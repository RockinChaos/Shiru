import { join } from 'node:path'
import process from 'node:process'

import { toXmlString } from 'powertoast'
import { youtubeServer } from './youtube.js'
import Jimp from 'jimp'
import fs from 'fs'

import { BrowserWindow, MessageChannelMain, Notification, Tray, Menu, nativeImage, app, dialog, ipcMain, powerMonitor, shell, session } from 'electron'
import electronShutdownHandler from '@paymoapp/electron-shutdown-handler'

import { development, getWindowState, saveWindowState, getDefaultBounds } from './util.js'
import Discord from './discord.js'
import Protocol from './protocol.js'
import Updater from './updater.js'
import Dialog from './dialog.js'
import Debug from './debugger.js'

export default class App {
  icon = nativeImage.createFromPath(join(__dirname, process.platform === 'win32' ? '/icon_filled.ico' : '/icon_filled.png'))
  trayIcon = process.platform === 'darwin' ? nativeImage.createFromPath(join(__dirname, '/trayMacOSTemplate.png')) : this.icon
  trayNotifyIcon = nativeImage.createFromPath(join(__dirname, process.platform === 'darwin' ? '/trayNotifyMacOSTemplate.png' : process.platform === 'win32' ? '/icon_filled_notify.ico' : '/icon_filled_notify.png'))

  timeouts = new Set()
  stateTimeout = null

  torrentLoad = null
  webtorrentWindow = this.makeWebTorrentWindow()

  isMinimized = false
  isFullScreen = false
  windowState = getWindowState()
  mainWindow = new BrowserWindow({
    ...this.windowState.bounds,
    minWidth: 320,
    minHeight: 390,
    frame: process.platform === 'darwin',
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: {
        color: 'rgba(47, 50, 65, 0)',
        symbolColor: '#eee',
        height: 28
      } } : {}),
    backgroundColor: '#17191c',
    autoHideMenuBar: true,
    webPreferences: {
      webSecurity: false,
      allowRunningInsecureContent: false,
      enableBlinkFeatures: 'FontAccess, AudioVideoTracks',
      backgroundThrottling: false,
      preload: join(__dirname, '/preload.js')
    },
    icon: this.icon,
    show: false
  })

  discord = new Discord(this.mainWindow)
  protocol = new Protocol(this.mainWindow)
  updater = new Updater(this.mainWindow, () => this.webtorrentWindow)
  dialog = new Dialog()
  tray = new Tray(this.trayIcon)
  imageDir = join(app.getPath('userData'), 'Cache', 'Image_Data')
  debug = new Debug()
  close = false
  ready = false
  notifications = {}

  constructor() {
    this.mainWindow.setMenuBarVisibility(false)
    this.mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    if (development) this.mainWindow.once('ready-to-show', () => this.showAndFocus(true))
    else ipcMain.once('main-ready', () => this.showAndFocus(true)) // HACK: Prevents the window from being shown while it's still loading. This is nice for production as the window can't be moved without the elements being rendered.
    ipcMain.on('torrent-devtools', () => this.webtorrentWindow.webContents.openDevTools({ mode: 'detach' }))
    ipcMain.on('ui-devtools', ({ sender }) => sender.openDevTools({ mode: 'detach' }))
    ipcMain.on('window-hide', () => this.mainWindow.hide())
    ipcMain.on('window-show', () => this.showAndFocus())
    ipcMain.on('minimize', () => this.mainWindow?.minimize())
    ipcMain.on('maximize', () => this.mainWindow?.isMaximized() ? this.mainWindow.unmaximize() : this.mainWindow.maximize())
    ipcMain.on('webtorrent-restart', () => this.setWebTorrentWindow(true))
    this.mainWindow.on('maximize', () => this.mainWindow.webContents.send('isMaximized', true))
    this.mainWindow.on('unmaximize', () => {
      saveWindowState(this.mainWindow)
      this.mainWindow.webContents.send('isMaximized', false)
    })
    const minimize = (isMinimized) => {
      this.isMinimized = isMinimized
      this.mainWindow.webContents.send('electron:onMinimize', !isMinimized)
    }
    ipcMain.handle('electron:isMinimized', () => this.isMinimized)
    this.mainWindow.on('minimize', () => minimize(true))
    this.mainWindow.on('hide', () => minimize(true))
    this.mainWindow.on('restore', () => minimize(false))
    this.mainWindow.on('show', () => minimize(false))
    const debounceState = () => {
      clearTimeout(this.stateTimeout)
      this.stateTimeout = setTimeout(() => saveWindowState(this.mainWindow), 150)
      this.stateTimeout.unref?.()
    }
    this.mainWindow.on('resize', debounceState)
    this.mainWindow.on('move', debounceState)
    const fullScreen = (isFullScreen) => {
      this.isFullScreen = isFullScreen
      this.mainWindow.webContents.send('electron:onFullScreen', isFullScreen)
    }
    ipcMain.handle('electron:isFullScreen', () => this.isFullScreen)
    this.mainWindow.on('enter-full-screen', () => fullScreen(true))
    this.mainWindow.on('leave-full-screen', () => fullScreen(false))

    this.setWebTorrentWindow()
    this.mainWindow.on('closed', () => this.destroy())
    ipcMain.on('close', () => { this.close = true; this.destroy() })

    ipcMain.on('close-prompt', () => {
      this.showAndFocus()
      this.mainWindow.webContents.send('window-close')
    })

    this.mainWindow.on('close', (event) => {
      if (!this.close) {
        event.preventDefault()
        this.showAndFocus()
        this.mainWindow.webContents.send('window-close')
      }
    })

    app.on('before-quit', e => {
      if (this.destroyed) return
      e.preventDefault()
      this.destroy()
    })

    powerMonitor.on('shutdown', e => {
      if (this.destroyed) return
      e.preventDefault()
      this.destroy()
    })

    this.createTray()

    fs.rmSync(this.imageDir, { recursive: true, force: true })
    ipcMain.on('notification-unread', async (e, notificationCount) => this.setTrayIcon(notificationCount))
    ipcMain.on('notification', async (e, opts) => {
      opts.icon = opts.icon ? ((await this.getImage(opts.id, opts.icon)) || this.icon) : this.icon
      let notification
      if (process.platform === 'win32') {
        opts.heroImg &&= await this.getImage(opts.id, opts.heroImg, true)
        opts.inlineImg &&= await this.getImage(opts.id, opts.inlineImg)
        notification = new Notification({ toastXml: toXmlString(opts) })
      } else {
        const simpleOpts = { title: opts.title, body: opts.message, icon: opts.icon }
        if (process.platform === 'darwin' && opts.button && opts.button.length) simpleOpts.actions = opts.button.map(button => ({ type: 'button', text: button.text }))
        notification = new Notification(simpleOpts)
        notification.on('click', () => {
          if (opts.activation?.launch) shell.openExternal(opts.activation.launch)
        })
        if (process.platform === 'darwin') {
          notification.on('action', (event, index) => {
            if (opts.button && opts.button[index]) shell.openExternal(opts.button[index].activation)
          })
        }
      }
      notification.show()
    })

    if (process.platform === 'win32') {
      app.setAppUserModelId('com.github.rockinchaos.shiru')
      // this message usually fires in dev-mode from the parent process
      process.on('message', data => {
        if (data === 'graceful-exit') this.destroy()
      })
      electronShutdownHandler.setWindowHandle(this.mainWindow.getNativeWindowHandle())
      electronShutdownHandler.blockShutdown('Saving torrent data...')
      electronShutdownHandler.on('shutdown', async () => {
        await this.destroy()
        electronShutdownHandler.releaseShutdown()
      })
    } else {
      process.on('SIGTERM', () => this.destroy())
    }

    this.mainWindow.loadURL(development ? 'http://localhost:5000/app.html' : `file://${join(__dirname, '/app.html')}`)

    if (development) this.mainWindow.webContents.openDevTools({ mode: 'detach' })

    let crashcount = 0
    this.mainWindow.webContents.on('render-process-gone', async (e, { reason }) => {
      if (reason === 'crashed') {
        if (++crashcount > 10) {
          await dialog.showMessageBox({ message: 'Crashed too many times.', title: 'Shiru', detail: 'App crashed too many times. For a fix visit https://github.com/RockinChaos/Shiru/wiki/faq/', icon: '/renderer/public/icon_filled.png' })
          shell.openExternal('https://github.com/RockinChaos/Shiru/wiki/faq/')
        } else {
          app.relaunch()
        }
        app.quit()
      }
    })

    ipcMain.on('portRequest', async (event, settings) => {
      const { port1, port2 } = new MessageChannelMain()
      await this.torrentLoad
      ipcMain.once('webtorrent-heartbeat', () => {
        this.webtorrentWindow.webContents.postMessage('main-heartbeat', settings)
        ipcMain.once('torrentRequest', () => {
          this.webtorrentWindow.webContents.postMessage('port', null, [port1])
          event.sender.postMessage('port', null, [port2])
        })
      })
    })

    ipcMain.on('webtorrent-reload', () => { if (!this.mainWindow?.isDestroyed() && !this.webtorrentWindow?.isDestroyed()) this.webtorrentWindow.webContents.postMessage('webtorrent-reload', null) })

    let authWindow
    ipcMain.on('open-auth', (event, url) => {
      if (authWindow && !authWindow.isDestroyed()) authWindow.loadURL(url)
      else {
        const partitionName = 'open-auth'
        authWindow = new BrowserWindow({
          width: 480,
          height: 720,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            backgroundThrottling: false,
            allowRunningInsecureContent: false,
            partition: partitionName
          },
          icon: this.icon,
          title: 'Login',
          backgroundColor: '#17191c',
          autoHideMenuBar: true
        })

        authWindow.webContents.setWindowOpenHandler(() => { return { action: 'deny' } })
        authWindow.webContents.on('did-finish-load', () => authWindow.show())
        authWindow.webContents.on('did-start-loading', () => authWindow.webContents.insertCSS
          (`
            ::-webkit-scrollbar {
              width: 6px;
              height: 6px;
              background-color: transparent;
            }
            ::-webkit-scrollbar-thumb {
              background-color: #2a2e32;
              border-radius: 3px;
            }
            ::-webkit-scrollbar-corner {
              background-color: transparent;
            }
          `))
        authWindow.on('close', () => {
          this.mainWindow.webContents.send('auth-canceled')
          session.fromPartition(partitionName).clearStorageData()
        })
        authWindow.webContents.on('will-redirect', (event, url) => {
          if (url.startsWith('shiru:')) {
            event.preventDefault()
            authWindow.destroy()
            ipcMain.emit('handle-protocol', {}, url)
            session.fromPartition(partitionName).clearStorageData()
          }
        })

        authWindow.loadURL(url)
      }
    })

    ipcMain.on('quit-and-install', () => {
      if (this.updater.hasUpdate) this.destroy(true)
    })
  }

  makeWebTorrentWindow() {
    return new BrowserWindow({
      webPreferences: {
        webSecurity: false,
        allowRunningInsecureContent: false,
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false
      },
      show: false
    })
  }

  webTorrentCrashes = 0
  setWebTorrentWindow(crashed = false) {
    if (!crashed || ++this.webTorrentCrashes < 5) {
      if (crashed) {
        const timeout = setTimeout(() => {
          this.timeouts.delete(timeout)
          if (this.webTorrentCrashes < 5) this.webTorrentCrashes = 0
        }, 60_000)
        timeout.unref?.()
        this.timeouts.add(timeout)
        try {
          if (this.webtorrentWindow && !this.webtorrentWindow.isDestroyed()) {
            this.webtorrentWindow.removeAllListeners('closed')
            this.webtorrentWindow.destroy()
          }
        } catch {}
        this.webtorrentWindow = this.makeWebTorrentWindow()
      }
      this.torrentLoad = this.webtorrentWindow.loadURL(development ? 'http://localhost:5000/background.html' : `file://${join(__dirname, '/background.html')}`)
      if (development) this.webtorrentWindow.webContents.openDevTools({ mode: 'detach' })
      if (crashed) this.mainWindow.webContents.send('webtorrent-crashed')
      this.webtorrentWindow.on('closed', () => this.destroy())
      this.webtorrentWindow.webContents.on('render-process-gone', async (e, { reason }) => {
       if (reason === 'crashed') this.setWebTorrentWindow(true)
      })
    }
  }

  destroyed = false
  async destroy(forceRunAfter = false) {
    if (this.destroyed) return
    this.destroyed = true
    this.updater.destroyed = true
    this.close = true
    this.mainWindow.hide()
    this.mainWindow.webContents?.closeDevTools?.()
    this.tray?.destroy()
    for (const timeout of this.timeouts) clearTimeout(timeout)
    this.timeouts.clear()
    clearTimeout(this.stateTimeout)
    saveWindowState(this.mainWindow)
    youtubeServer?.close?.()
    try {
      if (this.webtorrentWindow && !this.webtorrentWindow.isDestroyed()) { // WebTorrent shouldn't ever be destroyed before main, but it's better to be safe.
        this.webtorrentWindow.webContents?.closeDevTools?.()
        this.webtorrentWindow.webContents?.postMessage('destroy', null)
        let resolveTimeout
        await new Promise(resolve => {
          ipcMain.once('destroyed', resolve)
          resolveTimeout = setTimeout(resolve, 5_000)
          resolveTimeout.unref?.()
        })
        clearTimeout(resolveTimeout)
      }
    } catch {} // WebTorrent crashed... prevents hanging infinitely.
    if (!this.updater.install(forceRunAfter)) app.quit()
  }

  imageCache = new Map()
  async getImage(id, url, wideScreen) {
    const cacheKey = `${id}_${url}_${wideScreen}`
    if (this.imageCache.has(cacheKey)) return this.imageCache.get(cacheKey)
    const res = await fetch(url)
    const arrayBuffer = await res.arrayBuffer()
    const urlParts = url.split('/')
    const baseName = urlParts[urlParts.length - 1].replace(/\.[^/.]+$/, '')
    const extension = urlParts[urlParts.length - 1].split('.').pop()
    const uniqueName = `${baseName}_${id}.${extension}`
    const imagePath = join(this.imageDir, uniqueName)
    const image = await Jimp.read(Buffer.from(arrayBuffer))
    const { width, height } = image.bitmap
    this.imageCache.set(cacheKey, imagePath)
    if (wideScreen) {
      let adjWidth, adjHeight
      if (width / height > (16 / 9)) {
        adjWidth = Math.floor(height * (16 / 9))
        image.crop((width - adjWidth) / 2, 0, adjWidth, height)
      } else {
        adjHeight = Math.floor(width / (16 / 9))
        image.crop(0, (height - adjHeight) / 2, width, adjHeight)
      }
      await image.resize(adjWidth || width, adjHeight || height, Jimp.RESIZE_BEZIER).writeAsync(imagePath)
    } else {
      const squareRatio = Math.min(width, height)
      await image.crop((width - squareRatio) / 2, (height - squareRatio) / 2, squareRatio, squareRatio).resize(128, 128, Jimp.RESIZE_BEZIER).writeAsync(imagePath)
    }
    const timeout = setTimeout(() => {
      this.timeouts.delete(timeout)
      fs.unlink(imagePath, (error) => {
        if (!error) this.imageCache.delete(cacheKey)
      })
    }, 90_000)
    timeout.unref?.()
    this.timeouts.add(timeout)
    return imagePath
  }

  notificationCount = 0
  setTrayIcon(notificationCount, verify) {
    if (this.destroyed) return
    if (!this.tray || this.tray.isDestroyed()) {
      this.tray = new Tray(this.trayIcon)
      this.createTray()
    }
    if (!verify) this.notificationCount = notificationCount
    if (this.notificationCount <= 0 || !this.notificationCount) {
      this.tray.setImage(this.trayIcon)
      this.mainWindow.setOverlayIcon(null, '')
    } else {
      this.mainWindow.setOverlayIcon(nativeImage.createFromPath(join(__dirname, `/icon_filled_notify_${this.notificationCount < 10 ? this.notificationCount : `filled`}.png`)), `${this.notificationCount} Unread Notifications`)
      this.tray.setImage(this.trayNotifyIcon)
    }
  }
  createTray() {
    if (this.destroyed) return
    this.tray.setToolTip('Shiru')
    this.setTrayMenu()
    this.tray.on('click', () => this.showAndFocus())
  }
  setTrayMenu() {
    if (this.destroyed || !this.tray || this.tray.isDestroyed()) return
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Shiru', enabled: false },
      ...(this.ready ? [
          { type: 'separator' },
          { label: 'Show', click: () => this.showAndFocus() },
          { label: 'Restore', click: () => this.restoreWindow() }
        ]
        : []),
      { type: 'separator' },
      { label: 'Quit', click: () => this.destroy() }
    ]))
  }

  restoreWindow() {
    if (this.destroyed || this.mainWindow?.isDestroyed()) return
    const defaultBounds = getDefaultBounds()
    this.mainWindow.unmaximize()
    this.mainWindow.setFullScreen(false)
    this.mainWindow.setBounds(defaultBounds)
    /** HACK: Electron doesn't handle DPI scaling differences between monitors very well so we have to set the bounds twice... */
    setImmediate(() => {
      this.mainWindow.setBounds(defaultBounds)
      saveWindowState(this.mainWindow)
      this.showAndFocus()
    })
  }

  showAndFocus(ready = false) {
    if (!this.ready && !ready) return
    if (!this.ready) {
      this.ready = true
      this.setTrayMenu()
    }
    if (ready) {
      if (this.windowState.bounds.x && this.windowState.bounds.y) this.mainWindow.setBounds(this.windowState.bounds)
      if (this.windowState.isMaximized) this.mainWindow.maximize()
      if (this.windowState.isFullScreen) this.mainWindow.setFullScreen(true)
    }
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore()
    } else if (!this.mainWindow.isVisible()) {
      this.mainWindow.show()
    } else {
      this.mainWindow.moveTop()
    }
    this.mainWindow.focus()
    this.setTrayIcon(0, true)
  }
}