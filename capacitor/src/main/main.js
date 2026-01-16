/* globals AndroidFullScreen, PictureInPicture */
import { StatusBar, Style } from '@capacitor/status-bar'
import { SafeArea } from 'capacitor-plugin-safe-area'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Keyboard } from '@capacitor/keyboard'
import { Device } from '@capacitor/device'
import { FolderPicker } from 'capacitor-folder-picker'
//import { Filesystem } from '@capacitor/filesystem'
import { toast } from 'svelte-sonner'
import { IPC } from '../preload/preload.js'

IPC.on('open', url => Browser.open({ url }))

let lastScrollY = null
let scrollContainer = null
Keyboard.addListener('keyboardWillShow', info => {
  const active = document.activeElement
  if (!active || !['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return
  scrollContainer = active.closest('.scroll-container')
  if (!scrollContainer) return
  const scrollableContainer = getClosestScrollable(scrollContainer)
  if (!scrollableContainer) return
  const rect = active.getBoundingClientRect()
  const visibleArea = window.innerHeight - info.keyboardHeight
  if (rect.bottom > visibleArea) {
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }
    lastScrollY = scrollableContainer.scrollTop
    scrollContainer.style.paddingBottom = (info.keyboardHeight) + 'px'
    const visibleHeight = visibleArea
    if (rect.bottom > visibleHeight) scrollableContainer.scrollBy({ top: (rect.bottom - visibleHeight), behavior: 'smooth' })
  }
})

let hideTimeout = null
Keyboard.addListener('keyboardWillHide', () => {
  if (lastScrollY != null && scrollContainer) {
    const scrollableContainer = getClosestScrollable(scrollContainer)
    if (scrollableContainer) scrollableContainer.scrollTo({ top: lastScrollY, behavior: 'smooth' })
    const _scrollContainer = scrollContainer
    hideTimeout = setTimeout(() => _scrollContainer.style.paddingBottom = '', 250)
    lastScrollY = null
    scrollContainer = null
  }
})

function getClosestScrollable(element) {
  let current = element
  while (current) {
    const style = window.getComputedStyle(current)
    if (/(auto|scroll)/.test(style.overflowY)) return current
    current = current.parentElement
  }
  return null
}

// Clever hack to recenter and focus active elements (causes keyboardWillShow to trigger)
window.addEventListener('orientationchange', () => {
  const active = document.activeElement
  if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
    active.blur()
    requestAnimationFrame(() => setTimeout(() => active.focus(), 800))
  }
})

App.addListener('appUrlOpen', ({ url }) => {
  // if (url.startsWith('content://')) handleTorrentFile(url)
  handleProtocol(url)
})

let canShowNotifications = false

LocalNotifications.checkPermissions().then(async value => {
  if (value) {
    try {
      await LocalNotifications.requestPermissions()
      canShowNotifications = true
    } catch (e) {
      console.error(e)
    }
  }
})

LocalNotifications.registerActionTypes({
  types: [
    {
      id: 'view_anime',
      actions: [
        {
          id: 'view_anime',
          title: 'View Anime'
        }
      ]
    },
    {
      id: 'start_watching',
      actions: [
        {
          id: 'watch_anime',
          title: 'Start Watching'
        },
        {
          id: 'view_anime',
          title: 'View Anime'
        }
      ]
    },
    {
      id: 'continue_watching',
      actions: [
        {
          id: 'watch_anime',
          title: 'Resume'
        },
        {
          id: 'view_anime',
          title: 'View Anime'
        }
      ]
    },
    {
      id: 'watch_now',
      actions: [
        {
          id: 'watch_anime',
          title: 'Watch'
        },
        {
          id: 'view_anime',
          title: 'View Anime'
        }
      ]
    },
    {
      id: 'update_app',
      actions: [
        {
          id: 'update_now',
          title: 'Update Now'
        },
        {
          id: 'whats_new',
          title: `What's New`
        }
      ]
    }
  ]
})

let NOTIFICATION_FG_ID = 9001
IPC.on('notification', opts => {
  /** @type {import('@capacitor/local-notifications').LocalNotificationSchema} */
  const notification = {
    smallIcon: 'ic_filled',
    largeIcon: opts.icon || opts.iconXL,
    sound: 'ic_notification.wav',
    iconColor: '#2F4F4F',
    id: NOTIFICATION_FG_ID++,
    title: opts.title,
    body: opts.message,
    actionTypeId: opts.button.length > 1 ? opts.button[0].text?.includes('Start') ? 'start_watching' : (opts.button[0].text?.includes('Continue') ? 'continue_watching' : (opts.button[0].text?.includes('Update') ? 'update_app' : 'watch_now')) : 'view_anime',
    attachments: [{ id: 'my_preview', url: opts.heroImg || opts.iconXL || opts.icon }],
    extra: { buttons: opts.button }
  }
  if (canShowNotifications) LocalNotifications.schedule({ notifications: [notification] })
})


let handleNotifications = false
IPC.on('portRequest', () => handleNotifications = true)
LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
  const url = notification.actionId === 'watch_anime' || notification.actionId === 'update_now' ? notification.notification.extra?.buttons?.[0]?.activation : notification.notification.extra?.buttons?.[1]?.activation
  if (url) {
    const checkInterval = setInterval(() => {
      if (handleNotifications) {
        clearInterval(checkInterval)
        window.location.href = url
      }
    }, 50)
  }
})

IPC.on('get-device-info', async () => {
  const deviceInfo = {
    features: {},
    info: await Device.getInfo(),
    cpu: {},
    ram: {}
  }
  IPC.emit('device-info', JSON.stringify(deviceInfo))
})

const STORAGE_TYPE_MAP = {
  primary: '/sdcard/',
  secondary: '/sdcard/'
}

IPC.on('dialog', async () => {
  const result = await FolderPicker.chooseFolder()
  const normalizedPath = decodeURIComponent(result.path)

  const [, uri, ...path] = normalizedPath.split(':')
  const [,, app, subpath, type, ...rest] = uri.split('/')

  if (app !== 'com.android.externalstorage.documents') return toast.error('Unverified app', { description: 'Expected com.android.externalstorage.documents, got: ' + app })
  if (rest.length) return toast.error('Unsupported uri', { description: 'Unexpected access type, got: tree/' + rest.join('/') })
  if (subpath !== 'tree') return toast.error('Unsupported subpath type', { description: 'Expected tree subpath, got: ' + subpath })

  let base = STORAGE_TYPE_MAP[type]
  if (!base) {
    if (!/[a-z0-9]{4}-[a-z0-9]{4}/i.test(type)) return toast.error('Unsupported storage type')
    base = `/storage/${type}/`
  }
  IPC.emit('path', base + path.join(''))
})

// schema: shiru://key/value
const protocolMap = {
  alauth: token => sendToken(token),
  malauth: token => sendMalToken(token),
  anime: id => IPC.emit('open-anime', { id }),
  malanime: id => IPC.emit('open-anime', { id, mal: true}),
  torrent: magnet => add(magnet),
  search: id => play(id),
  w2g: link => IPC.emit('w2glink', link),
  schedule: () => IPC.emit('schedule'),
  donate: () => Browser.open({ url: 'https://github.com/sponsors/RockinChaos/' }),
  update: () => IPC.emit('quit-and-install'),
  changelog: () => Browser.open({ url: 'https://github.com/RockinChaos/Shiru/releases/latest' }),
  show: () => IPC.emit('window-show')
}

const protocolRx = /shiru:\/\/([a-z0-9]+)\/(.*)/i

function handleProtocol (text) {
  // Handle magnet links
  if (text.startsWith('magnet:')) {
    add(text)
    return
  }

  // Handle shiru:// scheme
  const match = text.match(protocolRx)
  if (match) protocolMap[match[1]]?.(match[2])
}

/**
 * Handles opening a `.torrent` file and sends it as a `Uint8Array`
 * @param {string} fileUri - The path to the .torrent file
 */
// async function handleTorrentFile(fileUri) {
//   const fileContents = await Filesystem.readFile({ path: fileUri })
//   const binaryString = atob(fileContents.data)
//   const uint8Array = new Uint8Array(binaryString.length)
//   for (let i = 0; i < binaryString.length; i++) uint8Array[i] = binaryString.charCodeAt(i)
//   if (uint8Array.length === 0) throw new Error('Empty file or conversion failed')
//   add(uint8Array)
// }

function sendToken (line) {
  let token = line.split('access_token=')[1].split('&token_type')[0]
  if (token) {
    if (token.endsWith('/')) token = token.slice(0, -1)
    IPC.emit('altoken', token)
  }
}

function sendMalToken (line) {
  let code = line.split('code=')[1].split('&state')[0]
  let state = line.split('&state=')[1]
  if (code && state) {
    if (code.endsWith('/')) code = code.slice(0, -1)
    if (state.endsWith('/')) state = state.slice(0, -1)
    if (state.includes('%')) state = decodeURIComponent(state)
    IPC.emit('maltoken', code, state)
  }
}

/**
 * @param {string} id - The media id.
 */
function play(id) {
  IPC.emit('play-anime', id)
  IPC.emit('window-show')
}

/**
 * @param {string} magnet - The magnet link.
 */
function add(magnet) {
  IPC.emit('play-torrent', magnet)
  IPC.emit('window-show')
}

App.getLaunchUrl().then(res => {
  if (location.hash !== '#skipAlLogin') {
    location.hash = '#skipAlLogin'
    if (res) handleProtocol(res.url)
  } else {
    location.hash = ''
  }
})

SafeArea.addListener('safeAreaChanged', updateInsets)
screen.orientation.addEventListener('change', updateInsets)

async function updateInsets () {
  const { insets } = await SafeArea.getDisplayCutoutInsets()
  for (const [key, value] of Object.entries(insets)) {
    document.documentElement.style.setProperty(`--safe-area-${key}`, `${value}px`)
  }
}
updateInsets()

StatusBar.hide()
StatusBar.setStyle({ style: Style.Dark })
StatusBar.setOverlaysWebView({ overlay: true })

// cordova screen orientation plugin is also used, and it patches global screen.orientation.lock

// hook into pip request, and use our own pip implementation, then instantly report exit pip
// this is more like DOM PiP, rather than video PiP
HTMLVideoElement.prototype.requestPictureInPicture = function () {
  PictureInPicture.enter(this.videoWidth, this.videoHeight, success => {
    this.dispatchEvent(new Event('leavepictureinpicture'))
    if (success) document.querySelector('.content-wrapper').requestFullscreen()
  }, err => {
    this.dispatchEvent(new Event('leavepictureinpicture'))
    console.error(err)
  })

  return Promise.resolve({})
}
