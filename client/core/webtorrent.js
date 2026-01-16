import WebTorrent from 'webtorrent'
import HTTPTracker from 'http-tracker'
import Client from 'bittorrent-tracker'
import { hex2bin, arr2hex, text2arr } from 'uint8-util'
import { makeHash, getInfoHash, hasIntegrity, getProgressAndSize, stringifyQuery, errorToString, encodeStreamURL, ANNOUNCE, TMP } from '@client/lib/util.js'
import { fontRx, sleep, subRx, videoRx, isValidNumber } from '@/modules/util.js'
import { SUPPORTS } from '@/modules/support.js'
import { spawn } from 'node:child_process'
import Metadata from '@client/lib/metadata.js'
import Cache from '@client/lib/torrentcache.js'
import Debug from 'debug'
const debug = Debug('torrent:worker')

// HACK: this is https only, but electron doesn't run in https, weird.
if (!globalThis.FileSystemFileHandle) globalThis.FileSystemFileHandle = false

export default class TorrentClient extends WebTorrent {
  player = ''
  /** @type {ReturnType<spawn>} */
  playerProcess = null
  networking = 'online'
  intervals = []
  timeouts = []

  /**
   * Creates a new TorrentClient instance.
   * @param {any} ipc - Inter-process communication interface.
   * @param {number} storageQuota - Maximum storage quota in bytes.
   * @param {string} serverMode - Server mode ('node', 'browser', etc.).
   * @param {object} settings - Torrent and network configuration settings.
   * @param {Promise<any>|null} controller - Optional server controller promise.
   */
  constructor(ipc, storageQuota, serverMode, settings, controller) {
    debug('Initializing TorrentClient with settings:', JSON.stringify(settings))
    super({
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
    this.player = settings.playerPath
    this.ipc = ipc
    this.TMPDIR = this.settings.TMPDIR
    this.torrentPath = this.settings.torrentPathNew || (SUPPORTS.isAndroid ? this.TMPDIR : TMP) || ''
    this.torrentCache = new Cache(this.torrentPath)
    ipc.send('torrentRequest')
    this._ready = new Promise(resolve => {
      ipc.on('port', ({ ports }) => {
        if (this.destroyed) return
        this.message = ports[0].postMessage.bind(ports[0])
        ports[0].onmessage = ({ data }) => {
          debug(`Received IPC message ${data.type}:`, JSON.stringify(data.data))
          this.handleMessage({ data })
        }
        resolve()
      })
      ipc.on('destroy', this.destroy.bind(this))
    })

    this.serverMode = serverMode
    this.storageQuota = storageQuota
    this.currentFile = null

    const statsInterval = setInterval(() => {
      if (this.destroyed) return
      const currentTorrent = this.torrents.find(torrent => torrent.current)
      this.dispatch('stats', {
        numPeers: currentTorrent?.numPeers || 0,
        uploadSpeed: currentTorrent?.uploadSpeed || 0,
        downloadSpeed: currentTorrent?.downloadSpeed || 0
      })
    }, 200)
    this.intervals.push(statsInterval)
    statsInterval.unref?.()
    const activityInterval = setInterval(() => {
      if (this.destroyed) return
      const currentTorrent = this.torrents.find(torrent => torrent.current)
      if (currentTorrent?.pieces) this.dispatch('progress', this.currentFile?.progress)
      this.dispatch('activity', {
        current: {
          infoHash: currentTorrent?.infoHash,
          name: currentTorrent?.name,
          size: currentTorrent?.length,
          current: currentTorrent?.current,
          progress: currentTorrent?.progress,
          numSeeders: currentTorrent?.wires?.filter(wire => wire.isSeeder).length || 0,
          totalSeeders: currentTorrent?.seeders || 0,
          numLeechers: (currentTorrent?.wires?.length - currentTorrent?.wires?.filter(wire => wire.isSeeder).length) || 0,
          totalLeechers: currentTorrent?.leechers || 0,
          numPeers: currentTorrent?.numPeers || 0,
          downloadSpeed: currentTorrent?.downloadSpeed || 0,
          uploadSpeed: currentTorrent?.uploadSpeed || 0,
          magnetURI: currentTorrent?.magnetURI,
          date: currentTorrent?.date ?? new Date(Date.now() - 1_000).toUTCString(),
          eta: currentTorrent?.timeRemaining,
          ratio: currentTorrent?.ratio
        },
        staging: this.torrents.filter(torrent => torrent.staging).map(torrent => ({
          infoHash: torrent.infoHash,
          name: torrent.name,
          size: torrent.length,
          staging: torrent.staging,
          progress: torrent.progress,
          numSeeders: torrent.wires.filter(wire => wire.isSeeder).length || 0,
          totalSeeders: torrent?.seeders || 0,
          numLeechers: (torrent.wires.length - torrent.wires.filter(wire => wire.isSeeder).length) || 0,
          totalLeechers: torrent.leechers || 0,
          numPeers: torrent.numPeers,
          downloadSpeed: torrent.downloadSpeed,
          uploadSpeed: torrent.uploadSpeed,
          magnetURI: torrent.magnetURI,
          date: torrent.date ?? new Date(Date.now() - 1_000).toUTCString(),
          eta: torrent.timeRemaining,
          ratio: torrent.ratio
        })),
        seeding: this.torrents.filter(torrent => torrent.seeding).map(torrent => ({
          infoHash: torrent.infoHash,
          name: torrent.name,
          size: torrent.length,
          seeding: torrent.seeding,
          progress: torrent.progress,
          numSeeders: torrent.wires.filter(wire => wire.isSeeder).length || 0,
          totalSeeders: torrent?.seeders || 0,
          numLeechers: (torrent.wires.length - torrent.wires.filter(wire => wire.isSeeder).length) || 0,
          totalLeechers: torrent.leechers || 0,
          numPeers: torrent.numPeers,
          downloadSpeed: torrent.downloadSpeed,
          uploadSpeed: torrent.uploadSpeed,
          magnetURI: torrent.magnetURI,
          date: torrent.date ?? new Date(Date.now() - 1_000).toUTCString(),
          ratio: torrent.ratio
        }))
      })
    }, 5_000)
    this.intervals.push(activityInterval)
    activityInterval.unref?.()

    const createServer = controller => {
      this.server = this.createServer({ controller }, serverMode)
      this.server.listen(0, () => {})
    }
    if (controller) controller.then(createServer)
    else createServer()

    this.tracker = new HTTPTracker({}, atob('aHR0cDovL255YWEudHJhY2tlci53Zjo3Nzc3L2Fubm91bmNl'))
    process.on('uncaughtException', this.dispatchError.bind(this))
    this.on('error', this.dispatchError.bind(this))
  }

  /**
   * Loads the most recently used torrent from cache and resumes it.
   * @param {string|Buffer} torrent - Magnet URI, torrent file, or torrent info.
   */
  async loadLastTorrent(torrent) {
    debug('Loading last torrent: ', JSON.stringify(torrent))
    if (!torrent?.length && !(typeof torrent === 'object' && Object.keys(torrent).length)) return
    const cache = await this.torrentCache.get(torrent?.infoHash || await getInfoHash(torrent))
    this.addTorrent(torrent?.id ?? torrent, cache, true)
  }

  /**
   * Handles the current torrent metadata once it becomes available and notifies listeners with file and magnet info.
   * @param {import('webtorrent').Torrent} torrent - Active torrent instance.
   */
  async torrentReady(torrent) {
    if (this.destroyed) return
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
        url: this.serverMode === 'node' ? 'http://localhost:' + this.server.address().port + encodeStreamURL(file.streamURL) : encodeStreamURL(file.streamURL)
      }
    })
    this.dispatch('files', files)
    this.dispatch('magnet', { magnet: torrent.magnetURI, hash: torrent.infoHash })
    const timeout = setTimeout(() => {
      if (this.destroyed || torrent.destroyed) return
      if (torrent.progress !== 1) {
        if (torrent.numPeers === 0 && this.networking !== 'offline') this.dispatchError('No peers found, try using a different torrent.')
      }
    }, 30_000)
    this.timeouts.push(timeout)
    timeout.unref?.()
  }

  /**
   * Searches the current torrent for embedded font files and sends them to the renderer for use.
   * @param {object} targetFile - File currently being processed.
   */
  async findFontFiles(targetFile) {
    const currentTorrent = this.torrents.find(torrent => torrent.current)
    if (!currentTorrent?.files) return
    const fontFiles = currentTorrent.files.filter(file => fontRx.test(file.name))
    const map = {}

    // deduplicate fonts
    // some releases have duplicate fonts for diff languages
    // if they have different chars, we can't find that out anyways
    // so some chars might fail, on REALLY bad releases
    for (const file of fontFiles) map[file.name] = file
    debug(`Found ${Object.keys(map).length} font files`)

    for (const file of Object.values(map)) {
      const data = await file.arrayBuffer()
      if (targetFile !== this.currentFile) return
      this.dispatch('file', { data: new Uint8Array(data) }, [data])
    }
  }

  /**
   * Searches the current torrent for subtitle files matching the current video and sends them to the renderer.
   * @param {object} targetFile - File currently being processed.
   */
  async findSubtitleFiles(targetFile) {
    const currentTorrent = this.torrents.find(torrent => torrent.current)
    if (!currentTorrent?.files) return
    const videoFiles = currentTorrent.files.filter(file => videoRx.test(file.name))
    const videoName = targetFile.name.substring(0, targetFile.name.lastIndexOf('.')) || targetFile.name
    // array of subtitle files that match video name, or all subtitle files when only 1 vid file
    const subfiles = currentTorrent.files.filter(file => subRx.test(file.name) && (videoFiles.length === 1 ? true : file.name.includes(videoName)))
    debug(`Found ${subfiles?.length} subtitle files`)
    for (const file of subfiles) {
      const data = await file.arrayBuffer()
      if (targetFile !== this.currentFile) return
      this.dispatch('subtitleFile', { name: file.name, data: new Uint8Array(data) }, [data])
    }
  }

  /**
   * Adds a torrent to the client for downloading or staging.
   * Restores from cache if available, verifies existing files, and begins progress tracking.
   *
   * @param {string|Buffer} id - Magnet URI, torrent file, info hash, or parseTorrent from cache.
   * @param {object} [cache] - Cached torrent metadata (if available).
   * @param {boolean} [current=false] - Whether to set as the active torrent for playback.
   * @param {boolean} [rescan=false] - True if adding during a cache rescan.
   */
  async addTorrent(id, cache, current = false, rescan = false) {
    if (this.destroyed || !id) return
    debug(`${current ? 'Adding' : 'Staging'} torrent: ${!cache ? JSON.stringify(id) : `${cache.infoHash}:${cache.name}`}`)

    const infoHash = cache?.infoHash || await getInfoHash(id)
    const existing = infoHash ? this.torrents.find(torrent => torrent.infoHash === infoHash) : await this.get(structuredClone(id))
    const currentTorrent = current && this.torrents.find(torrent => torrent.current)
    if (currentTorrent) await this.promoteTorrent(currentTorrent, true, !!existing)
    if (existing && !existing._removal) {
      debug(`Duplicate torrent detected: ${infoHash}, existing state: current=${existing.current}, staging=${existing.staging}, seeding=${existing.seeding}`)
      if (current) {
        existing.staging = false
        existing.seeding = false
        existing.current = current
        this.bumpTorrent(existing)
        this.dispatch('loaded', { id: existing.magnetURI, ...(existing.local ? { local: true } : {}), infoHash: existing.infoHash })
        if (existing.ready) this.torrentReady(existing)
      } else if (!rescan) this.dispatch('info', 'This torrent is already queued and downloading in the background...')
      return
    } else if (existing?._removal) {
      const start = Date.now()
      while (existing._removal && !existing.destroyed && !this.destroyed && Date.now() - start < 5000) await new Promise(resolve => setTimeout(resolve, 100))
      const existingRemoval = this.torrents.find(torrent => torrent.infoHash === infoHash)
      if (existingRemoval && !existingRemoval._removal) {
        debug('Torrent still exists after the expected removal... aborting.')
        return
      }
    }

    const torrent = await this.add(structuredClone(cache ?? id), {
      path: this.settings.torrentPathNew || undefined,
      announce: ANNOUNCE,
      bitfield: cache?._bitfield,
      deselect: this.settings.torrentStreamedDownload
    })
    torrent.current = current
    torrent.staging = !current
    torrent.date = new Date(Date.now() - 1_000).toUTCString()
    this.bumpTorrent(torrent)
    const timeout = setTimeout(() => {
      const seeders = torrent?.wires?.filter(wire => wire.isSeeder)?.length
      if (!this.destroyed && !torrent.destroyed && torrent.current && !torrent.progress && !torrent.ready && torrent.numPeers === 0 && this.networking !== 'offline') this.dispatchError('No peers found, try using a different torrent.')
      else if (!this.destroyed && !torrent.destroyed && torrent.current && torrent.progress < .95 && isValidNumber(seeders) && seeders.length < 5 && isValidNumber(torrent.numPeers) && torrent.numPeers < 25 && this.networking !== 'offline') this.dispatch('info', 'Availability Warning! This release is poorly seeded and likely will have playback issues such as buffering!')
    }, 30_000)
    this.timeouts.push(timeout)
    timeout.unref?.()
    torrent.once('metadata', () => {
      if (!rescan && torrent.staging && torrent.progress < 1 && !cache?.infoHash) this.dispatch('info', 'Torrent queued for background download. Check the management page for progress...')
    })
    torrent.once('verified', async () => {
      if (this.destroyed || torrent.destroyed) return
      if (torrent.current && !torrent.ready && torrent.progress < 1 && !cache?.infoHash) this.dispatch('info', 'Detected already downloaded files. Verifying file integrity. This might take a minute...')
      if (torrent.staging && this.settings.torrentStreamedDownload && (!this.currentFile || this.currentFile.progress === 1)) {
        for (const file of torrent.files) {
          if (!file._destroyed) file.select()
        }
      }
      if (!rescan && torrent.progress < 1 && (!this.settings.torrentStreamedDownload || torrent.staging) && (torrent.length > await this.storageQuota(torrent.path))) this.dispatchError('File Too Big! This File Exceeds The Selected Drive\'s Available Space. Change Download Location In Torrent Settings To A Drive With More Space And Restart The App!')
    })
    if (!torrent.ready) await new Promise(resolve => torrent.once('ready', resolve))

    let interval
    let dataStored = cache
    let torrentProgress = torrent.progress
    const torrentComplete = torrent.progress === 1
    const torrentStore = this.torrentCache
    const cacheBitfield = async (task = true) => {
      if (torrent.destroyed) clearInterval(interval)
      if (torrent.destroyed || (task && (torrentProgress === torrent.progress || torrent.progress === 1))) return
      dataStored = {
        info: torrent.info,
        'url-list': torrent.urlList ?? [],
        'announce-list': (torrent.announce ?? []).map(url => [text2arr(url)]),
        _bitfield: torrent.bitfield?.buffer,
        cachedAt: dataStored?.cachedAt || Date.now(),
        updatedAt: Date.now()
      }
      torrentProgress = torrent.progress
      await torrentStore.set(torrent.infoHash, dataStored)
    }
    const wrapTorrent  = async () => {
      clearInterval(interval)
      await cacheBitfield(torrentComplete)
      await this.promoteTorrent(torrent)
    }
    if (torrent.progress === 1) await wrapTorrent()
    else {
      interval = setInterval(cacheBitfield, 5_000)
      this.intervals.push(interval)
      interval.unref?.()
      await cacheBitfield()
    }
    this.bindTracker(torrent)
    if (torrent.current) {
      this.dispatch('loaded', { id: torrent.magnetURI, ...(torrent.local ? { local: true } : {}), infoHash: torrent.infoHash })
      this.torrentReady(torrent)
    } else if (torrent.staging && torrent.progress < 1) this.dispatch('staging', torrent.infoHash)

    torrent.once('done', wrapTorrent)
    torrent.once('close', wrapTorrent)
  }

  /**
   * Marks a torrent for seeding, respecting seeding limits.
   * Removes oldest seeding torrent if limit exceeded.
   *
   * @param {import('webtorrent').Torrent} torrent - Torrent to seed.
   * @param {boolean} [swapping=false] - True when switching from the current torrent to an existing torrent.
   */
  async seedTorrent(torrent, swapping = false) {
    if (!torrent || torrent.destroyed) return
    let seedingOffset = 1
    const seedingLimit = this.settings.seedingLimit > SUPPORTS.maxSeeding ? SUPPORTS.maxSeeding : (this.settings.seedingLimit || 1)
    const seedingTorrents = this.torrents.filter(_torrent => _torrent.seeding && !_torrent.destroyed)
    if (!torrent.seeding && !torrent.destroyed) {
      if (seedingLimit > 1) {
        torrent.current = false
        torrent.staging = false
        torrent.seeding = true
        if (!swapping) seedingOffset++
        this.bumpTorrent(torrent)
        this.dispatch('seeding', torrent.infoHash)
        debug(`Seeding torrent: ${torrent.infoHash}`, torrent.magnetURI)
      } else seedingTorrents.push(torrent)
    }

    const offloadSeeds = (seedingTorrents.length + seedingOffset) - seedingLimit
    if (offloadSeeds > 0) {
      for (const completed of seedingTorrents.sort((a, b) => (b.ratio || 0) - (a.ratio || 0)).slice(0, offloadSeeds)) {
        await this.completeTorrent(completed)
      }
    }
  }

  /**
   * Promotes a torrent to an active or seeding state based on progress and persistence settings.
   * Also ensures staged/seeding torrents have files selected for download.
   *
   * @param {import('webtorrent').Torrent} torrent - Torrent to promote.
   * @param {boolean} [loaded=false] - True when switching from the current torrent to a new current torrent.
   * @param {boolean} [swapping=false] - True when switching from the current torrent to an existing torrent.
   */
  async promoteTorrent(torrent, loaded = false, swapping = false) {
    if (this.destroyed || torrent.destroyed) return
    if (torrent.current) {
      const seedingLimit = this.settings.seedingLimit > SUPPORTS.maxSeeding ? SUPPORTS.maxSeeding : (this.settings.seedingLimit || 1)
      if (torrent.progress < 1) {
        if (this.settings.torrentPersist || (seedingLimit > 1 && (this.torrents.filter(_torrent => (_torrent.seeding || _torrent.staging) && !_torrent.destroyed)?.length + (!swapping ? 1 : 0) < seedingLimit))) {
          torrent.current = false
          torrent.staging = true
          this.bumpTorrent(torrent)
          this.dispatch('staging', torrent.infoHash)
          debug(`Loaded torrent did not finish downloading, moving to staging: ${torrent.infoHash}`, torrent.magnetURI)
        } else this.completeTorrent(torrent)
      } else if (loaded) await this.seedTorrent(torrent, swapping)
      this.torrents.filter(_torrent => Array.isArray(_torrent.files)).forEach(_torrent => {
        _torrent.files.forEach(file => {
          if (!file._destroyed) file.select()
        })
      })
    } else await this.seedTorrent(torrent, swapping)
  }

  /**
   * Marks the torrent as complete, handles persistence or cache removal, and removes it from the client.
   *
   *  @param torrent the torrent to complete
   */
  async completeTorrent(torrent) {
    torrent.current = false
    torrent.staging = false
    torrent.seeding = false
    if (!this.settings.torrentPersist) await this.torrentCache.delete(torrent.infoHash)
    else {
      const stats = { infoHash: torrent.infoHash, name: torrent.name, size: torrent.length, progress: torrent.progress, magnetURI: torrent.magnetURI, date: new Date(Date.now() - 1_000).toUTCString(), incomplete: torrent.progress < 1 }
      this.completed = Array.from(new Map([...(this.completed || []), stats].map(item => [item.infoHash, item])).values())
      this.dispatch('completed', stats)
    }
    debug(`Completed torrent: ${torrent.infoHash}:${this.settings.torrentPersist}`)
    torrent._removal = true
    await this.remove(torrent, { destroyStore: !this.settings.torrentPersist })
  }

  /**
   * Handles incoming IPC messages and dispatches torrent operations.
   * Supports loading, staging, seeding, rescanning, settings updates, playback control, and torrent completion events.
   *
   * @param {{data: any}} opts - IPC message event object.
   */
  async handleMessage({ data }) {
    if (this.destroyed) return
    switch (data.type) {
      case 'load': {
        this.loadLastTorrent(data.data)
        break
      } case 'destroy': {
        this.destroy()
        break
      } case 'scrape': {
        this._scrape(data.data)
        break
      } case 'rescan': {
        this.dispatch('info', 'Rescanning the torrent cache, this will take a moment...')
        const excludeHashes = new Set([...this.torrents.map(torrent => torrent.infoHash), ...(this.completed || []).map(torrent => torrent.infoHash)].filter(Boolean))
        const torrents = []
        for await (const torrent of this.torrentCache.entries()) {
          if (!excludeHashes.has(torrent.infoHash)) torrents.push(torrent)
        }
        let missingCount = 0
        let removedCount = 0
        for (const torrent of torrents) {
          if ((await getProgressAndSize(torrent))?.progress < 1 && this.settings.torrentPersist) {
            missingCount++
            this.addTorrent(torrent, torrent, false, true)
          }
          else if (await this.torrentCache.exists(torrent.name, this.torrentPath)) {
            missingCount++
            const torrentStats = await getProgressAndSize(torrent)
            const verified = await hasIntegrity(torrent, this.torrentPath)
            const stats = { infoHash: torrent.infoHash, name: torrent.name, size: torrentStats.size, progress: torrentStats.progress, magnetURI: torrent.magnetURI, date: new Date(Date.now() - 1_000).toUTCString(), incomplete: torrentStats.progress < 1 || !verified, missing_pieces: !verified }
            this.completed = Array.from(new Map([...(this.completed || []), stats].map(item => [item.infoHash, item])).values())
            this.dispatch('completed', stats)
          } else {
            removedCount++
            await this.torrentCache.delete(torrent.infoHash)
            await this.torrentCache.delete(torrent.name, this.torrentPath)
          }
        }
        this.dispatch('rescan_done')
        this.dispatch('info', `Rescan complete: ${missingCount} missing torrents found, ${removedCount} removed from cache.`)
        break
      } case 'settings': {
        this.settings = { ...data.data }
        this.throttleDownload(this.settings.downloadLimit)
        this.throttleUpload(this.settings.uploadLimit)
        this.player = this.settings.playerPath
        this.torrentPath = this.settings.torrentPathNew || (SUPPORTS.isAndroid ? this.TMPDIR : TMP) || ''
        this.torrentCache = new Cache(this.torrentPath)
        break
      } case 'current': {
        if (data.data) {
          const torrent = await this.get(data.data.current.infoHash)
          if (!torrent || torrent.destroyed) return
          const found = torrent.files.find(file => file.path === data.data.current.path)
          if (!found || found._destroyed) return
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
            this.torrents.filter(_torrent => (_torrent.staging || _torrent.seeding) && Array.isArray(_torrent.files)).forEach(_torrent => {
              _torrent.files.forEach(file => {
                if (!file._destroyed) file.deselect()
              })
            })
          }
          this.metadata?.destroy?.()
          this.metadata = null
          found.select()
          if (this.settings.torrentStreamedDownload && (found.length > await this.storageQuota(torrent.path))) this.dispatchError('File Too Big! This File Exceeds The Selected Drive\'s Available Space. Change Download Location In Torrent Settings To A Drive With More Space And Restart The App!')

          if (this.settings.torrentStreamedDownload) {
            if (this._checkProgress) {
              const lastTorrent = this.torrents.find(torrent => torrent.current)
              if (lastTorrent) lastTorrent.off('download', this._checkProgress)
            }
            this._checkProgress = () => {
              if (this.currentFile !== found || this.destroyed) torrent.off('download', this._checkProgress)
              else if (this.currentFile.progress === 1) {
                debug('Current file has completed its streamed download... resuming queued torrents.', found.path)
                this.torrents.filter(_torrent => Array.isArray(_torrent.files) && _torrent.infoHash !== torrent.infoHash).forEach(_torrent => {
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

          const currentTorrent = this.torrents.find(_torrent => _torrent.current)
          if (currentTorrent) {
            currentTorrent.current = false
            this.bumpTorrent(currentTorrent)
          }
          torrent.current = true
          this.bumpTorrent(torrent)
          if (!(data.data.external && (SUPPORTS.isAndroid || this.player))) {
            this.metadata = new Metadata(this, found)
            this.findSubtitleFiles(found)
            this.findFontFiles(found)
          } else this.dispatch('externalReady')
        }
        break
      } case 'externalPlay': {
        const startTime = Date.now()
        const found = this.torrents.find(_torrent => _torrent.current)?.files?.find(file => file.path === data.data.current.path)
        if (!found) return
        this.ipc.removeAllListeners('external-close')
        if (this.playerProcess) {
          this.playerProcess.removeAllListeners('close')
          this.playerProcess.kill()
          this.playerProcess = null
        }
        if (this.player) {
          this.playerProcess = spawn(this.player, ['' + new URL('http://localhost:' + this.server.address().port + encodeStreamURL(found.streamURL))])
          this.playerProcess.stdout.on('data', () => {})
          this.playerProcess.once('close', () => {
            if (this.destroyed) return
            this.playerProcess = null
            const seconds = (Date.now() - startTime) / 1000
            this.dispatch('externalWatched', seconds)
          })
        } else if (SUPPORTS.isAndroid) this.dispatch('androidExternal', `intent://localhost:${this.server.address().port}${encodeStreamURL(found.streamURL)}#Intent;type=video/any;scheme=http;end;`)
        break
      } case 'torrent': {
        const hash = data.data && data.data.hash
        const torrentID = data.data && data.data.id
        const cache = await this.torrentCache.get(hash || (await getInfoHash(torrentID)))
        if (!cache?.infoHash && data.data.magnet) this.dispatch('info', 'A Magnet Link has been detected and is being processed. Files will be loaded shortly...')
        this.addTorrent(torrentID, cache, true)
        break
      } case 'stage': {
        const hash = data.data && data.data.hash
        const torrentID = data.data && data.data.id
        const cache = await this.torrentCache.get(hash || (await getInfoHash(torrentID)))
        this.addTorrent(torrentID, cache)
        break
      } case 'complete': {
        const cache = await this.torrentCache.get(data.data)
        if (cache?.infoHash) {
          if (!this.settings.torrentPersist) await this.torrentCache.delete(data.data)
          else {
            const torrentStats = await getProgressAndSize(cache)
            const stats = { infoHash: cache.infoHash, name: cache.name, size: torrentStats.size, progress: torrentStats.progress, magnetURI: cache.magnetURI, date: new Date(Date.now() - 1_000).toUTCString(), incomplete: torrentStats.progress < 1 }
            this.completed = Array.from(new Map([...(this.completed || []), stats].map(item => [item.infoHash, item])).values())
            this.dispatch('completed', stats)
          }
          const completed = this.torrents.find(torrent => torrent.infoHash === cache.infoHash)
          debug(`Completed torrent: ${completed?.infoHash}`)
          if (completed) {
            completed._removal = true
            await this.remove(completed, { destroyStore: !this.settings.torrentPersist })
          }
        }
        break
      } case 'stage_all': {
        for (const hash of data.data) {
          const cache = await this.torrentCache.get(hash)
          if (cache) this.addTorrent(cache, cache)
          else this.dispatch('untrack', hash)
        }
        debug('Loaded staging torrents:', JSON.stringify(data.data))
        break
      } case 'seed_all': {
        for (const hash of data.data) {
          const cache = await this.torrentCache.get(hash)
          if (cache && await this.torrentCache.exists(cache.name, this.torrentPath)) this.addTorrent(cache, cache)
          else this.dispatch('untrack', hash)
        }
        debug('Loaded seeding torrents:', JSON.stringify(data.data))
        break
      } case 'complete_all': {
        const stats = await Promise.all(data.data.map(async (hash) => {
          const cache = await this.torrentCache.get(hash)
          if (!cache?.infoHash || !(await this.torrentCache.exists(cache.name, this.torrentPath))) {
            this.dispatch('untrack', hash)
            return null
          }
          const torrentStats = await getProgressAndSize(cache)
          const verified = await hasIntegrity(cache, this.torrentPath)
          return { infoHash: cache.infoHash, name: cache.name, size: torrentStats.size, progress: torrentStats.progress, magnetURI: cache.magnetURI, date: new Date(Date.now() - 1_000).toUTCString(), incomplete: torrentStats.progress < 1 || !verified, missing: !verified }
        }))
        this.completed = Array.from(new Map([...(this.completed || []), ...(stats.filter(Boolean) || [])].map(item => [item.infoHash, item])).values())
        this.dispatch('completedStats', this.completed.reverse())
        debug('Loaded completed torrents:', JSON.stringify(data.data))
        break
      } case 'unload': {
        if (!data.data && this.torrents.find(torrent => torrent.current)) {
          this.currentFile = null
          const current = this.torrents.find(torrent => torrent.current)
          const cache = await this.torrentCache.get(current.infoHash)
          const seedingLimit = this.settings.seedingLimit > SUPPORTS.maxSeeding ? SUPPORTS.maxSeeding : (this.settings.seedingLimit || 1)
          if (this.settings.torrentPersist || (seedingLimit > 1 && (this.torrents.filter(_torrent => (_torrent.seeding || _torrent.staging) && !_torrent.destroyed)?.length + 1 < seedingLimit))) {
            current._removal = true
            await this.remove(current, { destroyStore: false })
            if (cache) {
              this.dispatch('loaded', {})
              this.addTorrent(cache, cache)
            }
          } else {
            current._removal = true
            this.dispatch('loaded', {})
            this.torrentCache.delete(current.infoHash)
            await this.remove(current, { destroyStore: true })
          }
        } else if (data.data) {
          const cache = await this.torrentCache.get(data.data?.infoHash || (data.data?.hash && data.data?.torrent) || (await getInfoHash(data.data?.torrent || data.data)))
          if (cache?.infoHash) {
            const torrentStats = await getProgressAndSize(cache)
            const stats = { infoHash: cache.infoHash, name: cache.name, size: torrentStats.size, progress: torrentStats.progress, magnetURI: cache.magnetURI, date: new Date(Date.now() - 1_000).toUTCString(), incomplete: torrentStats.progress < 1 }
            this.completed = Array.from(new Map([...(this.completed || []), stats].map(item => [item.infoHash, item])).values())
            if (data.data?.hash) {
              const unload = this.torrents.find(torrent => torrent.infoHash === data.data.torrent)
              if (unload) {
                unload._removal = true
                await this.remove(unload, { destroyStore: !this.settings.torrentPersist })
              }
            }
            this.dispatch('completed', stats)
          }
        }
        break
      } case 'untrack': { // User really doesn't want this, delete from cache and remove the file. (Probably should implement a prompt asking if the user wants to keep the associated files).
        const untrack = this.torrents.find(torrent => torrent.infoHash === data.data)
        if (untrack) {
          untrack._removal = true
          await this.torrentCache.delete(untrack.infoHash)
          await this.remove(untrack, { destroyStore: true })
        } else if (this.completed?.find(torrent => torrent.infoHash === data.data)) {
          await this.torrentCache.delete(data.data)
          await this.torrentCache.delete(this.completed.find(torrent => torrent.infoHash === data.data).name, this.torrentPath)
        }
        this.dispatch('untrack', data.data)
        break
      } case 'networking': {
        if (this.networking.match(/offline/i) && !data.data.match(/offline/i)) {
          this.torrents.forEach(torrent => {
            if (!this.destroyed && !torrent.destroyed) torrent.discovery?.tracker?.start()
          })
        }
        this.networking = data.data
        break
      } case 'debug': {
        Debug.disable()
        if (data.data) Debug.enable(data.data)
        break
      }
    }
  }

  /**
   * Binds an HTTP tracker client to the given torrent to update seeder/leecher counts.
   * Overrides the torrent's `destroy` method to ensure the tracker client is cleaned up.
   *
   * @param {import('webtorrent').Torrent} torrent - Torrent to bind the tracker to.
   */
  bindTracker(torrent) {
    if (!torrent?.infoHash || torrent.destroyed || torrent.tracker || !torrent.client?.peerId || !(torrent.announce || []).length) return

    const client = new Client({
      infoHash: torrent.infoHash,
      announce: torrent.announce,
      peerId: torrent.client.peerId,
      port: this.torrentPort
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
   *
   * @param {{id: string, infoHashes: string[]}} opts - Scrape request containing ID and info hashes.
   * @returns {Promise<{id: string, result: object[]}>} Scrape results keyed by info hash.
   */
  async _scrape({ id, infoHashes }) {
    debug(`Scraping ${infoHashes.length} hashes, id: ${id}`)
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
            this.dispatch('warn', `Failed to update seeder counts: ${error}`)
            return resolve([])
          }
          const { files } = data
          const result = []
          debug(`Scraped ${Object.keys(files || {}).length} hashes, id: ${id}`)
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
    debug(`Scraped ${results.length} hashes, id: ${id}`)

    this.dispatch('scrape_done', { id, result: results })
    return { id, result: results }
  }

  /**
   * Moves the specified torrent to the front of the torrent list.
   * Useful for prioritizing torrents in UI and processing order.
   *
   * @param {import('webtorrent').Torrent} torrent - Torrent to prioritize.
   */
  bumpTorrent(torrent) {
    const index = this.torrents.indexOf(torrent)
    if (index > -1) this.torrents.splice(index, 1)
    this.torrents.unshift(torrent)
  }

  /**
   * Dispatches an event to the IPC channel once the client is ready.
   *
   * @param {string} type - Event type name.
   * @param {any} data - Event payload data.
   * @param {Transferable[]} [transfer] - Optional transferable objects for structured cloning.
   */
  async dispatch(type, data, transfer) {
    await this._ready
    this.message?.({ type, data }, transfer)
  }

  /**
   * Converts and filters an error before dispatching it to listeners.
   * Ignores common/expected connection-related errors.
   *
   * @param {Error|string} e - Error object or message to dispatch.
   */
  dispatchError(e) {
    const error = errorToString(e)
    for (const exclude of ['WebSocket', 'User-Initiated Abort, reason=', 'Connection failed.']) {
      if (error.startsWith(exclude)) return
    }
    console.error('Error: ' + error, e)
    this.dispatch('error', error)
  }

  /**
   * Gracefully shuts down the TorrentClient, closing trackers, metadata, server, and destroying all torrents.
   * Emits a `destroyed` event via IPC once complete.
   */
  destroy() {
    debug('Destroying TorrentClient')
    if (this.destroyed) {
      debug('Ooops! TorrentClient is already destroyed!')
      this.ipc?.send('destroyed')
      this.ipc?.emit('destroyed')
      return
    }
    this.intervals.forEach(clearInterval)
    this.timeouts.forEach(clearTimeout)
    if (this._checkProgress) {
      const currentTorrent = this.torrents.find(t => t.current)
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
    this.server?.close?.()
    super.destroy(() => {
      this.ipc?.send('destroyed')
      this.ipc?.emit('destroyed')
    })
  }
}