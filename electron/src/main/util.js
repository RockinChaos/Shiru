import { app, ipcMain, shell, screen } from 'electron'
import Store from './store.js'

export const store = new Store(app.getPath('userData'), 'persist.json', { angle: 'default' })
export const development = process.env.NODE_ENV?.trim() === 'development'

const flags = [
  // fix for gpu crashing issue with wayland, this fix primarily targets intel iris... probably safe...? Doesn't work on wayland without this regardless.
  ...(process.env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland' ? [['in-process-gpu']] : []),
  // not sure if safe?
  ['disable-gpu-sandbox'], ['disable-direct-composition-video-overlays'], ['double-buffer-compositing'], ['enable-zero-copy'], ['ignore-gpu-blocklist'], ['force_high_performance_gpu'],
  // should be safe
  ['enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay'],
  // safe performance stuff
  ['enable-features', 'PlatformEncryptedDolbyVision,CanvasOopRasterization,ThrottleDisplayNoneAndVisibilityHiddenCrossOriginIframes,UseSkiaRenderer,WebAssemblyLazyCompilation,AutoPictureInPictureForVideoPlayback'],
  // Note: FluentOverlayScrollbars and WindowsScrollingPersonality were used for smoother scrolling, but both have been deprecated and disabled by Chromium (see: https://issues.chromium.org/issues/359747082)

  // disabling shit, vulkan rendering, widget layering aka right click context menus [I think] for macOS [I think], rest is for chromium detecting how much video it should buffer, hopefully it makes it buffer more
  ['disable-features', 'Vulkan,WidgetLayering,MediaEngagementBypassAutoplayPolicies,PreloadMediaEngagementData,RecordMediaEngagementScores'],
  // utility stuff, aka website security that's useless for a native app:
  ['autoplay-policy', 'no-user-gesture-required'], ['disable-notifications'], ['disable-logging'], ['disable-permissions-api'], ['no-zygote'], ['disable-renderer-backgrounding'],
  // chromium throttles stuff if it detects slow network, nono, this is native, don't do that
  ['force-effective-connection-type', '4G'],
  // image, and video cache hopefully lets video buffer more and remembers more images, might be bad to touch this?
  ['disk-cache-size', '500000000']
]
for (const [flag, value] of flags) app.commandLine.appendSwitch(flag, value)
app.commandLine.appendSwitch('use-angle', store.get('angle') || 'default')

ipcMain.on('open', (event, url) => shell.openExternal(url))
ipcMain.on('set:angle', (e, data) => store.set('angle', data))
ipcMain.on('version', ({ sender }) => sender.send('version', app.getVersion()))
ipcMain.handle('get:angle', () => store.get('angle') || 'default')
ipcMain.on('doh', (event, dns) => {
  try {
    app.configureHostResolver({
      secureDnsMode: 'secure',
      secureDnsServers: ['' + new URL(dns)]
    })
  } catch (e) {}
})

app.setJumpList?.([
  {
    name: 'Frequent',
    items: [
      {
        type: 'task',
        program: 'shiru://w2g/',
        title: 'Watch Together',
        description: 'Create a New Watch Together Lobby'
      },
      {
        type: 'task',
        program: 'shiru://donate/',
        title: 'Donate',
        description: 'Support This App'
      }
    ]
  }
])

let defaultBounds
export function getWindowState() {
  const state = store.get('windowState') || {}
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  defaultBounds = { width: Math.floor(screenWidth * 0.75), height: Math.floor(screenHeight * 0.75), x: undefined, y: undefined }
  let bounds = state.bounds || defaultBounds
  if (bounds.width > screenWidth || bounds.height > screenHeight) bounds = { ...defaultBounds }
  if (!isNaN(bounds.x) && !isNaN(bounds.y)) {
    const { width, height, x, y } = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).bounds
    if (bounds.x < x || bounds.y < y || bounds.x > x + width || bounds.y > y + height) {
      bounds.x = undefined
      bounds.y = undefined
    }
  }
  if (isNaN(bounds.x) || isNaN(bounds.y)) {
    bounds.x = Math.floor((screenWidth - bounds.width) / 2)
    bounds.y = Math.floor((screenHeight - bounds.height) / 2)
  }
  return { bounds, isMaximized: (state.isMaximized || false), isFullScreen: (state.isFullScreen || false) }
}

export function saveWindowState(window) {
  if (!window || window.isDestroyed()) return
  let bounds
  if (!window.isMaximized() && !window.isFullScreen()) bounds = window.getBounds()
  else bounds = store.get('windowState')?.bounds || defaultBounds
  store.set('windowState', { bounds,  isMaximized: window.isMaximized(), isFullScreen: window.isFullScreen() })
}

export function getDefaultBounds() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  return {
    width: defaultBounds.width,
    height: defaultBounds.height,
    x: Math.floor((screenWidth - defaultBounds.width) / 2),
    y: Math.floor((screenHeight - defaultBounds.height) / 2)
  }
}