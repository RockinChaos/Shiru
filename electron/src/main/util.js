import { promises, unlink, rmSync, readFileSync } from 'fs'
import { app, ipcMain, shell, screen, nativeImage } from 'electron'
import { join } from 'path'

import Store from './store.js'

export const store = new Store(app.getPath('userData'), 'persist.json', { angle: 'default' })
export const development = process.env.NODE_ENV?.trim() === 'development'
export const windowBounds = { minWidth: 320, minHeight: 390 }
export const timeouts = new Set()

const flags = [
  // Wayland GPU workaround that targeted Intel Iris.
  // Older Electron had weaker Wayland GPU support, newer versions handle it better. Using this now cause issues with hardware-accelerated decoding and shutdown hangs.
  // ...(process.env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland' ? [['in-process-gpu']] : []),

  // GPU / rendering pipeline overrides (behavior varies across hardware and driver versions)
  ['disable-gpu-sandbox'], ['disable-direct-composition-video-overlays'], ['double-buffer-compositing'], ['enable-zero-copy'], ['ignore-gpu-blocklist'], ['force_high_performance_gpu'],
  // Overlay behavior (generally safe, affects fullscreen layering behavior)
  ['enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay'],
  // Safe performance-related features
  ['enable-features', 'PlatformEncryptedDolbyVision,CanvasOopRasterization,ThrottleDisplayNoneAndVisibilityHiddenCrossOriginIframes,UseSkiaRenderer,WebAssemblyLazyCompilation,AutoPictureInPictureForVideoPlayback'],
  // Note: FluentOverlayScrollbars and WindowsScrollingPersonality were used for smoother scrolling, but both have been deprecated and disabled by Chromium (see: https://issues.chromium.org/issues/359747082)

  // Disables Chromium UI layering behavior (WidgetLayering)
  ['disable-features', 'WidgetLayering'],
  // Legacy Chromium media engagement: ['disable-features', 'MediaEngagementBypassAutoplayPolicies,PreloadMediaEngagementData,RecordMediaEngagementScores']

  // Chromium behavior overrides (permissions, process model, throttling, media policy)
  ['autoplay-policy', 'no-user-gesture-required'], ['disable-notifications'], ['disable-logging'], ['disable-permissions-api'], ['no-zygote'], ['disable-renderer-backgrounding'],
  // Network throttling override (prevents Chromium from downscaling behavior on slow networks)
  ['force-effective-connection-type', '4G'],
  // Cache sizing (can improve media/image responsiveness, tradeoff is disk usage)
  ['disk-cache-size', '500000000']
]
for (const [flag, value] of flags) app.commandLine.appendSwitch(flag, value)
app.commandLine.appendSwitch('use-angle', store.get('angle') || 'default')

ipcMain.handle('common:getAppVersion', () => getAppVersion())
ipcMain.handle('common:openURI', (event, uri) => shell.openExternal(uri))
ipcMain.handle('electron:getAngle', () => store.get('angle') || 'default')
ipcMain.on('electron:setAngle', (event, angle) => store.set('angle', angle))
ipcMain.on('electron:setDoH', (event, dns) => {
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

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

export function toXmlString(opts) {
  const binding = []
  if (opts.title) binding.push(`<text><![CDATA[${opts.title}]]></text>`)
  if (opts.message) binding.push(`<text><![CDATA[${opts.message}]]></text>`)
  if (opts.icon) { // noinspection HtmlUnknownAttribute
    binding.push(`<image placement="appLogoOverride" hint-crop="none" src="${escapeXml(opts.icon)}"/>`)
  }
  if (opts.heroImg) { // noinspection HtmlUnknownAttribute
    binding.push(`<image placement="hero" src="${escapeXml(opts.heroImg)}"/>`)
  }
  if (opts.inlineImg) { // noinspection HtmlUnknownAttribute
    binding.push(`<image src="${escapeXml(opts.inlineImg)}"/>`)
  }
  const actions = (opts.button || []).map(button => `<action content="${escapeXml(button.text)}" arguments="${escapeXml(button.activation)}" activationType="protocol"/>`).join('')
  const launch = opts.activation?.launch ? ` launch="${escapeXml(opts.activation.launch)}" activationType="protocol"` : ''
  return `<?xml version="1.0" encoding="UTF-8"?><toast${launch}><visual><binding template="ToastGeneric">${binding.join('')}</binding></visual>${actions ? `<actions>${actions}</actions>` : ''}</toast>`
}


const imageCache = new Map()
const imageDir = join(app.getPath('userData'), 'Cache', 'Image_Data')
try {
  rmSync(imageDir, { recursive: true, force: true })
} catch {}
export async function getImage(id, url, wideScreen) {
  const cacheKey = `${id}_${url}_${wideScreen}`
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey)
  const res = await fetch(url)
  const arrayBuffer = await res.arrayBuffer()
  const uniqueName = `${id}_${wideScreen ? 'wide' : 'square'}.png`
  const imagePath = join(imageDir, uniqueName)
  const image = nativeImage.createFromBuffer(Buffer.from(arrayBuffer))
  const { width, height } = image.getSize()
  imageCache.set(cacheKey, imagePath)
  let cropped
  if (wideScreen) {
    if (width / height > (16 / 9)) {
      const adjWidth = Math.floor(height * (16 / 9))
      cropped = image.crop({ x: Math.floor((width - adjWidth) / 2), y: 0, width: adjWidth, height })
    } else {
      const adjHeight = Math.floor(width / (16 / 9))
      cropped = image.crop({ x: 0, y: Math.floor((height - adjHeight) / 2), width, height: adjHeight })
    }
  } else {
    const squareRatio = Math.min(width, height)
    cropped = image
      .crop({ x: Math.floor((width - squareRatio) / 2), y: Math.floor((height - squareRatio) / 2), width: squareRatio, height: squareRatio })
      .resize({ width: 128, height: 128, quality: 'best' })
  }
  try {
    await promises.mkdir(imageDir, { recursive: true })
    await promises.writeFile(imagePath, cropped.toPNG())
  } catch { imageCache.delete(cacheKey) }
  if (imageCache.has(cacheKey)) {
    const timeout = setTimeout(() => {
      timeouts.delete(timeout)
      try {
        unlink(imagePath, () => imageCache.delete(cacheKey))
      } catch {
        imageCache.delete(cacheKey)
      }
    }, 90_000)
    timeout.unref?.()
    timeouts.add(timeout)
  }
  return imagePath
}

export function getWindowState() {
  const state = store.get('windowState') || {}
  return {
    bounds: getUsableBounds(state.bounds),
    isMaximized: state.isMaximized === true
  }
}

export function saveWindowState(window) {
  if (!window || window.isDestroyed() || window.isMinimized()) return
  const normalBounds = window.getNormalBounds()
  let bounds = normalBounds
  const isFullScreen = window.isFullScreen()
  if (window.isMaximized() || isFullScreen) {
    // The normal rectangle can remain on the previous display after a maximized or fullscreen move
    const currentDisplay = screen.getDisplayMatching(window.getBounds()).workArea
    const normalDisplay = screen.getDisplayMatching(normalBounds).workArea
    bounds = {
      ...normalBounds,
      x: currentDisplay.x + normalBounds.x - normalDisplay.x,
      y: currentDisplay.y + normalBounds.y - normalDisplay.y
    }
  }
  store.set('windowState', {
    bounds: getUsableBounds(bounds),
    isMaximized: isFullScreen ? store.get('windowState')?.isMaximized === true : window.isMaximized()
  })
}

export function getDefaultBounds() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  const windowWidth = Math.max(windowBounds.minWidth, Math.min(width, Math.floor(width * 0.75)))
  const windowHeight = Math.max(windowBounds.minHeight, Math.min(height, Math.floor(height * 0.75)))
  return {
    width: windowWidth,
    height: windowHeight,
    x: x + Math.floor((width - windowWidth) / 2),
    y: y + Math.floor((height - windowHeight) / 2)
  }
}

function getUsableBounds(bounds) {
  const fallback = getDefaultBounds()
  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width < windowBounds.minWidth || bounds.height < windowBounds.minHeight) return fallback

  let workArea = screen.getPrimaryDisplay().workArea
  if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
    let largestOverlap = 0
    for (const display of screen.getAllDisplays()) {
      const area = display.workArea
      const overlap = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)) *
        Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y))
      if (overlap > largestOverlap) {
        largestOverlap = overlap
        workArea = area
      }
    }
    if (!largestOverlap) return fallback
  }

  const { x, y, width, height } = workArea
  const windowWidth = Math.min(bounds.width, width)
  const windowHeight = Math.min(bounds.height, height)
  return {
    width: windowWidth,
    height: windowHeight,
    x: Number.isFinite(bounds.x) ? Math.max(x, Math.min(bounds.x, x + width - windowWidth)) : x + Math.floor((width - windowWidth) / 2),
    y: Number.isFinite(bounds.y) ? Math.max(y, Math.min(bounds.y, y + height - windowHeight)) : y + Math.floor((height - windowHeight) / 2)
  }
}

function getAppVersion() {
  if (app.isPackaged) return app.getVersion()
  try {
    return JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')).version
  } catch (error) {
    console.debug('Failed to read version from package.json', error)
    return app.getVersion()
  }
}
