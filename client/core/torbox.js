import { join } from 'node:path'
import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import TorBoxAPI from '@client/lib/torboxapi.js'
import HTTPFile from '@client/lib/httpfile.js'
import Metadata from '@client/lib/metadata.js'
import { getInfoHash, makeHash, errorToString, TMP } from '@client/lib/util.js'
import { arr2hex, hex2bin } from 'uint8-util'
import { fontRx, subRx, videoRx } from '@/modules/util.js'
import { SUPPORTS } from '@/modules/support.js'
import Debug from 'debug'
const debug = Debug('torrent:torbox')

const HEX_HASH = /^[a-f0-9]{40}$|^[a-f0-9]{32}$/i

/**
 * Debrid (TorBox) backend for Shiru.
 *
 * It is a drop-in replacement for the WebTorrent `TorrentClient` and speaks the
 * exact same IPC contract with the renderer: it consumes `torrent`/`stage`/
 * `current`/... messages and emits `files`/`activity`/`loaded`/`subtitle`/...
 * events. Instead of running a local BitTorrent engine it hands torrents off to
 * TorBox and streams playback from TorBox's range-capable CDN links.
 *
 * Anything that fundamentally requires local piece access (real seeding, peer
 * counts, bitfields, file selection) is mapped onto TorBox's cloud model or
 * stubbed out as a no-op while preserving the event shapes the UI expects.
 */
export default class TorrentClient {
  networking = 'online'
  intervals = []
  timeouts = []
  /** @type {Array<object>} In-memory torrent records mirrored to the UI. */
  torrents = []
  /** @type {object[]} */
  completed = []
  /** @type {ReturnType<spawn>|null} */
  playerProcess = null
  currentFile = null
  destroyed = false

  /**
   * @param {any} ipc - Inter-process communication interface.
   * @param {Function} storageQuota - Unused; kept for signature parity with WebTorrent backend.
   * @param {string} serverMode - Unused; kept for signature parity.
   * @param {object} settings - Torrent and network configuration settings (must include `torboxApiKey`).
   */
  constructor (ipc, storageQuota, serverMode, settings) {
    debug('Initializing TorBox TorrentClient')
    this.settings = settings
    this.serverMode = serverMode
    this.player = settings.playerPath
    this.ipc = ipc
    this.TMPDIR = settings.TMPDIR
    this.torrentPath = settings.torrentPathNew || (SUPPORTS.isAndroid ? this.TMPDIR : TMP) || ''
    this.cacheDir = join(this.torrentPath, 'shiru-torbox-cache')
    this.api = new TorBoxAPI(settings.torboxApiKey)

    ipc.send('torrentRequest')
    this._ready = new Promise(resolve => {
      ipc.on('port', ({ ports }) => {
        if (this.destroyed) return
        this.message = ports[0].postMessage.bind(ports[0])
        ports[0].onmessage = ({ data }) => {
          debug(`Received IPC message ${data.type}`)
          this.handleMessage({ data })
        }
        resolve()
      })
      ipc.on('destroy', this.destroy.bind(this))
    })

    const statsInterval = setInterval(() => {
      if (this.destroyed) return
      const current = this.torrents.find(torrent => torrent.current)
      this.dispatch('stats', {
        numPeers: current?.numPeers || 0,
        uploadSpeed: current?.uploadSpeed || 0,
        downloadSpeed: current?.downloadSpeed || 0
      })
    }, 200)
    this.intervals.push(statsInterval)
    statsInterval.unref?.()

    const activityInterval = setInterval(() => {
      if (this.destroyed) return
      const current = this.torrents.find(torrent => torrent.current)
      if (current) this.dispatch('progress', current.progress)
      this.dispatch('activity', {
        current: this.toActivity(current, 'current'),
        staging: this.torrents.filter(torrent => torrent.staging).map(torrent => this.toActivity(torrent, 'staging')),
        seeding: this.torrents.filter(torrent => torrent.seeding).map(torrent => this.toActivity(torrent, 'seeding'))
      })
    }, 5_000)
    this.intervals.push(activityInterval)
    activityInterval.unref?.()

    // Refresh TorBox download progress / readiness for tracked torrents.
    const pollInterval = setInterval(() => { if (!this.destroyed) this.poll() }, 5_000)
    this.intervals.push(pollInterval)
    pollInterval.unref?.()

    process.on?.('uncaughtException', this.dispatchError.bind(this))
  }

  /**
   * Maps an internal torrent record to the activity payload shape the UI expects.
   * @param {object|undefined} torrent
   * @param {'current'|'staging'|'seeding'} state
   */
  toActivity (torrent, state) {
    if (!torrent) return { infoHash: undefined }
    return {
      infoHash: torrent.infoHash,
      name: torrent.name,
      size: torrent.length,
      [state]: true,
      progress: torrent.progress ?? 0,
      numSeeders: torrent.numSeeders || 0,
      totalSeeders: torrent.totalSeeders || 0,
      numLeechers: torrent.numLeechers || 0,
      totalLeechers: torrent.totalLeechers || 0,
      numPeers: torrent.numPeers || 0,
      downloadSpeed: torrent.downloadSpeed || 0,
      uploadSpeed: torrent.uploadSpeed || 0,
      magnetURI: torrent.magnetURI,
      date: torrent.date ?? new Date(Date.now() - 1_000).toUTCString(),
      eta: torrent.eta,
      ratio: torrent.ratio
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Lightweight JSON persistence (decoupled from the bencode torrent cache). */
  /* ----------------------------------------------------------------------- */

  /** @param {string} infoHash */
  cacheFile (infoHash) {
    return join(this.cacheDir, `${infoHash}.json`)
  }

  /** @param {object} record */
  async cacheSet (record) {
    if (!record?.infoHash) return
    try {
      await mkdir(this.cacheDir, { recursive: true })
      await writeFile(this.cacheFile(record.infoHash), JSON.stringify(record))
    } catch (err) {
      debug(`Failed to persist ${record.infoHash}: ${errorToString(err)}`)
    }
  }

  /** @param {string} infoHash */
  async cacheGet (infoHash) {
    try {
      return JSON.parse(await readFile(this.cacheFile(infoHash), 'utf8'))
    } catch {
      return null
    }
  }

  /** @param {string} infoHash */
  async cacheDelete (infoHash) {
    try {
      await unlink(this.cacheFile(infoHash))
    } catch { /* ignore */ }
  }

  async * cacheEntries () {
    let files = []
    try {
      files = await readdir(this.cacheDir)
    } catch { return }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const record = await this.cacheGet(file.slice(0, -5))
      if (record) yield record
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Torrent source resolution + TorBox add flow.                            */
  /* ----------------------------------------------------------------------- */

  /**
   * Normalizes any supported torrent identifier into a magnet/file plus info hash.
   * @param {string|Uint8Array|Buffer} id
   * @returns {Promise<{ magnet?: string, file?: Uint8Array, infoHash: string, magnetURI: string }>}
   */
  async resolveSource (id) {
    if (id && typeof id === 'object' && (id.magnetURI || id.infoHash || id.id) && !(id instanceof Uint8Array)) {
      // A cached record (JSON cache entry or a `loaded` detail) was passed straight through.
      const magnet = id.magnetURI || id.id
      return { magnet, infoHash: id.infoHash, magnetURI: magnet, torboxId: id.torboxId, record: id }
    }
    if (id instanceof Uint8Array || Buffer.isBuffer?.(id)) {
      const infoHash = await getInfoHash(id)
      return { file: id, infoHash, magnetURI: infoHash ? `magnet:?xt=urn:btih:${infoHash}` : undefined }
    }
    if (typeof id === 'string') {
      if (id.startsWith('magnet:')) {
        return { magnet: id, infoHash: await getInfoHash(id), magnetURI: id }
      }
      if (HEX_HASH.test(id)) {
        const magnet = `magnet:?xt=urn:btih:${id.toLowerCase()}`
        return { magnet, infoHash: id.toLowerCase(), magnetURI: magnet }
      }
      if (id.startsWith('http')) {
        const res = await fetch(id)
        if (!res.ok) throw new Error(`Failed to fetch torrent: HTTP ${res.status}`)
        const file = new Uint8Array(await res.arrayBuffer())
        const infoHash = await getInfoHash(file)
        return { file, infoHash, magnetURI: infoHash ? `magnet:?xt=urn:btih:${infoHash}` : undefined }
      }
    }
    throw new Error('Unsupported torrent identifier')
  }

  /**
   * Adds a torrent to TorBox and tracks it locally.
   * @param {string|Uint8Array|Buffer|object} id
   * @param {{ current?: boolean, queued?: boolean }} [opts]
   */
  async addTorrent (id, { current = false, queued = false } = {}) {
    if (this.destroyed || !id) return
    if (!this.api.configured) {
      this.dispatchError('No TorBox API key configured. Add your API key in Torrent settings.')
      return
    }
    let source
    try {
      source = await this.resolveSource(id)
    } catch (err) {
      this.dispatchError(errorToString(err))
      return
    }
    const infoHash = source.infoHash
    if (!infoHash) {
      this.dispatchError('Could not determine the info hash for this torrent.')
      return
    }

    // De-duplicate against already tracked torrents.
    const existing = this.torrents.find(torrent => torrent.infoHash === infoHash)
    if (existing) {
      if (current) {
        await this.demoteCurrent()
        existing.current = true
        existing.staging = false
        existing.seeding = false
        this.bumpTorrent(existing)
        this.dispatch('loaded', { id: existing.magnetURI, infoHash })
        if (existing.ready) this.emitFiles(existing)
        else existing._needsFiles = true
      } else {
        this.dispatch('info', 'This torrent is already queued on TorBox...')
      }
      return
    }

    if (current) {
      await this.demoteCurrent()
      if (!source.torboxId) this.dispatch('info', 'Sending torrent to TorBox. Files will load once TorBox has it ready...')
    }

    let torboxId = source.torboxId
    let hash = infoHash
    // Recover a previously known TorBox id from our local cache to avoid re-adding.
    if (!torboxId) {
      const record = await this.cacheGet(infoHash)
      if (record?.torboxId) torboxId = record.torboxId
    }
    try {
      if (!torboxId) {
        const created = await this.api.createTorrent({ magnet: source.magnet, file: source.file, queued })
        torboxId = created?.torrent_id ?? created?.queued_id
        hash = (created?.hash || infoHash).toLowerCase()
      }
    } catch (err) {
      this.dispatchError(errorToString(err))
      return
    }

    const torrent = {
      infoHash: hash,
      torboxId,
      name: source.record?.name || hash,
      length: source.record?.length || 0,
      magnetURI: source.magnetURI || `magnet:?xt=urn:btih:${hash}`,
      files: [],
      current,
      staging: !current,
      seeding: false,
      progress: 0,
      ready: false,
      _needsFiles: true,
      date: new Date(Date.now() - 1_000).toUTCString()
    }
    this.torrents.unshift(torrent)
    await this.cacheSet(this.toRecord(torrent))

    if (!current) this.dispatch('staging', torrent.infoHash)
    // Kick an immediate refresh so instantly-cached torrents load without delay.
    await this.refreshTorrent(torrent)
  }

  /** Demotes the current torrent (if any) to staging/seeding before a new one loads. */
  async demoteCurrent () {
    const current = this.torrents.find(torrent => torrent.current)
    if (!current) return
    current.current = false
    if (current.progress >= 1) {
      current.seeding = true
      this.dispatch('seeding', current.infoHash)
    } else {
      current.staging = true
      this.dispatch('staging', current.infoHash)
    }
  }

  /**
   * Pulls fresh metadata/progress for a torrent from TorBox and, when ready,
   * mints stream links and emits the files list.
   * @param {object} torrent
   */
  async refreshTorrent (torrent) {
    if (this.destroyed || !torrent?.torboxId) return
    const info = await this.api.getTorrent(torrent.torboxId)
    if (!info) return
    torrent.name = info.name || torrent.name
    torrent.length = info.size || torrent.length
    torrent.progress = info.download_finished ? 1 : (typeof info.progress === 'number' ? info.progress : torrent.progress)
    torrent.downloadSpeed = info.download_speed || 0
    torrent.uploadSpeed = info.upload_speed || 0
    torrent.numSeeders = torrent.totalSeeders = info.seeds || 0
    torrent.numPeers = info.peers || 0
    torrent.eta = info.eta

    const ready = (info.download_present || info.download_finished || info.cached) && Array.isArray(info.files) && info.files.length
    if (ready && torrent._needsFiles) {
      try {
        torrent.files = await this.buildFiles(torrent, info.files)
        torrent.ready = true
        torrent._needsFiles = false
        await this.cacheSet(this.toRecord(torrent))
        if (torrent.current) {
          this.dispatch('loaded', { id: torrent.magnetURI, infoHash: torrent.infoHash })
          this.emitFiles(torrent)
        }
      } catch (err) {
        this.dispatchError(errorToString(err))
      }
    }
    // A finished background torrent becomes "seeding" (retained in the TorBox cloud).
    if (torrent.staging && torrent.progress >= 1) {
      torrent.staging = false
      torrent.seeding = true
      this.dispatch('seeding', torrent.infoHash)
    }
  }

  /** Periodically refresh any torrents still downloading or awaiting files. */
  async poll () {
    const pending = this.torrents.filter(torrent => torrent._needsFiles || torrent.progress < 1)
    for (const torrent of pending) await this.refreshTorrent(torrent)
  }

  /**
   * Mints direct stream links for each TorBox file and maps them to the UI file shape.
   * @param {object} torrent
   * @param {any[]} torboxFiles
   */
  async buildFiles (torrent, torboxFiles) {
    return Promise.all(torboxFiles.map(async file => {
      const fileId = file.id
      const name = file.short_name || file.name?.split('/').pop() || file.name
      const url = await this.api.requestDownloadLink(torrent.torboxId, fileId)
      return {
        infoHash: torrent.infoHash,
        fileHash: makeHash(`${torrent.infoHash}:${name}:${file.size}`),
        torrent_name: torrent.name,
        name,
        type: file.mimetype || file.mime_type || '',
        size: file.size,
        path: file.name,
        url,
        _torboxFileId: fileId
      }
    }))
  }

  /** @param {object} torrent */
  emitFiles (torrent) {
    this.dispatch('files', torrent.files.map(({ _torboxFileId, ...file }) => file))
    this.dispatch('magnet', { magnet: torrent.magnetURI, hash: torrent.infoHash })
  }

  /** Strips runtime-only fields before persisting a torrent record. */
  toRecord (torrent) {
    return {
      infoHash: torrent.infoHash,
      torboxId: torrent.torboxId,
      name: torrent.name,
      length: torrent.length,
      magnetURI: torrent.magnetURI,
      progress: torrent.progress
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Subtitle / font extraction over HTTP (option 1).                        */
  /* ----------------------------------------------------------------------- */

  /**
   * Loads container metadata (tracks, chapters, fonts, subtitles) for the file
   * about to be played by streaming it over HTTP from the TorBox CDN link, and
   * surfaces any external subtitle/font sidecar files in the same torrent.
   * @param {object} torrent
   * @param {object} file - One of `torrent.files`.
   */
  async loadMetadata (torrent, file) {
    this.metadata?.destroy?.()
    this.metadata = null
    // Refresh the playing file's link so long-lived sessions never hit an expired URL.
    try {
      const fresh = await this.api.requestDownloadLink(torrent.torboxId, file._torboxFileId)
      if (fresh) file.url = fresh
    } catch (err) {
      debug(`Could not refresh stream link: ${errorToString(err)}`)
    }
    const httpFile = new HTTPFile(file.url, { name: file.name, size: file.size })
    this.metadata = new Metadata(this, httpFile)
    this.findSidecarFiles(torrent, file)
  }

  /**
   * Finds subtitle/font files alongside the playing video and ships them to the renderer.
   * @param {object} torrent
   * @param {object} targetFile
   */
  async findSidecarFiles (torrent, targetFile) {
    if (!torrent?.files?.length) return
    const videoFiles = torrent.files.filter(file => videoRx.test(file.name))
    const videoName = targetFile.name.substring(0, targetFile.name.lastIndexOf('.')) || targetFile.name
    const subfiles = torrent.files.filter(file => subRx.test(file.name) && (videoFiles.length === 1 ? true : file.name.includes(videoName)))
    const fonts = torrent.files.filter(file => fontRx.test(file.name))
    for (const file of subfiles) {
      if (this.currentFile !== targetFile || this.destroyed) return
      try {
        const data = new Uint8Array(await new HTTPFile(file.url).arrayBuffer())
        this.dispatch('subtitleFile', { name: file.name, data }, [data.buffer])
      } catch (err) {
        debug(`Failed to fetch subtitle ${file.name}: ${errorToString(err)}`)
      }
    }
    for (const file of fonts) {
      if (this.currentFile !== targetFile || this.destroyed) return
      try {
        const data = new Uint8Array(await new HTTPFile(file.url).arrayBuffer())
        // The renderer's font handler expects a binary string (see subtitles.js#handleFile).
        this.dispatch('file', hex2bin(arr2hex(data)))
      } catch (err) {
        debug(`Failed to fetch font ${file.name}: ${errorToString(err)}`)
      }
    }
  }

  /* ----------------------------------------------------------------------- */
  /* IPC message handling.                                                   */
  /* ----------------------------------------------------------------------- */

  /** @param {{data: any}} opts */
  async handleMessage ({ data }) {
    if (this.destroyed) return
    try {
      switch (data.type) {
        case 'load': {
          if (data.data && (data.data.infoHash || data.data.id || typeof data.data === 'string')) await this.addTorrent(data.data, { current: true })
          break
        }
        case 'destroy': {
          this.destroy()
          break
        }
        case 'scrape': {
          await this.scrape(data.data)
          break
        }
        case 'rescan': {
          await this.rescan()
          break
        }
        case 'settings': {
          this.settings = { ...data.data }
          this.player = this.settings.playerPath
          if (this.api.apiKey !== (this.settings.torboxApiKey || '').trim()) this.api = new TorBoxAPI(this.settings.torboxApiKey)
          this.torrentPath = this.settings.torrentPathNew || (SUPPORTS.isAndroid ? this.TMPDIR : TMP) || ''
          this.cacheDir = join(this.torrentPath, 'shiru-torbox-cache')
          break
        }
        case 'current': {
          await this.handleCurrent(data.data)
          break
        }
        case 'externalPlay': {
          this.handleExternalPlay(data.data)
          break
        }
        case 'torrent': {
          const id = data.data.base64 ? new Uint8Array(Buffer.from(data.data.id, 'base64')) : data.data.id
          await this.addTorrent(id, { current: true })
          break
        }
        case 'stage': {
          const id = data.data.base64 ? new Uint8Array(Buffer.from(data.data.id, 'base64')) : data.data.id
          await this.addTorrent(id, { queued: true })
          break
        }
        case 'complete': {
          await this.completeTorrent(data.data)
          break
        }
        case 'stage_all': {
          for (const hash of data.data || []) {
            const record = await this.cacheGet(hash)
            if (record) await this.addTorrent(record, { queued: true })
            else this.dispatch('untrack', hash)
          }
          break
        }
        case 'seed_all': {
          for (const hash of data.data || []) {
            const record = await this.cacheGet(hash)
            if (record) await this.addTorrent(record, { queued: true })
            else this.dispatch('untrack', hash)
          }
          break
        }
        case 'complete_all': {
          const stats = []
          for (const hash of data.data || []) {
            const record = await this.cacheGet(hash)
            if (!record) { this.dispatch('untrack', hash); continue }
            stats.push({ infoHash: record.infoHash, name: record.name, size: record.length, progress: record.progress ?? 1, magnetURI: record.magnetURI, date: new Date(Date.now() - 1_000).toUTCString(), incomplete: (record.progress ?? 1) < 1 })
          }
          this.completed = Array.from(new Map([...this.completed, ...stats].map(item => [item.infoHash, item])).values())
          this.dispatch('completedStats', this.completed.slice().reverse())
          break
        }
        case 'unload': {
          await this.handleUnload(data.data)
          break
        }
        case 'untrack': {
          await this.untrack(data.data)
          break
        }
        case 'reannounce': {
          const torrent = this.torrents.find(torrent => torrent.infoHash === data.data)
          if (torrent?.torboxId) {
            try { await this.api.controlTorrent(torrent.torboxId, 'reannounce') } catch { /* ignore */ }
            this.dispatch('info', `Reannounce requested for ${torrent.name}`)
          }
          break
        }
        case 'networking': {
          this.networking = data.data
          break
        }
        case 'debug': {
          Debug.disable()
          if (data.data) Debug.enable(data.data)
          break
        }
      }
    } catch (err) {
      this.dispatchError(errorToString(err))
    }
  }

  /** @param {{current: {infoHash: string, path: string}, external?: boolean}} payload */
  async handleCurrent (payload) {
    if (!payload?.current) return
    const torrent = this.torrents.find(torrent => torrent.infoHash === payload.current.infoHash)
    if (!torrent) return
    const found = torrent.files.find(file => file.path === payload.current.path || file.name === payload.current.name)
    if (!found) return
    if (this.playerProcess) { this.playerProcess.kill(); this.playerProcess = null }
    this.currentFile = found

    if (this.torrents.find(torrent => torrent.current && torrent.infoHash !== payload.current.infoHash)) await this.demoteCurrent()
    torrent.current = true
    torrent.staging = false
    torrent.seeding = false
    this.bumpTorrent(torrent)

    if (!(payload.external && (SUPPORTS.isAndroid || this.player))) {
      await this.loadMetadata(torrent, found)
    } else {
      this.dispatch('externalReady')
    }
  }

  /** @param {{current: {infoHash: string, path: string}}} payload */
  handleExternalPlay (payload) {
    const torrent = this.torrents.find(torrent => torrent.current) || this.torrents.find(torrent => torrent.infoHash === payload?.current?.infoHash)
    const found = torrent?.files?.find(file => file.path === payload?.current?.path || file.name === payload?.current?.name)
    if (!found) return
    const startTime = Date.now()
    this.ipc.removeAllListeners?.('external-close')
    if (this.playerProcess) {
      this.playerProcess.removeAllListeners('close')
      this.playerProcess.kill()
      this.playerProcess = null
    }
    if (this.player) {
      this.playerProcess = spawn(this.player, ['' + found.url])
      this.playerProcess.stdout?.on('data', () => {})
      this.playerProcess.once('close', () => {
        if (this.destroyed) return
        this.playerProcess = null
        this.dispatch('externalWatched', (Date.now() - startTime) / 1000)
      })
    } else if (SUPPORTS.isAndroid) {
      const scheme = found.url.startsWith('http://') ? 'http' : 'https'
      this.dispatch('androidExternal', `intent://${found.url.replace(/^https?:\/\//, '')}#Intent;type=video/any;scheme=${scheme};end;`)
    }
  }

  /**
   * Stops tracking a torrent locally, recording it as completed (retained on TorBox).
   * @param {string} infoHash
   */
  async completeTorrent (infoHash) {
    const torrent = this.torrents.find(torrent => torrent.infoHash === infoHash)
    const record = torrent ? this.toRecord(torrent) : await this.cacheGet(infoHash)
    if (record) {
      const stats = { infoHash: record.infoHash, name: record.name, size: record.length, progress: record.progress ?? 1, magnetURI: record.magnetURI, date: new Date(Date.now() - 1_000).toUTCString(), incomplete: (record.progress ?? 1) < 1 }
      this.completed = Array.from(new Map([...this.completed, stats].map(item => [item.infoHash, item])).values())
      this.dispatch('completed', stats)
    }
    if (torrent) this.torrents = this.torrents.filter(item => item !== torrent)
  }

  /** @param {any} payload */
  async handleUnload (payload) {
    if (!payload) {
      const current = this.torrents.find(torrent => torrent.current)
      if (!current) return
      this.currentFile = null
      this.metadata?.destroy?.()
      this.metadata = null
      current.current = false
      if (current.progress >= 1) { current.seeding = true; this.dispatch('seeding', current.infoHash) } else { current.staging = true; this.dispatch('staging', current.infoHash) }
      this.dispatch('loaded', {})
      return
    }
    const infoHash = payload.infoHash || payload.hash || (typeof payload === 'string' ? payload : payload.torrent)
    const record = this.torrents.find(torrent => torrent.infoHash === infoHash) || await this.cacheGet(infoHash)
    if (record) {
      const stats = { infoHash: record.infoHash, name: record.name, size: record.length || record.size, progress: record.progress ?? 1, magnetURI: record.magnetURI, date: new Date(Date.now() - 1_000).toUTCString(), incomplete: (record.progress ?? 1) < 1 }
      this.completed = Array.from(new Map([...this.completed, stats].map(item => [item.infoHash, item])).values())
      this.dispatch('completed', stats)
    }
  }

  /**
   * Permanently removes a torrent from TorBox and the local cache.
   * @param {string} infoHash
   */
  async untrack (infoHash) {
    const torrent = this.torrents.find(torrent => torrent.infoHash === infoHash)
    if (torrent?.torboxId) {
      try { await this.api.controlTorrent(torrent.torboxId, 'delete') } catch (err) { debug(`Delete failed: ${errorToString(err)}`) }
      if (torrent.current) this.dispatch('loaded', {})
    }
    this.torrents = this.torrents.filter(item => item.infoHash !== infoHash)
    this.completed = this.completed.filter(item => item.infoHash !== infoHash)
    await this.cacheDelete(infoHash)
    this.dispatch('untrack', infoHash)
  }

  /** Reconciles the local cache with the TorBox account. */
  async rescan () {
    this.dispatch('info', 'Rescanning TorBox library, this will take a moment...')
    let found = 0
    try {
      const list = await this.api.list()
      const tracked = new Set([...this.torrents.map(torrent => torrent.infoHash), ...this.completed.map(torrent => torrent.infoHash)])
      for (const item of list) {
        const infoHash = (item.hash || '').toLowerCase()
        if (!infoHash || tracked.has(infoHash)) continue
        const stats = { infoHash, name: item.name, size: item.size, progress: item.download_finished ? 1 : (item.progress || 0), magnetURI: `magnet:?xt=urn:btih:${infoHash}`, date: new Date(Date.now() - 1_000).toUTCString(), incomplete: !item.download_finished }
        this.completed = Array.from(new Map([...this.completed, stats].map(entry => [entry.infoHash, entry])).values())
        await this.cacheSet({ infoHash, torboxId: item.id, name: item.name, length: item.size, magnetURI: stats.magnetURI, progress: stats.progress })
        this.dispatch('completed', stats)
        found++
      }
    } catch (err) {
      this.dispatchError(errorToString(err))
    }
    this.dispatch('rescan_done')
    this.dispatch('info', `Rescan complete: ${found} torrents found on TorBox.`)
  }

  /**
   * Reports instant-availability as pseudo seeder counts for the UI.
   * @param {{id: string, infoHashes: string[]}} opts
   */
  async scrape ({ id, infoHashes }) {
    const result = []
    try {
      const cached = await this.api.checkCached(infoHashes)
      for (const hash of infoHashes) {
        const entry = cached[hash] || cached[hash?.toLowerCase()]
        result.push({ hash, complete: entry ? (entry.seeds || 1) : 0, incomplete: entry ? (entry.peers || 0) : 0, downloaded: entry ? 1 : 0 })
      }
    } catch (err) {
      debug(`Scrape failed: ${errorToString(err)}`)
    }
    this.dispatch('scrape_done', { id, result })
  }

  /**
   * Moves the specified torrent to the front of the list (most-recent ordering).
   * @param {object} torrent
   */
  bumpTorrent (torrent) {
    const index = this.torrents.indexOf(torrent)
    if (index > -1) this.torrents.splice(index, 1)
    this.torrents.unshift(torrent)
  }

  /**
   * Dispatches an event to the renderer once the IPC channel is ready.
   * @param {string} type
   * @param {any} data
   * @param {Transferable[]} [transfer]
   */
  async dispatch (type, data, transfer) {
    await this._ready
    this.message?.({ type, data }, transfer)
  }

  /**
   * Normalizes and filters an error before dispatching it.
   * @param {Error|string} e
   */
  dispatchError (e) {
    const error = errorToString(e)
    console.error('TorBox error: ' + error)
    this.dispatch('error', error)
  }

  /** Gracefully shuts down the client. */
  destroy () {
    debug('Destroying TorBox TorrentClient')
    if (this.destroyed) {
      this.ipc?.send('destroyed')
      this.ipc?.emit?.('destroyed')
      return
    }
    this.destroyed = true
    this.intervals.forEach(clearInterval)
    this.timeouts.forEach(clearTimeout)
    if (this.playerProcess) {
      this.playerProcess.removeAllListeners()
      this.playerProcess.kill()
      this.playerProcess = null
    }
    this.metadata?.destroy?.()
    this.ipc?.send('destroyed')
    this.ipc?.emit?.('destroyed')
  }
}
