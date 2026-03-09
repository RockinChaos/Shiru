import ApkUpdater from 'cordova-plugin-apkupdater'
import { IPC } from '../preload/preload.js'
import { development } from './util.js'
import { App } from '@capacitor/app'
import semver from 'semver'
import YAML from 'yaml'

const versionCodes = { 'arm64-v8a': 1, 'armeabi-v7a': 2, 'x86': 3, 'universal': 4 }

/**
 * Manages application updates for Capacitor/Android using APK downloads from GitHub.
 * Supports both stable and nightly release channels with architecture-specific builds.
 */
export default class Updater {
  hasUpdate = false
  updateAvailable = false
  availableInterval

  repoOwner
  repoName

  build
  currentVersion
  versionCode
  latestRelease
  updateChannel = 'stable'

  /**
   * Creates an updater instance and sets up IPC listeners.
   * @param {string} repoOwner GitHub repository owner
   * @param {string} repoName GitHub repository name
   */
  constructor(repoOwner, repoName) {
    this.repoOwner = repoOwner
    this.repoName = repoName
    this.getInfo()
    IPC.on('update', (channel) => {
      if (channel) this.updateChannel = channel
      this.checkForUpdates()
    })
    IPC.on('set-update-channel', (channel) => this.setUpdateChannel(channel))
  }

  /** Retrieves and stores app version information and device architecture. */
  async getInfo() {
    const appInfo = await App.getInfo()
    this.build = appInfo.build
    this.currentVersion = appInfo.version
    this.versionCode = await this.parseABI()
  }

  /**
   * Determines device architecture from build string.
   * @returns {Promise<string>} Architecture identifier (arm64-v8a, armeabi-v7a, x86, or universal)
   */
  async parseABI() {
    if (this.build?.length === 7) {
      const versionCode = parseInt(this.build.substring(0, 1))
      if (versionCode < 5) {
        for (const [arch, code] of Object.entries(versionCodes)) {
          if (code === versionCode) return arch
        }
      } else if (versionCode === 5) return 'arm64-v8a'
    }
    return 'universal'
  }

  /** Checks for available updates based on current update channel. */
  async checkForUpdates() {
    if (!development) {
      try {
        if (this.updateChannel === 'nightly') this.latestRelease = await this.getNightlyUpdate()
        else this.latestRelease = YAML.parse(await (await fetch(`https://github.com/${this.repoOwner}/${this.repoName}/releases/latest/download/latest-android.yml`)).text()).version
        if (this.isOutdated() && !this.updateAvailable && !this.hasUpdate) {
          this.startUpdatePolling()
        }
      } catch (error) {
        console.debug('Failed to check for updates', error)
      }
    } else {
      console.debug('Skip checkForUpdates because application is not packed and dev update config is not forced')
    }
  }

  /**
   * Fetches the latest nightly or stable version from GitHub tags.
   * @returns {Promise<string|null>} Latest version string or null on error
   */
  async getNightlyUpdate() {
    try {
      const response = await fetch(`https://api.github.com/repos/${this.repoOwner}/${this.repoName}/git/refs/tags/`)
      if (!response.ok) {
        console.debug('Failed to fetch tags', response.status, response.statusText)
        return this.getStableRelease()
      }
      const tags = await response.json()
      if (!Array.isArray(tags)) {
        console.debug('Tags response is not an array', tags)
        return this.getStableRelease()
      }
      if (tags.length === 0) {
        console.debug('No tags found in repository')
        return this.getStableRelease()
      }
      const tagNames = tags.map(tag => tag.ref?.replace('refs/tags/v', '')).filter(tag => tag && semver.valid(tag))
      if (tagNames.length === 0) {
        console.debug('No valid semver tags found')
        return this.getStableRelease()
      }

      let candidateVersion = null
      const latestStable = this.getLatestTag(tagNames.filter(tag => !semver.prerelease(tag)))
      const latestNightly = this.getLatestTag(tagNames.filter(tag => semver.prerelease(tag)))
      if (!latestStable && !latestNightly) {
        return this.getStableRelease()
      } else if (!latestStable) {
        candidateVersion = latestNightly
      } else if (!latestNightly) {
        candidateVersion = latestStable
      } else if (semver.gt(latestStable, latestNightly)) {
        candidateVersion = latestStable
      } else {
        candidateVersion = latestNightly
      }

      try {
        const yamlResponse = await fetch(`https://github.com/${this.repoOwner}/${this.repoName}/releases/download/v${candidateVersion}/latest-android.yml`)
        if (!yamlResponse.ok) throw new Error(`YAML fetch failed: ${yamlResponse.status}`)
        return YAML.parse(await yamlResponse.text()).version
      } catch (error) {
        console.debug('Failed to verify version with YAML', candidateVersion, error)
        return this.getStableRelease()
      }
    } catch (error) {
      console.debug('Failed to get nightly update', error)
      return this.getStableRelease()
    }
  }

  /**
   * Fetches the latest stable release version.
   * @returns {Promise<string|null>} Stable version string or null on error
   */
  async getStableRelease() {
    try {
      const response = await fetch(`https://github.com/${this.repoOwner}/${this.repoName}/releases/latest/download/latest-android.yml`)
      if (!response.ok) {
        console.debug('Failed to fetch stable release', response.status)
        return null
      }
      return YAML.parse(await response.text()).version
    } catch (error) {
      console.debug('Failed to get stable release', error)
      return null
    }
  }

  /**
   * Finds the latest version from a list of tags using semver comparison.
   * @param {string[]} tags Array of version tag strings
   * @returns {string|null} Latest version tag or null if empty
   */
  getLatestTag(tags) {
    if (!tags || tags.length === 0) return null
    return tags.sort((tagA, tagB) => semver.rcompare(tagA, tagB))[0]
  }

  /**
   * Determines if an update is available based on version comparison and channel.
   * @returns {boolean} True if update should be applied
   */
  isOutdated() {
    if (!this.latestRelease || !this.currentVersion) return false
    const current = semver.valid(this.currentVersion)
    const latest = semver.valid(this.latestRelease)
    if (semver.lt(latest, current)) return false
    if (this.updateChannel !== 'nightly' && semver.prerelease(this.latestRelease)) return false
    if (semver.gt(latest, current)) return true
    return semver.eq(latest, current) && semver.prerelease(this.currentVersion) && !semver.prerelease(this.latestRelease)
  }

  /**
   * Changes the update channel and triggers a new update check.
   * @param {string} [channel='stable'] Update channel ('stable' or 'nightly')
   */
  setUpdateChannel(channel = 'stable') {
    this.updateChannel = channel
    this.hasUpdate = false
    this.updateAvailable = false
    this.latestRelease = null
    clearInterval(this.availableInterval)
    this.checkForUpdates()
  }

  /** Starts periodic polling to notify renderer of available update. */
  startUpdatePolling() {
    this.updateAvailable = true
    clearInterval(this.availableInterval)
    this.availableInterval = setInterval(() => {
      if (!this.hasUpdate) IPC.emit('update-available', this.latestRelease)
    }, 1_000)
    this.availableInterval.unref?.()
  }

  /**
   * Downloads and installs the update APK for the device architecture.
   * @param {boolean} forceRequestInstall Whether to force installation
   * @returns {Promise<boolean>} True if installation started, false otherwise
   */
  async install(forceRequestInstall = false) {
    if (!this.hasUpdate && forceRequestInstall) {
      try {
        clearInterval(this.availableInterval)
        this.updateAvailable = false
        this.hasUpdate = true
        const releaseInfo = await (await fetch(`https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/tags/v${this.latestRelease}`)).json()
        const regex = new RegExp(`${semver.valid(releaseInfo.tag_name)}.*${this.versionCode}`, 'i')
        const asset = releaseInfo?.assets?.find(asset => regex.test(asset.browser_download_url))
        if (!asset) {
          console.debug('Update file not found for version and architecture', this.latestRelease, releaseInfo.tag_name, this.versionCode)
          this.updateAborted()
          return false
        }
        await ApkUpdater.download(asset.browser_download_url, {
          onDownloadProgress: (progress) => {
            console.debug(progress)
            IPC.emit('update-progress', progress.progress ?? 0)
          }
        }, () => {
          const listener = App.addListener('appStateChange', (state) => {
            if (state.isActive) {
              listener.remove()
              setTimeout(() => this.updateAborted(true), 1_500).unref?.()
            }
          })
          ApkUpdater.install(console.error, console.error)
        }, (error) => {
          console.debug('Failed to download update', error)
          this.updateAborted()
        })
        return true
      } catch (error) {
        IPC.emit('update-aborted')
        clearInterval(this.availableInterval)
        this.updateAvailable = false
        this.hasUpdate = false
        console.debug(error)
      }
    }
    return false
  }

  /**
   * Handles update abortion and restarts availability polling.
   * @param {boolean} aborted Whether update was user-aborted vs error
   */
  updateAborted(aborted = false) {
    this.hasUpdate = false
    this.startUpdatePolling()
    IPC.emit('update-aborted', aborted)
  }
}