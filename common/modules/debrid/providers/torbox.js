import { DebridError, DebridProvider, buildMagnetUri, normalizeInfoHash } from './base.js'

/** @typedef {import('../types.d.ts').DebridProviderMeta} DebridProviderMeta */
/** @typedef {import('../types.d.ts').DebridAccountInfo} DebridAccountInfo */
/** @typedef {import('../types.d.ts').DebridCacheEntry} DebridCacheEntry */
/** @typedef {import('../types.d.ts').DebridResolvedTorrent} DebridResolvedTorrent */

const API_BASE = 'https://api.torbox.app/v1/api'
const CHECK_BATCH_SIZE = 50
const POLL_INTERVAL_MS = 3_000
const MAX_POLL_WAIT_MS = 10 * 60_000

const PLAN_NAMES = {
  0: 'Free',
  1: 'Essential',
  2: 'Pro',
  3: 'Standard'
}

const READY_STATES = new Set(['completed', 'cached', 'seeding', 'uploading'])
const FAILED_STATES = new Set(['error', 'failed', 'stalled (no seeds)', 'reported'])

/**
 * Checks whether a TorBox torrent entry is ready to stream.
 *
 * @param {Record<string, any> | null | undefined} item
 * @returns {boolean}
 */
function isTorrentReady(item) {
  if (!item) return false
  if (item.download_present || item.download_finished) return true
  const state = String(item.download_state || '').toLowerCase()
  return READY_STATES.has(state) || Number(item.progress) >= 1
}

/**
 * Normalizes TorBox progress (typically 0..1 float, occasionally 0..100) into 0..100 percentage.
 *
 * @param {Record<string, any> | null | undefined} item
 * @returns {number}
 */
function normalizeProgress(item) {
  if (!item) return 0
  if (isTorrentReady(item)) return 100
  const raw = Number(item.progress) || 0
  if (raw <= 1) return Math.max(0, Math.min(100, Math.round(raw * 100)))
  return Math.max(0, Math.min(100, Math.round(raw)))
}

/**
 * Normalizes file metadata entries from TorBox `mylist` / `checkcached`.
 *
 * @param {Record<string, any>} torrent
 * @returns {import('../types.d.ts').DebridResolvedFile[]}
 */
function mapTorrentFiles(torrent) {
  const files = Array.isArray(torrent?.files) ? torrent.files : []
  return files.map((file, idx) => {
    const rawPath = String(file.name || file.short_name || `file_${idx}`).replace(/^\/+/, '')
    const shortName = file.short_name || rawPath.split('/').pop() || rawPath
    return {
      id: file.id ?? idx,
      name: shortName,
      path: rawPath,
      length: Number(file.size) || 0
    }
  })
}

/**
 * Sleeps for the specified duration while respecting an optional AbortSignal.
 *
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DebridError('Aborted while waiting for TorBox', { code: 'ABORTED', providerId: 'torbox' }))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DebridError('Aborted while waiting for TorBox', { code: 'ABORTED', providerId: 'torbox' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class TorBoxProvider extends DebridProvider {
  /** @type {DebridProviderMeta} */
  static meta = {
    id: 'torbox',
    name: 'TorBox',
    shortName: 'TB',
    description: 'High-speed debrid & usenet caching with instant streaming and seeding control.',
    website: 'https://torbox.app',
    apiKeyUrl: 'https://torbox.app/settings',
    accentColor: '#2bb690',
    capabilities: {
      cacheCheck: true,
      userLibrary: true,
      supportsTorrentFile: true,
      supportsMagnet: true,
      supportsUncached: true
    },
    settingsSchema: [
      {
        key: 'seedPreference',
        label: 'Seeding Preference',
        description: 'Control whether TorBox seeds added torrents back to the swarm.',
        type: 'select',
        defaultValue: 1,
        options: [
          { value: 1, label: 'Auto (Recommended)' },
          { value: 2, label: 'Seed' },
          { value: 3, label: 'Do Not Seed' }
        ]
      }
    ]
  }

  /**
   * Performs an authenticated request against the TorBox v1 API.
   *
   * @param {string} endpoint
   * @param {Record<string, any>} config
   * @param {Omit<import('../types.d.ts').DebridRequestOptions, 'url'>} [options]
   * @returns {Promise<any>}
   */
  async api(endpoint, config, options = {}) {
    const apiKey = config?.apiKey?.trim()
    if (!apiKey) {
      throw new DebridError('TorBox API key is not configured.', { code: 'MISSING_API_KEY', providerId: this.id })
    }
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {})
    }
    const response = await this.request(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      responseType: 'json'
    })
    const payload = response.data
    if (!response.ok || (payload && typeof payload === 'object' && payload.success === false)) {
      const errorCode = payload?.error || `HTTP_${response.status}`
      const message = payload?.detail || payload?.message || response.statusText || 'TorBox API request failed'
      const normalizedCode = response.status === 401 || response.status === 403 || errorCode === 'AUTH_ERROR' || errorCode === 'BAD_TOKEN'
        ? 'INVALID_API_KEY'
        : response.status === 429 || errorCode === 'RATE_LIMIT'
          ? 'RATE_LIMIT'
          : /not cached|no_cached|uncached/i.test(`${errorCode} ${message}`)
            ? 'NOT_CACHED'
            : String(errorCode)
      throw new DebridError(message, {
        code: normalizedCode,
        status: response.status,
        providerId: this.id,
        retryable: response.status >= 500 || response.status === 429
      })
    }
    return payload?.data ?? payload
  }

  /**
   * @param {Record<string, any>} config
   * @returns {Promise<DebridAccountInfo>}
   */
  async verifyCredentials(config) {
    const data = await this.api('/user/me?settings=false', config)
    const planNum = Number(data?.plan ?? 0)
    const planName = PLAN_NAMES[planNum] || `Plan ${planNum}`
    return {
      authenticated: true,
      email: data?.email || undefined,
      username: data?.email ? data.email.split('@')[0] : undefined,
      plan: planName,
      isSubscribed: Boolean(data?.is_subscribed || planNum > 0),
      expiresAt: data?.premium_expires_at || null,
      totalDownloaded: Number(data?.total_bytes_downloaded) || 0,
      raw: data
    }
  }

  /**
   * @param {string[]} hashes
   * @param {Record<string, any>} config
   * @returns {Promise<Record<string, DebridCacheEntry>>}
   */
  async checkCached(hashes, config) {
    const normalized = [...new Set(hashes.map(h => normalizeInfoHash(h)).filter(Boolean))]
    /** @type {Record<string, DebridCacheEntry>} */
    const results = {}
    for (const hash of normalized) {
      results[hash] = { hash, cached: false, providerId: this.id, providerName: this.name }
    }
    if (!normalized.length || !config?.apiKey?.trim()) return results

    for (let i = 0; i < normalized.length; i += CHECK_BATCH_SIZE) {
      const chunk = normalized.slice(i, i + CHECK_BATCH_SIZE)
      const params = new URLSearchParams({
        hash: chunk.join(','),
        format: 'object',
        list_files: 'true'
      })
      const data = await this.api(`/torrents/checkcached?${params.toString()}`, config)
      if (!data) continue
      if (Array.isArray(data)) {
        for (const item of data) {
          const h = normalizeInfoHash(item?.hash)
          if (h && item?.cached !== false) {
            results[h] = {
              hash: h,
              cached: true,
              providerId: this.id,
              providerName: this.name,
              name: item.name,
              size: Number(item.size) || 0,
              files: Array.isArray(item.files) ? item.files : []
            }
          }
        }
      } else if (typeof data === 'object') {
        for (const [key, item] of Object.entries(data)) {
          if (!item || item.cached === false) continue
          const h = normalizeInfoHash(item.hash || key)
          if (h) {
            results[h] = {
              hash: h,
              cached: true,
              providerId: this.id,
              providerName: this.name,
              name: item.name,
              size: Number(item.size) || 0,
              files: Array.isArray(item.files) ? item.files : []
            }
          }
        }
      }
    }
    return results
  }

  /**
   * Finds an existing torrent in the user's TorBox list by info-hash or torrent ID.
   *
   * @param {{ torrentId?: number | string | null, infoHash?: string | null, bypassCache?: boolean }} query
   * @param {Record<string, any>} config
   * @param {AbortSignal} [signal]
   * @returns {Promise<Record<string, any> | null>}
   */
  async findInList({ torrentId = null, infoHash = null, bypassCache = true }, config, signal) {
    const params = new URLSearchParams()
    if (torrentId != null) params.set('id', String(torrentId))
    if (bypassCache) params.set('bypass_cache', 'true')
    const data = await this.api(`/torrents/mylist?${params.toString()}`, config, { signal })
    if (!data) return null
    if (!Array.isArray(data)) {
      if (torrentId != null && String(data.id) === String(torrentId)) return data
      if (infoHash && normalizeInfoHash(data.hash) === infoHash) return data
      return data.id != null ? data : null
    }
    if (torrentId != null) {
      const byId = data.find(item => String(item.id) === String(torrentId))
      if (byId) return byId
    }
    if (infoHash) {
      const target = normalizeInfoHash(infoHash)
      return data.find(item => normalizeInfoHash(item.hash) === target) || null
    }
    return null
  }

  /**
   * @param {{
   *   infoHash?: string | null,
   *   magnet?: string | null,
   *   name?: string,
   *   torrentBytes?: Uint8Array | null,
   *   allowUncached?: boolean,
   *   onProgress?: (info: { status: string, progress: number, name?: string }) => void,
   *   signal?: AbortSignal
   * }} input
   * @param {Record<string, any>} config
   * @returns {Promise<DebridResolvedTorrent>}
   */
  async resolveTorrent(input, config) {
    const { magnet, name, torrentBytes, allowUncached = false, onProgress, signal } = input
    const normalizedHash = normalizeInfoHash(input.infoHash || magnet)
    let torrent = normalizedHash ? await this.findInList({ infoHash: normalizedHash, bypassCache: true }, config, signal) : null
    let wasCached = Boolean(torrent && isTorrentReady(torrent))

    if (!torrent) {
      /** @type {import('../types.d.ts').DebridRequestFormEntry[]} */
      const formEntries = [
        { name: 'seed', value: String(config?.seedPreference ?? 1) },
        { name: 'allow_zip', value: 'false' },
        { name: 'add_only_if_cached', value: allowUncached ? 'false' : 'true' }
      ]
      if (torrentBytes instanceof Uint8Array && torrentBytes.byteLength > 0) {
        let binary = ''
        for (let i = 0; i < torrentBytes.length; i++) binary += String.fromCharCode(torrentBytes[i])
        formEntries.push({
          name: 'file',
          value: btoa(binary),
          encoding: 'base64',
          filename: `${(name || normalizedHash || 'torrent').replace(/[^\w.-]+/g, '_')}.torrent`,
          contentType: 'application/x-bittorrent'
        })
      } else {
        const magnetUri = magnet && magnet.startsWith('magnet:')
          ? magnet
          : normalizedHash
            ? buildMagnetUri(normalizedHash, name)
            : ''
        if (!magnetUri) {
          throw new DebridError('Missing magnet URI, info-hash, or .torrent payload for TorBox.', {
            code: 'INVALID_TORRENT',
            providerId: this.id
          })
        }
        formEntries.push({ name: 'magnet', value: magnetUri })
      }
      if (name) formEntries.push({ name: 'name', value: name })

      const created = await this.api('/torrents/createtorrent', config, {
        method: 'POST',
        body: { __formData: formEntries },
        signal
      })
      const createdId = created?.torrent_id ?? created?.id
      const createdHash = normalizeInfoHash(created?.hash) || normalizedHash
      torrent = await this.findInList({ torrentId: createdId, infoHash: createdHash, bypassCache: true }, config, signal)
      if (!torrent && createdId != null) {
        await sleep(1_000, signal)
        torrent = await this.findInList({ torrentId: createdId, infoHash: createdHash, bypassCache: true }, config, signal)
      }
      if (!torrent) {
        throw new DebridError('Torrent was added to TorBox but did not appear in list.', {
          code: 'TORRENT_NOT_FOUND',
          providerId: this.id
        })
      }
      wasCached = isTorrentReady(torrent)
    }

    if (!isTorrentReady(torrent)) {
      if (!allowUncached) {
        throw new DebridError('Torrent is not cached on TorBox.', {
          code: 'NOT_CACHED',
          providerId: this.id
        })
      }
      const startedAt = Date.now()
      while (!isTorrentReady(torrent)) {
        const state = String(torrent.download_state || '').toLowerCase()
        if (FAILED_STATES.has(state)) {
          throw new DebridError(`TorBox download failed (${torrent.download_state || 'error'}).`, {
            code: 'DOWNLOAD_FAILED',
            providerId: this.id
          })
        }
        onProgress?.({
          status: torrent.download_state || 'downloading',
          progress: normalizeProgress(torrent),
          name: torrent.name || name
        })
        if (Date.now() - startedAt > MAX_POLL_WAIT_MS) {
          throw new DebridError('Timed out waiting for TorBox to finish downloading the torrent.', {
            code: 'TIMEOUT',
            providerId: this.id
          })
        }
        await sleep(POLL_INTERVAL_MS, signal)
        const updated = await this.findInList({ torrentId: torrent.id, infoHash: normalizeInfoHash(torrent.hash) || normalizedHash, bypassCache: true }, config, signal)
        if (updated) torrent = updated
      }
    }

    const files = mapTorrentFiles(torrent)
    if (!files.length) {
      throw new DebridError('TorBox torrent contains no streamable files.', {
        code: 'NO_FILES',
        providerId: this.id
      })
    }

    const resolvedHash = normalizeInfoHash(torrent.hash) || normalizedHash || `tb-${torrent.id}`
    return {
      providerId: this.id,
      providerName: this.name,
      torrentId: torrent.id,
      infoHash: resolvedHash,
      name: torrent.name || name || resolvedHash,
      cached: wasCached,
      status: 'ready',
      progress: 100,
      files
    }
  }

  /**
   * Requests a temporary CDN download link for a specific file in a TorBox torrent.
   *
   * @param {{ torrentId: string | number, fileId: string | number, signal?: AbortSignal }} fileRef
   * @param {Record<string, any>} config
   * @returns {Promise<{ url: string }>}
   */
  async getFileStreamUrl({ torrentId, fileId, signal }, config) {
    const apiKey = config?.apiKey?.trim()
    if (!apiKey) {
      throw new DebridError('TorBox API key is not configured.', { code: 'MISSING_API_KEY', providerId: this.id })
    }
    const params = new URLSearchParams({
      token: apiKey,
      torrent_id: String(torrentId),
      file_id: String(fileId ?? 0)
    })
    const url = await this.api(`/torrents/requestdl?${params.toString()}`, config, { signal })
    if (!url || typeof url !== 'string') {
      throw new DebridError('TorBox did not return a valid stream URL.', {
        code: 'NO_STREAM_URL',
        providerId: this.id
      })
    }
    return { url }
  }

  /**
   * @param {string | number} torrentId
   * @param {Record<string, any>} config
   * @returns {Promise<void>}
   */
  async removeTorrent(torrentId, config) {
    await this.api('/torrents/controltorrent', config, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ torrent_id: torrentId, operation: 'delete' })
    })
  }
}
