import { errorToString } from '@client/lib/util.js'
import Debug from 'debug'
const debug = Debug('torrent:torbox-api')

/**
 * Thin wrapper around the TorBox REST API used by the TorBox torrent backend.
 *
 * Only the handful of endpoints the client actually needs are implemented:
 * adding torrents, listing torrent/file metadata, minting direct download
 * (stream) links, checking instant cache availability and basic torrent control.
 *
 * @see https://api-docs.torbox.app/
 */
export default class TorBoxAPI {
  /** @type {string} */
  base = 'https://api.torbox.app'
  /** @type {string} */
  version = 'v1'

  /**
   * @param {string} apiKey - TorBox API token (found in the TorBox account settings).
   */
  constructor (apiKey) {
    this.apiKey = (apiKey || '').trim()
  }

  /**
   * @returns {boolean} Whether an API key has been configured.
   */
  get configured () {
    return !!this.apiKey
  }

  /**
   * Builds a fully qualified API URL.
   * @param {string} path - Path relative to the API version root (e.g. `torrents/mylist`).
   * @param {Record<string, string|number|boolean|undefined>} [query] - Optional query params.
   * @returns {string}
   */
  url (path, query) {
    const url = new URL(`${this.base}/${this.version}/api/${path}`)
    if (query) for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  /**
   * Performs an authenticated request and unwraps the standard TorBox envelope.
   * @param {string} path
   * @param {RequestInit & { query?: Record<string, any> }} [opts]
   * @returns {Promise<any>} The `data` field of the response envelope.
   */
  async request (path, { query, headers, ...opts } = {}) {
    if (!this.configured) throw new Error('No TorBox API key configured. Add one in Torrent settings.')
    const res = await fetch(this.url(path, query), {
      ...opts,
      headers: { Authorization: `Bearer ${this.apiKey}`, ...headers }
    })
    let body
    try {
      body = await res.json()
    } catch {
      body = null
    }
    if (!res.ok || (body && body.success === false)) {
      const detail = body?.detail || body?.error || `HTTP ${res.status}`
      throw new Error(`TorBox: ${detail}`)
    }
    return body?.data
  }

  /**
   * Adds a torrent to TorBox via magnet link or raw `.torrent` file.
   * @param {object} opts
   * @param {string} [opts.magnet] - Magnet URI.
   * @param {Uint8Array|Buffer} [opts.file] - Raw `.torrent` file bytes.
   * @param {string} [opts.name] - Optional custom name for the torrent file upload.
   * @param {boolean} [opts.queued=false] - Add as queued instead of starting immediately.
   * @param {number} [opts.seed=1] - Seed preference (1 auto, 2 always, 3 never).
   * @returns {Promise<{torrent_id: number, hash: string, queued_id?: number}>}
   */
  async createTorrent ({ magnet, file, name, queued = false, seed = 1 }) {
    const form = new FormData()
    if (magnet) form.set('magnet', magnet)
    if (file) form.set('file', new Blob([file], { type: 'application/x-bittorrent' }), name || 'torrent.torrent')
    form.set('seed', String(seed))
    form.set('allow_zip', 'false')
    if (queued) form.set('as_queued', 'true')
    debug(`Creating torrent ${magnet ? magnet.slice(0, 60) : '(file upload)'} queued=${queued}`)
    return this.request('torrents/createtorrent', { method: 'POST', body: form })
  }

  /**
   * Fetches metadata for a single torrent by its TorBox id.
   * @param {number|string} id - TorBox torrent id.
   * @param {boolean} [bypassCache=true] - Skip TorBox's internal list cache for fresh progress.
   * @returns {Promise<any|null>} Torrent record (includes `files`) or null if missing.
   */
  async getTorrent (id, bypassCache = true) {
    try {
      return await this.request('torrents/mylist', { query: { id, bypass_cache: bypassCache } })
    } catch (err) {
      debug(`getTorrent(${id}) failed: ${errorToString(err)}`)
      return null
    }
  }

  /**
   * Lists all torrents currently held in the user's TorBox account.
   * @returns {Promise<any[]>}
   */
  async list () {
    const data = await this.request('torrents/mylist', { query: { bypass_cache: true } })
    return Array.isArray(data) ? data : (data ? [data] : [])
  }

  /**
   * Requests a direct, range-capable CDN download link for a specific file.
   * The returned link is valid for several hours and is what the player streams from.
   * @param {number|string} torrentId - TorBox torrent id.
   * @param {number|string} fileId - File id within the torrent.
   * @param {string} [userIp] - Optional client IP for geo-routing.
   * @returns {Promise<string>} Direct download URL.
   */
  async requestDownloadLink (torrentId, fileId, userIp) {
    const data = await this.request('torrents/requestdl', {
      query: { token: this.apiKey, torrent_id: torrentId, file_id: fileId, user_ip: userIp }
    })
    // The endpoint returns either a bare URL string or an object containing one.
    return typeof data === 'string' ? data : (data?.url || data?.link || data)
  }

  /**
   * Checks whether one or more info hashes are instantly cached on TorBox.
   * @param {string[]} hashes - Lowercase hex info hashes.
   * @returns {Promise<Record<string, any>>} Map keyed by info hash for cached entries.
   */
  async checkCached (hashes) {
    if (!hashes?.length) return {}
    try {
      const data = await this.request('torrents/checkcached', { query: { hash: hashes.join(','), format: 'object', list_files: false } })
      return data || {}
    } catch (err) {
      debug(`checkCached failed: ${errorToString(err)}`)
      return {}
    }
  }

  /**
   * Issues a control operation against a torrent (delete, pause, resume, reannounce).
   * @param {number|string} torrentId - TorBox torrent id.
   * @param {'delete'|'pause'|'resume'|'reannounce'} operation
   * @returns {Promise<any>}
   */
  async controlTorrent (torrentId, operation) {
    return this.request('torrents/controltorrent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ torrent_id: torrentId, operation })
    })
  }
}
