import { getRandomInt, createDeferred } from '@/modules/util.js'
import { status, printError } from '@/modules/networking.js'
import is_ip_private from '@rockinchaos/private-ip'
import { cache, caches } from '@/modules/cache.js'
import { settings } from '@/modules/settings.js'
import { SUPPORTS } from '@/modules/support.js'
import { writable } from 'simple-store-svelte'
import { toast } from '@/modules/lib/toast.js'
import { wrap } from 'comlink'
import { parse } from 'tldts'
import Debug from 'debug'
const debug = Debug('ui:extension-manager')

/** @type {RegExp} */
export const CUSTOM_SCHEMES = /^(gh|npm):/
/** @type {RegExp} */
export const VALID_SCHEMES = /^(https?:|gh:|npm:|file:|extension:)/

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
 * Creates and returns a new Web Worker instance for the given extension source.
 *
 * @param {object} source The extension source object.
 * @returns {Worker} The created worker instance.
 */
function createWorker(source) {
  return new Worker(new URL('@/modules/extensions/worker.js', import.meta.url), { type: 'module', name: getKey(source) })
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
 * @param {string} urls The manifest URLs or file path.
 * @param {boolean} updateCheck If the reason for getting the manifest is to check for updates.
 * @returns {Promise<object[]|null>} A parsed manifest array or null on error.
 */
async function getManifest(urls, updateCheck = false) {
  for (const url of [urls].flat()) {
    try {
      if (url.startsWith('http')) return resolveUrl(await (await fetch(url)).json(), url)
      if (isLocalPath(url) || url.startsWith('file:') || url.startsWith('extension:')) {
        const localeURL = (url.startsWith('extension:') ? url.replace(/^extension:/, 'file:') : url.startsWith('file:') ? url.replace(/^file:(?!\/{3})/, 'file:///') : `file:///${url.replace(/\\/g, '/')}`).replace(/^file:\/+/, 'file:///')
        const manifest = await (await fetch(localeURL + (!/\.json(\?|$)/i.test(localeURL) ? `${localeURL.endsWith('/') ? '' : '/'}index.json` : ''))).json()
        const basePath = url.replace(/^extension:/, '').replace(/^file:(?!\/{3})/, '').replace(/^file:\/+/, '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/[^/]+\.json$/, '')
        for (const source of manifest) {
          if (source?.id) source.locale = `extension://${basePath.endsWith('/') ? basePath.slice(0, -1) : basePath}`
        }
        return resolveUrl(manifest, url)
      }
      const {pathname, protocol} = new URL(url)
      if (protocol !== 'gh:' && protocol !== 'npm:') throw new Error(`Unknown protocol for source, expected: 'gh:', 'npm:', 'file:', 'extension:', or 'http(s)'`)
      const basePath = `https://esm.sh${protocol === 'gh:' ? '/gh' : ''}/${pathname}`
      const response = await fetch(/\.json(\?|$)/i.test(basePath) ? basePath : `${basePath}/index.json`)
      if (!response.ok) {
        const error = new Error(`Unable to load manifest due to a connection issue ${response.status} ${response.statusText}`)
        error.status = response.status
        throw error
      }
      return resolveUrl(await response.json(), url)
    } catch (error) {
      if (!updateCheck || !(error?.status === 429 || error?.status === 404 || error?.status === 503)) await printError('Failed to fetch Source', `Unable to load manifest for: ${url}`, error)
    }
  }
  return null
}

/**
 * Fetches the JavaScript code for a given extension from the provided URL.
 *
 * @param {string} name The extension name or ID.
 * @param {string} urls The source URLs.
 * @returns {Promise<string|null>} The fetched extension code or null on failure.
 */
async function getExtension(name, urls) {
  for (const url of [urls].flat()) {
    try {
      if (url.startsWith('http')) return await (await fetch(url)).text()
      if (url.startsWith('extension:')) return `${url}.js`
      const parsedUrl = new URL(url)
      const ghProtocol = parsedUrl.protocol === 'gh:'
      if (ghProtocol || parsedUrl.protocol === 'npm:') {
        const pathParts = parsedUrl.pathname.split('/')
        try {
          const response = await fetch(`${ghProtocol ? `https://esm.sh/gh/${pathParts[0]}/${pathParts[1]}` : `https://esm.sh/${pathParts[0]}`}/es2022/${pathParts.slice(ghProtocol ? 2 : 1).join('/')}.mjs`)
          if (!response.ok) {
            const error = new Error(`Failed to load extension code for url ${url} ${response.status} ${response.statusText}`)
            error.status = response.status
            throw error
          }
          let code = await response.text()
          if (code.includes('export * from') && code.includes('export { default } from')) {
            const match = code.match(/from\s+["']([^"']+)["']/)
            if (match && match[1]) {
              const moduleResponse = await fetch(`https://esm.sh${match[1]}`)
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
  /** @type {{promise: Promise<boolean>, resolve: (function(boolean): void)}} */
  whenReady = createDeferred()
  /** @type {Map<string, Promise<void>>} */
  loadingExtensions = new Map()

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
          this.updateExtensions(newSources, cache.getEntry(caches.EXTENSIONS, 'repositorySources') || {}).then(update => this.loadExtensions(cache.getEntry(caches.EXTENSIONS, 'extensionSources') ?? newSources, update)).catch(error => {
            printError('Failed to Update Extensions', 'Unable to check for updates or update extensions.', error)
            return this.loadExtensions(cache.getEntry(caches.EXTENSIONS, 'extensionSources') ?? newSources, false)
          })
        }
      }
    })

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
      }
      if (value === 'offline' || value === 'online') _status = value
    })
  }

  /**
   * Periodically checks for extension and source repository updates, reloading anything that changed.
   * Skips silently if offline or no extensions are installed yet.
   *
   * @returns {Promise<void>}
   */
  async checkForUpdates() {
    if (status.value === 'offline') return
    const extensionSources = cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}
    if (!Object.keys(extensionSources).length) {
      debug('Skipping periodic update check, no extensions installed')
    } else {
      debug('Running periodic extension update check...')
      try {
        const repositorySources = cache.getEntry(caches.EXTENSIONS, 'repositorySources') || {}
        const updated = await this.updateExtensions(extensionSources, repositorySources)
        if (updated) {
          debug('Periodic update check found changes, reloading affected extensions...')
          await this.loadExtensions(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}, true)
        } else {
          debug('Periodic update check completed, no changes found')
        }
      } catch (error) {
        await printError('Failed to check for extension updates', 'The periodic update check failed', error)
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
    const newCode = await getExtension(extension?.name || extension?.id, [extension?.main].flat().map(main => !main || VALID_SCHEMES.test(main) ? main : `${extension?.locale || [extension?.update].flat()[0]}/${main}`))
    if (this.whenReady !== generation) {
      worker.terminate()
    } else if (newCode && typeof newCode === 'string' && newCode.trim().length > 0) {
      if (!extension.locale) {
        await cache.cacheEntry(caches.EXTENSIONS, key, { mappings: true }, newCode, Date.now() + getRandomInt(7, 14) * 24 * 60 * 60 * 1_000)
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
    await this.loadExtensions({ [key]: extension }, false)
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
        cache.deleteEntry(caches.EXTENSIONS, _key).catch(error => debug('Failed to delete cache entry for removed source:', error))
      }
    }
    const removedKeys = Object.keys(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}).filter(key => !(key in extensionSources))
    cache.setEntry(caches.EXTENSIONS, 'extensionSources', extensionSources)
    settings.update(value => {
      const extensionsNew = { ...value.extensionsNew }
      for (const _key of removedKeys) delete extensionsNew[_key]
      return { ...value, extensionsNew }
    })
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
   * @param {boolean} update Whether this load is an update pass.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   */
  async loadExtensions(extensions, update) {
    const generation = this.whenReady
    const extensionIds = Object.keys(extensions || {})
    if (!extensionIds?.length) {
      this.whenReady.resolve(true)
      return false
    }
    const modules = !update ? Object.fromEntries(await Promise.all(extensionIds.map(async (id) => {
      try {
        const cachedModule = await cache.cachedEntry(caches.EXTENSIONS, getKey(extensions[id]), true)
        if (!cachedModule || (typeof cachedModule === 'string' && cachedModule.trim().length === 0)) {
          debug(`Cached module for ${id} is invalid, will refetch`)
          return null
        }
        return [id, cachedModule]
      } catch (error) {
        debug(`Error reading cache for ${id}:`, error)
        return null
      }
    })).then(results => results.flatMap(result => result ? [result] : []))) : {}

    const loadWorkers = Promise.allSettled(extensionIds.map(async (key) => {
      const loadingPromise = (async () => {
        if (!settings.value.extensionsNew[key]?.enabled) return
        if (!modules[key]) {
          const extension = extensions[key]
          const newCode = await getExtension(extension?.name || extension?.id, [extension?.main].flat().map(main => !main || VALID_SCHEMES.test(main) ? main : `${extension?.locale || [extension?.update].flat()[0]}/${main}`))
          if (newCode && typeof newCode === 'string' && newCode.trim().length > 0) {
            if (!extension.locale) {
              modules[key] = await cache.cacheEntry(caches.EXTENSIONS, key, { mappings: true }, newCode, Date.now() + getRandomInt(7, 14) * 24 * 60 * 60 * 1_000)
              if (!modules[key]) {
                debug(`Cache write failed for ${key}, using code directly`)
                modules[key] = newCode
              }
            } else modules[key] = newCode
          } else {
            debug(`Failed to fetch extension ${key}, attempting to use cached version`)
            modules[key] = await cache.cachedEntry(caches.EXTENSIONS, key, true)
            if (!modules[key] || (typeof modules[key] === 'string' && modules[key].trim().length === 0)) {
              debug(`No valid cache fallback for ${key}, skipping extension`)
              await cache.deleteEntry(caches.EXTENSIONS, key).catch(error => debug('Failed to delete empty cache entry:', error))
              return
            }
          }
          if (!modules[key]) {
            debug(`No valid module code for ${key}, skipping`)
            return
          }
        }

        if (!this.activeWorkers.value[key]) {
          try {
            const extension = extensions[key]
            const worker = createWorker(extension)
            if (SUPPORTS.isAndroid) worker.onmessage = async (event) => this.portMessage(event, worker) // hacky Android workaround for Access-Control-Allow-Origin error.
            try {
              /** @type {RemoteObject<Promise<comlink.Remote<import('@/modules/extensions/worker.js').Worker>>> & ProxyMethods} */
              const remoteWorker = await wrap(worker)
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
            this.#pendingWorkers.delete(key)
          }
        }
      })()
      this.loadingExtensions.set(key, loadingPromise)
      await loadingPromise.finally(() => this.loadingExtensions.delete(key))
    })).catch((error) => printError('Unexpected error initializing extensions', error.message, error))
    this.whenReady.resolve(true)
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
   * Checks for newer versions of existing extensions and updates them.
   *
   * @param {object} currentExtensions Currently installed extensions.
   * @param {object} repositorySources Currently added extension source repositories.
   * @returns {Promise<boolean>} True if updates were found, false otherwise.
   */
  async updateExtensions(currentExtensions, repositorySources) {
    const extensionIds = Object.keys(currentExtensions || {})
    if (!extensionIds?.length || status.value === 'offline') return false
    try {
      // Check for source repository updates
      const sourceUrls = Object.keys(repositorySources || {})
      if (sourceUrls.length) {
        debug(`Checking ${sourceUrls.length} stored source repositories for updates...`)
        const newSourceCounts = await Promise.all(sourceUrls.map(url => this.updateSources(url)))
        const totalNew = newSourceCounts.reduce((sum, count) => sum + count, 0)
        if (totalNew > 0) {
          toast.success(`Updated source repositor${sourceUrls.length > 1 ? 'ies' : 'y'}`, {
            description: `${totalNew} new extension source${totalNew > 1 ? 's' : ''} available. Go to the Sources tab on the Extensions settings page to add them.`,
            duration: 15_000
          })
        }
      }

      // Check for extension source updates
      const updateUrls = [...new Set(Object.values(currentExtensions).map(extension => extension?.locale || extension?.update).filter(Boolean))]
      debug(`Checking ${extensionIds.length} installed extension(s) for updates...`)
      const latestManifests = await Promise.all(updateUrls.map(url => getManifest(url, true)))
      const validManifests = latestManifests.filter(manifest => manifest != null && Array.isArray(manifest))
      if (validManifests.length === 0) {
        debug('No valid manifests retrieved during update check, skipping update')
        return false
      }
      const latestValid = validManifests.flat().filter(config => this.validateConfig(config))
      const toUpdate = []
      for (const oldId of extensionIds) {
        const current = currentExtensions[oldId]
        if (!current) continue
        const latest = latestValid.find(config => config.id === current.id)
        if (!latest) continue
        if (latest.version !== current.version || JSON.stringify([latest.update].flat()) !== JSON.stringify([current.update].flat())) toUpdate.push({ oldId, latest })
      }
      if (toUpdate.length) {
        debug(`Found ${toUpdate.length} extensions to update:`, toUpdate.map(update => update.oldId))
        toUpdate.forEach(({ oldId }) => {
          try {
            if (this.#pendingWorkers.has(oldId)) {
              this.#pendingWorkers.get(oldId).terminate()
              this.#pendingWorkers.delete(oldId)
            }
            if (this.activeWorkers.value[oldId]) {
              this.activeWorkers.value[oldId].terminate()
              this.activeWorkers.update(value => {
                const { [oldId]: _, ...rest } = value
                return rest
              })
            }
            if (this.inactiveWorkers.value[oldId]) {
              this.inactiveWorkers.value[oldId].terminate()
              this.inactiveWorkers.update(value => {
                const { [oldId]: _, ...rest } = value
                return rest
              })
            }
          } catch (error) {
            debug('Failed to terminate active workers during update')
          }
        })
        const extensionSources = { ...(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}) }
        toUpdate.forEach(({ oldId, latest }) => {
          const newId = getKey(latest)
          extensionSources[newId] = latest
          if (newId !== oldId) delete extensionSources[oldId]
        })
        cache.setEntry(caches.EXTENSIONS, 'extensionSources', extensionSources)
        settings.update((value) => {
          const extensionsNew = { ...value.extensionsNew }
          toUpdate.forEach(({ oldId, latest }) => {
            const newId = getKey(latest)
            if (newId !== oldId) {
              if (extensionsNew[oldId]) {
                extensionsNew[newId] = extensionsNew[oldId]
                delete extensionsNew[oldId]
              }
            }
          })
          return { ...value, extensionsNew }
        })
        debug(`Successfully updated ${toUpdate.length} extension${toUpdate.length > 1 ? 's' : ''}`, toUpdate.map(update => update.oldId))
        toast.success(`Updated ${toUpdate.length} extension${toUpdate.length > 1 ? 's' : ''}`, {
          description: toUpdate.map(update => currentExtensions[update.oldId]?.name || update.oldId).join(', '),
          duration: 8_000
        })
        return true
      }

      // Register new extensions added to the manifest since last update
      const existingIds = new Set(Object.values(currentExtensions).map(extension => extension.id))
      const toAdd = latestValid.filter(config => !existingIds.has(config.id))
      if (toAdd.length) {
        debug(`Found ${toAdd.length} new extensions to add:`, toAdd.map(extension => extension.id))
        const extensionSources = { ...(cache.getEntry(caches.EXTENSIONS, 'extensionSources') || {}) }
        toAdd.forEach(extension => {
          const key = getKey(extension)
          extensionSources[key] = extension
        })
        cache.setEntry(caches.EXTENSIONS, 'extensionSources', extensionSources)
        settings.update((value) => {
          const extensionsNew = { ...value.extensionsNew }
          toAdd.forEach(extension => {
            const key = getKey(extension)
            if (!extensionsNew[key]) {
              const defaults = Object.fromEntries((extension.settings || []).map(settings => [settings.key, settings.default ?? null]))
              extensionsNew[key] = { enabled: false, settings: defaults }
            }
          })
          return { ...value, extensionsNew }
        })
        toast.success(`Added ${toAdd.length} new extension${toAdd.length > 1 ? 's' : ''}`, {
          description: toAdd.map(extension => extension.name || extension.id).join(', '),
          duration: 10_000
        })
        return true
      }
      return false
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
   * Validates that an extension configuration object has the required fields.
   *
   * @param {object} config The extension config object.
   * @returns {boolean} True if valid, false otherwise.
   */
  validateConfig(config) {
    if (!config || typeof config !== 'object') return false
    if (!['id', 'name', 'version', 'main', 'update', 'type'].every(prop => prop in config)) return false
    if (typeof config.update !== 'string' && !(Array.isArray(config.update) && config.update.every(url => typeof url === 'string'))) return false
    if (Array.isArray(config.settings)) {
      return config.settings.every(setting => {
        if (!setting.key || !setting.label || !setting.type) return false
        if (!['text', 'toggle', 'dropdown', 'multiselect'].includes(setting.type)) return false
        if (['dropdown', 'multiselect'].includes(setting.type)) {
          if (!Array.isArray(setting.options) || !setting.options.length) return false
          if (!setting.options.every(option => option.label && option.value)) return false
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
