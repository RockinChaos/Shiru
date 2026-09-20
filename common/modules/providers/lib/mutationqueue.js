import { debounce, uniqueStore } from '@/modules/util.js'
import { cache, caches } from '@/modules/cache.js'
import { profiles } from '@/modules/settings.js'
import { writable } from 'simple-store-svelte'
import Debug from 'debug'
const debug = Debug('ui:mutationqueue')

/**
 * @typedef {'entry' | 'delete' | 'favourite'} MutationType
 */

/**
 * @typedef {object} QueuedMutation
 * @property {MutationType} type
 * @property {number} mediaId
 * @property {Record<string, any>} variables
 * @property {any} result
 * @property {number | null} progressBefore Progress value at the time of queueing, used for stale-write detection.
 * @property {boolean} executed True if the API call already succeeded this session; false if offline/pending.
 * @property {number} queuedAt Unix timestamp (ms) when this mutation was enqueued.
 */

export class MutationQueue {
  /** @type {'AniList' | 'MyAnimeList'} */
  #provider
  /** @type {import('simple-store-svelte').Writable<QueuedMutation[]>} */
  #queue = writable([])
  /** @type {boolean} True while the user lists are being fetched, used to decide whether to queue or apply immediately. */
  isFetchingList = false
  /**
   * @type {{ AniList: { perMinute: number, delayMs: number }, MyAnimeList: { perMinute: number, delayMs: number } }}
   * Rate limits per provider.
   */
  RATE_LIMITS = {
    AniList:     { perMinute: 8,  delayMs: 500 },
    MyAnimeList: { perMinute: 30, delayMs: 1_500 }
  }

  /**
   * @param {string} cacheKey Cache key used to persist the queue across sessions.
   * @param {string | null} [malAuth] If user is logged into MAL, tightens the MyAnimeList rate limit to 15 req/min.
   */
  constructor(cacheKey, malAuth) {
    this.#provider = cacheKey === 'syncQueueAni' ? 'AniList' : 'MyAnimeList'
    if (malAuth) this.RATE_LIMITS.MyAnimeList = { perMinute: 15, delayMs: 3_000 }
    try {
      const stored = cache.getEntry(caches.GENERAL, cacheKey)
      if (Array.isArray(stored) && stored.length) {
        this.#queue.value = stored
        debug(`[${this.#provider}] loaded ${this.#queue.value.length} persisted mutation(s)`)
      }
    } catch (error) {
      debug(`[${this.#provider}] failed to load:`, error)
      this.#queue.value = []
    }

    const updateCache = debounce((value) => {
      debug(`[${this.#provider}] the number of mutations in the queue have changed, saving to cache...`)
      cache.setEntry(caches.GENERAL, cacheKey, value.filter(mutation => !mutation.executed))
    }, 20)
    uniqueStore(this.#queue).subscribe(value => updateCache(value))
  }

  /**
   * Adds a mutation to the queue.
   * Duplicate favourite toggles for the same media cancel each other out, while duplicate entry/delete mutations use last-write-wins, preserving the original progressBefore and queuedAt.
   * Returns false if executed=true and the list is not currently being fetched, signaling the caller to apply the result immediately instead.
   *
   * @param {MutationType} type
   * @param {number} mediaId
   * @param {Record<string, any>} variables
   * @param {any} result
   * @param {number | null} [progressBefore] Progress before this mutation, used for stale-write detection.
   * @param {boolean} [executed] Whether the API call has already been made. Defaults to true.
   * @returns {boolean} false if the caller should apply the result immediately, true if queued.
   */
  enqueue(type, mediaId, variables, result, progressBefore = null, executed = true) {
    if (executed && !this.isFetchingList) return false
    const updatedVariables = { ...(variables || {}) }
    const userToken = updatedVariables.token
    if (userToken) {
      const profile = profiles.value.find(profile => profile?.token === userToken && profile?.viewer?.data?.Viewer?.id)
      if (profile) {
        delete updatedVariables.refresh_in
        delete updatedVariables.token
        updatedVariables.tokenUserId = profile.viewer.data.Viewer.id
      }
    }
    const mutation = { type, mediaId, variables: updatedVariables, result, progressBefore, executed, queuedAt: Date.now() }
    const queue = [...this.#queue.value]

    if (type === 'favourite') {
      const index = queue.findIndex(mutation => mutation.type === 'favourite' && mutation.mediaId === mediaId)
      if (index !== -1) {
        // Two toggles cancel out
        debug(`[${this.#provider}] favourite toggles for media ${mediaId} cancel out`)
        queue.splice(index, 1)
        this.#queue.value = queue
        return true
      }
    } else {
      const index = queue.findIndex(mutation => mutation.type === type && mutation.mediaId === mediaId)
      if (index !== -1) {
        // Last write wins, but preserve original progressBefore and queuedAt
        debug(`[${this.#provider}] replacing ${type} for media ${mediaId}`)
        queue[index] = { ...mutation, progressBefore: queue[index].progressBefore, queuedAt: queue[index].queuedAt }
        this.#queue.value = queue
        return true
      }
    }

    debug(`[${this.#provider}] enqueuing ${type} for media ${mediaId} (executed=${executed})`)
    this.#queue.value = [...queue, mutation]
    return true
  }

  /**
   * Returns the pre-mutation progress for a queued entry mutation, or null if none exists.
   * Used to avoid reading an already-optimistically-mutated cache value as the baseline.
   *
   * @param {number} mediaId
   * @returns {number | null}
   */
  getProgressBefore(mediaId) {
    return this.#queue.value.find(mutation => mutation.type === 'entry' && mutation.mediaId === mediaId)?.progressBefore ?? null
  }

  /** @returns {boolean} Whether there are any pending mutations in the queue. */
  get hasPending() {
    return this.#queue.value.length > 0
  }

  /**
   * Flushes the queue after userLists.value has been set.
   * All executed mutations are applied to the local cache immediately via applyFn, while offline mutations are sent to the API via executeFn with rate limiting.
   * Offline mutations remain in the persisted queue until they succeed, so an app restart mid-flush will retry them on next launch.
   *
   * @param {import('../anilist/al.d.ts').MediaListCollection | import('../myanimelist/mal.d.ts').MediaList | null} resolvedLists Fresh list data from the API, used for stale-write validation.
   * @param {(mutation: QueuedMutation) => Promise<void>} applyFn Applies a mutation to the local cache.
   * @param {(mutation: QueuedMutation) => Promise<void>} executeFn Sends an offline mutation to the API.
   */
  async flush(resolvedLists, applyFn, executeFn) {
    if (!this.#queue.value.length) return
    const snapshot = [...this.#queue.value]
    this.#queue.value = snapshot.filter(mutation => !mutation.executed) // Clear only the executed (session-only race-condition) mutations upfront, offline mutations stay in the queue until they successfully execute.
    debug(`[${this.#provider}] flushing ${snapshot.length} mutation(s)`)
    const offline = snapshot.filter(mutation => !mutation.executed)
    // Apply all validated mutations to local cache immediately so the UI is up to date regardless of how long the rate-limited API calls take.
    for (const mutation of [...snapshot.filter(mutation => mutation.executed).reverse(), ...offline]) {
      if (!this.#validate(mutation, resolvedLists)) continue
      if (mutation.executed) await applyFn(this.#resolveTokenFields(mutation))
      else if (mutation.result != null) await applyFn(this.#resolveTokenFields(mutation))
    }
    await this.#executeRateLimited(offline, resolvedLists, executeFn)
  }

  /**
   * Sends offline mutations to the API one-by-one, respecting the providers rate limit.
   * Each mutation is removed from the persisted queue only after it succeeds.
   * Failed mutations are left in the queue to be retried on the next flush.
   *
   * @param {QueuedMutation[]} mutations
   * @param {import('../anilist/al.d.ts').MediaListCollection | import('../myanimelist/mal.d.ts').MediaList | null} resolvedLists
   * @param {(mutation: QueuedMutation) => Promise<void>} executeFn
   */
  async #executeRateLimited(mutations, resolvedLists, executeFn) {
    const { perMinute, delayMs } = this.RATE_LIMITS[this.#provider]
    let executedThisWindow = 0
    let windowStart = Date.now()
    for (const mutation of mutations) {
      if (!this.#validate(mutation, resolvedLists)) {
        // Not valid... Discard and remove from the persisted queue
        this.#queue.value = this.#queue.value.filter(_mutation => !(_mutation.type === mutation.type && _mutation.mediaId === mutation.mediaId && _mutation.queuedAt === mutation.queuedAt))
        continue
      }

      // If we have hit the rate limit for this window, wait until the window resets
      if (executedThisWindow >= perMinute) {
        const elapsed = Date.now() - windowStart
        const waitMs = 60_000 - elapsed
        if (waitMs > 0) {
          debug(`[${this.#provider}] rate limit reached (${perMinute}/min), waiting ${waitMs}ms`)
          await new Promise(resolve => setTimeout(resolve, waitMs).unref?.())
        }
        executedThisWindow = 0
        windowStart = Date.now()
      }

      try {
        debug(`[${this.#provider}] executing offline ${mutation.type} for media ${mutation.mediaId}`)
        await executeFn(this.#resolveTokenFields(mutation))
        // Successfully executed, remove from the persisted queue
        this.#queue.value = this.#queue.value.filter(_mutation => !(_mutation.type === mutation.type && _mutation.mediaId === mutation.mediaId && _mutation.queuedAt === mutation.queuedAt))
        executedThisWindow++
      } catch (error) {
        debug(`[${this.#provider}] offline ${mutation.type} for media ${mutation.mediaId} failed, keeping in queue:`, error)
        // Leave it in the queue, it will be retried on next flush
      }
      // Small delay between requests to avoid hammering the API
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs).unref?.())
    }
  }

  /**
   * Validates a mutation against fresh server data to detect stale writes, delete and favourite mutations are always considered valid.
   * An entry mutation is invalid if the servers progress has already moved past the baseline recorded at queue time, indicating a newer write won.
   *
   * @param {QueuedMutation} mutation
   * @param {import('../anilist/al.d.ts').MediaListCollection | import('../myanimelist/mal.d.ts').MediaList | null} resolvedLists
   * @returns {boolean}
   */
  #validate(mutation, resolvedLists) {
    if (mutation.type === 'delete' || mutation.type === 'favourite') return true
    if (mutation.type === 'entry') {
      const targetProgress = mutation.executed ? mutation.result?.progress : mutation.variables?.episode
      if (targetProgress == null) return true
      const freshProgress = this.#findProgress(resolvedLists, mutation.mediaId)
      if (freshProgress == null) return true
      const progressBefore = mutation.progressBefore ?? freshProgress
      if (freshProgress > progressBefore) {
        debug(`[${this.#provider}] discard ${mutation.mediaId}: server (${freshProgress}) moved past start (${progressBefore})`)
        return false
      }
      return true
    }
    return true
  }

  /**
   * Looks up the current watch progress for a media entry from either an AniList or MAL list response.
   *
   * @param {import('../anilist/al.d.ts').MediaListCollection | import('../myanimelist/mal.d.ts').MediaList | null} lists
   * @param {number} mediaId
   * @returns {number | null}
   */
  #findProgress(lists, mediaId) {
    if (!lists) return null
    // AniList shape: { lists: [{ entries: [{ media: { id, mediaListEntry: { progress } } }] }] }
    if (lists.lists) {
      for (const list of lists.lists) {
        const entry = list.entries?.find(e => e.media?.id === mediaId)
        if (entry) return entry.media?.mediaListEntry?.progress ?? null
      }
      return null
    }
    // MAL shape: [{ node: { id, my_list_status: { num_episodes_watched } } }]
    if (Array.isArray(lists)) {
      const entry = lists.find(e => e.node?.id === mediaId)
      return entry?.node?.my_list_status?.num_episodes_watched ?? null
    }
    return null
  }

  /**
   * Restores the token and refresh_in fields to a mutations variables before execution.
   * At enqueue time these are replaced with tokenUserId to avoid persisting sensitive token data.
   *
   * @param {QueuedMutation} mutation
   * @returns {QueuedMutation}
   */
  #resolveTokenFields(mutation) {
    const { tokenUserId } = mutation.variables ?? {}
    if (!tokenUserId) return mutation
    const profile = profiles.value.find(profile => profile?.viewer?.data?.Viewer?.id === tokenUserId)
    if (!profile) return mutation
    const variables = { ...mutation.variables, token: profile.token, refresh_in: profile.refresh_in }
    delete variables.tokenUserId
    return { ...mutation, variables }
  }
}