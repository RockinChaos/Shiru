import { autoUpdater } from 'electron-updater'
import { app, ipcMain, shell } from 'electron'
import semver from 'semver'

/**
 * Manages application updates for Electron using electron-updater.
 * Supports both stable and nightly release channels.
 */
export default class Updater {
  hasUpdate = false
  downloading = false

  window
  torrentWindow
  currentVersion
  latestVersion
  availableInterval
  downloadedInterval
  updateChannel = 'stable'

  /**
   * Creates an updater instance and sets up IPC listeners.
   * @param {import('electron').BrowserWindow} window Main application window
   * @param {() => import('electron').BrowserWindow} torrentWindow Function returning torrent window
   */
  constructor (window, torrentWindow) {
    this.currentVersion = app.getVersion()
    this.window = window
    this.torrentWindow = torrentWindow
    autoUpdater.autoInstallOnAppQuit = false
    ipcMain.on('update', (event, channel) => {
      if (channel) this.updateChannel = channel
      autoUpdater.channel = this.updateChannel === 'nightly' ? 'beta' : 'latest'
      autoUpdater.allowPrerelease = this.updateChannel === 'nightly'
      autoUpdater.checkForUpdates()
    })
    ipcMain.on('set-update-channel', (event, channel) => this.setUpdateChannel(channel))
    autoUpdater.on('error', () => this.window.webContents.send('update-aborted'))
    autoUpdater.on('update-available', (info) => {
      if (this.skipUpdate(info.version)) return
      else if (this.latestVersion !== info.version) {
        this.hasUpdate = false
        this.downloading = false
        clearInterval(this.availableInterval)
        clearInterval(this.downloadedInterval)
      }
      if (!this.downloading) {
        this.downloading = true
        this.availableInterval = setInterval(() => {
          if (!this.hasUpdate) this.window.webContents.send('update-available', info.version)
        }, 1_000)
        this.availableInterval.unref?.()
      }
      this.latestVersion = info.version
    })
    autoUpdater.on('update-downloaded', (info) => {
      if (this.skipUpdate(info.version)) return
      if (!this.hasUpdate) {
        this.hasUpdate = true
        clearInterval(this.availableInterval)
        this.downloadedInterval = setInterval(() => {
          if (this.hasUpdate) this.window.webContents.send('update-downloaded', info.version)
        }, 1_000)
        this.downloadedInterval.unref?.()
      }
    })
  }

  /**
   * Changes the update channel and triggers a new update check.
   * @param {string} [channel='stable'] Update channel ('stable' or 'nightly')
   */
  setUpdateChannel(channel = 'stable') {
    this.updateChannel = channel
    this.hasUpdate = false
    this.downloading = false
    this.latestVersion = null
    clearInterval(this.availableInterval)
    clearInterval(this.downloadedInterval)
    autoUpdater.channel = this.updateChannel === 'nightly' ? 'beta' : 'latest'
    autoUpdater.allowPrerelease = this.updateChannel === 'nightly'
    autoUpdater.checkForUpdates()
  }

  /**
   * Determines if an update should be skipped based on version and channel.
   * @param {string} version Version string to check
   * @returns {boolean} True if update should be skipped
   */
  skipUpdate(version) {
    const validVersion = semver.valid(version)
    const validCurrent = semver.valid(this.currentVersion)
    if (!validVersion || !validCurrent) return false
    if (semver.lt(validVersion, validCurrent)) return true
    return this.updateChannel !== 'nightly' && semver.prerelease(version)
  }

  /**
   * Installs the downloaded update and restarts the application.
   * @param {boolean} forceRunAfter Whether to force installation
   * @returns {boolean} True if installation started, false otherwise
   */
  install (forceRunAfter = false) {
    if (this.hasUpdate && forceRunAfter) {
      setImmediate(() => {
        try {
          this.window.close()
          this.torrentWindow().close()
        } catch (e) {}
        clearInterval(this.downloadedInterval)
        autoUpdater.quitAndInstall(true, true)
      })
      if (process.platform === 'darwin') shell.openExternal('https://github.com/RockinChaos/Shiru/releases/latest')
      this.hasUpdate = false
      return true
    }
    return false
  }
}