/* global PictureInPicture */
import { App as Capacitor } from '@capacitor/app'
import { Toast } from '@capacitor/toast'
import { Browser } from '@capacitor/browser'
import { IntentUri } from 'capacitor-intent-uri'
import { Filesystem } from '@capacitor/filesystem'
import { development, keyboardVisible} from '../main/util.js'
import { SplashScreen } from '@capacitor/splash-screen'
import { FileManager, MediaSession } from '../main/plugin.js'
import { createRemote } from '@client/lib/remote.js'
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

/** Current worker transport; replaced when requesting a fresh connection.
 * @type {any}
 */
let torrentPort = null
/** @type {string|null} */
let portRequest = null
/** Awaitable proxy for the connected torrent worker.
 * @type {ReturnType<typeof createRemote>}
 */
const client = createRemote(undefined, (method, data) => {
  if ((method === 'streamTorrent' || method === 'stageTorrent') && data.id instanceof Uint8Array) {
    return { ...data, id: btoa(Array.from(data.id, byte => String.fromCharCode(byte)).join('')), base64: true }
  }
  return data
})

window.torrent = {
  /**
   * Requests a fresh torrent host and disconnects the current remote.
   * @returns {void}
   */
  reload: () => {
    portRequest = null
    client.disconnect()
    ipcWire.send('torrent:reload')
  },
  /**
   * Registers a torrent-worker crash callback when supported by the platform.
   * @param {() => void} callback
   * @returns {any}
   */
  onCrash: (callback) => {}, // Currently not used for Capacitor...
  /**
   * Registers a callback for externally opened torrent requests.
   * @param {(request: any) => void} callback
   * @returns {any}
   */
  onRequest: (callback) => ipcWire.on('torrent:onRequest', (event, opts) => callback(opts)),
  /**
   * Updates the worker debug filter.
   * @param {string} debug Enabled debug namespaces.
   * @returns {Promise<void>}
   */
  debug: async (debug) => (await client).setDebug(debug),
  /**
   * Rescans cached torrent files.
   * @returns {Promise<{missingCount: number, removedCount: number}>}
   */
  rescan: async () => (await client).rescan(),
  /**
   * Retrieves tracker statistics for torrent hashes.
   * @param {string[]} infoHashes Hashes to scrape.
   * @returns {Promise<object[]>}
   */
  scrape: async (infoHashes) => (await client).scrape(infoHashes),
  /**
   * Loads a torrent for playback and reports its playable files.
   * @param {string|Uint8Array} id Magnet, hash, torrent bytes, or encoded torrent file.
   * @param {string|false} hash Known hash when available.
   * @param {boolean} magnet Whether the request originated from a magnet link.
   * @param {boolean} base64 Whether id contains base64-encoded torrent bytes.
   * @param {(files: object[], magnet: {magnet: string, hash: string}) => void} [onReady] Receives playable files and magnet information.
   * @returns {Promise<object|void>}
   */
  stream: async (id, hash, magnet, base64, onReady) => (await client).streamTorrent({ id, hash, magnet, base64 }, onReady),
  /**
   * Queues a torrent for background downloading.
   * @param {string|Uint8Array} id Torrent identifier or bytes.
   * @param {string} hash Known torrent hash.
   * @param {boolean} [base64] Whether id contains base64-encoded torrent bytes.
   * @returns {Promise<object|void>}
   */
  stage: async (id, hash, base64) => (await client).stageTorrent({ id, hash, base64 }),
  /**
   * Stops an active torrent and applies the persistence setting.
   * @param {string} hash
   * @returns {Promise<void>}
   */
  complete: async (hash) => (await client).complete(hash),
  /**
   * Unloads current playback or an explicitly selected torrent.
   * @param {any} data Torrent descriptor, or null for current playback.
   * @returns {Promise<void>}
   */
  unload: async (data) => (await client).unload(data),
  /**
   * Removes a torrent and its persisted files.
   * @param {string} hash
   * @returns {Promise<void>}
   */
  untrack: async (hash) => (await client).untrack(hash),
  /**
   * Requests fresh peer information for a torrent.
   * @param {string} hash
   * @returns {Promise<void>}
   */
  reannounce: async (hash) => (await client).reannounceTorrent(hash),
  /**
   * Registers renderer notification and torrent lifecycle callbacks.
   * @param {(level: string, message: string) => void} onNotify Displays worker and RPC errors.
   * @param {(infoHash: string|null, update: object) => void} onUpdate Applies torrent lifecycle updates.
   * @returns {Promise<void>}
   */
  subscribe: async (onNotify, onUpdate) => {
    (await client).setErrorHandler(error => onNotify('error', error.message))
    return (await client).subscribe(onNotify, onUpdate)
  },
  /**
   * Reads one active torrent snapshot without its piece map.
   * @param {string} infoHash
   * @returns {Promise<object|null>}
   */
  getTorrentStats: async (infoHash) => (await client).getTorrentStats(infoHash),
  /**
   * Reads capacity and free bytes for the torrent directory.
   * @returns {Promise<{total: number, free: number}>}
   */
  getDiskSpace: async () => (await client).getDiskSpace(),
  /**
   * Reads tracks from the current metadata parser.
   * @returns {Promise<any[]|null>}
   */
  getTracks: async () => (await client).metadata.getTracks(),
  /**
   * Reads chapter markers from the current metadata parser.
   * @returns {Promise<any[]|null>}
   */
  getChapters: async () => (await client).metadata.getChapters(),
  /**
   * Registers callbacks for streamed subtitles, fonts, and files.
   * @param {(packet: {subtitle: any, trackNumber: number}) => void} cbSubtitle Receives subtitle packets.
   * @param {(font: {url: string}) => void} cbFont Receives font URLs.
   * @param {(file: {name: string, url: string}) => void} cbFiles Receives subtitle files.
   * @returns {Promise<void|null>}
   */
  onSubtitles: async (cbSubtitle, cbFont, cbFiles) => (await client).metadata.onSubtitles(cbSubtitle, cbFont, cbFiles),
  /**
   * Stops subtitle delivery and buffering for the current metadata parser.
   * @returns {Promise<void|null>}
   */
  offSubtitles: async () => (await client).metadata.offSubtitles(),
  /**
   * Selects a torrent file and prepares internal or external playback.
   * @param {string} id Info hash of the torrent to play.
   * @param {string} path Path of the file within the torrent to play.
   * @param {boolean} external Whether to launch an external player.
   * @returns {Promise<true|void>}
   */
  setPlayback: async (id, path, external) => (await client).setPlayback(id, path, external),
  /**
   * Restores queued torrents, completed snapshots, and optional current playback.
   * @param {string[]|null} staging Staged torrent hashes.
   * @param {string[]|null} seeding Seeding torrent hashes.
   * @param {string[]|null} completed Completed torrent hashes.
   * @param {object|null} current Saved current torrent identifier.
   * @param {(files: object[], magnet: {magnet: string, hash: string}) => void} onReady Receives playable files.
   * @returns {Promise<object[]>} Restored completed snapshots.
   */
  restoreSession: async (staging, seeding, completed, current, onReady) => (await client).restoreSession(staging, seeding, completed, current, onReady),
  /**
   * Launches a desktop player or returns an Android playback intent.
   * @param {string} path
   * @param {() => void} [externalWatched]
   * @returns {Promise<string|void>}
   */
  launchExternal: async (path, externalWatched) => (await client).launchExternal(path, externalWatched),
  /**
   * Updates worker network availability.
   * @param {string} status
   * @returns {Promise<void>}
   */
  updateNetwork: async (status) => (await client).updateNetwork(status),
  /**
   * Updates torrent configuration and bandwidth limits.
   * @param {Record<string, any>} settings
   * @returns {Promise<void>}
   */
  updateSettings: async (settings) => (await client).updateSettings(settings),
  /**
   * Requests a worker message port and connects the remote client.
   * @param {Record<string, any>} settings
   * @returns {Promise<void>}
   */
  portRequest: async (settings) => {
    const requestId = Date.now() + ':' + Math.random()
    const assertRequest = () => {
      if (requestId !== portRequest) throw new Error('Torrent connection request superseded')
    }
    portRequest = requestId
    const previous = torrentPort
    torrentPort = null
    if (previous) client.disconnect()
    let port
    try {
      await previous?.close()
      assertRequest()
      port = await ipcWire.invoke('torrent:portRequest', { settings, requestId })
      assertRequest()
      await port.onmessage(event => {
        if (torrentPort === port) client.receive(event)
      })
      assertRequest()
      torrentPort = port
      client.connect(port.postMessage.bind(port))
    } catch (error) {
      await port?.close()
      if (requestId === portRequest) client.disconnect(error)
      throw error
    }
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
  pickMediaFiles: () => ipcWire.invoke('common:pickMediaFiles'),
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
   * @param {(event: any) => void} callback
   */
  onBackButton: (callback) => Capacitor.addListener('backButton', callback),
  /**
   * Listens for the app moving between the foreground and background.
   * @param {(isActive: boolean) => void} callback
   */
  onAppStateChange: (callback) => Capacitor.addListener('appStateChange', ({ isActive }) => callback(isActive)),
  /**
   * Listens for native Android PiP mode changes.
   * @param {(isInPictureInPictureMode: boolean) => void} callback
   */
  onPictureInPictureModeChanged: (callback) => MediaSession.onPictureInPictureModeChanged(callback),
  /**
   * Listens for playback actions from Android media controls.
   * @param {(action: 'play' | 'pause' | 'last' | 'next' | 'seek', position?: number) => void} callback
   */
  onMediaAction: (callback) => MediaSession.onAction(callback),
  /**
   * Activates Android media controls and keeps their playback state in sync.
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
   * @param {'LIGHT' | 'DARK'} style The style to apply to the system bars.
   */
  setSystemStyle: (style) => SystemBars.setStyle({ style: style === 'LIGHT' ? SystemBarsStyle.Light : SystemBarsStyle.Dark }),
  /**
   * Requests "All Files" access permission when needed, resolves with granted `true` if access is granted, or `false` if denied.
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
   * @param {string} url The intent URL to launch externally.
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
