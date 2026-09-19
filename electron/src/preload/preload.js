import { contextBridge, ipcRenderer } from 'electron'

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

contextBridge.exposeInMainWorld('torrent', {
  reload: () => ipcRenderer.send('torrent:reload'),
  onCrash: (callback) => ipcRenderer.on('torrent:onCrash', callback),
  onRequest: (callback) => ipcRenderer.on('torrent:onRequest', (event, updateVersion) => callback(updateVersion)),
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
  offTracks: () => listeners['tracks'] = [],
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
  onExternalReady: (callback) => listeners['externalReady'] = [callback],
  onExternalWatched: (callback) => listeners['externalWatched'] = [callback],
  onAndroidExternal: (callback) => listeners['androidExternal'] = [callback],
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
  portRequest: (settings) => new Promise(resolve => {
    resetPortReady()
    ipcRenderer.once('electron:torrentPort', ({ ports }) => {
      _port = ports[0]
      _port.addEventListener('message', ({ data }) => {
        const cbs = listeners[data.type]
        if (cbs) cbs.forEach(callback => callback(data.data))
      })
      _port.start()
      _resolvePort()
      resolve()
    })
    ipcRenderer.invoke('torrent:portRequest', settings)
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