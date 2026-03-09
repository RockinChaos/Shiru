/* globals AndroidFullScreen, PictureInPicture */
import { LocalNotifications } from '@capacitor/local-notifications'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SafeArea } from 'capacitor-plugin-safe-area'
import { Keyboard } from '@capacitor/keyboard'
import { NodeJS } from 'capacitor-nodejs'

import Debugger from './debugger.js'
import Protocol from './protocol.js'
import Updater from './updater.js'
import Dialog from './dialog.js'

import { cache, caches } from '@/modules/cache.js'
import { IPC } from '../preload/preload.js'
import { loadingClient } from './util.js'

export default class App {
  protocol = new Protocol()
  debugger = new Debugger()
  updater = new Updater('RockinChaos', 'Shiru')
  dialog = new Dialog()

  ready = NodeJS.whenReady()

  kbLastScrollY = null
  kbHideTimeout = null
  kbScrollContainer = null

  canNotify = false
  handleNotify = false
  NOTIFICATION_FG_ID = 9001
  notifyTypes = [
    {
      id: 'view_anime',
      actions: [{ id: 'view_anime', title: 'View Anime' }]
    },
    {
      id: 'start_watching',
      actions: [{ id: 'watch_anime', title: 'Start Watching' }, { id: 'view_anime', title: 'View Anime' }]
    },
    {
      id: 'continue_watching',
      actions: [{ id: 'watch_anime', title: 'Resume' }, { id: 'view_anime', title: 'View Anime' }]
    },
    {
      id: 'watch_now',
      actions: [{ id: 'watch_anime', title: 'Watch' }, { id: 'view_anime', title: 'View Anime' }]
    },
    {
      id: 'update_app',
      actions: [{ id: 'update_now', title: 'Update Now' }, { id: 'whats_new', title: `What's New` }]
    }
  ]

  constructor() {
    StatusBar.hide()
    StatusBar.setStyle({ style: Style.Dark })
    StatusBar.setOverlaysWebView({ overlay: true })

    this.updateSafeInsets()
    SafeArea.addListener('safeAreaChanged', this.updateSafeInsets)
    screen.orientation.addEventListener('change', this.updateSafeInsets)

    IPC.on('portRequest', async () => {
      window.port = {
        onmessage: cb => {
          NodeJS.addListener('ipc', ({ args }) => cb(args[0]))
        },
        postMessage: (data, b) => {
          NodeJS.send({ eventName: 'ipc', args: [{ data }] })
        }
      }
      await this.ready
      await cache.isReady
      this.handleNotify = true
      NodeJS.send({ eventName: 'port-init', args: [] })
      let stethoscope = true
      NodeJS.addListener('webtorrent-heartbeat', () => {
        if (stethoscope) {
          stethoscope = false
          NodeJS.send({ eventName: 'main-heartbeat', args: [{ ...cache.getEntry(caches.GENERAL, 'settings'), userID: cache.cacheID }] })
          NodeJS.addListener('torrentRequest', () => {
            NodeJS.send({ eventName: 'torrentPort', args: [] })
            IPC.emit('port')
          })
          loadingClient.resolve()
        }
      })
    })
    IPC.on('webtorrent-reload', () => NodeJS.send({eventName: 'webtorrent-reload', args: []}))

    // HACK: recenter and focus active elements (causes keyboardWillShow to trigger)
    window.addEventListener('orientationchange', () => {
      const active = document.activeElement
      if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
        active.blur()
        requestAnimationFrame(() => setTimeout(() => active.focus(), 800))
      }
    })
    Keyboard.addListener('keyboardWillHide', () => {
      if (this.kbLastScrollY != null && this.kbScrollContainer) {
        const scrollableContainer = this.keyboardScrollParent(this.kbScrollContainer)
        if (scrollableContainer) scrollableContainer.scrollTo({ top: this.kbLastScrollY, behavior: 'smooth' })
        const _scrollContainer = this.kbScrollContainer
        this.kbHideTimeout = setTimeout(() => _scrollContainer.style.paddingBottom = '', 250)
        this.kbLastScrollY = null
        this.kbScrollContainer = null
      }
    })
    Keyboard.addListener('keyboardWillShow', info => {
      const active = document.activeElement
      if (!active || !['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return
      this.kbScrollContainer = active.closest('.scroll-container')
      if (!this.kbScrollContainer) return
      const scrollableContainer = this.keyboardScrollParent(this.kbScrollContainer)
      if (!scrollableContainer) return
      const rect = active.getBoundingClientRect()
      const visibleArea = window.innerHeight - info.keyboardHeight
      if (rect.bottom > visibleArea) {
        if (this.kbHideTimeout) {
          clearTimeout(this.kbHideTimeout)
          this.kbHideTimeout = null
        }
        this.kbLastScrollY = scrollableContainer.scrollTop
        this.kbScrollContainer.style.paddingBottom = (info.keyboardHeight) + 'px'
        const visibleHeight = visibleArea
        if (rect.bottom > visibleHeight) scrollableContainer.scrollBy({ top: (rect.bottom - visibleHeight), behavior: 'smooth' })
      }
    })

    LocalNotifications.registerActionTypes({ types: this.notifyTypes })
    LocalNotifications.checkPermissions().then(value => {
      if (value?.display !== 'granted') {
        try {
          LocalNotifications.requestPermissions().then(() => this.canNotify = true)
        } catch (error) {
          console.debug(error)
        }
      } else this.canNotify = true
    })
    LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
      const url = notification.actionId === 'watch_anime' || notification.actionId === 'update_now' ? notification.notification.extra?.buttons?.[0]?.activation : notification.notification.extra?.buttons?.[1]?.activation
      if (url) {
        const checkInterval = setInterval(() => {
          if (this.handleNotify) {
            clearInterval(checkInterval)
            window.location.href = url
          }
        }, 50)
      }
    })
    IPC.on('notification', opts => {
      if (!this.canNotify) return
      LocalNotifications.schedule({
        notifications: [{
          smallIcon: 'ic_filled',
          largeIcon: opts.icon || opts.iconXL,
          sound: 'ic_notification.wav',
          iconColor: '#2F4F4F',
          id: this.NOTIFICATION_FG_ID++,
          title: opts.title,
          body: opts.message,
          actionTypeId: opts.button.length > 1 ? opts.button[0].text?.includes('Start') ? 'start_watching' : (opts.button[0].text?.includes('Continue') ? 'continue_watching' : (opts.button[0].text?.includes('Update') ? 'update_app' : 'watch_now')) : 'view_anime',
          attachments: [{ id: 'my_preview', url: opts.heroImg || opts.iconXL || opts.icon }],
          extra: { buttons: opts.button }
        }]
      })
    })

    IPC.on('quit-and-install', () => {
      if (this.updater.updateAvailable) this.updater.install(true)
    })
  }

  /**
   * Updates CSS variables with safe area insets from the device.
   * @returns {Promise<void>}
   */
  async updateSafeInsets() {
    const { insets } = await SafeArea.getDisplayCutoutInsets()
    for (const [key, value] of Object.entries(insets)) {
      document.documentElement.style.setProperty(`--safe-area-${key}`, `${value}px`)
    }
  }

  /**
   * Finds the closest scrollable parent element of a given container.
   *
   * @param {HTMLElement} container - Element to start searching from.
   * @returns {HTMLElement|null} Closest scrollable parent, or null if none found.
   */
  keyboardScrollParent(container) {
    let current = container
    while (current) {
      if (/(auto|scroll)/.test(window.getComputedStyle(current)?.overflowY)) return current
      current = current.parentElement
    }
    return null
  }
}