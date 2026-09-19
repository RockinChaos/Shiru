import { generalDefaults, historyDefaults, extensionDefaults, notifyDefaults, isValidNumber, getRandomInt, generateRandomHexCode } from './util.js'
import { writable } from 'simple-store-svelte'
import equal from 'fast-deep-equal/es6'
import rfdc from 'rfdc'
import Debug from 'debug'
const debug = Debug('ui:cache')
const deepClone = rfdc({ proto: false, circles: false, ownProps: true })

/** @type {string} */
const SHARED_DB_NAME = 'shiru-shared'
/** @type {Map<string, Promise<IDBDatabase>>} */
const openDBs = new Map()
/** @type {number} */
const version = 2 // DONT TOUCH THIS
/** @type {import('simple-store-svelte').Writable<string|null>} */
export const migrationStatus = writable(null)

/** @type {number} */
const EVICTION_MAX_PER_RUN = 500
/** @type {number} */
const EVICTION_STARTUP_DELAY = 2 * 60 * 1_000
/** @type {number} */
const EVICTION_INTERVAL = 5 * 60 * 1_000

/** @type {Set<string>} */
const USER_MEDIA_FIELDS = new Set(['mediaListEntry', 'isFavourite'])
/**
 * Returns a copy of a media object with user-specific fields removed.
 *
 * @param {import('./providers/anilist/al.d.ts').Media} media
 * @returns {import('./providers/anilist/al.d.ts').Media}
 */
const stripUserFields = (media) => /** @type {import('./providers/anilist/al.d.ts').Media} */ Object.fromEntries(Object.entries(media).filter(([key]) => !USER_MEDIA_FIELDS.has(key)))

/**
 * Returns an object containing only the user-specific fields of a media object that have meaningful values.
 *
 * @param {import('./providers/anilist/al.d.ts').Media} media
 * @returns {{ mediaListEntry?: object, isFavourite?: boolean }}
 */
const extractUserFields = (media) => ({ ...(media.mediaListEntry && { mediaListEntry: media.mediaListEntry }), ...(media.isFavourite && { isFavourite: media.isFavourite }) })

/**
 * Map of user IDs to their corresponding batch writer instances.
 *
 * @type {Map<string, object>}
 */
const batchWriters = new Map()

/**
 * A collection of cache configurations used in the application.
 * Each entry represents a cache with its unique key, if its shared globally, and optional eviction params.
 *
 * @constant
 * @type {Object<string, {key: string, database?: boolean}>}
 */
export const caches = Object.freeze({
  // USER DB
  GENERAL: { key: 'general' },
  USER_LISTS: { key: 'user_lists' },
  HISTORY: { key: 'history' },
  NOTIFICATIONS: { key: 'notifications' },
  QUERY_NOTIFICATIONS: { key: 'query_notifications' },
  QUERY_FOLLOWING: { key: 'query_following', expiryOffset: 30 * 24 * 60 * 60 * 1_000, maxEntries: 2_000 }, // evict after 30 days.
  QUERY_RECOMMENDATIONS: { key: 'query_recommendations', expiryOffset: 30 * 24 * 60 * 60 * 1_000, maxEntries: 500 }, // evict after 30 days.
  // SHARED DB
  MEDIA_CACHE: { key: 'medias', shared: true, expiryOffset: 120 * 24 * 60 * 60 * 1_000, maxEntries: 10_000 }, // evict after 120 days.
  EXTENSIONS: { key: 'extensions', shared: true },
  QUERY_MAPPINGS: { key: 'query_mappings', shared: true, expiryOffset: 120 * 24 * 60 * 60 * 1_000, maxEntries: 5_000 }, // evict after 120 days.
  QUERY_COMPOUND: { key: 'query_compound', shared: true, expiryOffset: 7 * 24 * 60 * 60 * 1_000, maxEntries: 500 }, // evict after 7 days.
  QUERY_EPISODES: { key: 'query_episodes', shared: true, expiryOffset: 60 * 24 * 60 * 60 * 1_000, maxEntries: 1_000 }, // evict after 60 days.
  QUERY_SEARCH_IDS: { key: 'query_search_ids', shared: true, expiryOffset: 30 * 24 * 60 * 60 * 1_000, maxEntries: 1_000 }, // evict after 30 days.
  QUERY_SEARCH: { key: 'query_search', shared: true, expiryOffset: 30 * 24 * 60 * 60 * 1_000, maxEntries: 1_000 }, // evict after 30 days.
  QUERY_RSS: { key: 'query_rss', shared: true, expiryOffset: 30 * 24 * 60 * 60 * 1_000, maxEntries: 1_000 }, // evict after 30 days.
})

/**
 * Opens the IndexedDB database.
 *
 * @param {string} dbName The name of the database to open.
 * @returns {Promise<IDBDatabase>} A promise that resolves to the database instance.
 */
function open(dbName) {
  if (!openDBs.has(dbName)) {
    let migration = Promise.resolve()
    openDBs.set(dbName, new Promise((resolve, reject) => {
      const request = indexedDB.open(String(dbName), version)
      request.onerror = (event) => {
        openDBs.delete(dbName)
        reject(event.target.error)
      }
      request.onsuccess = async (event) => {
        await migration
        resolve(event.target.result)
      }
      request.onupgradeneeded = (event) => {
        const database = event.target.result
        const { oldVersion } = event
        const versionTx = event.target.transaction
        const isShared = dbName === SHARED_DB_NAME
        for (const { key, shared } of Object.values(caches)) {
          if (!!shared === isShared && !database.objectStoreNames.contains(key)) database.createObjectStore(key, { keyPath: 'key' })
        }
        if (oldVersion > 0 && oldVersion < version) migrationStatus.set('Getting everything ready, this may take a moment...')
        if (!isShared && oldVersion === 1) migration = UPGRADE_V1_TO_V2(database, versionTx)
      }
    }))
  }
  return openDBs.get(dbName)
}

/**
 * Loads all values from a specified cache (object store).
 *
 * @param {string} dbName The unique name of the database.
 * @param {keyof typeof caches} cache The name of the cache (object store).
 * @returns {Promise<Object<string, any>>} A promise that resolves to an array of all stored values.
 */
async function loadAll(dbName, cache) {
  try {
    const database = await open(dbName)
    const records = await readAllFrom(database, cache.key)
    return records.reduce((acc, item) => {
      acc[item.key] = item.value
      return acc
    }, {})
  } catch (error) {
    debug(`Failed to load cache ${cache.key} for database ${dbName}:`, error)
    throw error
  }
}

/**
 * Retrieves a specific value from a cache using a key.
 *
 * @param {string} dbName The unique name of the database.
 * @param {keyof typeof caches} cache The name of the cache (object store).
 * @param {string} key The key to retrieve the associated value for.
 * @returns {Promise<*>} A promise that resolves to the value associated with the key, or null if not found.
 */
async function get(dbName, cache, key) {
  const database = await open(dbName)
  const transaction = database.transaction(cache.key, 'readonly')
  const result = await wrapRequest(transaction.objectStore(cache.key).get(key))
  return result ? result.value : null
}

/**
 * Stores or updates a value in a specified cache.
 *
 * @param {string} dbName The unique name of the database.
 * @param {keyof typeof caches} cache The name of the cache (object store).
 * @param {string} key The key to associate with the value.
 * @param {*} value The value to store.
 * @returns {Promise<void>} A promise that resolves when the operation is complete.
 */
async function set(dbName, cache, key, value) {
  const database = await open(dbName)
  const transaction = database.transaction(cache.key, 'readwrite')
  await wrapRequest(transaction.objectStore(cache.key).put({ key, value }))
}

/**
 * Deletes specific keys from a specified cache.
 *
 * @param {string} dbName The unique name of the database.
 * @param {keyof typeof caches} cache The name of the cache (object store).
 * @param {string[]} keys An array of keys to delete.
 * @returns {Promise<void>} A promise that resolves when all specified keys are deleted.
 */
async function remove(dbName, cache, keys) {
  if (!keys || keys.length === 0) return
  const database = await open(dbName)
  const transaction = database.transaction(cache.key, 'readwrite')
  const objectStore = transaction.objectStore(cache.key)
  keys.forEach(key => objectStore.delete(key))
  return waitForTransaction(transaction)
}

/**
 * Clears all data from a specified cache.
 *
 * @param {string} dbName The unique name of the database.
 * @param {keyof typeof caches} cache The name of the cache (object store).
 * @returns {Promise<void>} A promise that resolves when the cache is cleared.
 */
async function reset(dbName, cache) {
  const database = await open(dbName)
  const transaction = database.transaction(cache.key, 'readwrite')
  transaction.objectStore(cache.key).clear()
  return waitForTransaction(transaction)
}

/**
 * Deletes the entire database and all caches for a user.
 *
 * @param {string} dbName The unique name of the database.
 * @returns {Promise<void>} A promise that resolves when the database is deleted.
 */
async function purge(dbName) {
  if (openDBs.has(dbName)) {
    try { (await openDBs.get(dbName)).close() } catch {}
    openDBs.delete(dbName)
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(String(dbName))
    request.onerror = (event) => reject(event.target.error)
    request.onsuccess = () => resolve()
  })
}

/**
 * Writes multiple entries into the specified IndexedDB cache in a single transaction.
 *
 * This function only updates IndexedDB. It does NOT update the in-memory cache.
 * Callers are responsible for keeping memory and disk in sync if needed.
 *
 * @param {string} dbName The unique name of the database.
 * @param {keyof typeof caches} cache The name of the cache (object store).
 * @param {Array<[string, any]>} entries An array of [key, value] pairs to insert/update.
 * @returns {Promise<void>} A promise that resolves when the transaction completes.
 */
async function putMany(dbName, cache, entries) {
  if (!entries.length) return
  const database = await open(dbName)
  const transaction = database.transaction(cache.key, 'readwrite')
  const objectStore = transaction.objectStore(cache.key)
  for (const [key, value] of entries) objectStore.put({ key, value })
  return waitForTransaction(transaction)
}

/**
 * Attempts to recover individual entries from a corrupted cache store.
 * Iterates through all keys and tries to read each one individually, collecting successful reads and logging failures.
 *
 * @param {string} dbName The unique name of the database.
 * @param {keyof typeof caches} cache The cache to recover from.
 * @returns {Promise<Object>} An object containing successfully recovered key-value pairs.
 */
async function recoverCache(dbName, cache) {
  const recovered = {}
  let corruptedKeys = []
  try {
    const database = await open(dbName)
    const transaction = database.transaction(cache.key, 'readonly')
    const objectStore = transaction.objectStore(cache.key)
    const keys = await wrapRequest(objectStore.getAllKeys())
    debug(`Recovery: Found ${keys.length} keys in ${cache.key}, attempting individual recovery...`)
    for (const key of keys) {
      try {
        const result = await wrapRequest(objectStore.get(key))
        if (!result || result.value === undefined) throw new Error('Empty or malformed entry')
        recovered[key] = result.value
        debug(`Recovery: Recovered ${cache.key}:${key}`)
      } catch (error) {
        corruptedKeys.push(key)
        debug(`Recovery: Failed to recover ${cache.key}:${key}:`, error.message)
      }
    }
    if (corruptedKeys.length > 0) debug(`Recovery: Recovered ${Object.keys(recovered).length}/${keys.length} entries from ${cache.key}. Corrupted keys:`, corruptedKeys)
    else debug(`Recovery: Successfully recovered all ${Object.keys(recovered).length} entries from ${cache.key}`)
  } catch (error) {
    debug(`Recovery: Could not access ${cache.key} for recovery:`, error)
  }
  return recovered
}

/**
 * Retrieves (or creates) a batch writer for the given user.
 *
 * @param {string} dbName The unique name of the database.
 * @returns {object} The batch writer instance associated with the user.
 */
function getBatchWriter(dbName) {
  if (!batchWriters.has(dbName)) batchWriters.set(dbName, createBatchWriter(dbName))
  return batchWriters.get(dbName)
}

/**
 * Wraps an IndexedDB transaction in a Promise.
 * Resolves when the transaction completes successfully and rejects if the transaction aborts or errors.
 *
 * @param {IDBTransaction} transaction The IndexedDB transaction to monitor.
 * @returns {Promise<void>} A promise that resolves on success, rejects on failure.
 */
function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = transaction.onerror = (error) => reject(error?.target?.error || new Error('IndexedDB transaction failed'))
  })
}

/**
 * Wraps an IndexedDB request in a Promise.
 *
 * @param {IDBRequest} request The IndexedDB request to wrap.
 * @returns {Promise<any>} A promise that resolves with request.result, rejects on error.
 */
function wrapRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Reads all entries from an object store on an existing transaction or database.
 *
 * @param {IDBTransaction|IDBDatabase} source A transaction or database to read from.
 * @param {string} storeKey The object store name.
 * @returns {Promise<Array<{key: string, value: any}>>} The raw stored records.
 */
function readAllFrom(source, storeKey) {
  const transaction = source instanceof IDBDatabase ? source.transaction(storeKey, 'readonly') : source
  return wrapRequest(transaction.objectStore(storeKey).getAll())
}

/**
 * Creates a batch writer for a given user that buffers cache writes and flushes them to IndexedDB after a delay.
 *
 * This groups multiple writes into a single IndexedDB transaction and retries failed writes by re-enqueuing them.
 *
 * @param {string} dbName The unique name of the database.
 * @param {number} [firstFlushDelay=10000] Delay in ms before the first flush before flushing writes to IndexedDB.
 * @param {number} [subsequentFlushDelay=1500] Delay in ms for subsequent flushes before flushing writes to IndexedDB.
 * @param {number} [resetDelay=5000] Delay in ms after which retry counts are reset.
 * @returns {Object} Batch writer with methods {@link enqueue}, {@link flushNow}, and {@link pendingCount}.
 */
function createBatchWriter(dbName, firstFlushDelay = 10_000, subsequentFlushDelay = 1_500, resetDelay = 5_000) {
  const pending = new Map()
  const retryMap = new Map()
  let flushTimer = null
  let flushPromise = Promise.resolve()
  let batchAt = null
  let initialFlush = true

  /**
   * Clears retry counts, allowing failed writes to retry again.
   */
  function resetRetries() {
    retryMap.clear()
  }
  setInterval(resetRetries, resetDelay).unref?.()

  /**
   * Flushes all queued writes to IndexedDB in a single transaction.
   * If an error occurs, re-enqueues the writes for retry.
   */
  async function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    batchAt = null
    initialFlush = false
    if (pending.size === 0) return
    const snapshot = Array.from(pending.entries())
    pending.clear()
    const database = await open(dbName)
    for (const [cacheKey, kvMap] of snapshot) {
      try {
        const transaction = database.transaction(cacheKey, 'readwrite')
        const store = transaction.objectStore(cacheKey)
        for (const [key, value] of kvMap.entries()) store.put({ key, value })
        await waitForTransaction(transaction)
        debug(`Flushed ${kvMap.size} entries to ${cacheKey}`)
      } catch (error) {
        debug(`Failed to flush ${cacheKey}, will retry`, error)
        for (const [key, value] of kvMap) {
          const mapKey = `${cacheKey}:${key}`
          const attempts = retryMap.get(mapKey) || 0
          if (attempts < 3) {
            retryMap.set(mapKey, attempts + 1)
            getBatchWriter(dbName).enqueue({ key: cacheKey }, key, value)
          } else debug(`Max retries reached for ${mapKey}, dropping value`)
        }
      }
    }
  }

  /**
   * Queues an immediate flush after any in-progress flush completes.
   *
   * @returns {Promise<void>} Resolves once this flush has completed.
   */
  function flushNow() {
    const nextFlush = flushPromise.then(flush)
    flushPromise = nextFlush.catch(() => {})
    return nextFlush
  }

  return {
    /**
     * Enqueues a cache entry for a specific cache and key.
     * Starts the flush timer if this is the first entry in the batch.
     *
     * @param {keyof typeof caches} cache The name of the cache (object store).
     * @param {string|number} key The key to store in the cache.
     * @param {*} value The value to store.
     */
    enqueue(cache, key, value) {
      const cacheKey = cache.key
      if (!pending.has(cacheKey)) pending.set(cacheKey, new Map())
      pending.get(cacheKey).set(String(key), value)
      if (!batchAt) {
        batchAt = Date.now()
        flushTimer = setTimeout(() => {
          flushNow().finally(() => {
            flushTimer = null
            batchAt = null
          })
        }, initialFlush ? firstFlushDelay : subsequentFlushDelay)
        flushTimer?.unref?.()
      }
    },
    /**
     * Immediately flushes all queued cache entries to IndexedDB.
     */
    async flushNow() {
      await flushNow()
    },
    /**
     * Returns the total number of queued cache entries across all caches.
     * @returns {number} Total pending cache entries.
     */
    pendingCount() {
      return [...pending.values()].reduce((n, m) => n + m.size, 0)
    }
  }
}

/**
 * Returns the updated value from a cache if it differs from the current value, otherwise returns the current value.
 *
 * @template T
 * @param {Record<string, T>} cache
 * @param {T} current
 * @param {string} [key='id'] The key to use for cache lookup.
 * @returns {T} The updated value if changed, otherwise the current value
 */
export function fromCache(cache, current, key = 'id') {
  if (!cache || !current?.[key]) return current
  const updated = cache[current[key]]
  if (!updated?.[key]) return current
  if (JSON.stringify(updated) === JSON.stringify(current)) return current
  return updated
}

/** @type {import('simple-store-svelte').Writable<Record<number, import('./providers/anilist/al.d.ts').Media>>} */
export let mediaCache

class Cache {
  /** @type {string} */
  cacheID = (JSON.parse(localStorage.getItem('ALviewer')) || JSON.parse(localStorage.getItem('MALviewer')))?.viewer?.data?.Viewer?.id || 'default'
  /** @type {import('simple-store-svelte').Writable<GeneralDefaults>} */
  general
  /** @type {import('simple-store-svelte').Writable<any>} */
  user_lists
  /** @type {import('simple-store-svelte').Writable<any>} */
  history
  /** @type {import('simple-store-svelte').Writable<NotifyDefaults>} */
  notifications
  /** @type {import('simple-store-svelte').Writable<ExtensionDefaults>} */
  extensions
  /** @type {import('simple-store-svelte').Writable<any>} */
  query_notifications
  /** @type {import('simple-store-svelte').Writable<any>} */
  query_following
  /** @type {import('simple-store-svelte').Writable<any>} */
  query_recommendations
  /** @type {import('simple-store-svelte').Writable<any>} */
  query_mappings
  /** @type {import('simple-store-svelte').Writable<any>} */
  query_compound
  /** @type {import('simple-store-svelte').Writable<any>} */
  query_episodes
  /** @type {import('simple-store-svelte').Writable<any>} */
  query_rss
  /** @type {import('simple-store-svelte').Writable<any>} */
  query_search
  /** @type {import('simple-store-svelte').Writable<any>} */
  query_search_ids
  /** @type {Map<string, any>} */
  #pending = new Map()
  /** @type {import('simple-store-svelte').Writable<string>} */
  status
  /** @type {PageStore} */
  page
  /** @type {AnilistClient} */
  anilistClient

  /** @type {Array<() => void>} */
  subscribers = []
  /** @type {Promise<void>} A promise that resolves when the cache has been fully initialized. */
  isReady

  constructor() {
    this.isReady = this.#initialize()
  }

  /**
   * Returns the database name for the given cache, shared DB for shared caches, user DB otherwise.
   *
   * @param {typeof caches[keyof typeof caches]} cache
   * @returns {string}
   */
  #getDatabase(cache) {
    return cache.shared ? SHARED_DB_NAME : this.cacheID
  }

  /**
   * Runs a full eviction pass across all configured caches, respecting the per-run deletion budget.
   * Handles nested query stores, flat IDB caches, and the media cache separately.
   *
   * @param {Map<string, Object>} cacheMap
   */
  async #runEviction(cacheMap) {
    const now = Date.now()
    let totalPurged = 0
    const purgedByCacheKey = {}
    const evictableCaches = Object.values(caches).filter(cache => cache.expiryOffset)
    debug(`Eviction: Pass started, evaluating ${evictableCaches.length} caches: ${evictableCaches.map(cache => cache.key).join(', ')}`)

    /** Selects expired entries from a store object, respecting the remaining budget. */
    const selectExpired = (storeEntries, expiryOffset, budget) => {
      return Object.entries(storeEntries).filter(([, entry]) => entry && typeof entry === 'object' && entry.expiry != null && now > entry.expiry + expiryOffset).slice(0, budget).map(([key]) => key)
    }

    /** Selects the oldest entries beyond maxEntries, respecting the remaining budget. */
    const selectOverflow = (storeEntries, maxEntries, budget) => {
      const entries = Object.entries(storeEntries)
      if (entries.length <= maxEntries) return []
      const overflow = entries.length - maxEntries
      return entries.filter(([, entry]) => entry && typeof entry === 'object').sort(([, a], [, b]) => (a.cachedAt ?? 0) - (b.cachedAt ?? 0)).slice(0, Math.min(overflow, budget)).map(([key]) => key)
    }

    /**
     * Purges expired then overflow entries from a single store by mutating the svelte store directly.
     * The store's subscriber (wired in #initialize) diffs the change and persists it via the batch writer.
     *
     * @param {string} label Used for debug logging.
     * @param {import('simple-store-svelte').Writable<any>} store The svelte store to mutate.
     * @param {Object} storeEntries The in-memory snapshot used to compute what's expired/overflowing.
     * @param {number} expiryOffset How long after the expiry to wait before purging data.
     * @param {number} maxEntries How many entries (keys) are allowed before purging oldest data first.
     * @returns {number} Count purged.
     */
    const purgeStore = (label, store, storeEntries, expiryOffset, maxEntries) => {
      let purged = 0

      const expired = selectExpired(storeEntries, expiryOffset, EVICTION_MAX_PER_RUN - totalPurged)
      if (expired.length) {
        store.update(value => {
          for (const key of expired) delete value[key]
          return value
        })
        purged += expired.length
        debug(`Eviction: Purged ${expired.length} expired entries from ${label}`)
      } else {
        debug(`Eviction: No expired entries for ${label} (${Object.keys(storeEntries).length} total)`)
      }

      const remainingBudget = EVICTION_MAX_PER_RUN - totalPurged - purged
      if (remainingBudget <= 0) return purged

      const remaining = { ...storeEntries }
      for (const key of expired) delete remaining[key]
      const overflow = selectOverflow(remaining, maxEntries, remainingBudget)
      if (overflow.length) {
        const before = Object.keys(remaining).length
        store.update(value => {
          for (const key of overflow) delete value[key]
          return value
        })
        purged += overflow.length
        debug(`Eviction: The ${label} cache overflowed by ${overflow.length} entries, purged oldest (was ${before}, limit ${maxEntries})`)
      }
      return purged
    }

    for (const cacheDefinition of Object.values(caches)) {
      if (!cacheDefinition.expiryOffset) continue
      if (totalPurged >= EVICTION_MAX_PER_RUN) break

      const { key: cacheKey, expiryOffset, maxEntries } = cacheDefinition
      const storeEntries = cacheKey === caches.MEDIA_CACHE.key ? (mediaCache?.value || {}) : cacheMap.get(cacheKey)
      if (!storeEntries) continue
      const store = cacheKey === caches.MEDIA_CACHE.key ? mediaCache : this[cacheDefinition.key]
      if (!store) continue

      const purged = purgeStore(cacheKey, store, storeEntries, expiryOffset, maxEntries)
      if (purged) {
        totalPurged += purged
        purgedByCacheKey[cacheKey] = (purgedByCacheKey[cacheKey] || 0) + purged
      }
    }

    if (totalPurged > 0) debug(`Eviction: Pass complete, total: ${totalPurged}, ${Object.entries(purgedByCacheKey).map(([k, v]) => `${k}:${v}`).join(', ')}`)
    else debug('Eviction: Pass complete, nothing to purge')
  }

  /**
   * Starts the eviction scheduler, deferring the first run by {@link EVICTION_STARTUP_DELAY}
   * then repeating every {@link EVICTION_INTERVAL}. Skips runs while offline or while
   * the player is fullscreen, retrying after 30 seconds instead.
   *
   * @param {Map<string, Object>} cacheMap
   */
  async #startEvictionScheduler(cacheMap) {
    let running = false
    let timeout = null
    if (!this.status) {
      const { status } = await import('@/modules/networking.js')
      this.status = status
    }
    if (!this.page) {
      const { page } = await import('@/modules/navigation.js')
      this.page = page
    }

    /**
     * Attempts a single eviction pass. Skips if one is already running or a retry is pending.
     * If conditions aren't met (offline or fullscreen player), schedules a single retry in 30s.
     */
    const run = async () => {
      if (running || timeout) return
      if (this.status?.value === 'offline' || (this.page?.value === this.page?.PLAYER && document.fullscreenElement)) {
        debug('Eviction: Skipping run, offline or player is fullscreen, retrying in 30s')
        timeout = setTimeout(() => {
          timeout = null
          run()
        }, 30_000)
        timeout.unref?.()
        return
      }
      running = true
      await this.#runEviction(cacheMap)
      running = false
    }

    const startup = setTimeout(() => {
      run()
      const interval = setInterval(run, EVICTION_INTERVAL)
      interval.unref?.()
    }, EVICTION_STARTUP_DELAY)

    startup.unref?.()
  }

  /**
   * Initializes the cache by loading necessary data into memory.
   * @returns {Promise<void>}
   */
  async #initialize() {
    debug(`Loading caches with id: ${this.cacheID}...`)
    await open(SHARED_DB_NAME)
    await open(this.cacheID)
    const cacheTypes = [
      // USER DB
      { key: caches.GENERAL, writable: (data) => this.general = writable({ ...generalDefaults, ...deepClone(data) }) },
      { key: caches.USER_LISTS, writable: (data) => this.user_lists = writable(deepClone(data)) },
      { key: caches.HISTORY, writable: (data) => this.history = writable({ ...historyDefaults, ...deepClone(data) }) },
      { key: caches.NOTIFICATIONS, writable: (data) => this.notifications = writable({ ...notifyDefaults, ...deepClone(data) }) },
      { key: caches.QUERY_NOTIFICATIONS, writable: (data) => this.query_notifications = writable(deepClone(data)) },
      { key: caches.QUERY_FOLLOWING, writable: (data) => this.query_following = writable(deepClone(data)) },
      { key: caches.QUERY_RECOMMENDATIONS, writable: (data) => this.query_recommendations = writable(deepClone(data)) },
      // SHARED DB
      { key: caches.MEDIA_CACHE, writable: (data) => mediaCache = writable(deepClone(data)) },
      { key: caches.EXTENSIONS, writable: (data) => this.extensions = writable({ ...extensionDefaults, ...deepClone(data) }) },
      { key: caches.QUERY_MAPPINGS, writable: (data) => this.query_mappings = writable(deepClone(data)) },
      { key: caches.QUERY_COMPOUND, writable: (data) => this.query_compound = writable(deepClone(data)) },
      { key: caches.QUERY_EPISODES, writable: (data) => this.query_episodes = writable(deepClone(data)) },
      { key: caches.QUERY_SEARCH_IDS, writable: (data) => this.query_search_ids = writable(deepClone(data)) },
      { key: caches.QUERY_SEARCH, writable: (data) => this.query_search = writable(deepClone(data)) },
      { key: caches.QUERY_RSS, writable: (data) => this.query_rss = writable(deepClone(data)) }
    ]

    /**
     * In-memory representation of all cache object stores.
     * Each entry maps a cache key to an object containing its stored key-value pairs.
     * This map is lazy-loaded on first access and kept in memory for fast lookups.
     *
     * @type {Map<string, Object>} cacheKey: { key: value }
     */
    const cacheMap = new Map()
    for (const { key } of cacheTypes) {
      try {
        let data
        try {
          data = await loadAll(this.#getDatabase(key), key)
        } catch (error) {
          debug(`Recovery: Normal load failed for ${key.key}, attempting recovery:`, error.message)
          const recovered = await recoverCache(this.#getDatabase(key), key)
          if (Object.keys(recovered).length > 0) {
            try {
              debug(`Recovery: Clearing corrupted ${key.key} and restoring ${Object.keys(recovered).length} recovered entries...`)
              await reset(this.#getDatabase(key), key)
              await putMany(this.#getDatabase(key), key, Object.entries(recovered))
              debug(`Recovery: Successfully restored ${key.key} with recovered data`)
            } catch (restoreError) {
              debug(`Recovery: Failed to restore ${key.key}, will use recovered data in-memory only:`, restoreError)
            }
          } else debug(`Recovery: No data could be recovered from ${key.key}, returning empty cache`)
          data = recovered
        }
        cacheMap.set(key.key, data)
      } catch (error) {
        debug(`Recovery: Critical error loading ${key.key}, using empty cache:`, error)
        cacheMap.set(key.key, {})
      }
    }
    cacheTypes.forEach(({ key, writable }) => writable(cacheMap.get(key.key)))

    // Merge user media entries (mediaListEntry, isFavourite) from user_lists into mediaCache
    const mediaEntry = this.user_lists.value['entries'] || {}
    if (Object.keys(mediaEntry).length > 0) {
      let merged = 0
      mediaCache.update(medias => {
        for (const [id, entries] of Object.entries(mediaEntry)) {
          if (medias[id]) {
            medias[id] = { ...medias[id], ...entries }
            merged++
          }
        }
        return medias
      })
      debug(`Merged ${merged}/${Object.keys(mediaEntry).length} user media entries from user_lists into mediaCache`)
    }

    this.subscribers = cacheTypes.map(({ key }) => {
      const dbName = this.#getDatabase(key)
      const batchWriter = getBatchWriter(dbName)
      const store = key.key === caches.MEDIA_CACHE.key ? mediaCache : this[key.key]
      const mediaReferences = key.key === caches.MEDIA_CACHE.key ? new Map() : null
      const queryEpisodeReferences = key.key === caches.QUERY_EPISODES.key ? new Map() : null
      return store.subscribe(value => {
        const storeEntries = cacheMap.get(key.key) || {}
        // Sync user-specific fields into user_lists['entries'] when they change
        if (key.key === caches.MEDIA_CACHE.key) {
          const updatedEntries = { ...this.user_lists.value['entries'] }
          let entriesChanged = false
          for (const [subKey, subValue] of Object.entries(value || {})) {
            if (mediaReferences.get(subKey) === subValue) continue
            const persistValue = stripUserFields(subValue)
            const prevSubValue = storeEntries[subKey]
            if (!equal(prevSubValue, persistValue)) {
              batchWriter.enqueue(key, subKey, persistValue)
              storeEntries[subKey] = deepClone(persistValue)
            }
            const userFields = extractUserFields(subValue)
            const hasEntry = userFields.mediaListEntry || userFields.isFavourite
            if (hasEntry && !equal(updatedEntries[subKey], userFields)) {
              updatedEntries[subKey] = userFields
              entriesChanged = true
            } else if (!hasEntry && updatedEntries[subKey]) {
              delete updatedEntries[subKey]
              entriesChanged = true
            }
            mediaReferences.set(subKey, subValue)
          }
          if (entriesChanged) {
            this.user_lists.update(lists => {
              lists['entries'] = updatedEntries
              return lists
            })
          }
        } else {
          for (const [subKey, subValue] of Object.entries(value || {})) {
            if (queryEpisodeReferences?.get(subKey) === subValue) continue
            const prevSubValue = storeEntries[subKey]
            if (!equal(prevSubValue, subValue)) {
              batchWriter.enqueue(key, subKey, subValue)
              storeEntries[subKey] = deepClone(subValue)
            }
            queryEpisodeReferences?.set(subKey, subValue)
          }
        }
        for (const subKey of Object.keys(storeEntries)) {
          if (!(subKey in (value || {}))) {
            delete storeEntries[subKey]
            mediaReferences?.delete(subKey)
            queryEpisodeReferences?.delete(subKey)
            remove(dbName, key, [subKey]).catch(error => debug(`Failed to remove ${subKey} from ${key.key}`, error))
          }
        }
        cacheMap.set(key.key, storeEntries)
        return () => {
          cacheMap.delete(key.key)
          debug('Unsubscribed from cache:', key.key)
        }
      })
    })

    if (migrationStatus.value) migrationStatus.set('Migration complete, loading your cached data...')

    this.#startEvictionScheduler(cacheMap)
    debug('Caches have successfully been loaded!')
  }

  /**
   * Releases all resources held by this cache and marks it as inactive.
   *
   * Unsubscribes listeners, clears pending operations and lookup maps,
   * nulls stored data to enable garbage collection, and logs its destruction.
   * After calling, this instance should not be used.
   */
  destroy() {
    this.subscribers.forEach((unsubscribe) => unsubscribe())
    this.#pending.clear()
    this.flush().finally(() => {
      openDBs.get(this.cacheID)?.then(database => database.close()).catch(() => {})
      openDBs.delete(this.cacheID)
      batchWriters.delete(this.cacheID)
    })
    this.general = null
    this.user_lists = null
    this.history = null
    this.notifications = null
    this.query_notifications = null
    this.query_following = null
    this.query_recommendations = null
    this.query_mappings = null
    this.query_compound = null
    this.extensions = null
    this.query_episodes = null
    this.query_search_ids = null
    this.query_search = null
    this.query_rss = null
    mediaCache = null
    debug(`Cache with ID ${this.cacheID} has been destroyed.`)
  }

  /**
   * Immediately persists queued user and shared cache writes to IndexedDB.
   *
   * @returns {Promise<void>} Resolves after all pending writes have completed.
   */
  async flush() {
    await this.isReady
    await Promise.all([
      batchWriters.get(this.cacheID)?.flushNow(),
      batchWriters.get(SHARED_DB_NAME)?.flushNow()
    ])
  }

  /**
   * Updates the cache for a specific key.
   *
   * @param {keyof typeof caches} cache The name of the cache (object store).
   * @param {number|string} key The key for the specific cache entry (e.g., media ID).
   * @param {Object} data The cache object to store.
   * @warn Do not use this outside of {@link Cache}, use {@link cacheEntry} instead.
   */
  #update(cache, key, data) {
    const store = this[cache.key]
    store.update((value) => {
      const current = value[key]
      value[key] = typeof data === 'function' ? data(current) : data
      return value
    })
  }

  /**
   * Transfers all cached data from the current cache to a new cache ID and then purges the old cache.
   * Only keeps necessary info like settings, notifications, watch history, and previous magnet links excluding caches like queries and user lists as they can't be used.
   *
   * @param {string} newCacheID The ID of the new cache to which data should be transferred.
   * @returns {Promise<void>} Resolves when the data has been successfully transferred and the old cache purged.
   */
  async abandon(newCacheID){
    await purge(this.cacheID)
    this.cacheID = newCacheID
    for (const value of [[caches.GENERAL, this.general.value], [caches.NOTIFICATIONS, this.notifications.value], [caches.HISTORY, this.history.value]]) {
      for (const [key, keyValue] of Object.entries(value[1])) {
        try {
          await putMany(newCacheID, value[0], [[key, keyValue]])
        } catch (error) {
          debug(`IDB update failed for ${newCacheID}:${key}:`, error)
        }
      }
    }
  }

  /**
   * Resets all settings completely clearing the general cache.
   * See {@link generalDefaults} for all values that will be reset.
   */
  async resetSettings() {
    await reset(this.#getDatabase(caches.GENERAL), caches.GENERAL)
    location.reload()
  }

  /**
   * Resets all watch history and magnet links completely clearing the history cache.
   * See {@link historyDefaults} for all values that will be reset.
   */
  async resetHistory() {
    await reset(this.#getDatabase(caches.HISTORY), caches.HISTORY)
    this.history.value = { ...historyDefaults }
  }

  /**
   * Resets extension data, either clearing only cached code or performing a full reset.
   *
   * @param {boolean} [codeOnly=true]
   * See {@link extensionDefaults} for all values that will be reset.
   */
  async resetExtensions(codeOnly = true) {
    if (codeOnly) {
      const defaultKeys = new Set(Object.keys(extensionDefaults))
      await remove(this.#getDatabase(caches.EXTENSIONS), caches.EXTENSIONS, Object.keys(this.extensions.value).filter(key => !defaultKeys.has(key)))
      location.reload()
    } else {
      await reset(this.#getDatabase(caches.EXTENSIONS), caches.EXTENSIONS)
      this.extensions.value = { ...extensionDefaults }
    }
  }

  /**
   * Resets all caches completely clearing the caches, excluding notifications.
   * To clear notifications see: {@link resetNotifications}.
   */
  async resetCaches() {
    await reset(this.#getDatabase(caches.USER_LISTS), caches.USER_LISTS)
    await reset(this.#getDatabase(caches.QUERY_COMPOUND), caches.QUERY_COMPOUND)
    await reset(this.#getDatabase(caches.QUERY_EPISODES), caches.QUERY_EPISODES)
    await reset(this.#getDatabase(caches.QUERY_FOLLOWING), caches.QUERY_FOLLOWING)
    await reset(this.#getDatabase(caches.QUERY_RECOMMENDATIONS), caches.QUERY_RECOMMENDATIONS)
    await reset(this.#getDatabase(caches.QUERY_SEARCH_IDS), caches.QUERY_SEARCH_IDS)
    await reset(this.#getDatabase(caches.QUERY_SEARCH), caches.QUERY_SEARCH)
    await reset(this.#getDatabase(caches.QUERY_RSS), caches.QUERY_RSS)
    await reset(this.#getDatabase(caches.QUERY_MAPPINGS), caches.QUERY_MAPPINGS)
    await reset(this.#getDatabase(caches.MEDIA_CACHE), caches.MEDIA_CACHE)
    location.reload()
  }

  /**
   * Resets all notifications completely clearing the notifications cache.
   * See {@link notifyDefaults} for all values that will be reset.
   */
  resetNotifications() {
    this.notifications.value = { ...notifyDefaults }
  }

  /**
   * Immediately retrieves a cache entry directly from storage skipping the batch caching queue.
   *
   * @param {keyof typeof caches} cache The name of the cache (object store).
   * @param {string} key The category to retrieve (e.g., 'lastAni').
   * @returns {Promise<any>} The cached data for the specified key, or `undefined` if it does not exist.
   */
  read(cache, key) {
    return get(this.#getDatabase(cache), cache, key)
  }

  /**
   * Immediately writes a cache entry directly to storage skipping the batch caching queue, data will eventually be saved to the memory cache.
   *
   * @param {keyof typeof caches} cache The name of the cache (object store).
   * @param {string} key The category to update (e.g., 'lastAni').
   * @param {Object} data The cache object to store.
   * @returns {Promise<void>} Resolves when the data has been successfully updated.
   */
  write(cache, key, data) {
    this.setEntry(cache, key, data)
    return set(this.#getDatabase(cache), cache, key, data)
  }

  /**
   * Gets the underlying writable store for a given cache.
   *
   * @param {keyof typeof caches} cache The name of the cache (object store).
   * @returns {import('simple-store-svelte').Writable<any>} The writable store backing the cache.
   * @throws {Error} If the cache is not one of the supported stores.
   */
  #getStore(cache) {
    const store = { [caches.GENERAL.key]: this.general, [caches.NOTIFICATIONS.key]: this.notifications, [caches.HISTORY.key]: this.history, [caches.EXTENSIONS.key]: this.extensions }[cache.key]
    if (!store) throw new Error(`Store: Failed to get unsupported cache ${cache.key}`)
    return store
  }

  /**
   * Retrieves the cache entry for a specific key.
   *
   * @param {keyof typeof caches} cache The name of the cache (object store).
   * @param {string} key The category to retrieve (e.g., 'lastAni').
   * @returns {any} The cached data for the specified key, or `undefined` if it does not exist.
   */
  getEntry(cache, key) {
    return this.#getStore(cache).value[key]
  }

  /**
   * Updates the cache for a specific key.
   *
   * @param {keyof typeof caches} cache The name of the cache (object store).
   * @param {string} key The category to update (e.g., 'lastAni').
   * @param {Object} data The cache object to store.
   */
  setEntry(cache, key, data) {
    this.#getStore(cache).update((query) => {
      const current = query[key]
      query[key] = typeof data === 'function' ? data(current) : data
      return query
    })
  }

  /**
   * Deletes a cache entry for a specific key.
   *
   * @param {keyof typeof caches} cache The name of the cache (object store).
   * @param {string} key The key to delete from the cache.
   * @returns {Promise<void>} Resolves when the entry has been successfully deleted.
   */
  async deleteEntry(cache, key) {
    const store = cache === caches.MEDIA_CACHE ? mediaCache : this[cache.key]
    store.update((value) => {
      const updated = { ...value }
      delete updated[key]
      return updated
    })
    this.#pending.delete(`${cache.key}:${key}`)
    debug(`Deleted cache entry ${cache.key}:${key}`)
  }

  /**
   * Updates the media cache with the provided media entries.
   *
   * @param {Array<Object>} medias An array of media objects to be cached. Each media object should have a unique identifier (`id`).
   * @param {Object} [fillLists] An object containing user list data to attach to each media entry (e.g., `{ data: { MediaList: [...] } }`)
   */
  updateMedia(medias, fillLists) {
    if (!medias || !medias.length) return
    const filledMedias = fillLists ? fillEntries(medias, fillLists) : medias /* attaches any alternative authorization userList information to the anilist media for tracking. */
    const mediaMap = new Map(filledMedias.map(media => [media.id, media]))
    const now = Date.now()
    mediaCache.update(current => {
      for (const [id, media] of mediaMap.entries()) {
        if (media) current[id] = { ...media, cachedAt: Date.now(), expiry: media.status === 'FINISHED' ? now + getRandomInt(7, 14) * 24 * 60 * 60 * 1_000 : now + getRandomInt(12, 24) * 60 * 60 * 1_000 }
      }
      return current
    })
  }

  /**
   * Returns media for the given ID, fetching it if missing.
   *
   * @param {number | string | null} id
   * @param {boolean} isMal
   * @returns {Promise<Object | null>}
   */
  async requestMedia(id, isMal = false) {
    if (!id || !isValidNumber(Number(id))) return null
    const exactId = Number(id)
    const media = isMal ? Object.values(mediaCache.value).find(media => media.idMal === exactId) : mediaCache.value[id]
    if (!this.anilistClient) {
      const { anilistClient } = await import('@/modules/providers/anilist/anilist.js')
      this.anilistClient = anilistClient
    }
    if (media) return media
    if (isMal) return (await this.anilistClient.searchIDSingle({ idMal: exactId })).data.Media // TODO: need to add a requestMediaID in myanimelist.js...
    else return this.anilistClient.requestMediaID(exactId)
  }

  /**
   * Returns cached media for the given ID, no attempt is made to fetch the media if it's not found.
   *
   * @param {number | string | null} id
   * @returns {Object | null}
   */
  getMedia(id) {
    if (!id || !isValidNumber(Number(id))) return null
    return mediaCache.value[Number(id)] ?? {}
  }

  /**
   * Retrieves a cached entry by its key, optionally ignoring the expiration time.
   *
   * @param {keyof typeof caches} cache The name of the cache (object store).
   * @param {string} key The unique key identifying the cached entry.
   * @param {boolean} [ignoreExpiry=false] If true, the entry will be returned even if it has expired, defaults to `false`; meaning expired entries will not be returned.
   * @returns {Promise<Object|null>} The cached entry if found and valid; otherwise, `null`.
   */
  cachedEntry(cache, key, ignoreExpiry) {
    if (this.#pending.has(`${cache.key}:${key}`) && !ignoreExpiry) {
      debug(`Found pending query ${cache.key} for ${key}`)
      return this.#pending.get(`${cache.key}:${key}`)
    }
    const store = this[cache.key]
    const cachedEntry = store?.value?.[key]
    if (cachedEntry && cachedEntry.data && ((Date.now() < cachedEntry.expiry) || ignoreExpiry)) {
      debug(`Found cached ${cache.key} for ${key}`)
      const data = deepClone(cachedEntry.data)
      if (cache !== caches.QUERY_RECOMMENDATIONS || this.general.value.settings.queryComplexity === 'Complex') { /* Remap media id's to their respective media in the cache */
        if (data.data?.Page?.media) data.data.Page.media = data.data.Page.media.map(mediaId => mediaCache.value[mediaId])
        if (data.data?.Media) data.data.Media = mediaCache.value[data.data.Media]
        if (data.data?.MediaListCollection && !key?.includes('token')) data.data.MediaListCollection.lists = (data.data.MediaListCollection.lists || []).map(list => ({ ...list, entries: list.entries.map(entry => ({ ...entry, media: mediaCache.value[entry.media] })) }))
      }
      return Promise.resolve(data)
    }
    return null
  }

  /**
   * Caches an entry with the specified key, variables, data, and expiry time.
   * Only one instance of the function will be run, subsequent identical calls will return the initial call.
   *
   * @param {keyof typeof caches} cache The name of the cache (object store).
   * @param {string} key The unique key to identify the cached entry.
   * @param {Object} [vars] The variables associated with the cached data if applicable, this can include filters, query parameters, or context-specific data.
   * @param {Object} data The data to be cached, this is the primary content to store for the key. Preferably this should be a promise as it will be handled before caching.
   * @param {number} expiry The expiration timestamp for the cache entry in milliseconds since the epoch, once the current time exceeds this value the entry is considered expired.
   * @returns {Promise<Object>} A promise that resolves when the caching operation is complete.
   *
   */
  async cacheEntry(cache, key, vars, data, expiry) {
    if (this.#pending.has(`${cache.key}:${key}`)) {
      debug(`Found pending query ${cache.key} for ${key} during cache update...`)
      return this.#pending.get(`${cache.key}:${key}`)
    }
    const { fillLists, ...variables } = vars || {}
    const promiseData = (async () => {
      let res
      try {
        res = await data
      } catch (error) {
        debug(`Detected an error in the promised data, returning cached data if available.`, error)
        return this.cachedEntry(cache, key, true)
      }
      const cacheRes = deepClone(res)
      if (this.status?.value?.match(/offline/i) || (!variables?.mappings && (!res || ((res.errors?.length > 0) && !res.errors?.[0]?.title?.match(/record not found/i))))) return this.cachedEntry(cache, key, true) || res
      if (cache !== caches.QUERY_RECOMMENDATIONS || this.general.value.settings.queryComplexity === 'Complex') {
        if (res?.data?.Page?.media) {
          if (!res.data.Page.media.length) expiry = Date.now() + getRandomInt(1, 2) * 60 * 1_000 // dont cache empty queries for long.
          cacheRes.data.Page.media = cacheRes.data.Page.media.map(media => media.id)
          this.updateMedia(res.data.Page.media, await fillLists)
        } else if (res?.data?.Media) {
          cacheRes.data.Media = cacheRes.data.Media.id
          this.updateMedia([res.data.Media], await fillLists)
        } else if (res?.data?.MediaListCollection && !variables.token) {
          const lists = res.data.MediaListCollection.lists || []
          if (!lists.length) expiry = Date.now() + getRandomInt(1, 2) * 60 * 1_000  // dont cache empty queries for long.
          cacheRes.data.MediaListCollection = { ...res.data.MediaListCollection, lists: lists.map(list => ({ ...list, entries: list.entries.map(entry => ({ ...entry, media: entry.media.id })) })) }
          this.updateMedia(lists.flatMap(list => list.entries.map(entry => entry.media)))
        }
      }
      this.#update(cache, key, { data: cacheRes, expiry, cachedAt: Date.now() })
      return res
    })()
    this.#pending.set(`${cache.key}:${key}`, promiseData)
    promiseData.finally(() => this.#pending.delete(`${cache.key}:${key}`))
    return promiseData
  }
}


/**
 * Mapping from MyAnimeList status values to AniList status values.
 * Keys are MAL statuses, values are AniList equivalents.
 */
const MAL_TO_ANILIST = {
  watching: 'CURRENT',
  rewatching: 'REPEATING', /* rewatching is determined by is_rewatching boolean (no individual list) */
  plan_to_watch: 'PLANNING',
  completed: 'COMPLETED',
  dropped: 'DROPPED',
  on_hold: 'PAUSED'
}

/**
 * Mapping from AniList status values to MyAnimeList status values.
 * Generated automatically from {@link MAL_TO_ANILIST}, with 'REPEATING' mapped to 'watching'.
 */
const ANILIST_TO_MAL = Object.fromEntries(Object.entries(MAL_TO_ANILIST).map(([mal, ani]) => [ani, mal === 'rewatching' ? 'watching' : mal]))

/**
 * Maps anime status between MyAnimeList and AniList (bidirectional).
 *
 * @param {string} status The status to map.
 * @returns {string|undefined} The mapped status, or undefined if not recognized.
 */
export function mapStatus(status) {
  return MAL_TO_ANILIST[status] ?? ANILIST_TO_MAL[status]
}

/**
 * Fills the queried AniList media entries with additional user list data from alternate authorizations (e.g., MyAnimeList).
 *
 * This function attaches user-specific data to each AniList media entry, such as progress, status, start/completion dates,
 * and custom list information, by matching the media's ID with entries from the provided user lists.
 *
 * @param {Array<Object>} medias An array of AniList media objects to be filled with user list data.
 * @param {Object} userLists The user list data, containing entries from alternate authorizations like MyAnimeList.
 * @param {Object} userLists.data The user list data structure containing a list of media entries.
 * @param {Array<Object>} userLists.data.MediaList An array of media list entries from alternate authorizations.
 * @returns {Array<Object>} The updated array of AniList media objects with attached user list data.
 */
function fillEntries(medias, userLists) {
  debug(`Filling MyAnimeList entry data for ${medias?.length} media(s)`)
  const malEntries = userLists?.data?.MediaList || []
  const malMap = new Map(malEntries.map(({ node }) => [node.id, node.my_list_status]))
  return medias.map(media => {
    const status = malMap.get(media.idMal)
    if (!status) return media

    const startDate = status.start_date ? new Date(status.start_date) : undefined
    const finishDate = status.finish_date ? new Date(status.finish_date) : undefined
    const startedAt = startDate ? { year: startDate.getFullYear(), month: startDate.getMonth() + 1, day: startDate.getDate() } : undefined
    const completedAt = finishDate ? { year: finishDate.getFullYear(), month: finishDate.getMonth() + 1, day: finishDate.getDate() } : undefined
    media.mediaListEntry = {
      id: media.id,
      progress: status.num_episodes_watched,
      repeat: status.number_times_rewatched,
      status: mapStatus(status.is_rewatching ? 'rewatching' : status.status),
      customLists: [],
      score: status.score,
      startedAt,
      completedAt
    }
    return media
  })
}

/**
 * Migrates existing data to the v2 store layout.
 *
 * @param {IDBDatabase} database The database being upgraded.
 * @param {IDBTransaction} versionTx The active versionchange transaction.
 * @returns {Promise<void>}
 */
async function UPGRADE_V1_TO_V2(database, versionTx) {
  const allEntries = new Map()
  const sharedDB = await openDBs.get(SHARED_DB_NAME)
  if (!sharedDB) {
    debug('Migration: shared DB not in openDBs, skipping data migration')
    return
  }

  // Move mappings and medias out of their old top-level stores in the user DB.
  migrationStatus.set('Moving media library to shared storage...')
  for (const { oldKey, cache } of [{ oldKey: 'mappings', cache: caches.QUERY_MAPPINGS }, { oldKey: 'medias', cache: caches.MEDIA_CACHE }]) {
    if (!database.objectStoreNames.contains(oldKey)) {
      debug(`Migration: ${oldKey} not in user DB, skipping (likely already migrated)`)
      continue
    }
    try {
      allEntries.set(cache, await readAllFrom(versionTx, oldKey))
    } catch (error) {
      debug(`Migration: failed to read ${oldKey} from user DB:`, error)
    }
    try {
      database.deleteObjectStore(oldKey)
      debug(`Migration: deleted ${oldKey} store from user DB`)
    } catch (error) {
      debug(`Migration: failed to delete ${oldKey} store from user DB:`, error)
    }
  }

  // Remove a stale '{}' key that was incorrectly written to notifications in v1.
  migrationStatus.set('Cleaning up legacy settings...')
  if (database.objectStoreNames.contains(caches.NOTIFICATIONS.key)) {
    try {
      versionTx.objectStore(caches.NOTIFICATIONS.key).delete('{}')
      debug('Migration: deleted stale {} entry from notifications store')
    } catch (error) {
      debug('Migration: failed to delete {} from notifications:', error)
    }

    // Stamp missing uids onto notification entries.
    try {
      const notificationsRecord = await wrapRequest(versionTx.objectStore(caches.NOTIFICATIONS.key).get('notifications'))
      const notifications = notificationsRecord?.value
      if (Array.isArray(notifications)) {
        const stamped = notifications.map(notification => notification.uid ? notification : { ...notification, uid: generateRandomHexCode(8) })
        await wrapRequest(versionTx.objectStore(caches.NOTIFICATIONS.key).put({ key: 'notifications', value: stamped }))
        debug('Migration: stamped uids onto notification entries')
      }
    } catch (error) {
      debug('Migration: failed to stamp uids onto notifications:', error)
    }
  }

  // remove stale 'volume' key, this is now located in settings.
  if (database.objectStoreNames.contains(caches.GENERAL.key)) {
    try {
      versionTx.objectStore(caches.GENERAL.key).delete('volume')
      debug('Migration: deleted stale volume entry from general store')
    } catch (error) {
      debug('Migration: failed to delete volume from general:', error)
    }
  }

  // Migrate the top-level 'theme' entry into general settings as settings.customCSS.
  if (database.objectStoreNames.contains(caches.GENERAL.key)) {
    try {
      const themeRecord = await wrapRequest(versionTx.objectStore(caches.GENERAL.key).get('theme'))
      const themeValue = themeRecord?.value
      if (themeValue !== undefined) {
        const settingsRecord = await wrapRequest(versionTx.objectStore(caches.GENERAL.key).get('settings'))
        const settings = settingsRecord?.value || {}
        const updatedSettings = { ...settings, customCSS: themeValue }
        await wrapRequest(versionTx.objectStore(caches.GENERAL.key).put({ key: 'settings', value: updatedSettings }))
        versionTx.objectStore(caches.GENERAL.key).delete('theme')
        debug('Migration: moved theme entry into general settings.customCSS')
      } else {
        debug('Migration: no top-level theme entry found, skipping')
      }
    } catch (error) {
      debug('Migration: failed to migrate theme into general settings:', error)
    }
  }

  // Migrate extension sources from general settings into extensions.
  if (database.objectStoreNames.contains(caches.GENERAL.key)) {
    try {
      const generalRecord = await wrapRequest(versionTx.objectStore(caches.GENERAL.key).get('settings'))
      const settings = generalRecord?.value
      if (settings) {
        const extensionSourcesData = settings.extensionSources
        const sourcesNewData = settings.sourcesNew
        const { extensionSources, sourcesNew, ...cleanedSettings } = settings
        await wrapRequest(versionTx.objectStore(caches.GENERAL.key).put({ key: 'settings', value: cleanedSettings }))
        debug('Migration: removed extensionSources and sourcesNew from general settings')
        if (extensionSourcesData) allEntries.set('repositorySources', extensionSourcesData)
        if (sourcesNewData) allEntries.set('extensionSources', sourcesNewData)
      }
    } catch (error) {
      debug('Migration: failed to migrate extension sources from general settings:', error)
    }
  }

  // Extract nested query sub-stores from the old 'queries' object store.
  migrationStatus.set('Reorganizing your search and query history...')
  const legacyQueriesKey = 'queries'
  if (database.objectStoreNames.contains(legacyQueriesKey)) {
    try {
      const allQueryRecords = await readAllFrom(versionTx, legacyQueriesKey)
      for (const [oldNestedName, cacheDefinition] of Object.entries({
        compound: caches.QUERY_COMPOUND,
        episodes: caches.QUERY_EPISODES,
        extensions: caches.EXTENSIONS,
        rss: caches.QUERY_RSS,
        search: caches.QUERY_SEARCH,
        searchIDS: caches.QUERY_SEARCH_IDS,
        following: caches.QUERY_FOLLOWING,
        recommendations: caches.QUERY_RECOMMENDATIONS
      })) {
        const record = allQueryRecords.find(r => r.key === oldNestedName)
        if (!record || !record.value) {
          debug(`Migration: ${oldNestedName} not found in queries, skipping`)
          continue
        }
        const entries = Object.entries(record.value).map(([entryKey, value]) => ({ key: entryKey, value }))
        allEntries.set(cacheDefinition, entries)
        debug(`Migration: extracted ${entries.length} entries of ${oldNestedName} from queries, will become ${cacheDefinition.key}`)
      }
      database.deleteObjectStore(legacyQueriesKey)
      debug('Migration: deleted legacy queries store from user DB')
    } catch (error) {
      debug('Migration: failed to read/delete queries store for nested extraction:', error)
    }
  }

  // Stamp cachedAt/expiry, extract user fields, and write entries to user_lists['entries']
  migrationStatus.set('Extracting your user data...')
  const mediaEntries = allEntries.get(caches.MEDIA_CACHE)
  if (mediaEntries?.length) {
    const now = Date.now()
    const userEntries = {}
    for (const entry of mediaEntries) {
      if (entry.value && !entry.value.cachedAt) entry.value = { ...entry.value, cachedAt: now, expiry: entry.value.status === 'FINISHED' ? now - getRandomInt(50, 65) * 24 * 60 * 60 * 1_000 : now + getRandomInt(12, 24) * 60 * 60 * 1_000 }
      const userFields = extractUserFields(entry.value)
      if (userFields.mediaListEntry || userFields.isFavourite) userEntries[entry.key] = userFields
      entry.value = stripUserFields(entry.value)
    }
    if (Object.keys(userEntries).length > 0) {
      try {
        const existing = await wrapRequest(versionTx.objectStore(caches.USER_LISTS.key).get('entries'))
        const merged = { ...(existing?.value || {}), ...userEntries }
        await wrapRequest(versionTx.objectStore(caches.USER_LISTS.key).put({ key: 'entries', value: merged }))
        debug(`Migration: wrote ${Object.keys(userEntries).length} user media entries to user_lists['entries']`)
      } catch (error) {
        debug('Migration: failed to write user media entries:', error)
      }
    }
  }

  // Write all collected entries to their target databases.
  migrationStatus.set('Writing to shared database...')
  for (const [cache, entries] of allEntries) {
    if (typeof cache === 'string') continue
    if (!entries.length) {
      debug(`Migration: ${cache.key} empty, nothing to move`)
      continue
    }
    const targetDB = cache.shared ? sharedDB : database
    let existingTarget = []
    try {
      existingTarget = await readAllFrom(targetDB, cache.key)
    } catch (error) {
      debug(`Migration: failed to read existing entries for ${cache.key}, will overwrite:`, error)
    }
    const existingByKey = new Map(existingTarget.map(({ key, value }) => [key, value]))
    const toWrite = entries.filter(({ key: entryKey, value }) => {
      const existing = existingByKey.get(entryKey)
      if (!existing) return true
      if (cache.key === caches.MEDIA_CACHE.key) return (value?.cachedAt ?? 0) > (existing?.cachedAt ?? 0)
      return false
    })
    if (!toWrite.length) {
      debug(`Migration: all ${entries.length} entries of ${cache.key} already present, skipping write`)
      continue
    }
    try {
      const targetTx = targetDB.transaction(cache.key, 'readwrite')
      const store = targetTx.objectStore(cache.key)
      for (const { key: entryKey, value } of toWrite) store.put({ key: entryKey, value })
      await waitForTransaction(targetTx)
      debug(`Migration: merged ${toWrite.length}/${entries.length} new entries of ${cache.key} into ${cache.shared ? 'shared' : 'user'} DB`)
    } catch (error) {
      debug(`Migration: failed to write ${cache.key}:`, error)
    }
  }

  // Write migrated repository sources to shared DB
  migrationStatus.set('Migrating extension sources...')
  const repositorySourcesData = allEntries.get('repositorySources')
  if (repositorySourcesData && Object.keys(repositorySourcesData).length > 0) {
    try {
      const existingRecord = await new Promise((resolve, reject) => {
        const transaction = sharedDB.transaction(caches.EXTENSIONS.key, 'readonly')
        const request = transaction.objectStore(caches.EXTENSIONS.key).get('repositorySources')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const merged = { ...(existingRecord?.value || {}), ...repositorySourcesData }
      const transaction = sharedDB.transaction(caches.EXTENSIONS.key, 'readwrite')
      await wrapRequest(transaction.objectStore(caches.EXTENSIONS.key).put({ key: 'repositorySources', value: merged }))
      debug(`Migration: merged ${Object.keys(repositorySourcesData).length} repositorySources into extensions`)
    } catch (error) {
      debug('Migration: failed to write repositorySources to shared DB:', error)
    }
  }

  // Write migrated extension sources to shared DB
  const extensionSourcesData = allEntries.get('extensionSources')
  if (extensionSourcesData && Object.keys(extensionSourcesData).length > 0) {
    try {
      const existingRecord = await new Promise((resolve, reject) => {
        const transaction = sharedDB.transaction(caches.EXTENSIONS.key, 'readonly')
        const request = transaction.objectStore(caches.EXTENSIONS.key).get('extensionSources')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const merged = { ...(existingRecord?.value || {}), ...extensionSourcesData }
      const transaction = sharedDB.transaction(caches.EXTENSIONS.key, 'readwrite')
      await wrapRequest(transaction.objectStore(caches.EXTENSIONS.key).put({ key: 'extensionSources', value: merged }))
      debug(`Migration: merged ${Object.keys(extensionSourcesData).length} extensionSources into extensions`)
    } catch (error) {
      debug('Migration: failed to write extensionSources to shared DB:', error)
    }
  }
}

/** @type {Cache} */
export let cache = new Cache()

/**
 * Ensures that the cache system has finished initializing before use.
 * THIS MUST BE CALLED BEFORE ACCESSING {@link cache}.
 *
 * @returns {Promise<void>} A promise that resolves once the cache is fully initialized and ready to use.
 */
export function cacheReady() {
  return cache.isReady
}