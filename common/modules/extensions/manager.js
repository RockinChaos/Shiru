import { getRandomInt, createDeferred } from '@/modules/util.js'
import { status, printError } from '@/modules/networking.js'
import is_ip_private from '@rockinchaos/private-ip'
import { cache, caches } from '@/modules/cache.js'
import { settings } from '@/modules/settings.js'
import { SUPPORTS } from '@/modules/support.js'
import { writable } from 'simple-store-svelte'
import { toast } from '@/modules/lib/toast.js'
import equal from 'fast-deep-equal/es6'
import { wrap } from 'comlink'
import { parse } from 'tldts'
import Debug from 'debug'
const debug = Debug('ui:extension-manager')

/** @type {RegExp} */
export const CUSTOM_SCHEMES = /^(gh|npm):/
/** @type {RegExp} */
export const VALID_SCHEMES = /^(https?:|gh:|npm:|file:|extension:)/

/**
 * Creates and returns a new Web Worker instance for the given extension source.
 *
 * @param {object} source The extension source object.
 * @returns {Worker} The created worker instance.
 */
function createWorker(source) {
  return new Worker(new URL('@/modules/extensions/worker.js', import.meta.url), { type: 'module', name: getKey(source) })
}

/**
 * Gets an identifier for grouping extensions with the same manifest locations.
 *
 * @param {object} extension The extension metadata.
 * @returns {string} The serialized manifest locations.
 */
const sourceId = extension => JSON.stringify(sourceUrls(extension))

/**
 * Gets an extension's local manifest location or remote update URLs.
 *
 * @param {object} extension The extension metadata.
 * @returns {string[]} The manifest locations in fallback order.
 */
const sourceUrls = extension => [extension?.locale || extension?.update].flat().filter(Boolean)

/**
 * Gets the extension's code URLs, resolving relative paths against its source location.
 *
 * @param {object} extension The extension metadata.
 * @returns {string[]} The code URLs in fallback order.
 */
const getMainUrls = extension => [extension?.main].flat().map(main => !main || VALID_SCHEMES.test(main) ? main : `${extension?.locale || [extension?.update].flat()[0]}/${main}`)

/**
 * Converts a GitHub or npm source URL to its esm.sh manifest URL.
 * Appends index.json when the source does not name a JSON file.
 *
 * @param {string} url The source URL using the gh: or npm: protocol.
 * @returns {string} The esm.sh manifest URL.
 */
function getEsmManifestUrl(url) {
  const { protocol, pathname, search } = new URL(url)
  const base = `https://esm.sh${protocol === 'gh:' ? '/gh' : ''}/${pathname}`
  return `${/\.json$/i.test(pathname) ? base : `${base.replace(/\/$/, '')}/index.json`}${search}`
}

/**
 * Converts a GitHub or npm module URL to its esm.sh entry URL.
 *
 * @param {string} url The module URL using the gh: or npm: protocol.
 * @returns {string} The esm.sh module URL.
 */
function getEsmModuleUrl(url) {
  const { protocol, pathname, search } = new URL(url)
  return `https://esm.sh${protocol === 'gh:' ? '/gh' : ''}/${pathname}${search}`
}

/**
 * Gets the unique cache key for a source.
 *
 * @param {object} source The source object.
 * @returns {string}
 */
export const getKey = (source) => (source?.locale || [source?.update]?.flat()?.[0]) + '/' + source?.id

/**
 * Checks if the url is a Windows, Linux, or macOS file path.
 *
 * @param {string} url
 * @returns {boolean}
 */
export const isLocalPath = url => !url.includes(':') || /^[A-Za-z]:[/\\]/.test(url)

/**
 * Normalizes a local file path or file: URL to the extension:// protocol convention.
 *
 * @param {string} url The URL or path to normalize.
 * @returns {string} The normalized URL.
 */
export const normalizeUrl = url => isLocalPath(url) || url.startsWith('file:') ? `extension://${url.replace(/^file:(?!\/{3})/, '').replace(/^file:\/+/, '').replace(/\\/g, '/').replace(/^\/+/, '')}` : url

/**
 * Ignores esm.sh generated provenance banner when comparing module code.
 *
 * @param {string} code The downloaded or cached module code.
 * @returns {string} The code used for change detection.
 */
const comparableCode = code => code.replace(/^\/\* esm\.sh - [^\r\n]* \*\/\r?\n/, '')

/**
 * Gets a code cache key tied to an extension's version and main URLs.
 *
 * @param {string} key The extension key.
 * @param {object} extension The extension metadata.
 * @returns {string} The version-specific code cache key.
 */
const getCodeCacheKey = (key, extension) => `${key}:${extension.version}`

/**
 * Reads cached code for an extension's current version and main URLs, ignoring expiry.
 *
 * @param {object} extension The extension metadata.
 * @returns {Promise<string|null>} Non-empty cached code, or null if unavailable.
 */
async function getCachedCode(extension) {
  const code = await cache.cachedEntry(caches.EXTENSIONS, getCodeCacheKey(getKey(extension), extension), true)
  return typeof code === 'string' && code.trim() ? code : null
}

/**
 * Persists code under its version-specific cache key before an update can be committed.
 *
 * @param {object} extension The extension metadata.
 * @param {string} code The extension's JavaScript code.
 * @returns {Promise<void>} Resolves when the code has been saved.
 */
async function cacheCode(extension, code) {
  await cache.write(caches.EXTENSIONS, getCodeCacheKey(getKey(extension), extension), {
    data: code,
    expiry: Date.now() + getRandomInt(7, 14) * 24 * 60 * 60 * 1_000,
    cachedAt: Date.now()
  })
}

/**
 * Removes obsolete code versions and the legacy code cache entry.
 *
 * @param {string} key The extension key whose cached code should be pruned.
 * @param {string} [current] The version-specific cache key to retain, if any.
 * @returns {void}
 */
function deleteCode(key, current) {
  for (const cacheKey of Object.keys(cache.extensions.value)) {
    if (cacheKey.startsWith(`${key}:`) && cacheKey !== current) cache.deleteEntry(caches.EXTENSIONS, cacheKey).catch(error => debug('Failed to delete obsolete extension code:', error))
  }
  cache.deleteEntry(caches.EXTENSIONS, key).catch(error => debug('Failed to delete legacy extension code:', error))
}

/**
 * Migrates legacy code using the installed metadata before checking for newer manifests.
 * Existing versioned code takes precedence; legacy entries are removed only after a successful copy.
 *
 * @param {object} extensions The installed extension metadata, keyed by extension ID.
 * @returns {Promise<void>} Resolves after all available legacy entries have been processed.
 */
async function migrateLegacyCode(extensions) {
  await Promise.all(Object.values(extensions || {}).map(async extension => {
    const key = getKey(extension)
    if (extension.locale || !cache.getEntry(caches.EXTENSIONS, key)) return
    try {
      const code = await cache.cachedEntry(caches.EXTENSIONS, key, true)
      if (typeof code !== 'string' || !code.trim()) return
      if (!(await getCachedCode(extension))) await cacheCode(extension, code)
      await cache.deleteEntry(caches.EXTENSIONS, key)
    } catch (error) {
      debug(`Failed to migrate cached extension code for ${key}:`, error)
    }
  }))
}

/**
 * Resolves relative 'main' and 'update' URLs in a manifest against the source URL it was loaded from.
 * If no manifest is provided, resolves a single URL string against the base instead.
 *
 * @param {object[]|string} manifest The parsed manifest array, or a single URL string to resolve.
 * @param {string} sourceUrl The URL the manifest was fetched from.
 * @returns {object[]|string} The manifest with resolved URLs, or the resolved URL string.
 */
function resolveUrl(manifest, sourceUrl) {
  const normalizedSource = normalizeUrl(sourceUrl)
  const baseDir = normalizedSource.startsWith('extension://') || CUSTOM_SCHEMES.test(normalizedSource) ? normalizedSource : normalizedSource.endsWith('/') ? normalizedSource : normalizedSource.replace(/\/[^/]*\.json(\?.*)?$/, '/').replace(/\/[^/]*$/, '/')
  const collapse = (path) => {
    const match = path.match(/^([a-z]+:\/\/|[a-z]+:)/i)
    const prefix = match ? match[0] : ''
    const out = []
    for (const part of path.slice(prefix.length).split('/')) {
      if (part === '..') out.pop()
      else if (part !== '.' && part !== '') out.push(part)
    }
    return prefix + out.join('/')
  }
  const join = (base, relative) => collapse((base.endsWith('/') ? base : base + '/') + relative)
  const resolve = url => {
    if (!url || VALID_SCHEMES.test(url)) return url
    try {
      const relative = url.startsWith('./') ? url.slice(2) : url
      if (normalizedSource.startsWith('extension://') || CUSTOM_SCHEMES.test(normalizedSource)) {
        if (url === '.') return baseDir.replace(/\/$/, '')
        return join(baseDir, relative)
      }
      if (url === '.') return baseDir.replace(/\/$/, '')
      return new URL(relative, baseDir).href
    } catch {
      return url
    }
  }
  if (typeof manifest === 'string') return resolve(manifest)
  if (Array.isArray(manifest)) {
    for (const entry of manifest) {
      if (!entry) continue
      const resolveMain = entry.locale ? url => (!url || VALID_SCHEMES.test(url)) ? url : join(entry.locale, url.startsWith('./') ? url.slice(2) : url) : resolve
      if (entry.update) entry.update = Array.isArray(entry.update) ? entry.update.map(resolve) : resolve(entry.update)
      if (entry.main) entry.main = Array.isArray(entry.main) ? entry.main.map(resolveMain) : resolveMain(entry.main)
    }
  }
  return manifest
}

/**
 * Fetches and validates an extension manifest from a given URL.
 * Supports 'gh:', 'npm:', 'file:', 'extension:', and 'http(s)' protocols.
 *
 * @param {string|string[]} urls The manifest URLs or file paths in fallback order.
 * @param {boolean} updateCheck If the reason for getting the manifest is to check for updates.
 * @returns {Promise<object[]|null>} A parsed manifest array or null on error.
 */
async function getManifest(urls, updateCheck = false) {
  for (const url of [urls].flat()) {
    try {
      if (url.startsWith('http')) {
        const response = await fetch(url, { cache: 'reload' })
        if (!response.ok) throw new Error(`Unable to load manifest for ${url}: ${response.status} ${response.statusText}`)
        const manifest = await response.json()
        if (!Array.isArray(manifest)) throw new Error(`Invalid manifest from ${url}`)
        return resolveUrl(manifest, url)
      }
      if (isLocalPath(url) || url.startsWith('file:') || url.startsWith('extension:')) {
        const localeURL = (url.startsWith('extension:') ? url.replace(/^extension:/, 'file:') : url.startsWith('file:') ? url.replace(/^file:(?!\/{3})/, 'file:///') : `file:///${url.replace(/\\/g, '/')}`).replace(/^file:\/+/, 'file:///')
        const manifest = await (await fetch(localeURL + (!/\.json(\?|$)/i.test(localeURL) ? `${localeURL.endsWith('/') ? '' : '/'}index.json` : ''))).json()
        const basePath = url.replace(/^extension:/, '').replace(/^file:(?!\/{3})/, '').replace(/^file:\/+/, '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/[^/]+\.json$/, '')
        for (const source of manifest) {
          if (source?.id) source.locale = `extension://${basePath.endsWith('/') ? basePath.slice(0, -1) : basePath}`
        }
        return resolveUrl(manifest, url)
      }
      const { protocol } = new URL(url)
      if (protocol !== 'gh:' && protocol !== 'npm:') throw new Error(`Unknown protocol for source, expected: 'gh:', 'npm:', 'file:', 'extension:', or 'http(s)'`)
      const response = await fetch(getEsmManifestUrl(url), { cache: 'reload' })
      if (!response.ok) {
        const error = new Error(`Unable to load manifest due to a connection issue ${response.status} ${response.statusText}`)
        error.status = response.status
        throw error
      }
      return resolveUrl(await response.json(), url)
    } catch (error) {
      if (!updateCheck || !(error?.status === 429 || error?.status === 404 || error?.status === 500 || error?.status === 503)) await printError('Failed to fetch Source', `Unable to load manifest for: ${url}`, error)
    }
  }
  return null
}

/**
 * Fetches the JavaScript code for a given extension from the provided URL.
 *
 * @param {string} name The extension name or ID.
 * @param {string|string[]} urls The source URLs in fallback order.
 * @returns {Promise<string|null>} The fetched extension code or null on failure.
 */
async function getExtension(name, urls) {
  for (const url of [urls].flat()) {
    try {
      if (url.startsWith('http')) {
        const response = await fetch(url, { cache: 'reload' })
        if (!response.ok) throw new Error(`Failed to load extension code for url ${url} ${response.status} ${response.statusText}`)
        const code = await response.text()
        if (!code?.trim()) throw new Error(`Failed to load extension code for url ${url}, extension code is empty`)
        return code
      }
      if (url.startsWith('extension:')) return `${url}.js`
      const parsedUrl = new URL(url)
      const ghProtocol = parsedUrl.protocol === 'gh:'
      if (ghProtocol || parsedUrl.protocol === 'npm:') {
        try {
          const response = await fetch(getEsmModuleUrl(url), { cache: 'reload' })
          if (!response.ok) {
            const error = new Error(`Failed to load extension code for url ${url} ${response.status} ${response.statusText}`)
            error.status = response.status
            throw error
          }
          let code = await response.text()
          if (code.includes('export * from') && code.includes('export { default } from')) {
            const match = code.match(/from\s+["']([^"']+)["']/)
            if (match && match[1]) {
              const moduleResponse = await fetch(`https://esm.sh${match[1]}`, { cache: 'reload' })
              if (!moduleResponse.ok) throw new Error(`Failed to resolve module ${match[1]}`)
              code = await moduleResponse.text()
            }
          }
          if (!code || code.trim().length === 0) throw new Error(`Failed to load extension code for url ${url}, extension code is empty`)
          return code
        } catch (error) {
          await printError(`Failed to load extension ${name}`, 'Unable to fetch extension code', error)
          continue
        }
      }
      throw new Error(`Unknown protocol for extension, expected: 'gh:', 'npm:', 'file:', 'extension:', or 'http(s)'`)
    } catch (error) {
      await printError('Failed to fetch Extension', `Unable to load extension for: ${name} ${url}`, error)
    }
  }
  return null
}

/** Manages loading, caching, and lifecycle of extensions and their workers. */
class ExtensionManager {
  /** @type {Map<string, Promise<any>>} */
  pending = new Map()
  /** @type {Map<string, Worker>} */
  #pendingWorkers = new Map()
  /** @type {import('simple-store-svelte').Writable<Record<string, import('comlink').Remote<import('@/modules/extensions/worker.js').Worker>>>} */
  activeWorkers = writable({})
  /** @type {import('simple-store-svelte').Writable<Record<string, import('comlink').Remote<import('@/modules/extensions/worker.js').Worker>>>} */
  inactiveWorkers = writable({})
  /** @type {boolean} */
  #checkingForUpdates = false
  /** @type {boolean} */
  #skipSourceUpdateCheck = false
  /** @type {{promise: Promise<boolean>, resolve: (function(boolean): void)}} */
  whenReady = createDeferred()
  /** @type {Map<string, Promise<void>>} */
  loadingExtensions = new Map()
  /** @type {Map<string, {source: string, generation: object}>} */
  #loadingExtensionSources = new Map()

  constructor() {
    let sources = null
    debug('Loading extensions from sources...')
    settings.subscribe(value => {
      const newSources = cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}
      const sourcesOld = Object.keys(sources || {})
      const sourcesNew = Object.keys(newSources)

      // Sync extensionsNew with shared database.
      const extensionsNew = value.extensionsNew || {}
      const toAdd = [...sourcesNew].filter(key => !(key in extensionsNew))
      const toRemove = Object.keys(extensionsNew).filter(key => !newSources[key])
      if (toAdd.length || toRemove.length) {
        for (const key of toAdd) {
          const defaults = Object.fromEntries((newSources[key].settings || []).map(setting => [setting.key, setting.default ?? null]))
          extensionsNew[key] = { enabled: false, settings: defaults }
        }
        for (const key of toRemove) delete extensionsNew[key]
        if (toAdd.length) debug(`Synced ${toAdd.length} new extension(s) into extensionsNew:`, toAdd)
        if (toRemove.length) debug(`Removed ${toRemove.length} stale extension(s) from extensionsNew:`, toRemove)
      }

      // Update and Load extensions.
      if ((!sourcesOld?.length && !sourcesNew?.length) || !(sourcesOld.length === sourcesNew.length && sourcesOld.every(key => sourcesNew.includes(key)))) {
        if (sourcesOld.length && !sourcesNew.length) { sources = structuredClone(newSources); return }
        if (!sources && !sourcesNew.length) { this.whenReady.resolve(true); sources = {} }
        else if (sourcesNew.length) {
          debug(!sources ? 'Loading persisted extension sources...' : 'Found new sources and updated...', JSON.stringify(newSources))
          sources = structuredClone(newSources)
          this.whenReady = createDeferred()
          const checking = !this.#skipSourceUpdateCheck
          if (checking) this.#checkingForUpdates = true
          const update = checking ? this.updateExtensions(newSources, cache.getEntry(caches.EXTENSIONS, 'repositorySources') || {}) : Promise.resolve()
          update.then(() => this.loadExtensions(cache.getEntry(caches.EXTENSIONS, 'extensionSources') ?? newSources)).catch(error => {
            printError('Failed to Update Extensions', 'Unable to check for updates or update extensions.', error)
            return this.loadExtensions(cache.getEntry(caches.EXTENSIONS, 'extensionSources') ?? newSources)
          }).finally(() => { if (checking) this.#checkingForUpdates = false })
        }
      }
    })

    // Refresh saved repositories after cache hydration for a repository-only setup.
    cache.isReady.then(() => {
      const extensions = cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}
      const repositories = cache.getEntry(caches.EXTENSIONS, 'repositorySources') || {}
      if (!Object.keys(extensions).length && Object.keys(repositories).length) return this.checkForUpdates()
    }).catch(error => debug('Failed to start repository update check:', error))

    // check for extension updates every 3 hours.
    setInterval(() => this.checkForUpdates(), 3 * 60 * 60 * 1_000).unref?.()

    let _status = navigator.onLine ? 'online' : 'offline'
    status.subscribe(async value => {
      if (_status === 'offline' && value === 'online') {
        const tasks = Object.entries(this.inactiveWorkers.value).map(async ([key, worker]) => {
          if (this.activeWorkers.value[key] || this.#pendingWorkers.has(key)) return
          if (!settings.value.extensionsNew[key]?.enabled) {
            debug(`Extension ${key} was disabled during network change, terminating...`)
            worker.terminate()
            this.inactiveWorkers.update(value => {
              const { [key]: _, ...rest } = value
              return rest
            })
            return
          }
          this.#pendingWorkers.set(key, worker)
          try {
            this.inactiveWorkers.update(value => {
              const { [key]: _, ...rest } = value
              return rest
            })
            if (!(await worker.validate())) throw new Error('The content source appears to be unreachable.')
            if (this.#pendingWorkers.get(key) !== worker) return
            this.activeWorkers.update(value => ({ ...value, [key]: worker }))
          } catch (error) {
            if (this.#pendingWorkers.get(key) === worker) {
              this.inactiveWorkers.update(value => ({ ...value, [key]: worker }))
            }
            await printError(`Failed to load extension ${key}`, 'Validation has failed', error)
          } finally {
            this.#pendingWorkers.delete(key)
          }
        })
        await Promise.all(tasks)
        await this.checkForUpdates()
      }
      if (value === 'offline' || value === 'online') _status = value
    })
  }

  /**
   * Periodically checks for extension and source repository updates, reloading anything that changed.
   * Skips silently if offline or neither extensions nor repositories are saved.
   *
   * @returns {Promise<void>}
   */
  async checkForUpdates() {
    if (status.value === 'offline' || this.#checkingForUpdates) return
    const extensionSources = cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}
    const repositorySources = cache.getEntry(caches.EXTENSIONS, 'repositorySources') || {}
    if (!Object.keys(extensionSources).length && !Object.keys(repositorySources).length) {
      debug('Skipping periodic update check, no extensions or repositories saved')
    } else {
      debug('Running periodic extension and repository update check...')
      this.#checkingForUpdates = true
      try {
        const updated = await this.updateExtensions(extensionSources, repositorySources)
        const missing = Object.keys(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}).some(key => settings.value.extensionsNew[key]?.enabled && !this.activeWorkers.value[key] && !this.inactiveWorkers.value[key] && !this.loadingExtensions.has(key))
        if ((updated || missing) && Object.keys(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}).length) {
          debug('Periodic update check found changes or missing extension code, reloading affected extensions...')
          await this.loadExtensions(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {})
        } else {
          debug('Periodic update check completed, no extension reload needed')
        }
      } catch (error) {
        await printError('Failed to check for extension updates', 'The periodic update check failed', error)
      } finally {
        this.#checkingForUpdates = false
      }
    }
  }

  /**
   * Validates and activates an inactive extension worker by key.
   *
   * @param {string} key The identifier for the extension worker to validate.
   * @returns {Promise<void>}
   */
  async validateExtension(key) {
    if (!settings.value.extensionsNew[key]?.enabled) return
    const inactiveWorker = this.inactiveWorkers.value[key]
    if (!inactiveWorker) return
    try {
      this.#pendingWorkers.set(key, inactiveWorker)
      this.inactiveWorkers.update(value => {
        const { [key]: _, ...rest } = value
        return rest
      })
      let validated
      let validationError
      try {
        validated = status.value !== 'offline' ? await inactiveWorker.validate() : false
      } catch (err) {
        validated = false
        validationError = err
      }
      if (!this.#pendingWorkers.has(key)) return
      if (!validated && (await inactiveWorker.hasBadModule())) {
        await this.getExtensionCode(key, inactiveWorker)
        if (this.activeWorkers.value[key]) return
      }
      if (!validated) throw validationError || new Error('The content source appears to be unreachable.')
      this.activeWorkers.update(value => ({ ...value, [key]: inactiveWorker }))
    } catch (error) {
      if (!this.activeWorkers.value[key]) {
        this.inactiveWorkers.update(value => ({ ...value, [key]: inactiveWorker }))
      }
      await printError(`Failed to load extension ${key}`, 'Validation has failed', error)
    } finally {
      this.#pendingWorkers.delete(key)
    }
  }

  /**
   * Fetches, caches, initializes, and validates an extension's source code.
   * If validation fails, the worker is marked inactive or terminated as needed.
   *
   * @param {string} key Unique identifier for the extension.
   * @param {Object} worker The worker instance responsible for loading the extension.
   * @returns {Promise<void>} Resolves when the extension is successfully loaded.
   * @throws {Error} If the extension fails validation or initialization.
   */
  async getExtensionCode(key, worker) {
    const generation = this.whenReady
    const extension = (cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {})[key]
    const newCode = await getExtension(extension?.name || extension?.id, getMainUrls(extension))
    if (this.whenReady !== generation) {
      worker.terminate()
    } else if (newCode && typeof newCode === 'string' && newCode.trim().length > 0) {
      if (!extension.locale) {
        try {
          await cacheCode(extension, newCode)
        } catch (error) {
          await printError(`Failed to cache extension ${key}`, 'Extension code could not be saved', error)
        }
        try {
          if (this.#pendingWorkers.get(key) !== worker && this.activeWorkers.value[key] !== worker && this.inactiveWorkers.value[key] !== worker) return
          const initialize = await worker.initialize(key, extension.type, newCode, { settings: settings.value.extensionsNew[key]?.settings ?? {}, bypassCORS: SUPPORTS.isAndroid })
          if (!settings.value.extensionsNew[key]?.enabled) {
            debug(`Extension ${key} was disabled during code fetch, terminating...`)
            worker.terminate()
            return
          }
          if (!initialize.validated) {
            this.inactiveWorkers.update(value => ({ ...value, [key]: worker }))
            throw new Error(initialize.error)
          }
        } catch (error) {
          if (!this.inactiveWorkers.value[key]) worker.terminate()
          throw new Error(error, { cause: error })
        }
        this.activeWorkers.update(value => ({ ...value, [key]: worker }))
      }
    }
  }

  /** Terminates all workers and reloads extensions. */
  async reloadExtensions() {
    Object.values(this.activeWorkers.value).forEach(worker => worker.terminate())
    Object.values(this.inactiveWorkers.value).forEach(worker => worker.terminate())
    this.#pendingWorkers.forEach(worker => worker.terminate())
    this.#pendingWorkers.clear()
    this.activeWorkers.set({})
    this.inactiveWorkers.set({})
    this.whenReady = createDeferred()
    await this.loadExtensions(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {})
    debug(`Extensions have been reloaded`)
  }

  /**
   * Disables an extension by terminating its worker.
   *
   * @param {string} key The extension key.
   */
  disableExtension(key) {
    if (this.#pendingWorkers.has(key)) {
      this.#pendingWorkers.get(key).terminate()
      this.#pendingWorkers.delete(key)
    }
    if (this.activeWorkers.value[key]) {
      this.activeWorkers.value[key].terminate()
      this.activeWorkers.update(value => {
        const { [key]: _, ...rest } = value
        return rest
      })
    }
    if (this.inactiveWorkers.value[key]) {
      this.inactiveWorkers.value[key].terminate()
      this.inactiveWorkers.update(value => {
        const { [key]: _, ...rest } = value
        return rest
      })
    }
    debug(`Disabled extension ${key}`)
  }

  /**
   * Enables an extension by loading and validating it.
   *
   * @param {string} key The extension key.
   * @returns {Promise<void>}
   */
  async enableExtension(key) {
    if (this.activeWorkers.value[key] || this.loadingExtensions.has(key)) return
    const extension = (cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {})[key]
    if (!extension) return
    debug(`Enabling extension ${key}`)
    await this.loadExtensions({ [key]: extension })
  }

  /**
   * Update settings of an active extension worker.
   *
   * @param {string} key The extension key.
   * @returns {Promise<void>}
   */
  async updateExtensionSettings(key) {
    const worker = this.activeWorkers.value[key]
    if (!worker || this.loadingExtensions.has(key)) return
    const extension = settings.value.extensionsNew[key]
    if (!extension) return
    debug(`Updating settings for extension ${key}`)
    worker.updateSettings(extension.settings ?? {})
  }

  /**
   * Removes a specific extension source and clears related cache entries.
   *
   * @param {string} extensionId The extension identifier.
   */
  async removeSource(extensionId) {
    const extensionSources = { ...(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}) }
    for (const [_key, source] of Object.entries(extensionSources)) {
      if ([source.update].flat()[0] === extensionId) {
        const key = getKey(source)
        if (this.activeWorkers.value[key]) {
          this.activeWorkers.value[key].terminate()
          this.activeWorkers.update(value => {
            const { [key]: _, ...rest } = value
            return rest
          })
        } else if (this.inactiveWorkers.value[key]) {
          this.inactiveWorkers.value[key].terminate()
          this.inactiveWorkers.update(value => {
            const { [key]: _, ...rest } = value
            return rest
          })
        }
        delete extensionSources[_key]
        deleteCode(key)
      }
    }
    const removedKeys = Object.keys(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}).filter(key => !(key in extensionSources))
    cache.setEntry(caches.EXTENSIONS, 'extensionSources', extensionSources)
    this.#skipSourceUpdateCheck = true
    try {
      settings.update(value => {
        const extensionsNew = { ...value.extensionsNew }
        for (const _key of removedKeys) delete extensionsNew[_key]
        return { ...value, extensionsNew }
      })
    } finally {
      this.#skipSourceUpdateCheck = false
    }
  }

  /**
   * Adds a new extension source and validates its manifest.
   *
   * @param {string} url The source URL.
   * @returns {Promise<string|void>} A status message or undefined.
   */
  async addSource(url) {
    if (this.pending.has(url)) return this.pending.get(url)
    const promise = (async () => {
      try {
        const config = await getManifest(url)
        if (!config) {
          await printError('Failed to load source', '', { message: `Failed to load source: ${url} ${status.value !== 'offline' ? 'the source is not valid.' : 'no network connection!'}` })
          this.pending.delete(url)
          return `Failed to load extension(s) from the provided source '${url}': ${status.value !== 'offline' ? 'the source is not valid.' : 'no network connection!'}`
        }
        if (!Array.isArray(config) || !config.length) {
          this.pending.delete(url)
          return `Failed to load extension(s) from '${url}': the manifest must be a non-empty array.`
        }
        if (config.every(entry => entry?.main && !entry?.update)) { // source repository manifests
          const normalizedUrl = normalizeUrl(url)
          const repositorySources = cache.getEntry(caches.EXTENSIONS, 'repositorySources') || {}
          const current = repositorySources[normalizedUrl]
          if (JSON.stringify(current) !== JSON.stringify(config)) {
            cache.setEntry(caches.EXTENSIONS, 'repositorySources', { ...repositorySources, [normalizedUrl]: config })
            debug(`Stored new source repository: ${normalizedUrl}`)
          } else {
            debug(`Source repository unchanged: ${normalizedUrl}`)
            this.pending.delete(url)
            return `Source repository unchanged: ${normalizedUrl}`
          }
        } else { // extension manifests
          for (const extension of config) {
            if (!this.validateConfig(extension)) {
              await printError('Invalid extension format', '', { message: `Invalid extension config: ${url}` })
              this.pending.delete(url)
              return `Failed to load extension(s) from '${url}': invalid extension format.`
            }
          }
          const extensionSources = { ...(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}) }
          config.forEach(extension => {
            const key = getKey(extension)
            extensionSources[key] = extension
          })
          cache.setEntry(caches.EXTENSIONS, 'extensionSources', extensionSources)
          this.#skipSourceUpdateCheck = true
          try {
            settings.update(value => {
              const extensionsNew = { ...value.extensionsNew }
              config.forEach(extension => {
                const key = getKey(extension)
                if (!extensionsNew[key]) {
                  const defaults = Object.fromEntries((extension.settings || []).map(setting => [setting.key, setting.default ?? null]))
                  extensionsNew[key] = { enabled: false, settings: defaults }
                }
              })
              return { ...value, extensionsNew }
            })
          } finally {
            this.#skipSourceUpdateCheck = false
          }
        }
        this.pending.delete(url)
      } catch (error) {
        await printError('Failed to load source', `An unexpected error occurred loading: ${url}`, error)
        this.pending.delete(url)
        return `Failed to load extension(s) from '${url}': ${error.message}`
      }
    })()
    this.pending.set(url, promise)
    return promise
  }

  /**
   * Gets a promise that resolves when a specific extension is ready (or rejects if it fails)
   *
   * @param {string} key The extension key
   * @returns {Promise<import('comlink').Remote<import('@/modules/extensions/worker.js').Worker>|null>}
   */
  async whenExtensionReady(key) {
    if (this.activeWorkers.value[key]) return this.activeWorkers.value[key]
    if (this.inactiveWorkers.value[key]) return null
    if (this.loadingExtensions.has(key)) {
      await this.loadingExtensions.get(key)
      return this.activeWorkers.value[key] || null
    }
    return null
  }

  /**
   * Loads extension modules from cache or network and starts workers.
   *
   * @param {object} extensions Extension metadata.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   */
  async loadExtensions(extensions) {
    const generation = this.whenReady
    await migrateLegacyCode(extensions)
    const extensionIds = Object.keys(extensions || {})
    if (!extensionIds?.length) {
      generation.resolve(true)
      return false
    }
    const modules = Object.fromEntries(await Promise.all(extensionIds.map(async (id) => {
      try {
        const cachedModule = await getCachedCode(extensions[id])
        return cachedModule ? [id, cachedModule] : null
      } catch (error) {
        debug(`Error reading cache for ${id}:`, error)
        return null
      }
    })).then(results => results.flatMap(result => result ? [result] : [])))
    if (this.whenReady !== generation) return false

    const loadWorkers = Promise.allSettled(extensionIds.map(async (key) => {
      const source = JSON.stringify(extensions[key])
      const loading = this.#loadingExtensionSources.get(key)
      if (loading?.source === source && loading.generation === generation && this.loadingExtensions.has(key)) return this.loadingExtensions.get(key)
      const loadingPromise = Promise.resolve().then(async () => {
        if (this.whenReady !== generation || !settings.value.extensionsNew[key]?.enabled) return
        if (!modules[key]) {
          const extension = extensions[key]
          const newCode = await getExtension(extension?.name || extension?.id, getMainUrls(extension))
          if (newCode && typeof newCode === 'string' && newCode.trim().length > 0) {
            modules[key] = newCode
            try {
              if (!extension.locale) await cacheCode(extension, newCode)
            } catch (error) {
              await printError(`Failed to cache extension ${key}`, 'Extension code could not be saved', error)
            }
          } else {
            debug(`Failed to fetch extension ${key}, skipping extension until code for this version is available`)
            return
          }
          if (!modules[key]) {
            debug(`No valid module code for ${key}, skipping`)
            return
          }
        }

        if (this.whenReady !== generation || !settings.value.extensionsNew[key]?.enabled) return
        if (!this.activeWorkers.value[key]) {
          /** @type {RemoteObject<Promise<comlink.Remote<import('@/modules/extensions/worker.js').Worker>>> & ProxyMethods} */
          let remoteWorker
          try {
            const extension = extensions[key]
            const worker = createWorker(extension)
            if (SUPPORTS.isAndroid) worker.onmessage = async (event) => this.portMessage(event, worker) // hacky Android workaround for Access-Control-Allow-Origin error.
            try {
              remoteWorker = await wrap(worker)
              if (this.whenReady !== generation) {
                remoteWorker.terminate()
                return
              }
              this.#pendingWorkers.set(key, remoteWorker)
              const initialize = await remoteWorker.initialize(key, extension.type, modules[key], { settings: settings.value.extensionsNew[key]?.settings ?? {}, bypassCORS: SUPPORTS.isAndroid })
              if (this.whenReady !== generation) {
                remoteWorker.terminate()
                return
              } else if (!settings.value.extensionsNew[key]?.enabled) {
                debug(`Extension ${key} was disabled during initialization, terminating...`)
                remoteWorker.terminate()
                return
              }
              if (!initialize.validated && initialize.stub) {
                await this.getExtensionCode(key, remoteWorker)
                if (this.whenReady !== generation) {
                  remoteWorker.terminate()
                  return
                } else if (this.activeWorkers.value[key] || !settings.value.extensionsNew[key]?.enabled) return
              }
              if (!initialize.validated) {
                this.inactiveWorkers.update(value => ({ ...value, [key]: remoteWorker }))
                throw new Error(initialize.error)
              }
              if (this.activeWorkers.value[key]) {
                this.activeWorkers.value[key].terminate()
                this.activeWorkers.update(value => {
                  const { [key]: _, ...rest } = value
                  return rest
                })
              } else if (this.inactiveWorkers.value[key]) {
                this.inactiveWorkers.value[key].terminate()
                this.inactiveWorkers.update(value => {
                  const { [key]: _, ...rest } = value
                  return rest
                })
              }
              this.activeWorkers.update(value => ({ ...value, [key]: remoteWorker }))
            } catch (error) {
              if (!this.inactiveWorkers.value[key]) worker.terminate()
              throw new Error(error, { cause: error })
            }
          } catch (error) {
            await printError(`Failed to load extension ${key}`, 'Initialization has failed', error)
          } finally {
            if (this.#pendingWorkers.get(key) === remoteWorker) this.#pendingWorkers.delete(key)
          }
        }
      })
      this.loadingExtensions.set(key, loadingPromise)
      this.#loadingExtensionSources.set(key, { source, generation })
      await loadingPromise.finally(() => {
        if (this.loadingExtensions.get(key) === loadingPromise) {
          this.loadingExtensions.delete(key)
          this.#loadingExtensionSources.delete(key)
        }
      })
    })).catch((error) => printError('Unexpected error initializing extensions', error.message, error))
    generation.resolve(true)
    await loadWorkers
    return true
  }

  /**
   * Updates the extension source repository if it has changed.
   * TODO: Add an update field to the repository manifest, allow switching to new repository with retroactive updating of the cache, similar to extensions.
   *
   * @param {string} url The URL of the source repository.
   * @returns {Promise<number>} The number of new entries added, or 0 if unchanged or failed.
   */
  async updateSources(url) {
    try {
      const repositoryManifest = await getManifest(url, true)
      if (!repositoryManifest || !Array.isArray(repositoryManifest) || !repositoryManifest.every(entry => entry?.main && !entry?.update)) return 0
      const normalizedUrl = normalizeUrl(url)
      const repositorySources = cache.getEntry(caches.EXTENSIONS, 'repositorySources') || {}
      if (JSON.stringify(repositorySources[normalizedUrl]) !== JSON.stringify(repositoryManifest)) {
        const existingMains = new Set((repositorySources[normalizedUrl] || []).map(entry => entry.main))
        const newCount = repositoryManifest.filter(entry => !existingMains.has(entry.main)).length
        cache.setEntry(caches.EXTENSIONS, 'repositorySources', { ...repositorySources, [normalizedUrl]: repositoryManifest })
        debug(`Source repository updated: ${normalizedUrl}`)
        return newCount
      }
      debug(`Source repository unchanged: ${url}`)
      return 0
    } catch (error) {
      await printError('Failed to update Source Repository', `Unable to update repository for: ${url}`, error)
      return 0
    }
  }

  /**
   * Reconciles installed extensions with valid manifests, including updates,
   * new entries, and removals confirmed by a second fresh request.
   *
   * @param {object} currentExtensions Currently installed extensions.
   * @param {object} repositorySources Currently added extension source repositories.
   * @returns {Promise<boolean>} True if updates were found, false otherwise.
   */
  async updateExtensions(currentExtensions, repositorySources) {
    const extensionIds = Object.keys(currentExtensions || {})
    await migrateLegacyCode(currentExtensions)
    if (status.value === 'offline') return false
    try {
      // Check for source repository updates
      const repositoryUrls = Object.keys(repositorySources || {})
      if (repositoryUrls.length) {
        debug(`Checking ${repositoryUrls.length} stored source repositories for updates...`)
        const newSourceCounts = await Promise.all(repositoryUrls.map(url => this.updateSources(url)))
        await cache.flush()
        const totalNew = newSourceCounts.reduce((sum, count) => sum + count, 0)
        if (totalNew > 0) {
          toast.success(`Updated source repositor${repositoryUrls.length > 1 ? 'ies' : 'y'}`, {
            description: `${totalNew} new extension source${totalNew > 1 ? 's' : ''} available. Go to the Sources tab on the Extensions settings page to add them.`,
            duration: 15_000
          })
        }
      }
      if (!extensionIds.length) return false

      // Keep each installed extension tied to its own manifest. A valid manifest
      // can remove an extension, while a failed or malformed fetch cannot.
      const manifests = new Map()
      for (const extension of Object.values(currentExtensions)) manifests.set(sourceId(extension), sourceUrls(extension))
      debug(`Checking ${extensionIds.length} installed extension(s) for updates...`)
      const manifestResults = new Map(await Promise.all([...manifests].map(async ([id, urls]) => {
        const manifest = await getManifest(urls, true)
        return [id, Array.isArray(manifest) && manifest.every(config => this.validateConfig(config)) ? manifest : null]
      })))

      // A repository may replace one child manifest URL with another. Probe only
      // the new children of repositories that contained an installed extension.
      const refreshedRepositories = cache.getEntry(caches.EXTENSIONS, 'repositorySources') || {}
      const migrationUrls = new Map()
      for (const [repositoryUrl, previousEntries] of Object.entries(repositorySources || {})) {
        const previousMains = new Set(previousEntries.flatMap(entry => [entry.main].flat()))
        const currentMains = (refreshedRepositories[repositoryUrl] || []).flatMap(entry => [entry.main].flat())
        const addedMains = currentMains.filter(main => !previousMains.has(main))
        if (!addedMains.length) continue
        for (const [oldId, extension] of Object.entries(currentExtensions)) {
          if (sourceUrls(extension).some(url => previousMains.has(url) && !currentMains.includes(url))) migrationUrls.set(oldId, addedMains)
        }
      }
      const replacementUrls = [...new Set([...migrationUrls.values()].flat())]
      const replacementManifests = new Map(await Promise.all(replacementUrls.map(async url => {
        const manifest = await getManifest(url, true)
        return [url, Array.isArray(manifest) && manifest.every(config => this.validateConfig(config)) ? manifest : null]
      })))

      const toUpdate = []
      const missing = []
      for (const oldId of extensionIds) {
        const current = currentExtensions[oldId]
        const manifest = manifestResults.get(sourceId(current))
        let latest = manifest?.find(config => config.id === current.id)
        if (!latest) {
          const replacements = (migrationUrls.get(oldId) || []).flatMap(url => (replacementManifests.get(url) || []).filter(config => config.id === current.id && sourceId(config) !== sourceId(current)))
          if (replacements.length === 1) latest = replacements[0]
        }
        if (latest) {
          if (!equal(current, latest)) toUpdate.push({ oldId, latest })
        } else if (manifest) missing.push({ oldId, current })
      }

      // Confirm all missing extensions from each source with one additional valid manifest response.
      const missingBySource = new Map()
      for (const entry of missing) {
        const id = sourceId(entry.current)
        if (!missingBySource.has(id)) missingBySource.set(id, { urls: sourceUrls(entry.current), entries: [] })
        missingBySource.get(id).entries.push(entry)
      }
      const confirmedMissing = (await Promise.all([...missingBySource.values()].map(async ({ urls, entries }) => {
        const manifest = await getManifest(urls, true)
        if (!Array.isArray(manifest) || !manifest.every(config => this.validateConfig(config))) return []
        const presentIds = new Set(manifest.map(config => config.id))
        return entries.filter(({ current }) => !presentIds.has(current.id)).map(({ oldId }) => oldId)
      }))).flat()
      const previousPending = cache.getEntry(caches.EXTENSIONS, 'pendingUpdates') || {}
      const pendingUpdates = { ...previousPending }
      const sameCodeIdentity = (current, latest) => current.version === latest.version && equal(current.main, latest.main)
      const staged = await Promise.all(toUpdate.map(async update => {
        const { oldId } = update
        let { latest } = update
        const current = currentExtensions[oldId]
        if (latest.locale) return { update, ready: true }
        try {
          if (sourceId(current) !== sourceId(latest)) {
            const destination = await getManifest(sourceUrls(latest), true)
            const verified = Array.isArray(destination) && destination.every(config => this.validateConfig(config)) ? destination.find(config => config.id === current.id) : null
            if (!verified || sourceId(verified) !== sourceId(latest)) return { update, failed: true }
            latest = verified
            update = { oldId, latest }
          }
          const previousCode = await getCachedCode(current) || await cache.cachedEntry(caches.EXTENSIONS, oldId, true)
          if (sameCodeIdentity(current, latest)) {
            if (getCodeCacheKey(oldId, current) === getCodeCacheKey(getKey(latest), latest)) return { update, ready: true }
            if (previousCode) {
              await cacheCode(latest, previousCode)
              return { update, ready: true }
            }
          }
          let code = await getCachedCode(latest)
          let alreadyCached = !!code
          const hasUnchangedUpdateCode = (current, latest, previousCode, nextCode) => latest.version !== current.version && typeof previousCode === 'string' && comparableCode(previousCode) === comparableCode(nextCode)
          if (!code || hasUnchangedUpdateCode(current, latest, previousCode, code)) {
            code = await getExtension(latest.name || latest.id, getMainUrls(latest))
            if (!code?.trim()) return { update, failed: true }
            alreadyCached = false
          }
          if (hasUnchangedUpdateCode(current, latest, previousCode, code)) {
            // A version-only bump promises new code. Mixed metadata/code changes
            // get a grace period before accepting identical bytes as intentional.
            if (equal({ ...current, version: latest.version }, latest)) {
              debug(`Extension ${oldId} changed only its version, but code is unchanged; retrying later`)
              return { update, deferred: true }
            }
            const signature = JSON.stringify(latest)
            const priorFirstSeenAt = previousPending[oldId]?.firstSeenAt
            const firstSeenAt = previousPending[oldId]?.signature === signature && Number.isFinite(priorFirstSeenAt) ? priorFirstSeenAt : Date.now()
            if (Date.now() - firstSeenAt < 24 * 60 * 60 * 1_000) {
              debug(`Extension ${oldId} changed its version and metadata, but code is unchanged; retrying during the 24-hour grace period`)
              return { update, deferred: true, pending: { signature, firstSeenAt } }
            }
          }
          if (!alreadyCached) await cacheCode(latest, code)
          if (latest.version !== current.version && !previousCode) debug(`No previous cached code for ${oldId}; accepting candidate code without comparison`)
          return { update, ready: true }
        } catch (error) {
          await printError(`Failed to update extension ${latest.name || latest.id}`, 'New extension code could not be saved', error)
          return { update, failed: true }
        }
      }))
      const readyUpdates = staged.filter(result => result.ready).map(result => result.update)
      for (const result of staged) {
        if (result.pending) pendingUpdates[result.update.oldId] = result.pending
        else if (result.ready || result.deferred) delete pendingUpdates[result.update.oldId]
      }
      for (const oldId of confirmedMissing) delete pendingUpdates[oldId]
      for (const oldId of Object.keys(pendingUpdates)) {
        if (!currentExtensions[oldId] || (manifestResults.get(sourceId(currentExtensions[oldId])) && !toUpdate.some(update => update.oldId === oldId))) delete pendingUpdates[oldId]
      }
      if (!equal(previousPending, pendingUpdates)) await cache.write(caches.EXTENSIONS, 'pendingUpdates', pendingUpdates)
      const failedCount = staged.filter(result => result.failed).length
      if (failedCount) debug(`Failed to update ${failedCount} extension(s) during update check, skipping until next check`)

      const existingIds = new Set(Object.values(currentExtensions).map(extension => extension.id))
      const toAdd = [...new Map([...manifestResults.values()].filter(Boolean).flat().filter(config => !existingIds.has(config.id)).map(config => [getKey(config), config])).values()]
      if (!readyUpdates.length && !confirmedMissing.length && !toAdd.length) return false

      const extensionSources = { ...(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}) }
      for (const { oldId, latest } of readyUpdates) {
        const newId = getKey(latest)
        extensionSources[newId] = latest
        if (newId !== oldId) delete extensionSources[oldId]
      }
      for (const oldId of confirmedMissing) delete extensionSources[oldId]
      for (const extension of toAdd) extensionSources[getKey(extension)] = extension
      await cache.write(caches.EXTENSIONS, 'extensionSources', extensionSources)

      for (const { oldId, latest } of readyUpdates) {
        const current = currentExtensions[oldId]
        if (getKey(latest) !== oldId || !sameCodeIdentity(current, latest) || current.type !== latest.type || !equal(current.settings, latest.settings)) {
          try { this.disableExtension(oldId) } catch (error) { debug('Failed to stop extension worker during update:', error) }
        }
        deleteCode(oldId, getCodeCacheKey(getKey(latest), latest))
      }
      for (const oldId of confirmedMissing) {
        try { this.disableExtension(oldId) } catch (error) { debug('Failed to stop removed extension worker:', error) }
        deleteCode(oldId)
      }
      this.#skipSourceUpdateCheck = true
      try {
        settings.update(value => {
          const extensionsNew = { ...value.extensionsNew }
          for (const { oldId, latest } of readyUpdates) {
            const newId = getKey(latest)
            if (newId !== oldId && extensionsNew[oldId]) {
              extensionsNew[newId] = extensionsNew[oldId]
              delete extensionsNew[oldId]
            }
          }
          for (const oldId of confirmedMissing) delete extensionsNew[oldId]
          for (const extension of toAdd) {
            const key = getKey(extension)
            if (!extensionsNew[key]) {
              const defaults = Object.fromEntries((extension.settings || []).map(setting => [setting.key, setting.default ?? null]))
              extensionsNew[key] = { enabled: false, settings: defaults }
            }
          }
          return { ...value, extensionsNew }
        })
      } finally {
        this.#skipSourceUpdateCheck = false
      }
      if (readyUpdates.length) {
        toast.success(`Updated ${readyUpdates.length} extension${readyUpdates.length > 1 ? 's' : ''}`, {
          description: readyUpdates.map(({ oldId }) => currentExtensions[oldId]?.name || oldId).join(', '),
          duration: 8_000
        })
      }
      if (confirmedMissing.length) {
        toast.success(`Removed ${confirmedMissing.length} unavailable extension${confirmedMissing.length > 1 ? 's' : ''}`, {
          description: confirmedMissing.map(oldId => currentExtensions[oldId]?.name || oldId).join(', '),
          duration: 8_000
        })
      }
      if (toAdd.length) {
        toast.success(`Added ${toAdd.length} new extension${toAdd.length > 1 ? 's' : ''}`, {
          description: toAdd.map(extension => extension.name || extension.id).join(', '),
          duration: 10_000
        })
      }
      return true
    } catch (error) {
      await printError('Extension update check failed', 'The previously cached version will be used if available', error)
      return false
    }
  }

  /**
   * Checks if a URL points to a private or local network address.
   * Blocks non-HTTP protocols, private IP ranges, and hostnames without a valid public TLD.
   *
   * @param {string} url The URL to check.
   * @returns {boolean} True if the URL is private or local, false otherwise.
   */
  isPrivateOrLocal(url) {
    try {
      const { hostname, protocol } = new URL(url)
      if (protocol !== 'http:' && protocol !== 'https:') return true
      const cleanHostname = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
      if (is_ip_private(cleanHostname)) return true
      const { publicSuffix } = parse(cleanHostname)
      return !publicSuffix
    } catch {
      return true
    }
  }

  /**
   * Handles proxied network requests from workers (Android CORS workaround).
   *
   * @param {MessageEvent} event Message from the worker.
   * @param {Worker} worker The worker sending the request.
   */
  async portMessage(event, worker) {
    const { type, requestId, url, options } = event.data || {}
    if (type !== 'FETCH' || !url) return
    if (this.isPrivateOrLocal(url)) {
      worker.postMessage({
        type: 'RESULT',
        requestId,
        error: 'Access denied: requests to private or local network addresses are not permitted.'
      })
      return
    }

    try {
      const response = await fetch(url, {
        method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(options?.method?.toUpperCase()) ? options.method.toUpperCase() : 'GET',
        headers: options?.headers || {},
        body: options?.body
      })

      if (this.isPrivateOrLocal(response.url)) {
        worker.postMessage({
          type: 'RESULT',
          requestId,
          error: 'Access denied: request was redirected to a private or local network address.'
        })
        return
      }

      const text = await response.text()
      let json
      try { json = JSON.parse(text) } catch { json = {} }
      worker.postMessage({ type: 'RESULT', requestId, ok: response.ok, status: response.status, text, json })
    } catch (error) {
      worker.postMessage({ type: 'RESULT', requestId, error: error.message || 'unknown error' })
    }
  }

  /**
   * Validates required manifest values, supported extension types, and optional settings before installation or reconciliation.
   *
   * @param {object} config The extension config object.
   * @returns {boolean} True if valid, false otherwise.
   */
  validateConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return false
    if (!['id', 'name', 'version', 'type'].every(prop => typeof config[prop] === 'string' && config[prop].trim().length > 0)) return false
    if (!['torrent', 'subtitle'].includes(config.type)) return false
    for (const prop of ['main', 'update']) {
      const urls = Array.isArray(config[prop]) ? config[prop] : [config[prop]]
      if (!urls.length || !urls.every(url => typeof url === 'string' && url.trim().length > 0)) return false
    }
    if ('locale' in config && (typeof config.locale !== 'string' || !config.locale.trim())) return false
    if ('settings' in config && !Array.isArray(config.settings)) return false
    if (Array.isArray(config.settings)) {
      return config.settings.every(setting => {
        if (!setting || typeof setting !== 'object' || Array.isArray(setting)) return false
        if (!['key', 'label', 'type'].every(prop => typeof setting[prop] === 'string' && setting[prop].trim().length > 0)) return false
        if (!['text', 'toggle', 'dropdown', 'multiselect'].includes(setting.type)) return false
        if (['dropdown', 'multiselect'].includes(setting.type)) {
          if (!Array.isArray(setting.options) || !setting.options.length) return false
          if (!setting.options.every(option => option && ['label', 'value'].every(prop => typeof option[prop] === 'string' && option[prop].trim().length > 0))) return false
          const validValues = setting.options.map(option => option.value)
          if ('default' in setting) {
            if (setting.type === 'dropdown') {
              if (!validValues.includes(setting.default)) return false
            } else if (setting.type === 'multiselect') {
              if (!Array.isArray(setting.default) || !setting.default.every(value => validValues.includes(value))) return false
            }
          }
        }
        if ('default' in setting) {
          if (setting.type === 'text' && typeof setting.default !== 'string') return false
          if (setting.type === 'toggle' && typeof setting.default !== 'boolean') return false
        }
        return true
      })
    }
    return true
  }
}

/** @type {ExtensionManager} Global extension manager instance. */
export const extensionManager = new ExtensionManager()
