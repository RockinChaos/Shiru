/* global PictureInPicture */
import { App as Capacitor } from '@capacitor/app'
import { Toast } from '@capacitor/toast'
import { Browser } from '@capacitor/browser'
import { IntentUri } from 'capacitor-intent-uri'
import { Filesystem } from '@capacitor/filesystem'
import { development, keyboardVisible} from '../main/util.js'
import { SplashScreen } from '@capacitor/splash-screen'
import { FileManager, MediaSession } from '../main/plugin.js'
import { ipcWire } from '../main/ipc.js'
import { SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core'
import { ForegroundService, Importance, ServiceType } from '@capawesome-team/capacitor-android-foreground-service'
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

if (typeof localStorage === 'undefined') {
  const data = {}
  globalThis.localStorage = {
    setItem: (k, v) => { data[k] = v },
    getItem: (k) => data[k] || null
  }
}

if (typeof indexedDB === 'undefined') {
  globalThis.indexedDB = fakeIndexedDB
}

// cordova screen orientation plugin is also used, and it patches global screen.orientation.lock

// hook into pip request, and use our own pip implementation, then instantly report exit pip
// this is more like DOM PiP, rather than video PiP
HTMLVideoElement.prototype.requestPictureInPicture = function () {
  PictureInPicture.enter(this.videoWidth, this.videoHeight, success => {
    this.dispatchEvent(new Event('leavepictureinpicture'))
    if (success) document.querySelector('.content-wrapper').requestFullscreen()
  }, error => {
    this.dispatchEvent(new Event('leavepictureinpicture'))
    console.debug(error)
  })
  return Promise.resolve({})
}

const STREAMING_FG_ID = 1001
ForegroundService.createNotificationChannel({
  id: 'external-playback',
  name: 'External Playback',
  description: 'Keeps Video Streaming To An External Player Active',
  importance: Importance.Min
})

const listeners = {}
let _port = null
let _portReady, _resolvePort
function resetPortReady() {
  _portReady = new Promise(resolve => { _resolvePort = resolve })
}
resetPortReady()

function addListener(type, callback) {
  if (!listeners[type]) listeners[type] = []
  listeners[type].push(callback)
}

function send(type, data, transfer) {
  _portReady.then(() => _port.postMessage({ type, data }, transfer))
}

function once(type, callback) {
  const wrapper = (data) => {
    callback(data)
    listeners[type] = listeners[type].filter(fn => fn !== wrapper)
  }
  if (!listeners[type]) listeners[type] = []
  listeners[type].push(wrapper)
}

window.torrent = {
  reload: () => ipcWire.send('torrent:reload'),
  onCrash: (callback) => {}, // Currently not used for Capacitor...
  onRequest: (callback) => ipcWire.on('torrent:onRequest', (event, opts) => callback(opts)),
  debug: (debug) => send('debug', debug),
  rescan: () => new Promise(resolve => {
    once('rescan_done', ({ missingCount, removedCount }) => resolve({ missingCount, removedCount }))
    send('rescan')
  }),
  scrape: (id, infoHashes) => new Promise(resolve => {
    function check(detail) {
      if (detail.id !== id) return
      resolve(detail.result)
      listeners['scrape_done'] = listeners['scrape_done'].filter(fn => fn !== check)
    }
    if (!listeners['scrape_done']) listeners['scrape_done'] = []
    listeners['scrape_done'].push(check)
    send('scrape', { id, infoHashes })
  }),
  stream: (id, hash, magnet, base64) => send('torrent', { id, hash, magnet, base64 }),
  stage: (id, hash) => send('stage', { id, hash }),
  complete: (hash) => send('complete', hash),
  unload: (data) => send('unload', data),
  untrack: (hash) => send('untrack', hash),
  reannounce: (hash) => send('reannounce', hash),
  onStats: (callback) => addListener('activity', callback),
  onFiles: (callback) => addListener('files', callback),
  onMagnet: (callback) => addListener('magnet', callback),
  onTracks: (callback) => addListener('tracks', callback),
  offTracks: () => { listeners['tracks'] = [] },
  onSubtitles: (cbSubtitle, cbFont, cbFiles) => {
    addListener('subtitle', cbSubtitle)
    addListener('file', cbFont)
    addListener('subtitleFile', cbFiles)
  },
  offSubtitles: () => {
    listeners['subtitle'] = []
    listeners['file'] = []
    listeners['subtitleFile'] = []
  },
  onChapters: (callback) => addListener('chapters', callback),
  onProgress: (callback) => addListener('progress', callback),
  onCurrentStats: (callback) => addListener('stats', callback),
  onExternalReady: (callback) => { listeners['externalReady'] = [callback] },
  onExternalWatched: (callback) => { listeners['externalWatched'] = [callback] },
  onAndroidExternal: (callback) => { listeners['androidExternal'] = [callback] },
  onLoaded: (callback) => addListener('loaded', callback),
  onUntrack: (callback) => addListener('untrack', callback),
  onStage: (callback) => addListener('staging', callback),
  onSeed: (callback) => addListener('seeding', callback),
  onComplete: (callback) => addListener('completed', callback),
  onCompletedStats: (callback) => addListener('completedStats', callback),
  setPlayback: (current, external) => send('current', { current, external }),
  restoreSession: (staging, seeding, completed, current) => {
    if (staging) send('stage_all', staging)
    if (seeding) send('seed_all', seeding)
    if (completed) send('complete_all', completed)
    if (current) send('load', current)
  },
  launchExternal: (current) => send('externalPlay', { current }),
  updateNetwork: (status) => send('networking', status),
  updateSettings: (settings) => send('updateSettings', settings),
  onNotify: (callback) => {
    addListener('info', (detail) => callback('info', detail))
    addListener('warn', (detail) => callback('warn', detail))
    addListener('error', (detail) => callback('error', detail))
  },
  portRequest: async (settings) => {
    resetPortReady()
    _port = await ipcWire.invoke('torrent:portRequest', settings)
    _port.onmessage(({ data }) => {
      const cbs = listeners[data.type]
      if (cbs) cbs.forEach(callback => callback(data.data))
    })
    _resolvePort()
  }
}

window.common = {
  getAppVersion: async () => (await Capacitor.getInfo())?.version,
  getPlatformInfo: () => ({
    platform: globalThis.cordova?.platformId,
    arch: navigator.platform?.split(' ')?.[1],
    development
  }),
  getDeviceInfo: async () => ipcWire.invoke('common:getDeviceInfo'),
  exportLog: async () => ipcWire.invoke('common:exportLog'),
  resetLog: async () => ipcWire.invoke('common:resetLog'),
  notify: (opts) => ipcWire.send('common:notify', opts),
  windowReady: () => ipcWire.send('common:windowReady'),
  isWindowVisible: async () => true, // Currently not used for Capacitor...
  openURI: async (uri) => Browser.open({ url: uri }),
  pickFile: async (title) => '', // Currently not used for Capacitor...
  pickFolder: async (title) => ipcWire.invoke('common:pickFolder'),
  linkAccount: async (uri) => {
    Browser.open({ url: uri })
    return null // no token
  },
  handleProtocol: (data) => ipcWire.send('common:handleProtocol', data),
  setUpdateChannel: (channel) => ipcWire.send('common:setUpdateChannel', channel),
  checkForUpdates: (channel) => ipcWire.send('common:checkForUpdates', channel),
  onUpdateAvailable: (callback) => ipcWire.on('common:onUpdateAvailable', (event, updateVersion) => callback(updateVersion)),
  onUpdateDownloaded: (callback) => {}, // Currently not used in updating for Capacitor...
  onUpdateProgress: (callback) => ipcWire.on('common:onUpdateProgress', (event, progress) => callback(progress)),
  onUpdateAborted: (callback) => ipcWire.on('common:onUpdateAborted', (event, aborted) => callback(aborted)),
  quitAndInstall: () => ipcWire.send('common:quitAndInstall'),
  onLobbyInvite: (callback) => ipcWire.on('common:onLobbyInvite', (event, link) => callback(link)),
  onRequestPage: (callback) => ipcWire.on('common:onRequestPage', (event, page) => callback(page)),
  onRequestModal: (callback) => ipcWire.on('common:onRequestModal', (event, modal, opts) => callback(modal, opts)),
  onProviderToken: (callback) => ipcWire.on('common:onProviderToken', (event, provider, opts) => callback(provider, opts)),
  onRequestPlay: (callback) => ipcWire.on('common:onRequestPlay', (event, opts) => callback(opts))
}

window.android = {
  /**
   * Sends the app to the background.
   *
   * Any type of force exit of the app causes WebView to crash (e.g. #exitApp), this is a WebView bug!
   * The next time the user tries to open the app, it will forcibly close requiring them to open it again...
   * We prefer to use #minimizeApp instead as it is a safe paused state.
   */
  minimize: () => Capacitor.minimizeApp(),
  /** Shows the native Android splash screen. */
  showSplash: () => SplashScreen.show({ autoHide : false }),
  /**
   * Displays a native toast notification.
   * @param {string} text The message to display.
   * @param {'short'|'long'} duration How long the toast is visible.
   */
  toast: async (text, duration = 'short') => await Toast.show({ text, duration, position: 'bottom' }),
  /**
   * Listens for system back button presses.
   *
   * @param {(event: any) => void} callback
   */
  onBackButton: (callback) => Capacitor.addListener('backButton', callback),
  /**
   * Listens for the app moving between the foreground and background.
   *
   * @param {(isActive: boolean) => void} callback
   */
  onAppStateChange: (callback) => Capacitor.addListener('appStateChange', ({ isActive }) => callback(isActive)),
  /**
   * Listens for native Android PiP mode changes.
   *
   * @param {(isInPictureInPictureMode: boolean) => void} callback
   */
  onPictureInPictureModeChanged: (callback) => MediaSession.onPictureInPictureModeChanged(callback),
  /**
   * Listens for playback actions from Android media controls.
   *
   * @param {(action: 'play' | 'pause' | 'last' | 'next' | 'seek', position?: number) => void} callback
   */
  onMediaAction: (callback) => MediaSession.onAction(callback),
  /**
   * Activates Android media controls and keeps their playback state in sync.
   *
   * @param {{ active: boolean, playing?: boolean, title?: string, subtitle?: string, artwork?: string, position?: number, duration?: number, playbackRate?: number, hasLast?: boolean, hasNext?: boolean }} state
   */
  setMediaSession: (state) => MediaSession.setPlaybackState(state),
  /** Brings the player activity out of PiP and back to the foreground. */
  exitPiP: () => MediaSession.exitPiP(),
  /** Hides the status bar if the keyboard is not visible. */
  hideStatusBar: () => {
    if (!keyboardVisible) SystemBars.hide({ bar: SystemBarType.StatusBar })
  },
  /**
   * Sets the system bar icon and text style to light or dark.
   *
   * @param {'LIGHT' | 'DARK'} style The style to apply to the system bars.
   */
  setSystemStyle: (style) => SystemBars.setStyle({ style: style === 'LIGHT' ? SystemBarsStyle.Light : SystemBarsStyle.Dark }),
  /**
   * Requests "All Files" access permission when needed, resolves with granted `true` if access is granted, or `false` if denied.
   *
   * @returns {Promise<{ granted: boolean, error?: string | null }>} Resolves with granted `true` when access is granted, otherwise `false`.
   */
  requestFileAccess: async () => {
    if ((await Filesystem.requestPermissions()).publicStorage !== 'granted') return { granted: false, error: 'You are missing permissions to read and write to the selected download folder. Please enable storage access for this app in your device settings. Dismiss this toast to enable storage access.' }
    else if (await FileManager.hasAllFilesAccess()) return { granted: true }
    FileManager.requestAllFilesAccess()
    return new Promise((resolve) => {
      const listener = Capacitor.addListener('appStateChange', async (state) => {
        if (state.isActive) {
          listener.remove()
          if (await FileManager.hasAllFilesAccess()) resolve({ granted: true })
          else resolve({ granted: false, error: 'To reliably use a different torrent download location, please enable All Files Access for this app in your device settings. Dismiss this toast to enable all file access.' })
        }
      })
    })
  },
  /**
   * Launches an external playback intent and shows a foreground service while playback is active, resolves when the app returns to the foreground.
   *
   * @param {string} url - The intent URL to launch externally.
   * @returns {Promise<void>} Resolves when the app returns and the service stops.
   */
  launchExternal: (url) => {
    ForegroundService.startForegroundService({
      id: STREAMING_FG_ID,
      title: 'External Playback',
      body: 'Delivering Content To Your External Player',
      smallIcon: 'ic_filled',
      notificationChannelId: 'external-playback',
      serviceType: ServiceType.MediaPlayback,
      silent: true
    })
    return new Promise((resolve) => {
      IntentUri.openUri({ url }).then(() => {
        ForegroundService.stopForegroundService()
        resolve()
      })
    })
  }
}
