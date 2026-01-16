const noop = () => {}
const noopAsyncVoid = async () => {}
const noopAsyncBool = async () => false
const androidDefaults = {
  requestFileAccess: noopAsyncBool,
  launchExternal: noopAsyncVoid
}
const electronDefaults = {
  isMinimized: noopAsyncBool,
  isFullScreen: noopAsyncBool,
  onMinimize: noop,
  onFullScreen: noop,
  getYouTube: async () => 'https://www.youtube-nocookie.com'
}

export const IPC = window.IPC
export const VERSION = window.version
export const ANDROID = window.android || androidDefaults
export const ELECTRON = window.electron || electronDefaults