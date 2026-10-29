import { contextBridge, ipcRenderer } from 'electron'
import { createRemote } from '@client/lib/remote.js'

/** Current worker transport; replaced when requesting a fresh connection.
 * @type {any}
 */
let torrentPort = null
/** @type {((error: Error) => void)|null} */
let cancelPortRequest = null
/** Awaitable proxy for the connected torrent worker.
 * @type {ReturnType<typeof createRemote>}
 */
const client = createRemote()
ipcRenderer.on('torrent:onCrash', () => {
  const error = new Error('Torrent worker crashed')
  cancelPortRequest?.(error)
  client.disconnect(error)
})

contextBridge.exposeInMainWorld('torrent', {
  /**
   * Requests a fresh torrent host and disconnects the current remote.
   * @returns {void}
   */
  reload: () => {
    cancelPortRequest?.(new Error('Torrent connection reloaded'))
    client.disconnect()
    ipcRenderer.send('torrent:reload')
  },
  /**
   * Registers a torrent-worker crash callback when supported by the platform.
   * @param {() => void} callback
   * @returns {any}
   */
  onCrash: (callback) => ipcRenderer.on('torrent:onCrash', callback),
  /**
   * Registers a callback for externally opened torrent requests.
   * @param {(request: any) => void} callback
   * @returns {any}
   */
  onRequest: (callback) => {
    ipcRenderer.on('torrent:onRequest', (event, updateVersion) => callback(updateVersion))
    ipcRenderer.send('torrent:rendererReady')
  },
  /**
   * Updates the worker debug filter
   * @param {string} debug Enabled debug namespaces
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
  portRequest: (settings) => new Promise((resolve, reject) => {
    cancelPortRequest?.(new Error('Torrent connection request superseded'))
    if (torrentPort) client.disconnect()
    torrentPort?.close()
    torrentPort = null
    const requestId = Date.now() + ':' + Math.random()
    const finish = error => {
      if (cancelPortRequest !== finish) return
      ipcRenderer.removeListener('torrent:port', onPort)
      cancelPortRequest = null
      if (error) {
        client.disconnect(error)
        reject(error)
      } else resolve()
    }
    const onPort = ({ ports }, data) => {
      if (data?.requestId !== requestId) {
        for (const port of ports) port.close()
        return
      }
      try {
        const port = ports[0]
        if (!port) throw new Error('Torrent message port is unavailable')
        torrentPort = port
        port.addEventListener('message', event => {
          if (torrentPort === port) client.receive(event)
        })
        port.addEventListener('messageerror', () => {
          if (torrentPort === port) client.disconnect(new Error('Torrent message could not be decoded'))
        })
        port.start()
        client.connect(port.postMessage.bind(port))
        finish()
      } catch (error) { finish(error) }
    }
    cancelPortRequest = finish
    ipcRenderer.on('torrent:port', onPort)
    ipcRenderer.invoke('torrent:portRequest', { settings, requestId }).catch(finish)
  })
})

contextBridge.exposeInMainWorld('common', {
  getAppVersion: () => ipcRenderer.invoke('common:getAppVersion'),
  getPlatformInfo: () => ({
    platform: process.platform,
    arch: process.arch,
    flatpak: process.env.FLATPAK_ID,
    session: process.env.XDG_SESSION_TYPE || '',
    development: process.env.NODE_ENV?.trim() === 'development',
    manualInstall: process.platform === 'darwin' || !!process.env.FLATPAK_ID || !!process.env.PORTABLE_EXECUTABLE_FILE
  }),
  getDeviceInfo: () => ipcRenderer.invoke('common:getDeviceInfo'),
  exportLog: () => ipcRenderer.invoke('common:exportLog'),
  resetLog: () => ipcRenderer.invoke('common:resetLog'),
  notify: (opts) => ipcRenderer.send('common:notify', opts),
  windowReady: () => ipcRenderer.send('common:windowReady'),
  isWindowVisible: () => ipcRenderer.invoke('common:isWindowVisible'),
  openURI: (uri) => ipcRenderer.invoke('common:openURI', uri),
  pickFile: (title) => ipcRenderer.invoke('common:pickFile', title),
  pickFolder: (title) => ipcRenderer.invoke('common:pickFolder', title),
  pickMediaFiles: () => ipcRenderer.invoke('common:pickMediaFiles'),
  linkAccount: (uri) => ipcRenderer.invoke('common:linkAccount', uri),
  handleProtocol: (data) => ipcRenderer.send('common:handleProtocol', data),
  setUpdateChannel: (channel) => ipcRenderer.send('common:setUpdateChannel', channel),
  checkForUpdates: (channel) => ipcRenderer.send('common:checkForUpdates', channel),
  onUpdateAvailable: (callback) => ipcRenderer.on('common:onUpdateAvailable', (event, updateVersion) => callback(updateVersion)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('common:onUpdateDownloaded', (event, updateVersion) => callback(updateVersion)),
  onUpdateProgress: (callback) => {}, // Currently not used in updating for Electron...
  onUpdateAborted: (callback) => ipcRenderer.on('common:onUpdateAborted', (event, aborted) => callback(aborted)),
  quitAndInstall: () => ipcRenderer.send('common:quitAndInstall'),
  onLobbyInvite: (callback) => ipcRenderer.on('common:onLobbyInvite', (event, link) => callback(link)),
  onRequestPage: (callback) => ipcRenderer.on('common:onRequestPage', (event, page) => callback(page)),
  onRequestModal: (callback) => ipcRenderer.on('common:onRequestModal',  (event, modal, opts) => callback(modal, opts)),
  onProviderToken: (callback) => ipcRenderer.on('common:onProviderToken', (event, provider, opts) => callback(provider, opts)),
  onRequestPlay: (callback) => ipcRenderer.on('common:onRequestPlay', (event, opts) => callback(opts))
})
contextBridge.exposeInMainWorld('electron', {
  exit: () => ipcRenderer.send('electron:Exit'),
  cacheFlushed: () => ipcRenderer.send('electron:cacheFlushed'),
  setDoH: (url) => ipcRenderer.send('electron:setDoH', url),
  getAngle: () => ipcRenderer.invoke('electron:getAngle'),
  setAngle: (angle) => ipcRenderer.send('electron:setAngle', angle),
  isMinimized: () => ipcRenderer.invoke('electron:isMinimized'),
  isFullScreen: () => ipcRenderer.invoke('electron:isFullScreen'),
  onMinimize: (callback) => ipcRenderer.on('electron:onMinimize', (event, isMinimized) => callback(isMinimized)),
  onFullScreen: (callback) => ipcRenderer.on('electron:onFullScreen', (event, isFullScreen) => callback(isFullScreen)),
  hideWindow: () => ipcRenderer.send('electron:hideWindow'),
  showAndFocus: () => ipcRenderer.send('electron:showAndFocus'),
  onExitIntent: (callback) => ipcRenderer.on('electron:onExitIntent', callback),
  onFlushCache: (callback) => ipcRenderer.on('electron:onFlushCache', callback),
  openTorrentDevTools: () => ipcRenderer.send('electron:openTorrentDevTools'),
  openDevTools: () => ipcRenderer.send('electron:openDevTools'),
  setUnreadCount: (notificationCount) => ipcRenderer.send('electron:setUnreadCount', notificationCount),
  setDiscordRPC: (state) => ipcRenderer.send('electron:setDiscordRPC', state),
  setPresence: (activity) => ipcRenderer.send('electron:setPresence', activity),
  clearPresence: () => ipcRenderer.send('electron:clearPresence'),
  showTextContextMenu: (options) => ipcRenderer.send('electron:showTextContextMenu', options),
  onSelectContextText: (callback) => ipcRenderer.on('electron:onSelectContextText', callback),
  getYouTube: () => ipcRenderer.invoke('electron:getYouTube')
})