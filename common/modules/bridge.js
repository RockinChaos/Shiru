/** @returns {void} */
const noopVoid = () => {}
/** @returns {Promise<void>} */
const noopAsyncVoid = async () => {}
/** @returns {Promise<boolean>} */
const noopAsyncBool = async () => false
/** @returns {Promise<string>} */
const noopAsyncArray = async () => []
/** @returns {Promise<string>} */
const noopAsyncString = async () => ''

/** Safe fallback methods when the torrent preload is unavailable.
 * @type {Window["torrent"]}
 */
const torrentDefaults = {
  reload: noopVoid,
  onCrash: noopVoid,
  onRequest: noopVoid,
  debug: noopAsyncVoid,
  /** @returns {Promise<{missingCount: number, removedCount: number}>} */
  rescan: async () => ({ missingCount: 0, removedCount: 0 }),
  scrape: noopAsyncArray,
  stream: noopAsyncVoid,
  stage: noopAsyncVoid,
  complete: noopAsyncVoid,
  unload: noopAsyncVoid,
  untrack: noopAsyncVoid,
  reannounce: noopAsyncVoid,
  subscribe: noopAsyncVoid,
  getTorrentStats: async () => null,
  /** @returns {Promise<{total: number, free: number}>}  */
  getDiskSpace: async () => ({ total: 0, free: 0 }),
  getTracks: async () => null,
  getChapters: async () => null,
  onSubtitles: async () => null,
  offSubtitles: noopAsyncVoid,
  setPlayback: noopAsyncVoid,
  restoreSession: noopAsyncArray,
  launchExternal: noopAsyncVoid,
  updateNetwork: noopAsyncVoid,
  updateSettings: noopAsyncVoid,
  portRequest: noopAsyncVoid
}
const commonDefaults = {
  getAppVersion: noopAsyncString,
  getPlatformInfo: () => ({ platform: '', arch: '', flatpak: undefined, session: '', development: false, manualInstall: false }),
  getDeviceInfo: noopAsyncVoid,
  exportLog: noopAsyncVoid,
  resetLog: noopAsyncVoid,
  notify: noopVoid,
  windowReady: noopVoid,
  isWindowVisible: noopAsyncBool,
  openURI: noopAsyncVoid,
  pickFile: noopAsyncString,
  pickFolder: noopAsyncString,
  pickMediaFiles: async () => ({}),
  linkAccount: noopAsyncVoid,
  handleProtocol: noopVoid,
  /** @param {'stable' | 'nightly'} channel */
  setUpdateChannel: (channel = 'stable') => {},
  /** @param {'stable' | 'nightly'} channel */
  checkForUpdates: (channel = 'stable') => {},
  quitAndInstall: noopVoid,
  onUpdateAvailable: noopVoid,
  onUpdateDownloaded: noopVoid,
  onUpdateProgress: noopVoid,
  onUpdateAborted: noopVoid,
  onLobbyInvite: noopVoid,
  onRequestPage: noopVoid,
  onRequestModal: noopVoid,
  onProviderToken: noopVoid,
  onRequestPlay: noopVoid
}
const androidDefaults = {
  minimize: noopVoid,
  showSplash: noopVoid,
  toast: noopAsyncVoid,
  onBackButton: noopVoid,
  onAppStateChange: noopAsyncVoid,
  onPictureInPictureModeChanged: noopAsyncVoid,
  onMediaAction: noopAsyncVoid,
  setMediaSession: noopVoid,
  exitPiP: noopAsyncVoid,
  hideStatusBar: noopVoid,
  /** @param {'LIGHT' | 'DARK'} style */
  setSystemStyle: (style = 'LIGHT') => {},
  requestFileAccess: async () => ({ granted: true }),
  launchExternal: noopAsyncVoid
}
const electronDefaults = {
  exit: noopVoid,
  cacheFlushed: noopVoid,
  setDoH: noopVoid,
  getAngle: async () => 'default',
  setAngle: noopVoid,
  isMinimized: noopAsyncBool,
  isFullScreen: noopAsyncBool,
  onMinimize: noopVoid,
  onFullScreen: noopVoid,
  hideWindow: noopVoid,
  showAndFocus: noopVoid,
  onExitIntent: noopVoid,
  onFlushCache: noopVoid,
  openTorrentDevTools: noopVoid,
  openDevTools: noopVoid,
  setUnreadCount: noopVoid,
  setDiscordRPC: noopVoid,
  setPresence: noopVoid,
  clearPresence: noopVoid,
  showTextContextMenu: noopVoid,
  onSelectContextText: noopVoid,
  getYouTube: async () => 'https://www.youtube-nocookie.com'
}

export const TORRENT = window.torrent || torrentDefaults
export const COMMON = window.common || commonDefaults
export const ANDROID = window.android || androidDefaults
export const ELECTRON = window.electron || electronDefaults