import { writable } from 'simple-store-svelte'
import { settings } from '@/modules/settings.js'
import { TORRENT } from '@/modules/bridge.js'
import { DebridError, buildMagnetUri, normalizeInfoHash } from './providers/base.js'
import { TorBoxProvider } from './providers/torbox.js'
import Debug from 'debug'

const debug = Debug('ui:debrid')

/** @typedef {import('./types.d.ts').DebridProviderMeta} DebridProviderMeta */
/** @typedef {import('./types.d.ts').DebridAccountInfo} DebridAccountInfo */
/** @typedef {import('./types.d.ts').DebridCacheEntry} DebridCacheEntry */
/** @typedef {import('./types.d.ts').DebridResolvedTorrent} DebridResolvedTorrent */
/** @typedef {import('./types.d.ts').DebridMode} DebridMode */

const CACHE_TTL_MS = 5 * 60_000
const STREAM_URL_TTL_MS = 2.5 * 60 * 60_000

/**
 * Decodes a base64 string into a Uint8Array.
 *
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64ToBytes(base64) {
  const clean = base64.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export class DebridManager {
  /** @type {Map<string, import('./providers/base.js').DebridProvider>} */
  #providers = new Map()
  /** @type {Map<string, { entry: DebridCacheEntry, timestamp: number }>} */
  #cacheEntries = new Map()
  /** @type {Map<string, Promise<Record<string, DebridCacheEntry>>>} */
  #inflightCache = new Map()
  /** @type {Map<string, { url: string, headers?: Record<string, string>, timestamp: number }>} */
  #streamUrls = new Map()
  /** @type {Map<string, Promise<{ url: string, headers?: Record<string, string> }>>} */
  #inflightStreamUrls = new Map()

  /** Reactive map of lowercased infoHash -> DebridCacheEntry for UI bindings. */
  cacheStore = writable(/** @type {Record<string, DebridCacheEntry>} */ ({}))

  /** Reactive status of the currently selected provider + account verification state. */
  status = writable({
    enabled: false,
    configured: false,
    providerId: '',
    providerName: '',
    mode: /** @type {DebridMode} */ ('cached'),
    verifying: false,
    account: /** @type {DebridAccountInfo | null} */ (null),
    error: /** @type {string | null} */ (null)
  })

  constructor() {
    this.register(new TorBoxProvider())

    settings.subscribe(value => {
      this.#syncStatus(value)
    })
  }

  /**
   * Handles a lazy file URL request emitted by the Node client worker during playback or metadata parsing.
   *
   * @param {{
   *   requestId: string,
   *   infoHash: string,
   *   path: string,
   *   providerId: string,
   *   torrentId: string | number,
   *   fileId: string | number,
   *   forceRefresh?: boolean
   * }} req
   */
  async handleUrlRequest(req) {
    try {
      const result = await this.getFileStreamUrl({
        providerId: req.providerId,
        torrentId: req.torrentId,
        fileId: req.fileId,
        infoHash: req.infoHash,
        forceRefresh: Boolean(req.forceRefresh)
      })
      await TORRENT.setDebridFileUrl?.({
        requestId: req.requestId,
        infoHash: req.infoHash,
        path: req.path,
        url: result.url,
        headers: result.headers
      })
    } catch (err) {
      debug('Failed to fulfill lazy debrid URL request', err)
      await TORRENT.setDebridFileUrl?.({
        requestId: req.requestId,
        infoHash: req.infoHash,
        path: req.path,
        error: err?.message || 'Failed to resolve stream URL'
      })
    }
  }

  /**
   * Registers a Debrid provider instance in the manager registry.
   *
   * @param {import('./providers/base.js').DebridProvider} provider
   */
  register(provider) {
    this.#providers.set(provider.id, provider)
    this.#syncStatus(settings.value)
  }

  /** @returns {DebridProviderMeta[]} */
  getProviders() {
    return [...this.#providers.values()].map(p => p.meta)
  }

  /**
   * @param {string} [id]
   * @returns {import('./providers/base.js').DebridProvider | null}
   */
  getProvider(id = settings.value.debridProvider) {
    if (!id) return null
    return this.#providers.get(id) || null
  }

  /**
   * Returns merged configuration for the given provider ID.
   *
   * @param {string} [id]
   * @returns {Record<string, any>}
   */
  getConfig(id = settings.value.debridProvider) {
    const provider = this.getProvider(id)
    const defaults = provider ? provider.getDefaultConfig() : { apiKey: '' }
    const saved = settings.value.debridConfigs?.[id] || {}
    return { ...defaults, ...saved }
  }

  /**
   * Updates persisted configuration fields for a specific provider.
   *
   * @param {string} providerId
   * @param {Record<string, any>} patch
   */
  updateConfig(providerId, patch) {
    settings.update(s => {
      const current = s.debridConfigs?.[providerId] || {}
      return {
        ...s,
        debridConfigs: {
          ...(s.debridConfigs || {}),
          [providerId]: { ...current, ...patch }
        }
      }
    })
  }

  /**
   * Whether Debrid integration is currently active and configured with credentials.
   *
   * @returns {boolean}
   */
  isEnabled() {
    const provider = this.getProvider()
    if (!settings.value.debridEnabled || !provider) return false
    const cfg = this.getConfig(provider.id)
    return Boolean(cfg?.apiKey?.trim())
  }

  /** @returns {DebridMode} */
  getMode() {
    return settings.value.debridMode || 'cached'
  }

  /**
   * Synchronizes reactive UI status store with current settings.
   *
   * @param {Record<string, any>} currentSettings
   */
  #syncStatus(currentSettings) {
    const provider = this.getProvider(currentSettings?.debridProvider)
    const cfg = provider ? { ...provider.getDefaultConfig(), ...(currentSettings?.debridConfigs?.[provider.id] || {}) } : {}
    const configured = Boolean(provider && cfg?.apiKey?.trim())
    const enabled = Boolean(currentSettings?.debridEnabled && configured)
    this.status.update(prev => ({
      ...prev,
      enabled,
      configured,
      providerId: provider?.id || '',
      providerName: provider?.name || '',
      mode: currentSettings?.debridMode || 'cached',
      account: prev.providerId === (provider?.id || '') ? prev.account : null,
      error: prev.providerId === (provider?.id || '') ? prev.error : null
    }))
  }

  /**
   * Clears cached hash availability results (useful after changing providers or keys).
   */
  clearCache() {
    this.#cacheEntries.clear()
    this.#inflightCache.clear()
    this.#streamUrls.clear()
    this.cacheStore.set({})
  }

  /**
   * Verifies credentials for the specified (or active) provider.
   *
   * @param {string} [providerId]
   * @param {Record<string, any>} [overrideConfig]
   * @returns {Promise<DebridAccountInfo>}
   */
  async verifyProvider(providerId = settings.value.debridProvider, overrideConfig) {
    const provider = this.getProvider(providerId)
    if (!provider) throw new DebridError('No debrid provider selected.', { code: 'NO_PROVIDER' })
    const cfg = overrideConfig ? { ...this.getConfig(provider.id), ...overrideConfig } : this.getConfig(provider.id)
    this.status.update(prev => ({ ...prev, verifying: true, error: null }))
    try {
      const account = await provider.verifyCredentials(cfg)
      this.status.update(prev => ({
        ...prev,
        verifying: false,
        account: provider.id === prev.providerId ? account : prev.account,
        error: null
      }))
      return account
    } catch (err) {
      const message = err?.message || 'Verification failed'
      this.status.update(prev => ({
        ...prev,
        verifying: false,
        account: provider.id === prev.providerId ? null : prev.account,
        error: message
      }))
      throw err
    }
  }

  /**
   * Looks up a cached status entry from memory for a given hash or magnet URI.
   *
   * @param {string | null | undefined} hashOrMagnet
   * @returns {DebridCacheEntry | null}
   */
  getCachedEntry(hashOrMagnet) {
    const hash = normalizeInfoHash(hashOrMagnet)
    if (!hash) return null
    const record = this.#cacheEntries.get(hash)
    if (!record || (Date.now() - record.timestamp) > CACHE_TTL_MS) return null
    return record.entry
  }

  /**
   * Checks cached availability for an array of info-hashes or magnets on the active provider.
   * Silently skips if Debrid or cache checking is disabled, updating `cacheStore` reactively.
   *
   * @param {string[]} hashesOrMagnets
   * @param {{ force?: boolean }} [opts]
   * @returns {Promise<Record<string, DebridCacheEntry>>}
   */
  async checkCachedHashes(hashesOrMagnets, opts = {}) {
    if (!this.isEnabled() || !settings.value.debridCheckCache) return {}
    const provider = this.getProvider()
    if (!provider?.meta?.capabilities?.cacheCheck) return {}

    const normalized = [...new Set(hashesOrMagnets.map(h => normalizeInfoHash(h)).filter(Boolean))]
    if (!normalized.length) return {}

    const now = Date.now()
    /** @type {Record<string, DebridCacheEntry>} */
    const resultMap = {}
    /** @type {string[]} */
    const missing = []

    for (const hash of normalized) {
      const cached = !opts.force && this.#cacheEntries.get(hash)
      if (cached && (now - cached.timestamp) <= CACHE_TTL_MS) {
        resultMap[hash] = cached.entry
      } else {
        missing.push(hash)
      }
    }

    if (!missing.length) return resultMap

    const key = `${provider.id}:${missing.join(',')}`
    let promise = this.#inflightCache.get(key)
    if (!promise) {
      promise = provider.checkCached(missing, this.getConfig(provider.id))
        .then(checked => {
          const ts = Date.now()
          const storePatch = {}
          for (const hash of missing) {
            const entry = checked?.[hash] || { hash, cached: false, providerId: provider.id, providerName: provider.name }
            this.#cacheEntries.set(hash, { entry, timestamp: ts })
            storePatch[hash] = entry
          }
          this.cacheStore.update(curr => ({ ...curr, ...storePatch }))
          return storePatch
        })
        .catch(err => {
          debug('Cache check failed', err)
          return {}
        })
        .finally(() => {
          this.#inflightCache.delete(key)
        })
      this.#inflightCache.set(key, promise)
    }

    const fetched = await promise
    return { ...resultMap, ...fetched }
  }

  /**
   * Resolves a torrent via the active Debrid provider and prepares stream payload metadata.
   *
   * @param {string} torrentID
   * @param {{
   *   hash?: string | false,
   *   magnet?: boolean,
   *   base64?: boolean,
   *   name?: string,
   *   allowUncached?: boolean,
   *   onProgress?: (info: { status: string, progress: number, name?: string }) => void,
   *   signal?: AbortSignal
   * }} [opts]
   * @returns {Promise<DebridResolvedTorrent>}
   */
  async resolveTorrent(torrentID, opts = {}) {
    if (!this.isEnabled()) {
      throw new DebridError('Debrid is not enabled or configured.', { code: 'NOT_CONFIGURED' })
    }
    const provider = this.getProvider()
    const config = this.getConfig(provider.id)

    let infoHash = normalizeInfoHash(opts.hash || torrentID)
    let magnet = (typeof torrentID === 'string' && torrentID.startsWith('magnet:')) ? torrentID : null
    /** @type {Uint8Array | null} */
    let torrentBytes = null

    if (opts.base64 && typeof torrentID === 'string') {
      torrentBytes = base64ToBytes(torrentID)
    } else if (!magnet && typeof torrentID === 'string' && /^https?:\/\//i.test(torrentID)) {
      if (infoHash && provider.meta.capabilities.supportsMagnet) {
        magnet = buildMagnetUri(infoHash, opts.name)
      } else if (provider.meta.capabilities.supportsTorrentFile) {
        const res = await provider.request(torrentID, { responseType: 'arrayBuffer', signal: opts.signal })
        if (!res.ok || !res.data) {
          throw new DebridError(`Failed to download .torrent metadata (${res.status}).`, {
            code: 'TORRENT_FETCH_FAILED',
            providerId: provider.id
          })
        }
        torrentBytes = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data)
      }
    } else if (!magnet && infoHash) {
      magnet = buildMagnetUri(infoHash, opts.name)
    }

    const allowUncached = opts.allowUncached ?? (this.getMode() === 'always')
    const resolved = await provider.resolveTorrent({
      infoHash,
      magnet,
      name: opts.name,
      torrentBytes,
      allowUncached,
      onProgress: opts.onProgress,
      signal: opts.signal
    }, config)

    infoHash = normalizeInfoHash(resolved.infoHash) || infoHash
    if (infoHash) {
      const entry = {
        hash: infoHash,
        cached: true,
        providerId: provider.id,
        providerName: provider.name,
        name: resolved.name,
        files: resolved.files.map(f => ({ id: f.id, name: f.name, path: f.path, size: f.length }))
      }
      this.#cacheEntries.set(infoHash, { entry, timestamp: Date.now() })
      this.cacheStore.update(curr => ({ ...curr, [infoHash]: entry }))
    }

    return resolved
  }

  /**
   * Resolves and caches a direct CDN stream URL for a specific file inside a resolved torrent.
   *
   * @param {{
   *   providerId?: string,
   *   torrentId: string | number,
   *   fileId: string | number,
   *   infoHash?: string,
   *   forceRefresh?: boolean,
   *   signal?: AbortSignal
   * }} ref
   * @returns {Promise<{ url: string, headers?: Record<string, string> }>}
   */
  async getFileStreamUrl(ref) {
    const providerId = ref.providerId || settings.value.debridProvider
    const provider = this.getProvider(providerId)
    if (!provider) throw new DebridError(`Unknown debrid provider: ${providerId}`, { code: 'NO_PROVIDER' })

    const cacheKey = `${provider.id}:${ref.torrentId}:${ref.fileId}`
    const existing = !ref.forceRefresh && this.#streamUrls.get(cacheKey)
    if (existing && (Date.now() - existing.timestamp) < STREAM_URL_TTL_MS) {
      return { url: existing.url, headers: existing.headers }
    }

    let inflight = !ref.forceRefresh ? this.#inflightStreamUrls.get(cacheKey) : null
    if (!inflight) {
      inflight = provider.getFileStreamUrl({
        torrentId: ref.torrentId,
        fileId: ref.fileId,
        infoHash: ref.infoHash,
        signal: ref.signal
      }, this.getConfig(provider.id))
        .then(result => {
          this.#streamUrls.set(cacheKey, {
            url: result.url,
            headers: result.headers,
            timestamp: Date.now()
          })
          return result
        })
        .finally(() => {
          this.#inflightStreamUrls.delete(cacheKey)
        })
      this.#inflightStreamUrls.set(cacheKey, inflight)
    }

    return inflight
  }
}

export const debrid = new DebridManager()
