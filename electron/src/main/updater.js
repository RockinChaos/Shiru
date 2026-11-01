import { app, ipcMain, shell, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import { development } from './util.js'
import semver from 'semver'

/**
 * @typedef {object} UpdateFeedSource
 * @property {string} provider Feed provider type ('generic' or 'github')
 * @property {string} [url] Base URL for 'generic' providers
 * @property {string} [owner] Repository owner for 'github' providers
 * @property {string} [repo] Repository name for 'github' providers
 */

/** @type {UpdateFeedSource} */
const PRIMARY_SOURCE = { provider: atob('Z2l0aHVi'), owner: atob('Um9ja2luQ2hhb3M='), repo: atob('U2hpcnU=') }

/** @type {UpdateFeedSource[]} */
const FALLBACK_SOURCES = [{ provider: atob('Z2VuZXJpYw=='), url: atob('Y2RuLnNoaXJ1LmFwcA==') }]

/**
 * Manages application updates for Electron using electron-updater.
 * Supports both stable and nightly release channels.
 */
export default class Updater {
  destroyed = false
  hasUpdate = false
  downloading = false
  skipFallback = false
  isManualInstall = process.platform === 'darwin' || !!process.env.FLATPAK_ID || !!process.env.PORTABLE_EXECUTABLE_FILE

  window
  torrentWindow
  currentVersion
  latestVersion
  availableInterval
  downloadedInterval
  updateChannel = 'stable'
  currentFeedUrl

  /**
   * Creates an updater instance and sets up listeners.
   * @param {import('electron').BrowserWindow} window Main application window
   * @param {() => import('electron').BrowserWindow} torrentWindow Function returning torrent window
   */
  constructor (window, torrentWindow) {
    this.currentVersion = app.getVersion()
    this.window = window
    this.torrentWindow = torrentWindow
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    if (this.isManualInstall && !development) autoUpdater.isUpdaterActive = () => true
    ipcMain.on('common:checkForUpdates', (event, channel) => {
      if (this.destroyed || this.window.isDestroyed()) return
      if (channel) this.updateChannel = channel
      autoUpdater.allowPrerelease = this.updateChannel === 'nightly'
      autoUpdater.checkForUpdates()
    })
    ipcMain.on('common:setUpdateChannel', (event, channel) => this.setUpdateChannel(channel))
    autoUpdater.on('error', async (error) => {
      if (this.destroyed || this.window.isDestroyed()) return
      const message = error?.message ?? ''
      if (!this.skipFallback && (message.includes('404') || message.includes('451'))) {
        const fallback = await this.#resolveUpdateFallback()
        if (this.destroyed || this.window.isDestroyed()) return
        if (fallback) {
          this.currentFeedUrl = fallback.id
          autoUpdater.setFeedURL({ ...fallback.config })
          autoUpdater.checkForUpdates()
          return
        }
      }
      this.window.webContents.send('common:onUpdateAborted')
    })
    autoUpdater.on('update-available', (info) => {
      if (this.destroyed || this.window.isDestroyed() || this.skipUpdate(info.version)) return
      else if (this.latestVersion !== info.version) {
        this.hasUpdate = false
        this.downloading = false
        clearInterval(this.availableInterval)
        clearInterval(this.downloadedInterval)
      }
      if (!this.downloading) {
        this.downloading = true
        if (!this.isManualInstall) autoUpdater.downloadUpdate()
        else this.hasUpdate = true
        this.availableInterval = setInterval(() => {
          if (this.destroyed || this.window.isDestroyed()) return
          if (!this.hasUpdate || this.isManualInstall) this.window.webContents.send('common:onUpdateAvailable', info.version)
        }, 1_000)
        this.availableInterval.unref?.()
      }
      this.latestVersion = info.version
    })
    autoUpdater.on('update-downloaded', (info) => {
      if (this.destroyed || this.window.isDestroyed() || this.skipUpdate(info.version) || this.isManualInstall) return
      if (!this.hasUpdate) {
        this.hasUpdate = true
        clearInterval(this.availableInterval)
        this.downloadedInterval = setInterval(() => {
          if (this.destroyed || this.window.isDestroyed()) return
          if (this.hasUpdate) this.window.webContents.send('common:onUpdateDownloaded', info.version)
        }, 1_000)
        this.downloadedInterval.unref?.()
      }
    })
  }

  /**
   * Probes each fallback source and returns the first reachable one.
   * @returns {Promise<object|null>} Reachable fallback source config or null if none succeed
   */
  async #resolveUpdateFallback () {
    for (const source of FALLBACK_SOURCES) {
      if (this.#sourceId(source) === this.currentFeedUrl) continue
      let probeUrl
      let resolvedUrl
      switch (source.provider) {
        case 'github':
          probeUrl = `https://github.com/${source.owner}/${source.repo}/releases.atom`
          break
        case 'generic':
          resolvedUrl = `https://${source.url}/${this.updateChannel === 'nightly' ? 'beta' : 'latest'}`
          probeUrl = `${resolvedUrl}/latest.yml`
          break
        default:
          continue
      }
      try {
        const status = await new Promise((resolve, reject) => {
          const request = net.request({ method: 'HEAD', url: probeUrl })
          request.on('response', (response) => resolve(response.statusCode))
          request.on('error', reject)
          request.end()
        })
        if (status >= 200 && status < 300) {
          return { id: this.#sourceId(source), config: resolvedUrl ? { ...source, url: resolvedUrl } : source }
        }
      } catch {}
    }
    this.skipFallback = true
    return null
  }

  /**
   * Changes the update channel and triggers a new update check.
   * @param {string} [channel='stable'] Update channel ('stable' or 'nightly')
   */
  setUpdateChannel(channel = 'stable') {
    if (this.destroyed || this.window.isDestroyed()) return
    this.updateChannel = channel
    this.hasUpdate = false
    this.downloading = false
    this.skipFallback = false
    this.latestVersion = null
    if (this.currentFeedUrl) autoUpdater.setFeedURL(PRIMARY_SOURCE)
    this.currentFeedUrl = undefined
    clearInterval(this.availableInterval)
    clearInterval(this.downloadedInterval)
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
   * @param {UpdateFeedSource} source Fallback source
   * @returns {string} Stable identifier for the source
   */
  #sourceId (source) {
    return source.provider === 'github' ? `github:${source.owner}/${source.repo}` : `generic:${source.url}`
  }

  /**
   * Installs the downloaded update and restarts the application.
   * @param {boolean} forceRunAfter Whether to force installation
   * @returns {boolean} True if installation started, false otherwise
   */
  install(forceRunAfter = false) {
    if (this.hasUpdate && forceRunAfter) {
      setImmediate(() => {
        try {
          this.window.close()
          this.torrentWindow().close()
        } catch (e) {}
        clearInterval(this.downloadedInterval)
        if (!this.isManualInstall) autoUpdater.quitAndInstall(true, true)
      })
      if (this.isManualInstall) {
        const url = semver.valid(this.latestVersion) && semver.prerelease(this.latestVersion)
          ? `https://${PRIMARY_SOURCE.provider}.com/${PRIMARY_SOURCE.owner}/${PRIMARY_SOURCE.repo}/releases/tag/v${this.latestVersion}`
          : `https://${PRIMARY_SOURCE.provider}.com/${PRIMARY_SOURCE.owner}/${PRIMARY_SOURCE.repo}/releases/latest`
        shell.openExternal(url)
      }
      this.hasUpdate = false
      return !this.isManualInstall
    }
    return false
  }

  /** Stops update notifications and ignores subsequent update events. */
  destroy() {
    this.destroyed = true
    clearInterval(this.availableInterval)
    clearInterval(this.downloadedInterval)
  }
}
