import { settings } from '@/modules/settings.js'
import { cache, caches } from '@/modules/cache.js'
import { getRandomInt, createDeferred } from '@/modules/util.js'
import { status, printError } from '@/modules/networking.js'
import { SUPPORTS } from '@/modules/support.js'
import { toast } from 'svelte-sonner'
import { wrap } from 'comlink'
import Debug from 'debug'
const debug = Debug('ui:manager')

/**
 * Creates and returns a new Web Worker instance for the given extension source.
 * @param {object} source The extension source object.
 * @returns {Worker} The created worker instance.
 */
function createWorker(source) {
  return new Worker(new URL('@/modules/extensions/worker.js', import.meta.url), { type: 'module', name: (source.locale || (source.update + '/')) + source.id })
}

/**
 * Fetches and validates an extension manifest from a given URL.
 * Supports 'gh:', 'npm:', 'file:', 'extension:', and 'http(s)' protocols.
 * @param {string} url The manifest URL or file path.
 * @param {boolean} updateCheck If the reason for getting the manifest is to check for updates.
 * @returns {Promise<object[]|null>} A parsed manifest array or null on error.
 */
async function getManifest(url, updateCheck = false) {
  try {
    if (url.startsWith('http')) return await (await fetch(url)).json()
    if (/^[A-Z]:/.test(url) || url.startsWith('file:') || url.startsWith('extension:')) {
      const localeURL = (url.startsWith('extension:') ? url.replace(/^extension:/, 'file:') : url.startsWith('file:') ? url.replace(/^file:(?!\/{3})/, 'file:///') : `file:///${url.replace(/\\/g, '/')}`).replace(/^file:\/+/, 'file:///')
      const manifest = await (await fetch(localeURL + (!/\.json(\?|$)/i.test(localeURL) ? `${localeURL.endsWith('/') ? '' : '/'}index.json` : ''))).json()
      const basePath = url.replace(/^extension:/, '').replace(/^file:(?!\/{3})/, '').replace(/^file:\/+/, '').replace(/\\/g, '/').replace(/^[\/]+/, '').replace(/[^/]+\.json$/, '')
      for (const source of manifest) {
        if (source?.id) source.locale = `extension://${basePath}${basePath.endsWith('/') ? '' : '/'}`
      }
      return manifest
    }
    const { pathname, protocol } = new URL(url)
    if (protocol !== 'gh:' && protocol !== 'npm:') throw new Error(`Unknown protocol for source, expected: 'gh:', 'npm:', 'file:', 'extension:', or 'http(s)'`)
    const basePath = `https://esm.sh${protocol === 'gh:' ? '/gh' : ''}/${pathname}`
    const response = await fetch(/\.json(\?|$)/i.test(basePath) ? basePath : `${basePath}/index.json`)
    if (!response.ok) throw new Error(`Unable to load manifest due to a connection issue ${response.status} ${response.statusText}`)
    const manifest = await response.json()
    if (!Array.isArray(manifest)) throw new Error('Manifest is not an array')
    return manifest
  } catch (error) {
    if (!updateCheck || !(error?.status === 429 || error?.status === 503)) await printError('Failed to fetch Source', `Unable to load manifest for: ${url}`, error)
    return null
  }
}

/**
 * Fetches the JavaScript code for a given extension from the provided URL.
 * @param {string} name The extension name or ID.
 * @param {string} url The source URL.
 * @returns {Promise<string|null>} The fetched extension code or null on failure.
 */
async function getExtension(name, url) {
  try {
    if (url.startsWith('http')) return await (await fetch(url)).json()
    if (url.startsWith('extension:')) return `${url}.js`
    const parsedUrl = new URL(url)
    const ghProtocol = parsedUrl.protocol === 'gh:'
    if (ghProtocol || parsedUrl.protocol === 'npm:') {
      const pathParts = parsedUrl.pathname.split('/')
      try {
        const response = await fetch(`${ghProtocol ? `https://esm.sh/gh/${pathParts[0]}/${pathParts[1]}` : `https://esm.sh/${pathParts[0]}`}/es2022/${pathParts.slice(ghProtocol ? 2 : 1).join('/')}.mjs`)
        if (!response.ok) throw new Error(`Failed to load extension code for url ${url} ${response.status} ${response.statusText}`)
        const code = await response.text()
        if (!code || code.trim().length === 0) throw new Error(`Failed to load extension code for url ${url}, extension code is empty`)
        return code
      } catch (error) {
        await printError(`Failed to load extension ${name}`, 'Unable to fetch extension code', error)
        return null
      }
    }
    throw new Error(`Unknown protocol for extension, expected: 'gh:', 'npm:', 'file:', 'extension:', or 'http(s)'`)
  } catch (error) {
    await printError('Failed to fetch Extension', `Unable to load extension for: ${name} ${url}`, error)
    return null
  }
}

/** Manages loading, caching, and lifecycle of extensions and their workers. */
class ExtensionManager {
  /** @type {Map<string, Promise<any>>} */
  pending = new Map()
  /** @type {Record<string, import('comlink').Remote<import('@/modules/extensions/worker.js').Worker>>} */
  activeWorkers = {}
  /** @type {Record<string, import('comlink').Remote<import('@/modules/extensions/worker.js').Worker>>} */
  inactiveWorkers = {}
  /** @type {{promise: Promise<boolean>, resolve: (function(boolean): void)}} */
  whenReady = createDeferred()
  /** @type {Map<string, Promise<void>>} */
  loadingExtensions = new Map()

  constructor() {
    let sources = null
    debug('Loading extensions from sources...')
    settings.subscribe(value => {
      const newSources = value.sourcesNew || {}
      const sourcesOld = Object.keys(sources || {})
      const sourcesNew = Object.keys(newSources)
      if ((!sourcesOld?.length && !sourcesNew?.length) || !(sourcesOld.length === sourcesNew.length && sourcesOld.every(key => sourcesNew.includes(key)))) {
        if (sourcesOld.length && !sourcesNew.length) { sources = structuredClone(newSources); return }
        if (!sources && !sourcesNew.length) { this.whenReady.resolve(true); sources = {} }
        else if (sourcesNew.length) {
          sources = structuredClone(newSources)
          this.whenReady = createDeferred()
          this.updateExtensions(newSources, value.extensionSources).then(update => this.loadExtensions(settings.value.sourcesNew ?? newSources, update)).catch(error => {
            printError('Failed to Update Extensions', 'Unable to check for updates or update extensions.', error)
            return this.loadExtensions(settings.value.sourcesNew ?? newSources, false)
          })
          debug('Found new sources and updated...', JSON.stringify(newSources))
        }
      }
    })

    window.addEventListener('online', async () => {
      const tasks = Object.entries(extensionManager.inactiveWorkers).map(async ([key, worker]) => {
        if (extensionManager.activeWorkers[key]) return
        try {
          if (!(await worker.validate())) throw new Error('The content source appears to be unreachable.')
          extensionManager.activeWorkers[key] = worker
          delete extensionManager.inactiveWorkers[key]
          settings.set(settings.value)
        } catch (error) {
          if (extensionManager.inactiveWorkers[key]) worker.terminate()
          await printError(`Failed to load extension ${key}`, 'Validation has failed', error)
        }
      })
      await Promise.all(tasks)
    })
  }

  /**
   * Checks if the keyed extension source exists in the active workers.
   * @param {string} key The identifier for the extension worker.
   * @returns {import('comlink').Remote<import('@/modules/extensions/worker.js').Worker>} The active worker instance, or undefined if not found.
   */
  isActive(key) {
    return this.activeWorkers[key]
  }

  /**
   * Checks if the keyed extension source exists in the inactive workers.
   * @param {string} key The identifier for the extension worker.
   * @returns {import('comlink').Remote<import('@/modules/extensions/worker.js').Worker>} The inactive worker instance, or undefined if not found.
   */
  isInactive(key) {
    return this.inactiveWorkers[key]
  }

  /**
   * Validates and activates an inactive extension worker by key.
   * @param {string} key The identifier for the extension worker to validate.
   * @returns {Promise<void>}
   */
  async validateExtension(key) {
    const inactiveWorker = this.inactiveWorkers[key]
    if (!inactiveWorker) return
    try {
      delete this.inactiveWorkers[key]
      if (!(await inactiveWorker.validate())) throw new Error('The content source appears to be unreachable.')
      this.activeWorkers[key] = inactiveWorker
      settings.set(settings.value)
    } catch (error) {
      if (!this.activeWorkers[key]) this.inactiveWorkers[key] = inactiveWorker
      await printError(`Failed to load extension ${key}`, 'Validation has failed', error)
    }
  }

  /** Terminates all workers and reloads extensions from settings. */
  reloadExtensions() {
    Object.values(this.activeWorkers).forEach(worker => worker.terminate())
    Object.values(this.inactiveWorkers).forEach(worker => worker.terminate())
    this.activeWorkers = {}
    this.whenReady = createDeferred()
    this.loadExtensions(settings.value.sourcesNew)
  }

  /**
   * Removes a specific extension source and clears related cache entries.
   * @param {string} extensionId The extension identifier.
   */
  async removeSource(extensionId) {
    settings.update((value) => {
      const sourcesNew = { ...value.sourcesNew }
      const extensionsNew = { ...value.extensionsNew }
      for (const [_key, source] of Object.entries(sourcesNew)) {
        if (source.update === extensionId) {
          const key = (source.locale || (source.update + '/')) + source.id
          if (this.activeWorkers[key]) {
            this.activeWorkers[key].terminate()
            delete this.activeWorkers[key]
          } else if (this.inactiveWorkers[key]) {
            this.inactiveWorkers[key].terminate()
            delete this.inactiveWorkers[key]
          }
          delete sourcesNew[_key]
          delete extensionsNew[_key]
          cache.deleteEntry(caches.EXTENSIONS, _key).catch(error => debug('Failed to delete cache entry for removed source:', error))
        }
      }
      return { ...value, sourcesNew, extensionsNew }
    })
  }

  /**
   * Adds a new extension source and validates its manifest.
   * @param {string} url The source URL.
   * @returns {Promise<string|void>} A status message or undefined.
   */
  async addSource(url) {
    if (this.pending.has(url)) return this.pending.get(url)
    const promise = (async () => {
      const config = await getManifest(url)
      if (!config) {
        await printError('Failed to load source', `${url}: ${status.value !== 'offline' ? 'the source is not valid.' : 'no network connection!'}`, { message: `Failed to load source: ${url} ${status.value !== 'offline' ? 'the source is not valid.' : 'no network connection!'} ${JSON.stringify(config)}`})
        this.pending.delete(url)
        return `Failed to load extension(s) from the provided source '${url}': ${status.value !== 'offline' ? 'the source is not valid.' : 'no network connection!'}`
      }
      if (config.every(entry => entry?.main && !entry?.update)) { // source repository manifests
        const current = settings.value.extensionSources?.[url]
        if (JSON.stringify(current) !== JSON.stringify(config)) {
          settings.update(value => ({ ...value, extensionSources: { ...(value.extensionSources || {}), [url]: config } }))
          debug(`Stored new source repository: ${url}`)
        } else {
          debug(`Source repository unchanged: ${url}`)
          this.pending.delete(url)
          return `Source repository unchanged: ${url}`
        }
      } else { // extension manifests
        for (const extension of config) {
          if (!this.validateConfig(extension)) {
            await printError('Invalid extension format', `Invalid extension config: ${url}`, {message: `Invalid extension config: ${url} ${JSON.stringify(extension)}`})
            this.pending.delete(url)
            return `Failed to load extension(s) from '${url}': invalid extension format.`
          }
        }
        settings.update(value => {
          const sourcesNew = {...value.sourcesNew}
          const extensionsNew = {...value.extensionsNew}
          config.forEach(extension => {
            const key = (extension.locale || (extension.update + '/')) + extension.id
            sourcesNew[key] = {...extension, trusted: !!extension.id.match(new RegExp(atob('bnlhYQ=='), 'i')) || !!extension.id.match(new RegExp(atob('c3VrZWJlaQ=='), 'i'))}
            if (!extensionsNew[key]) extensionsNew[key] = {enabled: true}
          })
          return {...value, sourcesNew, extensionsNew}
        })
      }
      this.pending.delete(url)
    })()
    this.pending.set(url, promise)
    return promise
  }

  /**
   * Gets a promise that resolves when a specific extension is ready (or rejects if it fails)
   * @param {string} key The extension key
   * @returns {Promise<import('comlink').Remote<import('@/modules/extensions/worker.js').Worker>|null>}
   */
  async whenExtensionReady(key) {
    if (this.activeWorkers[key]) return this.activeWorkers[key]
    if (this.inactiveWorkers[key]) return null
    if (this.loadingExtensions.has(key)) {
      await this.loadingExtensions.get(key)
      return this.activeWorkers[key] || null
    }
    return null
  }

  /**
   * Loads extension modules from cache or network and starts workers.
   * @param {object} extensions Extension metadata.
   * @param {boolean} update Whether this load is an update pass.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   */
  async loadExtensions(extensions, update) {
    const extensionIds = Object.keys(extensions || {})
    if (!extensionIds?.length) return false
    const modules = !update ? Object.fromEntries(await Promise.all(extensionIds.map(async (id) => {
      try {
        const cachedModule = await cache.cachedEntry(caches.EXTENSIONS, (extensions[id]?.locale || (extensions[id]?.update + '/')) + extensions[id]?.id, true)
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
        if (!modules[key]) {
          const extension = extensions[key]
          let newCode = await getExtension(extension?.name || extension?.id, (extension?.locale || (extension?.update + '/')) + extension?.main)
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

        if (!this.activeWorkers[key]) {
          try {
            const extension = extensions[key]
            const worker = createWorker(extension)
            if (SUPPORTS.isAndroid && extension.trusted) worker.onmessage = async (event) => this.portMessage(event, worker) // hacky Android workaround for Access-Control-Allow-Origin error.
            try {
              /** @type {comlink.Remote<import('@/modules/extensions/worker.js').Worker>} */
              const remoteWorker = await wrap(worker)
              const initialize = await remoteWorker.initialize(key, modules[key], { bypassCORS: SUPPORTS.isAndroid && extension.trusted})
              if (!initialize.validated) {
                this.inactiveWorkers[key] = remoteWorker
                settings.set(settings.value)
                throw new Error(initialize.error)
              }
              if (this.activeWorkers[key]) {
                this.activeWorkers[key].terminate()
                delete this.activeWorkers[key]
              } else if (this.inactiveWorkers[key]) {
                this.inactiveWorkers[key].terminate()
                delete this.inactiveWorkers[key]
              }
              this.activeWorkers[key] = remoteWorker
              settings.set(settings.value)
            } catch (error) {
              if (!this.inactiveWorkers[key]) worker.terminate()
              throw new Error(error)
            }
          } catch (error) {
            await printError(`Failed to load extension ${key}`, 'Initialization has failed', error)
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
   *
   * @param {string} url The URL of the source repository.
   * @returns {Promise<boolean>} True if updated, false if unchanged or failed.
   */
  async updateSources(url) {
    try {
      const repositoryManifest = await getManifest(url, true)
      if (!repositoryManifest || !Array.isArray(repositoryManifest) || !repositoryManifest.every(entry => entry?.main && !entry?.update)) return false
      if (JSON.stringify(settings.value.extensionSources?.[url]) !== JSON.stringify(repositoryManifest)) {
        settings.update(value => ({ ...value,  extensionSources: { ...(value.extensionSources || {}), [url]: repositoryManifest } }))
        debug(`Source repository updated: ${url}`)
        return true
      }
      debug(`Source repository unchanged: ${url}`)
      return false
    } catch (error) {
      await printError('Failed to update Source Repository', `Unable to update repository for: ${url}`, error)
      return false
    }
  }

  /**
   * Checks for newer versions of existing extensions and updates them.
   * @param {object} currentExtensions Currently installed extensions.
   * @param {object} extensionSources Currently added extension source repositories.
   * @returns {Promise<boolean>} True if updates were found, false otherwise.
   */
  async updateExtensions(currentExtensions, extensionSources) {
    const extensionIds = Object.keys(currentExtensions || {})
    if (!extensionIds?.length) return false
    try {
      const latestManifests = await Promise.all([...new Set(Object.values(currentExtensions).map(ext => ext?.locale || ext?.update).filter(Boolean))].map(url => getManifest(url, true)))
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
        if (latest.version !== current.version || latest.update !== current.update) toUpdate.push({ oldId, latest })
      }
      if (toUpdate.length) {
        debug(`Found ${toUpdate.length} extensions to update:`, toUpdate.map(update => update.oldId))
        toUpdate.forEach(({ oldId }) => {
          try {
            if (this.activeWorkers[oldId]) {
              this.activeWorkers[oldId].terminate()
              delete this.activeWorkers[oldId]
            }
          } catch (error) {
            debug('Failed to terminate active workers during update')
          }
        })
        settings.update((value) => {
          const sourcesNew = { ...value.sourcesNew }
          const extensionsNew = { ...value.extensionsNew }
          toUpdate.forEach(({ oldId, latest }) => {
            const newId = (latest.locale || (latest.update + '/')) + latest.id
            sourcesNew[newId] = { ...latest, trusted: sourcesNew[oldId]?.trusted }
            if (newId !== oldId) {
              if (extensionsNew[oldId]) {
                extensionsNew[newId] = extensionsNew[oldId]
                delete extensionsNew[oldId]
              }
              delete sourcesNew[oldId]
            }
          })
          return { ...value, sourcesNew, extensionsNew }
        })
        debug(`Successfully updated ${toUpdate.length} extension${toUpdate.length > 1 ? 's' : ''}`, toUpdate.map(update => update.oldId))
        toast.success(`Updated ${toUpdate.length} extension${toUpdate.length > 1 ? 's' : ''}`, {
          description: toUpdate.map(update => currentExtensions[update.oldId]?.name || update.oldId).join(', '),
          duration: 8_000
        })
        return true
      }
      const sourceUrls = Object.keys(extensionSources || {})
      if (sourceUrls.length) {
        debug(`Checking ${sourceUrls.length} stored source repositories for updates...`)
        await Promise.all(sourceUrls.map(url => this.updateSources(url)))
      }
      return false
    } catch (error) {
      await printError('Extension update check failed', 'The previously cached version will be used if available', error)
      return false
    }
  }

  /**
   * Handles proxied network requests from workers (Android CORS workaround).
   * @param {MessageEvent} event Message from the worker.
   * @param {Worker} worker The worker sending the request.
   */
  async portMessage(event, worker) {
    const { type, requestId, url, options } = event.data || {}
    if (type === 'FETCH') {
      try {
        const response = await fetch(url, options)
        const text = await response.text()
        let json
        try { json = JSON.parse(text) } catch { json = {} }
        worker.postMessage({ type: 'RESULT', requestId, ok: response.ok, status: response.status, text, json })
      } catch (error) {
        worker.postMessage({ type: 'RESULT', requestId, error: error.message || 'unknown error' })
      }
    }
  }

  /**
   * Validates that an extension configuration object has the required fields.
   * @param {object} config The extension config object.
   * @returns {boolean} True if valid, false otherwise.
   */
  validateConfig(config) {
    return config && typeof config === 'object' && ['id', 'name', 'version', 'main', 'update'].every(prop => prop in config)
  }
}

/** @type {ExtensionManager} Global extension manager instance. */
export const extensionManager = new ExtensionManager()