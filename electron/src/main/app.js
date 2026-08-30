import { join } from 'node:path'
import process from 'node:process'

import { youtubeServer } from './youtube.js'

import { BrowserWindow, MessageChannelMain, Notification, Tray, Menu, nativeImage, app, dialog, ipcMain, powerMonitor, shell, session } from 'electron'
import electronShutdownHandler from '@paymoapp/electron-shutdown-handler'

import { development, timeouts, getImage, getWindowState, saveWindowState, getDefaultBounds, toXmlString } from './util.js'
import Debug from './debugger.js'
import Discord from './discord.js'
import Protocol from './protocol.js'
import Updater from './updater.js'
import Dialog from './dialog.js'

export default class App {
  icon = nativeImage.createFromPath(join(__dirname, process.platform === 'win32' ? '/icon_filled.ico' : '/icon_filled.png'))
  trayIcon = process.platform === 'darwin' ? nativeImage.createFromPath(join(__dirname, '/trayMacOSTemplate.png')) : this.icon
  trayNotifyIcon = nativeImage.createFromPath(join(__dirname, process.platform === 'darwin' ? '/trayNotifyMacOSTemplate.png' : process.platform === 'win32' ? '/icon_filled_notify.ico' : '/icon_filled_notify.png'))

  stateTimeout = null

  torrentLoad = null
  torrentAlive = false
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
      webSecurity: !development,
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
  debug = new Debug()
  dialog = new Dialog(this.debug)
  tray = new Tray(this.trayIcon)
  close = false
  ready = false
  notifications = {}

  constructor() {
    this.mainWindow.setMenuBarVisibility(false)
    this.mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    if (development) this.mainWindow.once('ready-to-show', () => this.showAndFocus(true))
    else ipcMain.on('common:windowReady', () => this.showAndFocus(true)) // HACK: Prevents the window from being shown while it's still loading. This is nice for production as the window can't be moved without the elements being rendered.
    ipcMain.handle('common:isWindowVisible', () => this.mainWindow.isVisible())
    ipcMain.on('electron:openTorrentDevTools', () => this.webtorrentWindow.webContents.openDevTools({ mode: 'detach' }))
    ipcMain.on('electron:openDevTools', ({ sender }) => sender.openDevTools({ mode: 'detach' }))
    ipcMain.on('electron:hideWindow', () => this.mainWindow.hide())
    ipcMain.on('electron:showAndFocus', () => this.showAndFocus())
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
    ipcMain.once('electron:Exit', () => this.destroy())
    this.mainWindow.on('close', (event) => {
      if (!this.exit) {
        event.preventDefault()
        this.showAndFocus()
        this.mainWindow.webContents.send('electron:onExitIntent')
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

    ipcMain.on('electron:setUnreadCount', async (e, notificationCount) => this.setTrayIcon(notificationCount))
    ipcMain.on('common:notify', async (e, opts) => {
      opts.icon = opts.icon ? ((await getImage(opts.id, opts.icon)) || this.icon) : this.icon
      let notification
      if (process.platform === 'win32') {
        opts.heroImg &&= await getImage(opts.id, opts.heroImg, true)
        opts.inlineImg &&= await getImage(opts.id, opts.inlineImg)
        notification = new Notification({ toastXml: toXmlString(opts) })
      } else {
        const simpleOpts = { title: opts.title, body: opts.message, icon: opts.icon }
        if (process.platform === 'darwin' && opts.button?.length) simpleOpts.actions = opts.button.map(button => ({ type: 'button', text: button.text }))
        notification = new Notification(simpleOpts)
        notification.on('click', () => {
          if (opts.activation?.launch) shell.openExternal(opts.activation.launch)
        })
        if (process.platform === 'darwin') {
          notification.on('action', (event, index) => {
            if (opts.button?.[index]) shell.openExternal(opts.button[index].activation)
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

    if (development) this.mainWindow.webContents.once('did-finish-load', () => this.mainWindow.webContents.openDevTools({ mode: 'detach' }))

    let crashcount = 0
    this.mainWindow.webContents.on('render-process-gone', async (e, { reason }) => {
      if (reason === 'crashed') {
        if (++crashcount > 10) {
          await dialog.showMessageBox({ message: 'Crashed too many times.', title: 'Shiru', detail: 'App crashed too many times. For a fix visit https://shiru.app/#/faq/', icon: '/renderer/public/icon_filled.png' })
          shell.openExternal('https://shiru.app/#/faq/')
        } else {
          app.relaunch()
        }
        app.quit()
      }
    })

    ipcMain.handle('torrent:portRequest', async (event, settings) => {
      const { port1, port2 } = new MessageChannelMain()
      this.torrentAlive = false
      await this.torrentLoad
      return new Promise(resolve => {
        ipcMain.once('webtorrent-heartbeat', () => {
          this.webtorrentWindow.webContents.postMessage('main-heartbeat', settings)
          ipcMain.once('torrentRequest', () => {
            this.webtorrentWindow.webContents.postMessage('torrent:port', null, [port1])
            event.sender.postMessage('electron:torrentPort', null, [port2])
            this.torrentAlive = true
            resolve()
          })
        })
      })
    })
    ipcMain.on('torrent:reload', () => { if (!this.mainWindow?.isDestroyed() && !this.webtorrentWindow?.isDestroyed()) this.webtorrentWindow.webContents.postMessage('torrent:reload', null) })

    let authWindow
    ipcMain.handle('common:linkAccount', (event, url) => {
      return new Promise((resolve, reject) => {
        if (authWindow && !authWindow.isDestroyed()) {
          authWindow.loadURL(url).catch(reject)
          authWindow.once('close', () => reject(new Error('common:failedAccount')))
          return
        }
        let settled = false
        const partitionName = 'common:linkAccount'
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
        authWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
          if (settled) return
          session.fromPartition(partitionName).clearStorageData()
          reject(new Error('common:failedAccount'))
        })
        authWindow.webContents.on('will-redirect', (event, url) => {
          if (url.startsWith('shiru:')) {
            settled = true
            event.preventDefault()
            authWindow.destroy()
            session.fromPartition(partitionName).clearStorageData()
            resolve(url)
          }
        })
        authWindow.loadURL(url).catch(reject)
      })
    })

    ipcMain.on('common:quitAndInstall', () => {
      if (this.updater.hasUpdate) this.destroy(true)
    })
  }

  makeWebTorrentWindow() {
    return new BrowserWindow({
      webPreferences: {
        webSecurity: !development,
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
          timeouts.delete(timeout)
          if (this.webTorrentCrashes < 5) this.webTorrentCrashes = 0
        }, 60_000)
        timeout.unref?.()
        timeouts.add(timeout)
        try {
          if (this.webtorrentWindow && !this.webtorrentWindow.isDestroyed()) {
            this.webtorrentWindow.removeAllListeners('closed')
            this.webtorrentWindow.destroy()
          }
        } catch {}
        this.webtorrentWindow = this.makeWebTorrentWindow()
      }
      this.torrentLoad = this.webtorrentWindow.loadURL(development ? 'http://localhost:5000/background.html' : `file://${join(__dirname, '/background.html')}`)
      if (development) this.webtorrentWindow.webContents.once('did-finish-load', () => this.webtorrentWindow.webContents.openDevTools({ mode: 'detach' }))
      if (crashed) this.mainWindow.webContents.send('torrent:onCrash')
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
    this.exit = true
    this.mainWindow.hide()
    this.mainWindow.webContents?.closeDevTools?.()
    this.tray?.destroy()
    for (const timeout of timeouts) clearTimeout(timeout)
    timeouts.clear()
    clearTimeout(this.stateTimeout)
    saveWindowState(this.mainWindow)
    youtubeServer?.close?.()
    try {
      if (this.webtorrentWindow && !this.webtorrentWindow.isDestroyed()) { // WebTorrent shouldn't ever be destroyed before main, but it's better to be safe.
        this.webtorrentWindow.webContents?.closeDevTools?.()
        this.webtorrentWindow.webContents?.postMessage('destroy', null)
        if (this.torrentAlive) { // If the app hasn't fully started there may be no response from WebTorrent and no data to save, best to not wait.
          let resolveTimeout
          await new Promise(resolve => {
            ipcMain.once('destroyed', resolve)
            resolveTimeout = setTimeout(resolve, 5_000)
            resolveTimeout.unref?.()
          })
          clearTimeout(resolveTimeout)
        }
      }
    } catch {} // WebTorrent crashed... prevents hanging infinitely.
    if (!this.updater.install(forceRunAfter)) app.quit()
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