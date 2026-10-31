import { makeHash, getInfoHash, hasIntegrity, getProgressAndSize, stringifyQuery, errorToString, TMP, isFlatpak, getStats, diskSpace } from '@client/lib/util.js'
import { sleep, isValidNumber, getRandomInt } from '@/modules/util.js'
import { hex2bin, arr2hex, text2arr } from 'uint8-util'
import Cache from '@client/lib/torrentcache.js'
import { SUPPORTS } from '@/modules/support.js'
import Metadata from '@client/lib/metadata.js'
import { spawn } from 'node:child_process'
import Client from 'bittorrent-tracker'
import HTTPTracker from 'http-tracker'
import WebTorrent from 'webtorrent'
import Debug from 'debug'
const debug = Debug('torrent:worker')

/**
 * @typedef {import('webtorrent/lib/torrent.js').default & {
 *   _removal?: boolean,
 *   _cacheWrite?: Promise<void>,
 *   seeders?: number,
 *   leechers?: number,
 *   trackerUrl?: string,
 *   tracker?: InstanceType<typeof Client>|null,
 *   current?: boolean,
 *   staging?: boolean,
 *   seeding?: boolean,
 *   local?: boolean,
 *   date?: string,
 *   cachedAt?: number
 * }} Torrent
 */

// HACK: this is https only, but electron doesn't run in https, weird.
if (!globalThis.FileSystemFileHandle) globalThis.FileSystemFileHandle = false

export default class TorrentClient {
  /** @type {WebTorrent} */
  client = null
  /** @type {(level: string, message: string) => void} */
  notify = () => {}
  /** @type {(infoHash: string|null, update: object) => void} */
  updateTorrent = () => {}
  /** @type {Record<string, any>} */
  settings = {}
  /** @type {string} */
  TMPDIR = TMP
  /** @type {string} */
  torrentPath = ''
  /** @type {Cache} */
  torrentCache = null
  /** @type {import('webtorrent/lib/file.js').default} */
  currentFile = null
  /** @type {Metadata} */
  metadata = null
  /** @type {number} */
  playbackRequest = 0
  /** @type {Promise<void>} */
  playbackChange = Promise.resolve()
  /** @type {ReturnType<WebTorrent['createServer']>|null} */
  torrentServer = null
  /** @type {HTTPTracker} */
  tracker = null
  /** @type {Map<string, Promise<void>>} */
  removals = new Map()
  /** @type {ReturnType<typeof getStats>[]} */
  completed = []
  /** @type {(() => void)|null} */
  _checkProgress = null
  /** @type {Promise<void>|null} */
  destroyed = null
  /** @type {ReturnType<spawn>} */
  playerProcess = null
  /** @type {'online' | 'offline' | 'offline_anilist' | 'limited_anilist'} */
  networking = 'online'
  /** @type {ReturnType<typeof setInterval>[]} */
  intervals = []

  /**
   * @param {object} settings
   * @param {string} [TMPDIR=TMP] Native fallback directory for torrent storage.
   */
  constructor(settings, TMPDIR = TMP) {
    Debug.disable()
    if (settings.debug) Debug.enable(settings.debug)
    debug('Initializing TorrentClient with settings:', JSON.stringify(settings))
    this.client = new WebTorrent({
      dht: settings.dht,
      utp: settings.torrentUTP,
      utPex: settings.torrentPeX,
      maxConns: settings.maxConns,
      downloadLimit: settings.downloadLimit,
      uploadLimit: settings.uploadLimit,
      torrentPort: settings.torrentPort,
      dhtPort: settings.dhtPort,
      natUpnp: SUPPORTS.permamentNAT ? 'permanent' : true
    })
    this.settings = settings
    this.TMPDIR = TMPDIR
    this.torrentPath = this.settings.torrentPathNew || this.TMPDIR || ''
    this.torrentCache = new Cache(this.torrentPath)
    this.currentFile = null

    this.torrentServer = this.client.createServer({}, 'node').listen(0)
    this.tracker = new HTTPTracker({}, atob('aHR0cDovL255YWEudHJhY2tlci53Zjo3Nzc3L2Fubm91bmNl'))
    this.client.on('error', this.handleError.bind(this))
  }

  /**
   * Registers callbacks for notifications and background torrent changes.
   * @param {(level: string, message: string) => void} notify Displays a renderer notification.
   * @param {(infoHash: string|null, update: object) => void} updateTorrent Applies a torrent lifecycle update.
   * @returns {void}
   */
  subscribe(notify, updateTorrent) {
    this.notify = notify
    this.updateTorrent = updateTorrent
  }

  /**
   * Loads a torrent for playback, decoding Android torrent bytes when necessary.
   * @param {{id: string|Uint8Array, hash?: string, magnet?: boolean, base64?: boolean}} data Torrent identifier and transfer options.
   * @param {(files: object[], magnet: {magnet: string, hash: string}) => void} [onReady] Receives playable files and magnet information.
   * @returns {Promise<ReturnType<typeof getStats>|void>} Accepted torrent stats, playable files arrive through onReady.
   */
  async streamTorrent(data, onReady) {
    const request = onReady ? ++this.playbackRequest : undefined
    const hash = data && data.hash
    const dataID = data && data.id
    const torrentID = data.base64 ? new Uint8Array(Buffer.from(dataID, 'base64')) : dataID
    const cache = await this.torrentCache.get(hash || (await getInfoHash(torrentID)))
    if (request !== undefined && request !== this.playbackRequest) return
    if (!cache?.infoHash && data.magnet) this.notify('info', 'A Magnet Link has been detected and is being processed. Files will be loaded shortly...')
    const add = () => this.addTorrent(torrentID, cache, false, onReady, request)
    const change = onReady ? this.playbackChange.then(add) : add()
    if (onReady) this.playbackChange = change.then(() => {}, () => {})
    return change.catch(error => {
      if (request === undefined || request === this.playbackRequest) throw error
    })
  }

  /**
   * Queues a torrent for background downloading.
   * @param {{id: string|Uint8Array, hash?: string, base64?: boolean}} data Torrent identifier and transfer options.
   * @returns {Promise<ReturnType<typeof getStats>|void>} Accepted torrent stats, readiness is published through updateTorrent.
   */
  async stageTorrent(data) {
    const hash = data && data.hash
    const dataID = data && data.id
    const torrentID = data.base64 ? new Uint8Array(Buffer.from(dataID, 'base64')) : dataID
    const cache = await this.torrentCache.get(hash || (await getInfoHash(torrentID)))
    return this.addTorrent(torrentID, cache)
  }

  /**
   * Adds a torrent to the client for downloading or staging.
   * Restores from cache if available, verifies existing files, and begins progress tracking.
   * @param {string|Buffer} id Magnet URI, torrent file, info hash, or parseTorrent from cache.
   * @param {object} [cache] Cached torrent metadata (if available).
   * @param {boolean} [rescan=false] True if adding during a cache rescan.
   * @param {((files: object[], magnet: {magnet: string, hash: string}) => void)|null} [onReady] Receives playable files after metadata is ready.
   * @param {number} [request] Existing playback request generation, when supplied.
   * @returns {Promise<ReturnType<typeof getStats>|void>} Initial stats after adding, metadata and verification continue in the background.
   */
  async addTorrent(id, cache, rescan = false, onReady = null, request = undefined) {
    if (onReady) {
      if (request === undefined) request = ++this.playbackRequest
      const callback = onReady
      onReady = (...args) => {
        if (request === this.playbackRequest && !this.client.destroyed && !this.destroyed) callback(...args)
      }
    }
    if (this.client.destroyed || !id) return
    debug(`${onReady ? 'Adding' : 'Staging'} torrent: ${!cache ? JSON.stringify(id) : `${cache.infoHash}:${cache.name}`}`)

    const infoHash = cache?.infoHash || await getInfoHash(id)
    await this.removals.get(infoHash)
    if (this.client.destroyed || this.destroyed || (request !== undefined && request !== this.playbackRequest)) return
    const existing = infoHash ? this.client.torrents.find(torrent => torrent.infoHash === infoHash) : await this.client.get(structuredClone(id))
    if (request !== undefined && request !== this.playbackRequest) return
    const currentTorrent = onReady && this.client.torrents.find(torrent => torrent.current)
    if (currentTorrent) await this.promoteTorrent(currentTorrent, true, !!existing)
    if (request !== undefined && request !== this.playbackRequest) return
    if (existing && !existing._removal) {
      debug(`Duplicate torrent detected: ${infoHash}, existing state: current=${existing.current}, staging=${existing.staging}, seeding=${existing.seeding}`)
      if (onReady) {
        existing.staging = false
        existing.seeding = false
        existing.current = !!onReady
        this.updateTorrent(existing.infoHash, { current: { id: existing.magnetURI, ...(existing.local ? { local: true } : {}), infoHash: existing.infoHash, stats: getStats(existing) } })
        if (existing.ready) onReady(this.#mapFiles(existing), { magnet: existing.magnetURI, hash: existing.infoHash })
        else existing.once('ready', () => { if (existing.current) onReady(this.#mapFiles(existing), { magnet: existing.magnetURI, hash: existing.infoHash }) })
      } else if (!rescan) this.notify('info', 'This torrent is already queued and downloading in the background...')
      return getStats(existing)
    } else if (existing?._removal) {
      await this.removals.get(infoHash)
      if (this.client.destroyed || this.destroyed || (request !== undefined && request !== this.playbackRequest)) return
    }

    const torrent = await this.client.add(structuredClone(cache ?? id), {
      path: this.settings.torrentPathNew || ((SUPPORTS.isAndroid || isFlatpak) && this.TMPDIR) || undefined, // flatpak "/tmp" gets wiped on every restart... so best to avoid it.
      announce: this.settings.trackers,
      bitfield: cache?._bitfield,
      deselect: this.settings.torrentStreamedDownload
    })
    if (!torrent.infoHash) {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          torrent.off('infoHash', identified)
          torrent.off('error', failed)
          torrent.off('close', closed)
        }
        const identified = () => { cleanup(); resolve() }
        const failed = error => { cleanup(); reject(error) }
        const closed = () => failed(new Error('Torrent closed before its info hash was available'))
        torrent.once('infoHash', identified)
        torrent.once('error', failed)
        torrent.once('close', closed)
        if (torrent.destroyed) closed()
      })
    }
    if (request !== undefined && request !== this.playbackRequest) {
      if (!torrent.destroyed) await this.#removeTorrent(torrent, false)
      return
    }
    if (this.client.destroyed || this.destroyed || torrent.destroyed) return
    torrent.current = !!onReady
    torrent.staging = !onReady
    torrent.date = new Date(Date.now() - 1_000).toUTCString()
    torrent.cachedAt = cache?.cachedAt ?? Date.now()
    const uploadedOffset = cache?._uploaded ?? 0
    Object.defineProperty(torrent, 'ratio', { // reassign torrent.ratio to use our own getter for more accurate ratio tracking.
      configurable: true,
      get() { return (uploadedOffset + torrent.uploaded) / (torrent.downloaded || torrent.length) }
    })
    const cancel = () => clearTimeout(timeout)
    const timeout = setTimeout(() => {
      torrent.off('close', cancel)
      const seeders = torrent?.wires?.filter(wire => wire.isSeeder)?.length
      if (!this.client.destroyed && !torrent.destroyed && torrent.current && !torrent.progress && !torrent.ready && torrent.numPeers === 0 && this.networking !== 'offline') this.handleError('No peers found, try using a different torrent.')
      else if (!this.client.destroyed && !torrent.destroyed && torrent.current && torrent.progress < .95 && isValidNumber(seeders) && seeders < 5 && isValidNumber(torrent.numPeers) && torrent.numPeers < 25 && this.networking !== 'offline') this.notify('info', 'Availability Warning! This release is poorly seeded and likely will have playback issues such as buffering!')
    }, 30_000)
    torrent.once('close', cancel)
    timeout.unref?.()
    torrent.once('verified', async () => {
      if (this.client.destroyed || torrent.destroyed) return
      if (torrent.current && !torrent.ready && torrent.progress < 1 && !cache?.infoHash) this.notify('info', 'Detected already downloaded files. Verifying file integrity. This might take a minute...')
      if (torrent.staging && this.settings.torrentStreamedDownload && (!this.currentFile || this.currentFile.progress === 1)) {
        for (const file of torrent.files) {
          if (!file._destroyed) file.select()
        }
      }
      if (!rescan && torrent.progress < 1 && (!this.settings.torrentStreamedDownload || torrent.staging) && (torrent.length > (await diskSpace(torrent.path)).free)) this.handleError('File Too Big! This File Exceeds The Selected Drive\'s Available Space. Change Download Location In Torrent Settings To A Drive With More Space And Restart The App!')
    })
    // Publish pending torrents through the same lifecycle updates as ready torrents.
    const publish = () => {
      if (torrent.destroyed || torrent._removal || this.client.destroyed || this.destroyed) return
      const hash = torrent.infoHash
      if (!hash || (torrent.current && !torrent.magnetURI)) return
      const stats = { ...getStats(torrent), infoHash: hash, name: torrent.name || cache?.name || hash }
      if (torrent.current) this.updateTorrent(hash, { current: { id: torrent.magnetURI, infoHash: hash, stats } })
      else if (torrent.staging) this.updateTorrent(hash, { staging: stats })
    }
    if (!torrent.ready) {
      if (!torrent.magnetURI) torrent.once('infoHash', publish)
      if (!torrent.metadata) torrent.once('metadata', publish)
      torrent.once('close', () => {
        torrent.off('infoHash', publish)
        torrent.off('metadata', publish)
      })
      publish()
    }
    // Metadata retrieval and verification continue after accepting the add.
    const initialize = this.#initializeTorrent(torrent, cache, onReady, uploadedOffset)
    if (torrent.ready) await initialize
    else {
      initialize.catch(error => {
        if (torrent._removal || this.client.destroyed || this.destroyed) return
        const hash = torrent.infoHash || infoHash
        if (torrent.destroyed && !this.client.torrents.some(active => active !== torrent && active.infoHash === hash && !active.destroyed)) {
          this.completed = this.completed.filter(completed => completed.infoHash !== hash)
          this.updateTorrent(hash, { untrack: true })
        }
        this.handleError(new Error('Failed to load torrent ' + (torrent.name || hash || '') + ': ' + errorToString(error)))
      })
    }
    return getStats(torrent)
  }

  /**
   * Marks a torrent for seeding, respecting seeding limits.
   * Removes oldest seeding torrent if limit exceeded.
   * @param {Torrent} torrent Torrent to seed.
   * @param {boolean} [swapping=false] True when switching from the current torrent to an existing torrent.
   * @returns {Promise<void>} Resolves after applying the seeding limit.
   */
  async seedTorrent(torrent, swapping = false) {
    if (!torrent || torrent.destroyed) return
    let seedingOffset = 1
    const seedingLimit = this.settings.seedingLimit > SUPPORTS.maxSeeding ? SUPPORTS.maxSeeding : (this.settings.seedingLimit || 1)
    const seedingTorrents = this.client.torrents.filter(_torrent => _torrent.seeding && !_torrent.destroyed)
    if (!torrent.seeding && !torrent.destroyed) {
      if (seedingLimit > 1) {
        torrent.current = false
        torrent.staging = false
        torrent.seeding = true
        if (!swapping) seedingOffset++
        this.updateTorrent(torrent.infoHash, { seeding: getStats(torrent) })
        debug(`Seeding torrent: ${torrent.infoHash}`, torrent.magnetURI)
      } else seedingTorrents.push(torrent)
    }

    const offloadSeeds = (seedingTorrents.length + seedingOffset) - seedingLimit
    if (offloadSeeds > 0) {
      for (const completed of seedingTorrents.sort((a, b) => (b.ratio || 0) - (a.ratio || 0) || a.cachedAt - b.cachedAt).slice(0, offloadSeeds)) {
        await this.completeTorrent(completed)
      }
    }
  }

  /**
   * Promotes a torrent to an active or seeding state based on progress and persistence settings.
   * Also ensures staged/seeding torrents have files selected for download.
   * @param {Torrent} torrent Torrent to promote.
   * @param {boolean} [loaded=false] True when switching from the current torrent to a new current torrent.
   * @param {boolean} [swapping=false] True when switching from the current torrent to an existing torrent.
   * @returns {Promise<void>} Resolves after updating the torrent role.
   */
  async promoteTorrent(torrent, loaded = false, swapping = false) {
    if (this.client.destroyed || torrent.destroyed) return
    if (torrent.current) {
      const seedingLimit = this.settings.seedingLimit > SUPPORTS.maxSeeding ? SUPPORTS.maxSeeding : (this.settings.seedingLimit || 1)
      if (torrent.progress < 1) {
        if (this.settings.torrentPersist || (seedingLimit > 1 && (this.client.torrents.filter(_torrent => (_torrent.seeding || _torrent.staging) && !_torrent.destroyed)?.length + (!swapping ? 1 : 0) < seedingLimit))) {
          torrent.current = false
          torrent.staging = true
          this.updateTorrent(torrent.infoHash, { staging: getStats(torrent) })
          debug(`Loaded torrent did not finish downloading, moving to staging: ${torrent.infoHash}`, torrent.magnetURI)
        } else await this.completeTorrent(torrent)
      } else if (loaded) await this.seedTorrent(torrent, swapping)
      this.client.torrents.filter(_torrent => Array.isArray(_torrent.files)).forEach(_torrent => {
        _torrent.files.forEach(file => {
          if (!file._destroyed) file.select()
        })
      })
    } else await this.seedTorrent(torrent, swapping)
  }

  /**
   * Marks the torrent as complete, handles persistence or cache removal, and removes it from the client.
   * @param {Torrent} torrent The torrent to complete.
   * @returns {Promise<void>} Resolves after caching or deleting and removing the torrent.
   */
  async completeTorrent(torrent) {
    torrent.current = false
    torrent.staging = false
    torrent.seeding = false
    if (!this.settings.torrentPersist) {
      this.updateTorrent(torrent.infoHash, { untrack: true })
    } else {
      this.completed = Array.from(new Map([...(this.completed || []), getStats(torrent)].map(item => [item.infoHash, item])).values())
      this.updateTorrent(torrent.infoHash, { completed: getStats(torrent) })
    }
    debug(`Completed torrent: ${torrent.infoHash}:${this.settings.torrentPersist}`)
    await this.#removeTorrent(torrent, !this.settings.torrentPersist, !this.settings.torrentPersist)
  }

  /**
   * Finishes initialization and publishes lifecycle updates once the torrent is ready.
   * @param {Torrent} torrent Torrent accepted by the engine.
   * @param {object} cache Cached torrent metadata, when available.
   * @param {((files: object[], magnet: {magnet: string, hash: string}) => void)|null} onReady Playback callback.
   * @param {number} uploadedOffset Previously uploaded bytes restored from cache.
   * @returns {Promise<void>} Resolves after readiness and lifecycle initialization.
   */
  async #initializeTorrent(torrent, cache, onReady, uploadedOffset) {
    if (!torrent.ready) {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          torrent.off('ready', ready)
          torrent.off('error', failed)
          torrent.off('close', closed)
        }
        const ready = () => { cleanup(); resolve() }
        const failed = error => { cleanup(); reject(error) }
        const closed = () => failed(new Error('Torrent closed before metadata was ready'))
        torrent.once('ready', ready)
        torrent.once('error', failed)
        torrent.once('close', closed)
        if (torrent.destroyed) closed()
      })
    }

    let interval
    let dataStored = cache
    let torrentUploaded = uploadedOffset
    let torrentProgress = torrent.progress
    const torrentStore = this.torrentCache
    const cacheTorrent = async (force = false) => {
      const uploaded = uploadedOffset + torrent.uploaded
      if (torrent.destroyed) {
        clearInterval(interval)
        this.intervals = this.intervals.filter(timer => timer !== interval)
      }
      if (!force && (torrentProgress === torrent.progress && torrentUploaded === uploaded)) return
      dataStored = {
        info: torrent.info,
        'url-list': torrent.urlList ?? [],
        'announce-list': (torrent.announce ?? []).map(url => [text2arr(url)]),
        _bitfield: torrent.bitfield?.buffer,
        _uploaded: uploaded,
        cachedAt: dataStored?.cachedAt || Date.now(),
        updatedAt: Date.now()
      }
      torrentUploaded = uploaded
      torrentProgress = torrent.progress
      const data = dataStored
      torrent._cacheWrite = (torrent._cacheWrite || Promise.resolve()).then(() => torrentStore.set(torrent.infoHash, data))
      await torrent._cacheWrite
    }
    const wrapTorrent = async () => {
      clearInterval(interval)
      this.intervals = this.intervals.filter(timer => timer !== interval)
      // Capture the snapshot before WebTorrent clears its files and peer state.
      let closedStats
      if (torrent.destroyed && !torrent._removal && !this.client.destroyed && !this.destroyed) {
        if (torrent.current) {
          this.metadata?.destroy()
          this.metadata = null
          this.currentFile = null
        }
        torrent.current = false
        torrent.staging = false
        torrent.seeding = false
        closedStats = { ...getStats(torrent), downloadSpeed: 0, uploadSpeed: 0, numPeers: 0, numSeeders: 0, numLeechers: 0 }
      }
      await cacheTorrent(true)
      if (closedStats) {
        if (this.client.destroyed || this.destroyed || this.client.torrents.some(active => active.infoHash === torrent.infoHash && !active.destroyed)) return
        this.completed = Array.from(new Map([...(this.completed || []), closedStats].map(item => [item.infoHash, item])).values())
        this.updateTorrent(torrent.infoHash, { completed: closedStats })
        return
      }
      await this.promoteTorrent(torrent)
      if (!torrent.destroyed && !this.client.destroyed && !this.destroyed) {
        interval = setInterval(cacheTorrent, getRandomInt(60_000, 120_000))
        this.intervals.push(interval)
        interval.unref?.()
      }
    }
    if (torrent.progress === 1) await wrapTorrent()
    else {
      await cacheTorrent(true)
      if (torrent.destroyed || this.client.destroyed || this.destroyed) return
      if (torrent.progress === 1) await wrapTorrent()
      else {
        interval = setInterval(cacheTorrent, getRandomInt(4_000, 6_000))
        this.intervals.push(interval)
        interval.unref?.()
      }
    }
    this.#bindTracker(torrent)
    if (torrent.current) {
      this.updateTorrent(torrent.infoHash, { current: { id: torrent.magnetURI, ...(torrent.local ? { local: true } : {}), infoHash: torrent.infoHash, stats: getStats(torrent) } })
      onReady?.(this.#mapFiles(torrent), { magnet: torrent.magnetURI, hash: torrent.infoHash })
    } else if (torrent.staging && torrent.progress < 1) this.updateTorrent(torrent.infoHash, { staging: getStats(torrent) })

    torrent.once('done', () => wrapTorrent().catch(error => this.handleError(error)))
    torrent.once('close', () => wrapTorrent().catch(error => this.handleError(error)))
  }

  /**
   * Waits for store cleanup and final cache writes before optionally deleting metadata.
   * @param {Torrent} torrent Torrent to remove.
   * @param {boolean} destroyStore Whether downloaded files should be deleted.
   * @param {boolean} [deleteCache=false] Whether cached metadata should also be deleted.
   * @returns {Promise<void>} Resolves after removal and requested cleanup finish.
   */
  async #removeTorrent(torrent, destroyStore, deleteCache = false) {
    const pending = this.removals.get(torrent.infoHash)
    if (pending) return pending
    torrent._removal = true
    const torrentStore = this.torrentCache
    const removal = Promise.resolve().then(async () => {
      await new Promise((resolve, reject) => {
        this.client.remove(torrent, { destroyStore }, error => error ? reject(error) : resolve()).catch(reject)
      })
      await torrent._cacheWrite
      if (deleteCache) await torrentStore.delete(torrent.infoHash)
    })
    this.removals.set(torrent.infoHash, removal)
    try {
      await removal
    } finally {
      this.removals.delete(torrent.infoHash)
      if (!torrent.destroyed) torrent._removal = false
    }
  }

  /**
   * Scans cached torrents for entries missing from the active and completed lists.
   * @returns {Promise<{missingCount: number, removedCount: number}>} Recovered and deleted cache entry counts.
   */
  async rescan() {
    const excludeHashes = new Set([...this.client.torrents.map(torrent => torrent.infoHash), ...(this.completed || []).map(torrent => torrent.infoHash)].filter(Boolean))
    const torrents = []
    for await (const torrent of this.torrentCache.entries()) {
      if (!excludeHashes.has(torrent.infoHash)) torrents.push(torrent)
    }
    let missingCount = 0
    let removedCount = 0
    for (const torrent of torrents) {
      if ((await getProgressAndSize(torrent))?.progress < 1 && this.settings.torrentPersist) {
        missingCount++
        this.addTorrent(torrent, torrent, true).catch(error => this.handleError(error))
      }
      else if (await this.torrentCache.exists(torrent.name, this.torrentPath)) {
        missingCount++
        const torrentStats = await getProgressAndSize(torrent)
        const verified = await hasIntegrity(torrent, this.torrentPath)
        const _torrent = {
          ...torrent,
          length: torrentStats.size,
          progress: torrentStats.progress,
          incomplete: torrentStats.progress < 1 || !verified,
          missing_pieces: !verified
        }
        this.completed = Array.from(new Map([...(this.completed || []), getStats(_torrent, true)].map(item => [item.infoHash, item])).values())
        this.updateTorrent(_torrent.infoHash, { completed: getStats(_torrent, true) })
      } else {
        removedCount++
        await this.torrentCache.delete(torrent.infoHash)
        await this.torrentCache.delete(torrent.name, this.torrentPath)
      }
    }
    return { missingCount, removedCount }
  }

  /**
   * Restores staged and seeding torrents, completed snapshots, and optional current playback.
   * @param {(string|import('@/types').TorrentSource)[]|null} staging
   * @param {string[]|null} seeding
   * @param {string[]|null} completed
   * @param {object|null} current
   * @param {(files: object[], magnet: {magnet: string, hash: string}) => void} [onReady]
   * @returns {Promise<ReturnType<typeof getStats>[]>}
   */
  async restoreSession(staging, seeding, completed, current, onReady) {
    if (current) {
      debug('Loading last torrent: ', JSON.stringify(current))
      if (current?.length || (typeof current === 'object' && Object.keys(current).length)) {
        this.streamTorrent({ id: current?.id ?? current, hash: current?.infoHash }, onReady).catch(error => this.handleError(error))
      }
    }
    for (const source of staging || []) {
      const hash = source?.infoHash ?? source
      const cache = await this.torrentCache.get(hash)
      this.addTorrent(cache ?? source?.id ?? hash, cache).catch(error => this.handleError(error))
    }
    debug('Loaded staging torrents:', JSON.stringify(staging))
    for (const hash of seeding || []) {
      const cache = await this.torrentCache.get(hash)
      if (cache && await this.torrentCache.exists(cache.name, this.torrentPath)) this.addTorrent(cache, cache).catch(error => this.handleError(error))
      else this.updateTorrent(hash, { untrack: true })
    }
    debug('Loaded seeding torrents:', JSON.stringify(seeding))
    const stats = await Promise.all((completed || []).map(async (hash) => {
      const cache = await this.torrentCache.get(hash)
      if (!cache?.infoHash || !(await this.torrentCache.exists(cache.name, this.torrentPath))) {
        this.updateTorrent(hash, { untrack: true })
        return null
      }
      const torrentStats = await getProgressAndSize(cache)
      const verified = await hasIntegrity(cache, this.torrentPath)
      const _torrent = {
        ...cache,
        length: torrentStats.size,
        progress: torrentStats.progress,
        incomplete: torrentStats.progress < 1 || !verified,
        missing_pieces: !verified
      }
      return getStats(_torrent, true)
    }))
    this.completed = Array.from(new Map([...(this.completed || []), ...(stats.filter(Boolean) || [])].map(item => [item.infoHash, item])).values())
    debug('Loaded completed torrents:', JSON.stringify(completed))
    return this.completed
  }

  /**
   * Stops an active torrent and retains its completed snapshot when persistence is enabled.
   * @param {string} id
   * @returns {Promise<void>} Resolves after the active torrent is removed.
   */
  async complete(id) {
    await this.removals.get(id)
    const cache = await this.torrentCache.get(id)
    if (cache?.infoHash) {
      if (!this.settings.torrentPersist) {
        this.updateTorrent(cache.infoHash, { untrack: true })
      } else {
        const torrentStats = await getProgressAndSize(cache)
        const _torrent = {
          ...cache,
          length: torrentStats.size,
          progress: torrentStats.progress,
        }
        this.completed = Array.from(new Map([...(this.completed || []), getStats(_torrent, true)].map(item => [item.infoHash, item])).values())
        this.updateTorrent(_torrent.infoHash, { completed: getStats(_torrent, true) })
      }
      const completed = this.client.torrents.find(torrent => torrent.infoHash === cache.infoHash)
      debug(`Completed torrent: ${completed?.infoHash}`)
      if (completed) {
        await this.#removeTorrent(completed, !this.settings.torrentPersist, !this.settings.torrentPersist)
      } else if (!this.settings.torrentPersist) await this.torrentCache.delete(id)
    }
  }

  /**
   * Removes a torrent from the client, cache, and renderer lists.
   * @param {string} id Hash of the torrent to remove.
   * @returns {Promise<void>} Resolves after removing the torrent and cached files.
   */
  async untrack(id) { // User really doesn't want this, delete from cache and remove the file. (Probably should implement a prompt asking if the user wants to keep the associated files).
    await this.removals.get(id)
    const untrack = this.client.torrents.find(torrent => torrent.infoHash === id)
    if (untrack) {
      if (untrack.current) {
        this.metadata?.destroy()
        this.metadata = null
        this.currentFile = null
        this.updateTorrent(null, { current: {} })
      }
      await this.#removeTorrent(untrack, true, true)
    } else if (this.completed?.find(torrent => torrent.infoHash === id)) {
      await this.torrentCache.delete(id)
      await this.torrentCache.delete(this.completed.find(torrent => torrent.infoHash === id).name, this.torrentPath)
    }
    this.completed = this.completed.filter(torrent => torrent.infoHash !== id)
    this.updateTorrent(id, { untrack: true })
  }

  /**
   * Unloads current playback or restores an explicitly supplied torrent as completed.
   * @param {string|{infoHash?: string, hash?: string, torrent?: string}|null} data Torrent to unload, or null for current playback.
   * @returns {Promise<void>} Resolves after unloading or scheduling restoration.
   */
  async unload(data = null) {
    if (!data) {
      const request = ++this.playbackRequest
      const current = this.client.torrents.find(torrent => torrent.current)
      if (!current) return
      const cache = await this.torrentCache.get(current.infoHash)
      if (request !== this.playbackRequest || this.client.destroyed || this.destroyed) return
      const change = this.playbackChange.then(async () => {
        if (request !== this.playbackRequest || current.destroyed || this.client.destroyed || this.destroyed) return
        this.metadata?.destroy()
        this.metadata = null
        this.currentFile = null
        const seedingLimit = this.settings.seedingLimit > SUPPORTS.maxSeeding ? SUPPORTS.maxSeeding : (this.settings.seedingLimit || 1)
        if (this.settings.torrentPersist || (seedingLimit > 1 && (this.client.torrents.filter(_torrent => (_torrent.seeding || _torrent.staging) && !_torrent.destroyed)?.length + 1 < seedingLimit))) {
          await this.#removeTorrent(current, false)
          if (request === this.playbackRequest) this.updateTorrent(null, { current: {} })
          if (cache) await this.addTorrent(cache, cache).catch(error => this.handleError(error))
        } else {
          this.updateTorrent(null, { current: {} })
          await this.#removeTorrent(current, true, true)
        }
      })
      this.playbackChange = change.then(() => {}, () => {})
      return change
    } else if (data) {
      const target = data?.hash && this.client.torrents.find(torrent => torrent.infoHash === data.torrent)
      const request = target?.current ? ++this.playbackRequest : this.playbackRequest
      const cache = await this.torrentCache.get(data?.infoHash || (data?.hash && data?.torrent) || (await getInfoHash(data?.torrent || data)))
      if (cache?.infoHash) {
        const torrentStats = await getProgressAndSize(cache)
        if (request !== this.playbackRequest && this.client.torrents.some(torrent => torrent.current && torrent.infoHash === cache.infoHash)) return
        const _torrent = {
          ...cache,
          length: torrentStats.size,
          progress: torrentStats.progress,
        }
        if (target && !target.destroyed) await this.#removeTorrent(target, !this.settings.torrentPersist)
        if (request !== this.playbackRequest && this.client.torrents.some(torrent => torrent.current && torrent.infoHash === cache.infoHash)) return
        this.completed = Array.from(new Map([...(this.completed || []), getStats(_torrent, true)].map(item => [item.infoHash, item])).values())
        this.updateTorrent(_torrent.infoHash, { completed: getStats(_torrent, true) })
      }
    }
  }

  // TODO: addLocalFiles

  /**
   * Selects a playable file and prepares metadata for internal playback.
   * Handles file selection/deselection, streaming metadata, and external player launching.
   * @param {string} id Info hash of the torrent to play.
   * @param {string} path Path of the file within the torrent to play.
   * @param {boolean} external Whether to launch an external player.
   * @returns {Promise<true|void>} True when using external playback; otherwise no value.
   */
  async setPlayback(id, path, external) {
    const request = ++this.playbackRequest
    if (id && path) {
      const torrent = await this.client.get(id)
      if (request !== this.playbackRequest || this.client.destroyed || this.destroyed || !torrent || torrent.destroyed || torrent._removal) return
      const found = torrent.files.find(file => file.path === path)
      if (!found || found._destroyed) return
      const space = this.settings.torrentStreamedDownload ? await diskSpace(torrent.path) : null
      if (request !== this.playbackRequest || this.client.destroyed || this.destroyed || torrent.destroyed || torrent._removal || found._destroyed) return
      if (this.playerProcess) {
        this.playerProcess.kill()
        this.playerProcess = null
      }
      if (this.currentFile) {
        this.currentFile.removeAllListeners('stream')
        this.currentFile.removeAllListeners('iterator')
        if (this.settings.torrentStreamedDownload && !this.currentFile._destroyed && found.progress < 1) this.currentFile.deselect()
      }
      if (this.settings.torrentStreamedDownload && found.progress < 1) {
        this.client.torrents.filter(_torrent => (_torrent.staging || _torrent.seeding) && Array.isArray(_torrent.files)).forEach(_torrent => {
          _torrent.files.forEach(file => {
            if (!file._destroyed) file.deselect()
          })
        })
      }
      this.metadata?.destroy?.()
      this.metadata = null
      found.select()
      if (this.settings.torrentStreamedDownload && (found.length > space.free)) this.handleError('File Too Big! This File Exceeds The Selected Drive\'s Available Space. Change Download Location In Torrent Settings To A Drive With More Space And Restart The App!')

      if (this.settings.torrentStreamedDownload) {
        if (this._checkProgress) {
          const lastTorrent = this.client.torrents.find(torrent => torrent.current)
          if (lastTorrent) lastTorrent.off('download', this._checkProgress)
        }
        this._checkProgress = () => {
          if (this.currentFile !== found || this.client.destroyed) torrent.off('download', this._checkProgress)
          else if (this.currentFile.progress === 1) {
            debug('Current file has completed its streamed download... resuming queued torrents.', found.path)
            this.client.torrents.filter(_torrent => Array.isArray(_torrent.files) && _torrent.infoHash !== torrent.infoHash).forEach(_torrent => {
              _torrent.files.forEach(file => {
                if (!file._destroyed) file.select()
              })
            })
            torrent.off('download', this._checkProgress)
          }
        }
        torrent.on('download', this._checkProgress)
      }
      this.currentFile = found

      const currentTorrent = this.client.torrents.find(_torrent => _torrent.current)
      if (currentTorrent) {
        currentTorrent.current = false
      }
      torrent.current = true
      if (!(external && (SUPPORTS.isAndroid || this.settings.playerPath))) {
        this.metadata = new Metadata(found, torrent.files)
      } else return true
    }
  }

  /**
   * Launches the configured desktop player or returns an Android playback intent.
   * @param {string} path Path of the file to view.
   * @param {() => void} [externalWatched] Receives elapsed playback time when the desktop player closes.
   * @returns {Promise<string|void>} Android intent URL, or no value for desktop playback or a missing file.
   */
  async launchExternal(path, externalWatched = () => {}) {
    const found = this.client.torrents.find(_torrent => _torrent.current)?.files?.find(file => file.path === path)
    if (!found) return
    if (this.playerProcess) {
      this.playerProcess.removeAllListeners('close')
      this.playerProcess.kill()
      this.playerProcess = null
    }
    if (this.settings.playerPath) {
      const url = '' + new URL('http://localhost:' + this.torrentServer.address().port + found.streamURL)
      this.playerProcess = spawn(this.settings.playerPath, [url])
      this.playerProcess.stdout.on('data', () => {})
      this.playerProcess.once('close', () => {
        if (this.client.destroyed) return
        this.playerProcess = null
        externalWatched()
      })
      return url
    } else if (SUPPORTS.isAndroid) return `intent://localhost:${this.torrentServer.address().port}${found.streamURL}#Intent;type=video/any;scheme=http;end;`
  }

  /**
   * Binds an HTTP tracker client to the given torrent to update seeder/leecher counts.
   * Overrides the torrent's `destroy` method to ensure the tracker client is cleaned up.
   * @private
   * @param {Torrent} torrent Torrent to bind the tracker to.
   * @returns {void}
   */
  #bindTracker(torrent) {
    if (!torrent?.infoHash || torrent.destroyed || torrent.tracker || !torrent.client?.peerId || !(torrent.announce || []).length) return

    const client = new Client({
      infoHash: torrent.infoHash,
      announce: torrent.announce,
      peerId: torrent.client.peerId,
      port: this.client.torrentPort
    })

    client.on('update', (data) => {
      // Only update if it's a new/better tracker report, typically it will lean toward favoring a specific url and sticking with it.
      if (!torrent.trackerUrl || (torrent.trackerUrl === data.announce) || (torrent.seeders <= data.complete)) {
        torrent.seeders = data.complete
        torrent.leechers = data.incomplete
        torrent.trackerUrl = data.announce
        debug(`Updated seeders and leechers:`, JSON.stringify({ name: torrent.name, infoHash: torrent.infoHash, seeders: torrent.seeders, leechers: torrent.leechers, trackerUrl: torrent.trackerUrl, complete: data.complete, incomplete: data.incomplete }))
      }
    })
    client.start()

    torrent.tracker = client
    const _destroy = torrent.destroy.bind(torrent)
    torrent.destroy = (opts, cb) => {
      if (torrent.tracker) {
        torrent.tracker.stop()
        torrent.tracker.destroy()
        torrent.tracker = null
      }
      return _destroy(opts, cb)
    }
    torrent.once('done', () => client.complete())
    torrent.once('close', () => client.complete())
    debug(`Successfully bound tracker:`, { name: torrent.name, infoHash: torrent.infoHash })
  }

  /**
   * Performs a tracker scrape request for one or more info hashes.
   * Used to retrieve current seeder/leecher counts from trackers.
   * TODO: Rework this, it works but is not very good and prone to hanging...
   * @param {string[]} infoHashes Hashes to scrape.
   * @returns {Promise<object[]>} Scrape results keyed by info hash.
   */
  async scrape(infoHashes) {
    debug(`Scraping ${infoHashes.length} hashes`)
    const MAX_ANNOUNCE_LENGTH = 1300 // it's likely 2048, but let's undercut it
    const RATE_LIMIT = 200 // ms
    const ANNOUNCE_LENGTH = this.tracker.scrapeUrl.length
    let batch = []
    let currentLength = ANNOUNCE_LENGTH // fuzz the size a little so we don't always request the same amt of hashes
    const results = []
    const scrape = async () => {
      if (results.length) await sleep(RATE_LIMIT)
      const result = await new Promise(resolve => {
        this.tracker._request(this.tracker.scrapeUrl, { info_hash: batch }, (err, data) => {
          if (err) {
            const error = errorToString(err)
            debug('Failed to scrape: ' + error)
            this.notify('warn', `Failed to update seeder counts: ${error}`)
            return resolve([])
          }
          const { files } = data
          const result = []
          debug(`Scraped ${Object.keys(files || {}).length} hashes`)
          for (const [key, data] of Object.entries(files || {})) result.push({ hash: key.length !== 40 ? arr2hex(text2arr(key)) : key, ...data })
          resolve(result)
        })
      })
      results.push(...result)
      batch = []
      currentLength = ANNOUNCE_LENGTH
    }

    for (const infoHash of infoHashes.sort(() => 0.5 - Math.random()).map(infoHash => hex2bin(infoHash))) {
      const qsLength = stringifyQuery({ info_hash: infoHash }).length + 1 // qs length + 1 for the & or ? separator
      if (currentLength + qsLength > MAX_ANNOUNCE_LENGTH) await scrape()
      batch.push(infoHash)
      currentLength += qsLength
    }
    if (batch.length) await scrape()
    debug(`Scraped ${results.length} hashes`)

    return results
  }

  /**
   * Requests fresh peer information for an active torrent.
   * @param {string} id Torrent hash to reannounce.
   * @returns {Promise<void>}
   */
  async reannounceTorrent(id) {
    const reannounce = this.client.torrents.find(torrent => torrent.infoHash === id)
    if (!this.client.destroyed && reannounce && !reannounce.destroyed) {
      reannounce.discovery?.tracker?.start()
      this.notify('info', `Reannounce successful for ${reannounce.name}`)
    }
  }

  /**
   * Reads capacity and available space for the configured torrent directory.
   * @returns {Promise<{total: number, free: number}>} Disk capacity and free space in bytes.
   */
  getDiskSpace() {
    return diskSpace(this.torrentPath || TMP)
  }

  /**
   * Returns a snapshot for the requested active torrent, or null if it is no longer active.
   * @param {string} infoHash
   * @returns {(ReturnType<typeof getStats> & {fileProgress: number})|null}
   */
  getTorrentStats(infoHash) {
    const torrent = this.client.torrents.find(torrent => torrent.infoHash === infoHash && !torrent.destroyed && !torrent._removal)
    if (!torrent) return null
    return {
      ...getStats(torrent, false, false),
      fileProgress: (torrent.current && torrent.pieces && this.currentFile?.progress) || 0
    }
  }

  /**
   * Updates the client's settings.
   * Applies download/upload limits, updates the player path, and initializes the torrent cache (if the location changed).
   * @param {Record<string, any>} settings
   * @returns {Promise<void>}
   */
  async updateSettings(settings) {
    if (!this.client || this.client?.destroyed) return
    this.settings = { ...settings }
    this.client.throttleDownload(this.settings.downloadLimit)
    this.client.throttleUpload(this.settings.uploadLimit)
    this.torrentPath = this.settings.torrentPathNew || this.TMPDIR || ''
    this.torrentCache = new Cache(this.torrentPath)
  }

  /**
   * Applies network availability to the active torrent connections.
   * @param {string} status
   * @returns {Promise<void>}
   */
  async updateNetwork(status) {
    if (this.networking === 'offline' && status !== 'offline') {
      this.client.torrents.forEach(torrent => {
        if (!this.client.destroyed && !torrent.destroyed) torrent.discovery?.tracker?.start()
      })
    }
    this.networking = status
  }

  /**
   * Replaces the enabled debug namespaces.
   * @param {string} debug Debug namespace filter.
   * @returns {Promise<void>}
   */
  async setDebug(debug) {
    Debug.disable()
    if (debug) Debug.enable(debug)
  }

  /**
   * Converts and filters an error before dispatching it to listeners.
   * Ignores common/expected connection-related errors.
   * @private
   * @param {Error|string} e Error object or message to dispatch.
   * @returns {void}
   */
  handleError(e) {
    const error = errorToString(e)
    console.error('Error: ' + error, e)
    for (const exclude of ['WebSocket', 'User-Initiated Abort, reason=', 'Connection failed.', 'UTP_ECONNRESET']) {
      if (error.startsWith(exclude)) return
    }
    this.notify('error', error)
  }

  /**
   * Processes a torrent's files once metadata is available and prepares them for playback.
   * Generates unique file hashes, constructs local URLs, and sets a timeout to check for stalled torrents.
   * @private
   * @param {Torrent} torrent The active torrent instance containing files and metadata.
   * @returns {Array<Object>} Array of mapped file objects.
   */
  #mapFiles(torrent) {
    if (this.client.destroyed) return []
    debug('Got torrent metadata:', torrent.name)
    const files = torrent.files.map(file => {
      return {
        infoHash: torrent.infoHash,
        fileHash: makeHash(`${torrent.infoHash}:${file.name}:${file.size}`),
        torrent_name: torrent.name,
        name: file.name,
        type: file.type,
        size: file.size,
        path: file.path,
        url: 'http://localhost:' + this.torrentServer.address().port + file.streamURL
      }
    })
    const cancel = () => clearTimeout(timeout)
    const timeout = setTimeout(() => {
      torrent.off('close', cancel)
      if (this.client.destroyed || torrent.destroyed) return
      if (torrent.progress !== 1) {
        if (torrent.numPeers === 0 && this.networking !== 'offline') this.handleError('No peers found, try using a different torrent.')
      }
    }, 30_000)
    torrent.once('close', cancel)
    timeout.unref?.()
    return files
  }

  /**
   * Gracefully shuts down the TorrentClient, closing trackers, metadata, server, and destroying all torrents.
   * Returns a promise that resolves once the client is fully destroyed.
   * @returns {Promise<void>} Resolves after resources are released; rejects if engine shutdown fails.
   */
  destroy() {
    if (this.destroyed) return this.destroyed
    debug('Destroying TorrentClient')
    const torrents = [...this.client.torrents]
    this.intervals.forEach(clearInterval)
    this.intervals = []
    if (this._checkProgress) {
      const currentTorrent = this.client.torrents.find(torrent => torrent.current)
      if (currentTorrent) currentTorrent.off('download', this._checkProgress)
      this._checkProgress = null
    }
    if (this.playerProcess) {
      this.playerProcess.removeAllListeners()
      this.playerProcess.kill()
      this.playerProcess = null
    }
    this.tracker?.destroy(() => null)
    this.metadata?.destroy?.()
    this.torrentServer?.close?.()
    this.destroyed = Promise.allSettled([
      ...this.removals.values(),
      new Promise((resolve, reject) => {
        if (this.client.destroyed) {
          debug('Ooops! TorrentClient is already destroyed!')
          return resolve()
        }
        this.client.destroy(error => error ? reject(error) : resolve())
      })
    ]).then(async results => {
      results.push(...await Promise.allSettled(torrents.map(torrent => torrent._cacheWrite)))
      for (const result of results) if (result.status === 'rejected') throw result.reason
    })
    return this.destroyed
  }
}
