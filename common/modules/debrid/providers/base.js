import { TORRENT } from '@/modules/bridge.js'

/** @typedef {import('./types.d.ts').DebridProviderMeta} DebridProviderMeta */
/** @typedef {import('./types.d.ts').DebridAccountInfo} DebridAccountInfo */
/** @typedef {import('./types.d.ts').DebridCacheEntry} DebridCacheEntry */
/** @typedef {import('./types.d.ts').DebridResolvedTorrent} DebridResolvedTorrent */
/** @typedef {import('./types.d.ts').DebridRequestOptions} DebridRequestOptions */
/** @typedef {import('./types.d.ts').DebridResponse} DebridResponse */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export class DebridError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, providerId?: string, retryable?: boolean }} [opts]
   */
  constructor(message, opts = {}) {
    super(message)
    this.name = 'DebridError'
    this.code = opts.code || 'DEBRID_ERROR'
    this.status = opts.status || 0
    this.providerId = opts.providerId || ''
    this.retryable = Boolean(opts.retryable)
  }
}

/**
 * Decodes a 32-character Base32 info-hash to lowercase 40-character hex.
 * Returns null if input is invalid Base32.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function base32ToHex(input) {
  const clean = String(input || '').trim().toUpperCase().replace(/=+$/, '')
  if (clean.length !== 32) return null
  let bits = 0
  let value = 0
  let hex = ''
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i])
    if (idx === -1) return null
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      hex += ((value >>> (bits - 8)) & 0xff).toString(16).padStart(2, '0')
      bits -= 8
    }
  }
  return hex.length === 40 ? hex : null
}

/**
 * Extracts and normalizes a BitTorrent v1 info-hash (lowercase 40-char hex)
 * from a raw hash or magnet URI.
 *
 * @param {string} value
 * @returns {string | null}
 */
export function normalizeInfoHash(value) {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  if (/^[a-fA-F0-9]{40}$/.test(trimmed)) return trimmed.toLowerCase()
  if (/^[A-Za-z2-7]{32}$/.test(trimmed)) return base32ToHex(trimmed)

  const match = trimmed.match(/xt=urn:btih:([a-zA-Z0-9]+)/i)
  if (!match) return null
  const extracted = match[1]
  if (/^[a-fA-F0-9]{40}$/.test(extracted)) return extracted.toLowerCase()
  if (/^[A-Za-z2-7]{32}$/.test(extracted)) return base32ToHex(extracted)
  return null
}

/**
 * Builds a minimal magnet URI from a normalized info-hash and optional display name.
 *
 * @param {string} infoHash
 * @param {string} [name]
 * @returns {string}
 */
export function buildMagnetUri(infoHash, name) {
  const hash = normalizeInfoHash(infoHash) || infoHash
  return `magnet:?xt=urn:btih:${hash}${name ? `&dn=${encodeURIComponent(name)}` : ''}`
}

/**
 * Base contract that every Debrid provider implementation must extend.
 * Keeping HTTP, normalization, and error semantics uniform makes adding new providers trivial.
 */
export class DebridProvider {
  /** @type {DebridProviderMeta} */
  static meta = {
    id: 'base',
    name: 'Base Debrid',
    shortName: 'Debrid',
    description: '',
    website: '',
    capabilities: {
      cacheCheck: false,
      userLibrary: false,
      supportsTorrentFile: false,
      supportsMagnet: true,
      supportsUncached: false
    },
    settingsSchema: []
  }

  /** @returns {DebridProviderMeta} */
  get meta() {
    return /** @type {typeof DebridProvider} */ (this.constructor).meta
  }

  /** @returns {string} */
  get id() {
    return this.meta.id
  }

  /** @returns {string} */
  get name() {
    return this.meta.name
  }

  /**
   * Builds a default configuration object from the provider's settingsSchema.
   *
   * @returns {Record<string, any>}
   */
  getDefaultConfig() {
    const config = { apiKey: '' }
    for (const field of this.meta.settingsSchema || []) {
      if (field.defaultValue !== undefined) config[field.key] = field.defaultValue
    }
    return config
  }

  /**
   * Executes an HTTP request through the CORS-free Node client bridge when available,
   * falling back to standard fetch if the bridge is unavailable.
   *
   * @param {string} url
   * @param {Omit<DebridRequestOptions, 'url'>} [options]
   * @returns {Promise<DebridResponse>}
   */
  async request(url, options = {}) {
    const { signal, timeout = 25_000, ...rest } = options
    if (signal?.aborted) throw new DebridError('Request aborted', { code: 'ABORTED', providerId: this.id })

    if (typeof TORRENT?.debridRequest === 'function') {
      const requestPromise = TORRENT.debridRequest({ url, timeout, ...rest })
      if (!signal) return requestPromise
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DebridError('Request aborted', { code: 'ABORTED', providerId: this.id }))
        signal.addEventListener('abort', onAbort, { once: true })
        requestPromise.then(
          res => {
            signal.removeEventListener('abort', onAbort)
            resolve(res)
          },
          err => {
            signal.removeEventListener('abort', onAbort)
            reject(err)
          }
        )
      })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const forwardAbort = () => controller.abort()
    signal?.addEventListener('abort', forwardAbort, { once: true })
    try {
      let body = rest.body
      const headers = { ...(rest.headers || {}) }
      if (body && typeof body === 'object' && Array.isArray(body.__formData)) {
        const form = new FormData()
        for (const entry of body.__formData) {
          if (entry.encoding === 'base64' && typeof entry.value === 'string') {
            const binary = atob(entry.value)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            form.append(entry.name, new Blob([bytes], { type: entry.contentType || 'application/octet-stream' }), entry.filename || 'file.torrent')
          } else if (entry.value instanceof Uint8Array) {
            const bytes = new Uint8Array(entry.value)
            form.append(entry.name, new Blob([bytes], { type: entry.contentType || 'application/octet-stream' }), entry.filename || 'file.torrent')
          } else {
            form.append(entry.name, String(entry.value ?? ''))
          }
        }
        body = /** @type {any} */ (form)
        delete headers['Content-Type']
        delete headers['content-type']
      }
      const res = await fetch(url, {
        method: rest.method || 'GET',
        headers,
        body: /** @type {any} */ (body),
        signal: controller.signal
      })
      const responseType = rest.responseType || 'json'
      let data
      if (responseType === 'arrayBuffer') data = await res.arrayBuffer()
      else if (responseType === 'text') data = await res.text()
      else {
        const text = await res.text()
        try { data = text ? JSON.parse(text) : null } catch { data = text }
      }
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        data
      }
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        throw new DebridError('Request aborted or timed out', { code: signal?.aborted ? 'ABORTED' : 'TIMEOUT', providerId: this.id, retryable: !signal?.aborted })
      }
      throw new DebridError(err?.message || 'Network request failed', { code: 'NETWORK_ERROR', providerId: this.id, retryable: true })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }

  /**
   * Validates credentials and returns normalized account details.
   *
   * @param {Record<string, any>} _config
   * @returns {Promise<DebridAccountInfo>}
   */
  async verifyCredentials(_config) {
    throw new DebridError(`verifyCredentials not implemented for ${this.name}`, { code: 'NOT_IMPLEMENTED', providerId: this.id })
  }

  /**
   * Checks cached availability for a batch of info-hashes.
   *
   * @param {string[]} _hashes
   * @param {Record<string, any>} _config
   * @returns {Promise<Record<string, DebridCacheEntry>>}
   */
  async checkCached(_hashes, _config) {
    return {}
  }

  /**
   * Resolves a torrent (by hash, magnet URI, or .torrent bytes) into playable files on the provider.
   *
   * @param {{
   *   infoHash?: string | null,
   *   magnet?: string | null,
   *   name?: string,
   *   torrentBytes?: Uint8Array | null,
   *   allowUncached?: boolean,
   *   onProgress?: (info: { status: string, progress: number, name?: string }) => void,
   *   signal?: AbortSignal
   * }} _input
   * @param {Record<string, any>} _config
   * @returns {Promise<DebridResolvedTorrent>}
   */
  async resolveTorrent(_input, _config) {
    throw new DebridError(`resolveTorrent not implemented for ${this.name}`, { code: 'NOT_IMPLEMENTED', providerId: this.id })
  }

  /**
   * Resolves a direct streamable URL for a specific file inside a resolved torrent.
   *
   * @param {{ torrentId: string | number, fileId: string | number, infoHash?: string, signal?: AbortSignal }} _fileRef
   * @param {Record<string, any>} _config
   * @returns {Promise<{ url: string, headers?: Record<string, string> }>}
   */
  async getFileStreamUrl(_fileRef, _config) {
    throw new DebridError(`getFileStreamUrl not implemented for ${this.name}`, { code: 'NOT_IMPLEMENTED', providerId: this.id })
  }

  /**
   * Optional: removes a torrent from the user's cloud library.
   *
   * @param {string | number} _torrentId
   * @param {Record<string, any>} _config
   * @returns {Promise<void>}
   */
  async removeTorrent(_torrentId, _config) {}
}
