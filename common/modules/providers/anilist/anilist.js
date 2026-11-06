import lavenshtein from 'js-levenshtein'
import { writable } from 'simple-store-svelte'
import Bottleneck from 'bottleneck'

import { alToken, settings, validateToken } from '@/modules/settings.js'
import { malDubs } from '@/modules/anime/animedubs.js'
import { isSubbedProgress, getMediaMaxEp } from '@/modules/anime/anime.js'
import { getRandomInt, sleep, debounce, uniqueStore, normalizeASCII, codes } from '@/modules/util.js'
import { printError, status, previousStatus } from '@/modules/networking.js'
import { cache, caches, mediaCache } from '@/modules/cache.js'
import { MutationQueue } from '@/modules/providers/lib/mutationqueue.js'
import { malClient } from '@/modules/providers/myanimelist/myanimelist.js'
import { queueNotification } from '@/modules/notification/manager.js'
import Helper from '@/modules/providers/helper.js'
import Debug from 'debug'
const debug = Debug('ui:anilist')
const trace = Debug('net:anilist')

const date = new Date()
export const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
export const currentSeason = seasons[Math.floor((date.getMonth() / 12) * 4) % 4]
export const currentYear = date.getFullYear()

/**
 * @param {import('./al.d.ts').Media & {lavenshtein?: number}} media
 * @param {string} name
 */
export function getDistanceFromTitle(media, name) {
  if (media) {
    const titles = Object.values(media.title).filter(v => v).map(title => lavenshtein(title.toLowerCase(), name.toLowerCase()))
    const synonyms = media.synonyms.filter(v => v).map(title => lavenshtein(title.toLowerCase(), name.toLowerCase()) + 2)
    const distances = [...titles, ...synonyms]
    return { ...media, lavenshtein: distances.reduce((prev, curr) => prev < curr ? prev : curr) }
  }
}

const queryObjects = /* js */`
id,
idMal,
title {
  romaji,
  english,
  native,
  userPreferred
},
description(asHtml: false),
endDate {
  year,
  month,
  day
},
startDate {
  year,
  month,
  day
},
season,
seasonYear,
format,
status,
episodes,
duration,
averageScore,
genres,
tags {
  name,
  rank,
  isGeneralSpoiler,
  isMediaSpoiler
},
isFavourite,
coverImage {
  extraLarge,
  medium,
  color
},
source,
countryOfOrigin,
isAdult,
bannerImage,
synonyms,
popularity,
trending,
stats {
  scoreDistribution {
    score,
    amount
    }
},
nextAiringEpisode {
  timeUntilAiring,
  episode
},
trailer {
  id,
  site
},
streamingEpisodes {
  title,
  thumbnail
},
mediaListEntry {
  id,
  progress,
  repeat,
  status,
  customLists(asArray: true),
  score(format: POINT_10),
  updatedAt,
  startedAt {
    year,
    month,
    day
  },
  completedAt {
    year,
    month,
    day
  }
},
airingSchedule(page: 1, perPage: 1000) {
  nodes {
    episode,
    airingAt
  }
},
relations {
  edges {
    relationType(version:2),
    node {
      id,
      type,
      format,
      genres,
      isAdult,
      seasonYear
    }
  }
}`

const queryComplexObjects = /* js */`
studios(sort: NAME, isMain: true) {
  nodes {
    name
  }
},
recommendations {
  edges {
    node {
      rating,
      mediaRecommendation {
        id,
        genres,
        isAdult,
      }
    }
  }
}`

class AnilistClient {
  limiter = new Bottleneck({
    reservoir: 30, // should be 90 but api is heavily degraded...
    reservoirRefreshAmount: 30, // should be 90 but api is heavily degraded...
    reservoirRefreshInterval: 64 * 1_000,
    maxConcurrent: 10,
    minTime: 260 // burst limit is 4 rq/s
  })

  rateLimitPromise = null
  rateLimitUntil = 0
  searchSnapshots = new Map()

  #listPromise = Promise.resolve()

  #isFlushingMutations = false
  #fetchingLists = 0

  /** @type {import('simple-store-svelte').Writable<ReturnType<AnilistClient['getUserLists']>>} */
  userLists = writable()

  mutationQueue = new MutationQueue('syncQueueAni')

  userID = alToken

  _status = status.value

  constructor() {
    debug('Initializing Anilist Client for ID ' + this.userID?.viewer?.data?.Viewer?.id)
    this.limiter.on('depleted', async () => {
      trace('AniList limiter reservoir depleted, jobs will queue until next refresh')
      if (status.value !== 'online') return
      status.set('limited_anilist')
      while ((await this.limiter.currentReservoir()) <= 0) {
        await sleep(100)
      }
      if (status.value === 'limited_anilist') status.set('online')
    })
    this.limiter.on('failed', async (error, jobInfo) => {
      if (status.value.match(/offline/i)) throw new Error('Failed making request to Anilist, network is offline... not retrying')
      else if (jobInfo.retryCount >= 1 && error.status !== 429) await printError('Search Failed', 'Failed making request to Anilist!', error, 20_000)
      const errorTrace = `Error: ${error.status || 429} - ${error.message || error.statusText || codes[error.status || 429]}`

      if (error.status === 429) { // rate limited...
        const resetHeader = error.headers?.get('x-ratelimit-reset')
        const retryHeader = error.headers?.get('retry-after')
        const resetAt = Number(resetHeader)
        const retryAfter = Number(retryHeader)
        const resetTime = resetHeader != null && Number.isFinite(resetAt) && resetAt > 0 ? Math.max((resetAt * 1_000) - Date.now(), 0) + 1_000 : 0
        const retryTime = retryHeader != null && Number.isFinite(retryAfter) && retryAfter >= 0 ? (retryAfter + 1) * 1_000 : 0
        this.rateLimitUntil = Math.max(this.rateLimitUntil, Date.now() + (Math.max(resetTime, retryTime) || 64_000))
        if (!this.rateLimitPromise) {
          this._status = status.value
          this.rateLimitPromise = (async () => {
            while (this.rateLimitUntil > Date.now()) await sleep(this.rateLimitUntil - Date.now())
            this.rateLimitUntil = 0
            this.rateLimitPromise = null
            if (status.value === 'limited_anilist') status.set(this._status)
          })()
        }
        if (!status.value.match(/offline/i) && status.value !== 'limited_anilist' && (this.rateLimitUntil - Date.now()) > 6_000) status.set('limited_anilist')
        return
      }

      if (jobInfo.retryCount >= 1) { // give up after 2 total attempts, let it reject so callers can fall back
        trace(`Giving up on request after ${jobInfo.retryCount + 1} attempts`, errorTrace)
        return
      }

      return 2_000 + 6_000 * jobInfo.retryCount // initial 2s delay, +6s per subsequent retry, for 500/502/503/504 etc
    })

    if (this.userID?.viewer?.data?.Viewer) {
      validateToken(this.userID.token) // Check if token is expired on startup.
      this.userLists.value = this.getUserLists({ sort: 'UPDATED_TIME_DESC'}, true)
      setTimeout(() => {
        this.getUserLists({ sort: 'UPDATED_TIME_DESC' }).then(updatedLists => {
          this.userLists.value = Promise.resolve(updatedLists) // no need to have userLists await the entire query process while we already have previous values, (it's awful to wait 15+ seconds for the query to succeed with large lists)
          return this.#flushMutationQueue()
        }).catch(error => debug('Failed to update user lists on init, this is likely a temporary connection issue:', error))
      }).unref?.()
      this.findNewNotifications().catch((error) => debug('Failed to get new anilist notifications at the scheduled interval, this is likely a temporary connection issue:', JSON.stringify(error)))
      // update userLists every 15 mins
      setInterval(() => {
        this.getUserLists({ sort: 'UPDATED_TIME_DESC' }).then(updatedLists => {
          this.userLists.value = Promise.resolve(updatedLists) // no need to have userLists await the entire query process while we already have previous values, (it's awful to wait 15+ seconds for the query to succeed with large lists)
          return this.#flushMutationQueue()
        }).catch(error => debug('Failed to update user lists at the scheduled interval, this is likely a temporary connection issue:', error))
      }, 1_000 * 60 * 15)
      // check notifications every 5 mins
      setInterval(() => this.findNewNotifications().catch((error) => debug('Failed to get new anilist notifications at the scheduled interval, this is likely a temporary connection issue:', JSON.stringify(error))), 1_000 * 60 * 5)
      // update userLists and flush queued offline mutations when back online
      uniqueStore(status).subscribe(value => {
        if (!(previousStatus.value.match(/offline/i) && value === 'online')) return
        debug(`Back online${this.mutationQueue.hasPending ? ' with pending mutations' : ''}, refreshing user lists`)
        this.getUserLists({ sort: 'UPDATED_TIME_DESC' }, false, true).then(updatedLists => {
          this.userLists.value = Promise.resolve(updatedLists)
          if (this.mutationQueue.hasPending) return this.#flushMutationQueue()
        }).catch(error => debug('Failed to refresh user lists after coming online:', error))
      })
    } else {
      uniqueStore(status).subscribe(value => {
        if (!(previousStatus.value.match(/offline/i) && value === 'online') || !this.mutationQueue.hasPending) return
        debug('Back online with pending mutations, flushing mutation queue...')
        this.#flushMutationQueue().catch(error => debug('Failed to replay mutations after coming online:', error))
      })
    }
  }

  numberOfQueries = 0
  /** @type {(options: RequestInit) => Promise<any>} */
  handleRequest = async opts => {
    if (this.rateLimitPromise) await this.rateLimitPromise
    try {
      return await this.limiter.schedule(async () => {
        // Skip using token if its expired, causes fetch to fail for queries that do not need a token.
        if (opts.headers.Authorization && this.userID && this.userID.reauth && this.userID.token === opts.headers.Authorization && (!this.userID.expires_in || (Math.floor(Date.now() / 1_000) >= (this.userID.expires_in + 30 * 24 * 60 * 60)))) {
          delete opts.headers.Authorization
        }
        validateToken(opts.headers.Authorization)
        if (status.value.match(/offline/i)) throw new Error('AniList API is temporarily disabled or network is offline')
        const numberOfQueries = this.numberOfQueries
        trace(`[${numberOfQueries}] requesting`, JSON.stringify(this.limiter.counts()), JSON.stringify({ ...opts, headers: { ...opts.headers, Authorization: opts.headers.Authorization ? '[redacted]' : undefined } }))
        this.numberOfQueries++
        let res = {}
        try {
          res = await fetch('https://graphql.anilist.co', opts)
        } catch (e) {
          if (!res || res.status !== 404) throw e
        }
        trace(`[${numberOfQueries}] request settled`, JSON.stringify({ status: res?.status, limit: res.headers?.get('x-ratelimit-limit'), remaining: res.headers?.get('x-ratelimit-remaining'), reset: res.headers?.get('x-ratelimit-reset'), retryAfter: res.headers?.get('retry-after') }))
        if (!res.ok && (res.status === 429 || res.status >= 500)) {
          throw res
        }
        let json = null
        try {
          json = await res.json()
        } catch (error) {
          if (res.ok) printError('Search Failed', 'Failed making request to Anilist!', error)
        }
        if (!res.ok && res.status !== 404) {
          if (json) {
            for (const error of json?.errors || []) {
              if (error.status === 400 && error.message?.match(/invalid token/i) && opts.headers.Authorization && !validateToken(opts.headers.Authorization, true)) {
                return { data: null, errors: [{ message: 'AniList session has expired. Please go to Profiles and log in again to continue syncing.', status: 401 }] }
              }
              printError('Search Failed', 'Failed making request to Anilist!', error)
            }
          } else {
            printError('Search Failed', 'Failed making request to Anilist!', res)
          }
        }
        return json || res
      })
    } catch (error) {
      if (error?.status !== 429) throw error
      return this.handleRequest(opts)
    }
  }

  /**
   * @param {string} query
   * @param {Record<string, any>} variables
   */
  alRequest (query, variables) {
    const vars =  {
      variables: {
        page: 1,
        perPage: 50,
        sort: 'TRENDING_DESC',
        ...variables
      }
    }
    delete vars.variables.token
    delete vars.variables.refresh_in
    delete vars.variables.tokenUserId
    if (vars?.variables?.sort === 'OMIT') { delete vars.variables.sort }

    /** @type {RequestInit} */
    const options = {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        query: query.replace(/\s/g, '').replaceAll('&nbsp;', ' '),
        ...vars
      })
    }
    if (variables?.token) options.headers.Authorization = variables.token
    else if (alToken?.token) options.headers.Authorization = alToken.token

    return this.handleRequest(options)
  }

  /** @returns {Promise<import('./al.d.ts').Query<{ Viewer: import('./al.d.ts').Viewer }>>} */
  viewer (variables = {}) {
    debug('Getting viewer')
    const query = /* js */`
    query {
      Viewer {
        avatar {
          medium,
          large
        },
        name,
        id,
        mediaListOptions {
          animeList {
            customLists
          }
        }
      }
    }`

    return this.alRequest(query, variables)
  }

  async findNewNotifications() {
    if (settings.value.aniNotify !== 'none') {
      debug('Checking for new AniList notifications')
      const res = await this.getNotifications()
      const notifications = res?.data?.Page?.notifications
      const lastNotified = cache.getEntry(caches.NOTIFICATIONS, 'lastAni')
      const newNotifications = (lastNotified > 0) && notifications ? notifications.filter(({createdAt}) => createdAt > lastNotified) : []
      debug(`Found ${newNotifications?.length} new notifications`)
      for (const { media, episode, type, createdAt } of newNotifications) {
        if ((settings.value.aniNotify !== 'limited' || type !== 'AIRING') && media.type === 'ANIME' && media.format !== 'MUSIC' && (!settings.value.preferDubs || (media?.status === 'FINISHED' && !['CURRENT', 'REPEATING']?.includes(media?.mediaListEntry?.status)) || !(await malDubs.isDubMedia(media)) || await isSubbedProgress(await cache.requestMedia(media?.id)))) {
          queueNotification({
            id: media?.id,
            title: media.title.userPreferred,
            message: type === 'AIRING' ? `${media.format !== 'MOVIE' ? `Episode ${episode}` : `The Movie`} (Sub) is out in Japan, ${media.format !== 'MOVIE' ? `it should be available soon.` : `, if this is a theatrical release it will likely a few months before it is available for streaming.`}` : 'Was recently announced!',
            icon: media.coverImage.medium,
            iconXL: media.coverImage.extraLarge,
            heroImg: media?.bannerImage || (media?.trailer?.id && `https://i.ytimg.com/vi/${media?.trailer?.id}/hqdefault.jpg`),
            ...(type === 'AIRING' ? { episode: episode } : {}),
            timestamp: createdAt,
            format: media?.format,
            dub: false,
            click_action: (type === 'AIRING' ? 'PLAY' : 'VIEW'),
            button: [{ text: 'View Anime', activation: `shiru://anime/${media?.id}` }],
            activation: {
              type: 'protocol',
              launch: `shiru://anime/${media?.id}`
            }
          })
        }
      }
      if ((newNotifications?.length > 0) || (lastNotified <= 1)) cache.setEntry(caches.NOTIFICATIONS, 'lastAni', Date.now() / 1_000)
    }
  }

  /** @returns {Promise<import('./al.d.ts').PagedQuery<{ notifications: { id: number, type: string, createdAt: number, episode: number, media: import('./al.d.ts').Media}[] }>>} */
  getNotifications(variables = {}) {
    debug('Getting notifications')
    const cachedEntry = cache.cachedEntry(caches.QUERY_NOTIFICATIONS, 'anilist_related_airing', status.value.match(/offline/i))
    if (cachedEntry) return cachedEntry
    const query = /* js */`
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        notifications(resetNotificationCount: false, type_in: [AIRING, RELATED_MEDIA_ADDITION]) {
          ...on&nbsp;AiringNotification {
            id,
            type,
            episode,
            createdAt,
            media {
              id,
              idMal,
              type,
              format,
              title {
                userPreferred
              },
              coverImage {
                medium
              },
              mediaListEntry {
                status
              }
            }
          },
          ...on&nbsp;RelatedMediaAdditionNotification {
            id,
            type,
            createdAt,
            media {
              id,
              type,
              format,
              title {
                userPreferred
              },
              coverImage {
                medium
              }
            }
          }
        }
      }
    }`
    return cache.cacheEntry(caches.QUERY_NOTIFICATIONS, 'anilist_related_airing', variables, this.alRequest(query, variables), Date.now() + 4 * 60 * 1_000) // expire after 4 minutes as this will be re-cached by our 5-minute interval.
  }

  /** @returns {Promise<import('./al.d.ts').Query<{ MediaListCollection: import('./al.d.ts').MediaListCollection }>>} */
  async getUserLists(variables = {}, ignoreExpiry = false, ignoreCache = false) {
    debug('Getting user lists')
    await this.#listPromise
    variables.id = variables.userID || this.userID?.viewer?.data?.Viewer?.id
    const userSort = variables.sort || 'UPDATED_TIME_DESC'
    if (!variables.sort || Helper.isUserSort(variables)) variables.sort = 'UPDATED_TIME_DESC'
    const cachedEntry = !ignoreCache && this.sortListEntries(userSort, await cache.cachedEntry(caches.USER_LISTS, JSON.stringify(variables), ignoreExpiry || status.value.match(/offline/i)))
    if (cachedEntry) return cachedEntry

    const query = /* js */`
      query($id: Int, $sort: [MediaListSort]) {
        MediaListCollection(userId: $id, type: ANIME, sort: $sort, forceSingleCompletedList: true) {
          lists {
            status,
            entries {
              media {
                ${queryObjects}${settings.value.queryComplexity === 'Complex' ? `, ${queryComplexObjects}` : ``}
              }
            }
          }
        }
      }`
    this.#fetchingLists++
    this.mutationQueue.isFetchingList = true
    try {
      let res
      for (let attempt = 1; attempt <= 3; attempt++) { // VERY large user lists can sometimes result in a timeout, typically trying again succeeds.
        res = await this.alRequest(query, variables)
        if (res?.data?.MediaListCollection) break
        if (attempt < 3) { // stupid fix... probably could be improved...
          debug(`Error fetching user lists, attempt ${attempt} failed. Retrying in 5 seconds...`)
          await new Promise(resolve => setTimeout(resolve, 5_000).unref?.())
        } else {
          debug('Failed fetching user lists. Maximum of 3 attempts reached, giving up.')
        }
      }

      const result = await cache.cacheEntry(caches.USER_LISTS, JSON.stringify(variables), variables, res, Date.now() + 14 * 60 * 1_000) // expire after 14 minutes as this will be re-cached by our 15-minute interval.
      return this.sortListEntries(userSort, result)
    } finally {
      this.#fetchingLists--
      this.mutationQueue.isFetchingList = this.#fetchingLists > 0
    }
  }

  /**
   * Sorts the media list entries based on the specified sorting criteria.
   * UPDATED_TIME_DESC should be the default sort for the data, so if this is used the list will not be sorted.
   * @param {string} sort The sorting type (e.g., 'STARTED_ON_DESC', 'FINISHED_ON_DESC').
   * @param {Object} data The media list data containing the lists and entries.
   * @returns {Object} The reorganized media list with sorted entries.
   */
  sortListEntries(sort, data) {
    if (!data?.data?.MediaListCollection?.lists) return data
    const res = data
    debug('Sorting user lists based on custom sort order:', sort)
    const getSortValue = (entry) => {
      switch (sort) {
        case 'STARTED_ON_DESC':
          return entry?.media?.mediaListEntry?.startedAt ? (entry.media.mediaListEntry.startedAt.year || 0) * 10_000 + (entry.media.mediaListEntry.startedAt.month || 0) * 100 + (entry.media.mediaListEntry.startedAt.day || 0) : 0
        case 'FINISHED_ON_DESC':
          return entry?.media?.mediaListEntry?.completedAt ? (entry.media.mediaListEntry.completedAt.year || 0) * 10_000 + (entry.media.mediaListEntry.completedAt.month || 0) * 100 + (entry.media.mediaListEntry.completedAt.day || 0) : 0
        case 'PROGRESS_DESC': {
          const totalEpisodes = entry?.media?.episodes ?? getMediaMaxEp(entry?.media) ?? 0
          const progress = entry?.media?.mediaListEntry?.progress ?? 0
          if (progress === 0) return Infinity
          if (totalEpisodes === 0) return -progress
          const distance = totalEpisodes - progress
          return distance <= 0 ? -Infinity : distance
        }
        case 'USER_SCORE_DESC': // doesn't exist, AniList uses SCORE_DESC for both MediaSort and MediaListSort.
          return entry?.media?.mediaListEntry?.score || 0
        case 'UPDATED_TIME_DESC':
          return entry?.media?.mediaListEntry?.updatedAt || 0
        default:
          return 0
      }
    }
    (res.data.MediaListCollection?.lists || []).forEach(list => {
      list.entries = list.entries.filter(entry => entry.media).sort((a, b) => {
        const aValue = getSortValue(a)
        const bValue = getSortValue(b)
        if (sort === 'PROGRESS_DESC') return aValue - bValue
        if (aValue === 0 && bValue !== 0) return 1
        if (bValue === 0 && aValue !== 0) return -1
        return bValue - aValue // Descending order, this will need to change to implement different sort orders in the future.
      })
    })
    return res
  }

  async entry(variables) {
    debug(`Updating entry for ${variables.id}`)

    const progressBefore = this.mutationQueue.getProgressBefore(variables.id, variables) ?? (!variables.token ? cache.getMedia(variables.id)?.mediaListEntry?.progress : null) ?? null
    if (status.value.match(/offline/i) && settings.value.offlineSync) {
      debug(`We are offline and offline syncing is enabled, queuing entry update for media ${variables.id}`)
      this.mutationQueue.enqueue('entry', variables.id, variables, null, progressBefore, false)
      return { data: { SaveMediaListEntry: { ...(await this.#applyEntry(variables)) } } }
    }

    const query = /* js */`
      mutation($id: Int, $status: MediaListStatus, $episode: Int, $repeat: Int, $score: Int, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
        SaveMediaListEntry(mediaId: $id, status: $status, progress: $episode, repeat: $repeat, scoreRaw: $score, startedAt: $startedAt, completedAt: $completedAt) {
          id,
          status,
          progress,
          score,
          repeat,
          updatedAt,
          startedAt {
            year,
            month,
            day
          },
          completedAt {
            year,
            month,
            day
          }
        }
      }`
    const pendingBefore = this.mutationQueue.getPending(variables.id, variables)
    const res = await this.alRequest(query, variables)
    const listEntry = res?.data?.SaveMediaListEntry
    if (res?.errors?.length || !listEntry) return
    if (!variables.token) {
      this.mutationQueue.enqueue('entry', variables.id, variables, listEntry, progressBefore, true, pendingBefore)
      await this.updateListEntry(variables.id, listEntry)
    }
    //TODO: need to implement "else" for anilist syncing functionality. #updateListEntry
    return res
  }

  async delete(variables) {
    debug(`Deleting entry for ${variables.id}`)

    if (status.value.match(/offline/i) && settings.value.offlineSync) {
      debug(`We are offline and offline syncing is enabled, queuing entry deletion for media ${variables.id}`)
      this.mutationQueue.enqueue('delete', variables.idAni, variables, null, null, false)
      if (!variables.token) await this.deleteListEntry(variables.idAni)
      return { data: { DeleteMediaListEntry: { deleted: true } } }
    }

    const query = /* js */`
      mutation($id: Int) {
        DeleteMediaListEntry(id: $id) {
          deleted
        }
      }`
    const pendingBefore = this.mutationQueue.getPending(variables.idAni, variables)
    const res = await this.alRequest(query, variables)
    if (res?.errors?.length || res?.data?.DeleteMediaListEntry?.deleted !== true) return
    if (!variables.token) {
      this.mutationQueue.enqueue('delete', variables.idAni, variables, null, null, true, pendingBefore)
      await this.deleteListEntry(variables.idAni)
    }
    //TODO: need to implement "else" for anilist syncing functionality. #deleteListEntry
    return res
  }

  async updateListEntry(mediaId, listEntry) {
    const result = this.#listPromise.then(async () => {
      const lists = (await this.userLists.value).data.MediaListCollection.lists?.map(list => ({ ...list, entries: list.entries.filter(entry => entry.media.id !== mediaId) }))
      let targetList = lists.find(list => list.status === listEntry?.status)
      if (!targetList) {
        targetList = { status: listEntry?.status, entries: [] }
        lists.push(targetList)
      }
      cache.updateMedia([{ ...(await cache.requestMedia(mediaId)), mediaListEntry: listEntry }])
      targetList.entries.unshift({ media: await cache.requestMedia(mediaId) })
      const res = Promise.resolve({
        data: {
          MediaListCollection: {
            lists: lists
          }
        }
      })
      cache.cacheEntry(caches.USER_LISTS, JSON.stringify({ sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer?.id }), { sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer?.id }, res, (await cache.cachedEntry(caches.USER_LISTS, JSON.stringify({ sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer?.id })))?.expiry || (Date.now() + 14 * 60 * 1_000))
      this.userLists.value = res
    })
    this.#listPromise = result.catch(() => {})
    return await result
  }

  async deleteListEntry(mediaId) {
    const result = this.#listPromise.then(async () => {
      cache.updateMedia([{ ...(await cache.requestMedia(mediaId)), mediaListEntry: null }])
      const res = Promise.resolve({
        data: {
          MediaListCollection: {
            lists: (await this.userLists.value)?.data?.MediaListCollection?.lists?.map(list => {
              return {...list, entries: list.entries.filter(entry => entry.media.id !== mediaId)}
            })
          }
        }
      })
      cache.cacheEntry(caches.USER_LISTS, JSON.stringify({ sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer?.id }), { sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer?.id }, res, (await cache.cachedEntry(caches.USER_LISTS, JSON.stringify({ sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer?.id })))?.expiry || (Date.now() + 14 * 60 * 1_000))
      this.userLists.value = res
    })
    this.#listPromise = result.catch(() => {})
    return await result
  }

  /** @param {{key: string, title: string, year?: string, isAdult: boolean}[]} flattenedTitles */
  async alSearchCompound(flattenedTitles) {
    debug(`Searching for ${flattenedTitles?.length} titles via compound search`)
    const cachedEntry = cache.cachedEntry(caches.QUERY_COMPOUND, JSON.stringify(flattenedTitles),  status.value.match(/offline/i))
    if (cachedEntry) return cachedEntry

    if (!flattenedTitles.length) return []
    // isAdult doesn't need an extra variable, as the title is the same regardless of type, so we re-use the same variable for adult and non-adult requests
    /** @type {Record<`v${number}`, string>} */
    const requestVariables = flattenedTitles.reduce((obj, { title, isAdult }, i) => {
      if (isAdult && i !== 0) return obj
      obj[`v${i}`] = normalizeASCII(title) // stupid fix because AniList search sucks.
      return obj
    }, {})

    const queryVariables = flattenedTitles.reduce((arr, { isAdult }, i) => {
      if (isAdult && i !== 0) return arr
      arr.push(`$v${i}: String`)
      return arr
    }, []).join(', ')
    const fragmentQueries = flattenedTitles.map(({ year, isAdult }, i) => /* js */`
    v${i}: Page(perPage: 10) {
      media(type: ANIME, search: $v${(isAdult && i !== 0) ? i - 1 : i}, status_not: CANCELLED, isAdult: ${!!isAdult} ${year ? `, seasonYear: ${year}` : ''}) {
        ...med
      }
    }`)

    const query = /* js */`
    query(${queryVariables}) {
      ${fragmentQueries}
    }

    fragment&nbsp;med&nbsp;on&nbsp;Media {
      id,
      title {
        romaji,
        english,
        native,
        userPreferred
      },
      synonyms
    }`

    /**
     * @type {import('./al.d.ts').Query<Record<string, {media: import('./al.d.ts').Media[]}>>}
     * @returns {Promise<[string, import('./al.d.ts').Media][]>}
     */
    const res = await this.alRequest(query, requestVariables)
    if (!res?.data || Object.values(res.data).every(({ media }) => !media.length)) return cache.cachedEntry(caches.QUERY_COMPOUND, JSON.stringify(flattenedTitles), true) // if the query failed just return the potential cache... better to have something than nothing.

    /** @type {Record<string, number>} */
    const searchResults = {}
    for (const [variableName, { media }] of Object.entries(res.data)) {
      if (!media.length) continue
      const titleObject = flattenedTitles[Number(variableName.slice(1))]
      if (searchResults[titleObject.key]) continue
      searchResults[titleObject.key] = media.map(media => getDistanceFromTitle(media, titleObject.title)).reduce((prev, curr) => prev.lavenshtein <= curr.lavenshtein ? prev : curr).id
      // Convoluted and not as good as distance matching, better to return more than less.
      //   if (searchResults[titleObject.key]) continue
      //   for (const mediaItem of media) {
      //     if (matchKeys(mediaItem, titleObject.title, ['title.userPreferred', 'title.english', 'title.romaji', 'title.native', 'synonyms'], titleObject.title.length > 15 ? 0.2 : titleObject.title.length > 9 ? 0.15 : 0.1)) {
      //       searchResults[titleObject.key] = mediaItem.id
      //       break
      //     }
      //   }
      //   searchResults[titleObject.key] = !searchResults[titleObject.key] ? media.map(media => getDistanceFromTitle(media, titleObject.title)).reduce((prev, curr) => prev.lavenshtein <= curr.lavenshtein ? prev : curr).id : searchResults[titleObject.key]
    }

    const ids = Object.values(searchResults)
    const search = await this.searchIDS({ id: ids, perPage: 50, sort: 'OMIT' })
    const mappedResults = Object.entries(searchResults)?.map(([filename, id]) => [filename, search?.data?.Page?.media?.find(media => media.id === id)])
    return mappedResults ? cache.cacheEntry(caches.QUERY_COMPOUND, JSON.stringify(flattenedTitles), { mappings: true, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, mappedResults, Date.now() + getRandomInt(60, 90) * 60 * 1_000) : cache.cachedEntry(caches.COMPOUND, JSON.stringify(flattenedTitles), true)
  }

  search(variables = {}, searchCache = true) {
    if (settings.value.adult === 'none') variables.isAdult = false
    if (settings.value.adult !== 'hentai' && (!variables.genre_not || !variables.genre_not.includes('Hentai'))) variables.genre_not = [ ...(variables.genre_not ? variables.genre_not : []), 'Hentai' ]
    if (searchCache && variables.search?.trim().length >= 3) return this.searchWithCache({ ...variables })
    if (variables.search) variables.search = normalizeASCII(variables.search) // stupid fix because AniList search sucks.

    debug(`Searching ${JSON.stringify(variables)}`)
    const cachedEntry = !variables.skipCache && cache.cachedEntry(caches.QUERY_SEARCH, JSON.stringify(variables), status.value.match(/offline/i))
    if (cachedEntry) return cachedEntry
    const query = /* js */`
    query($page: Int, $perPage: Int, $sort: [MediaSort], $search: String, $onList: Boolean, $status: [MediaStatus], $status_not: [MediaStatus], $season: MediaSeason, $year: Int, $genre: [String], $genre_not: [String], $tag: [String], $tag_not: [String], $format: [MediaFormat], $format_not: [MediaFormat], $id_not: [Int], $idMal_not: [Int], $id: [Int], $idMal: [Int], $isAdult: Boolean) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          hasNextPage
        },
        media(id_not_in: $id_not, idMal_not_in: $idMal_not, id_in: $id, idMal_in: $idMal, type: ANIME, search: $search, sort: $sort, onList: $onList, status_in: $status, status_not_in: $status_not, season: $season, seasonYear: $year, genre_in: $genre, genre_not_in: $genre_not, tag_in: $tag, tag_not_in: $tag_not, format_in: $format, format_not: MUSIC, format_not_in: $format_not, isAdult: $isAdult) {
          ${queryObjects}${settings.value.queryComplexity === 'Complex' ? `, ${queryComplexObjects}` : ``}
        }
      }
    }`

    const request = (async () => {
      try {
        return await this.alRequest(query, variables)
      } catch (error) {
        if (!searchCache) throw error
        return this.fallbackSearch(variables)
      }
    })()

    return cache.cacheEntry(caches.QUERY_SEARCH, JSON.stringify(variables), { ...variables, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, request, Date.now() + getRandomInt(75, 100) * 60 * 1_000)
  }

  /**
   * Supplement title searches with a stable set of fuzzy cache candidates.
   * AniList applies online filters and metric sorts to the combined IDs.
   * @param variables
   */
  searchWithCache(variables) {
    if (status.value.match(/offline/i)) return this.fallbackSearch(variables)
    const { page = 1, perPage = 50, ...filters } = variables
    const start = (page - 1) * perPage
    const end = start + perPage
    const key = JSON.stringify([!!Helper.isAniAuth(), Helper.getUser()?.id, settings.value.queryComplexity, perPage, filters])
    let snapshot = this.searchSnapshots.get(key)
    if (!snapshot || page === 1) {
      snapshot = { media: [], candidates: null, nextPage: 1, hasNextPage: true, extras: [], extraIndex: 0, pending: Promise.resolve() }
      this.searchSnapshots.delete(key)
      if (this.searchSnapshots.size >= 10) this.searchSnapshots.delete(this.searchSnapshots.keys().next().value)
      this.searchSnapshots.set(key, snapshot)
    }

    const request = snapshot.pending.then(async () => {
      while (snapshot.hasNextPage && snapshot.media.length < end) {
        const res = await this.search({ ...filters, page: snapshot.nextPage, perPage: 50 }, false)
        if (!Array.isArray(res?.data?.Page?.media)) throw new Error('AniList search returned no media page')
        const knownIDs = new Set(snapshot.media.map(media => media.id))
        for (const media of res.data.Page.media) {
          if (media && !knownIDs.has(media.id)) { snapshot.media.push(media); knownIDs.add(media.id) }
        }
        snapshot.hasNextPage = !!res.data.Page.pageInfo?.hasNextPage
        snapshot.nextPage++
        if (!res.data.Page.media.length && snapshot.hasNextPage) throw new Error('AniList search returned an empty intermediate page')
      }
      if (!snapshot.candidates) {
        const cached = await this.fallbackSearch({ ...filters, page: 1, perPage: Math.max(Object.keys(mediaCache.value || {}).length, 1), sort: 'SEARCH_MATCH' })
        snapshot.candidates = cached.data.Page.media.map(media => media.id)
      }
      const primaryIDs = new Set(snapshot.media.map(media => media.id))
      const extraIDs = snapshot.candidates.filter(id => !primaryIDs.has(id))
      if (extraIDs.length && filters.sort !== 'OMIT' && ![filters.sort].flat().includes('SEARCH_MATCH')) {
        const res = await this.search({ ...filters, search: undefined, id: [...primaryIDs, ...extraIDs], page, perPage }, false)
        if (!Array.isArray(res?.data?.Page?.media)) throw new Error('AniList cache search returned no media page')
        return {
          ...res,
          data: {
            ...res.data,
            Page: {
              ...res.data.Page,
              pageInfo: { ...res.data.Page.pageInfo, hasNextPage: snapshot.hasNextPage || !!res.data.Page.pageInfo?.hasNextPage }
            }
          }
        }
      }

      // Preserve AniList order before appending additional, fuzzy-ranked matches.
      if (!snapshot.hasNextPage) {
        while (snapshot.extraIndex < extraIDs.length && snapshot.extras.length <= end - snapshot.media.length) {
          const ids = extraIDs.slice(snapshot.extraIndex, snapshot.extraIndex + 50)
          const res = await this.search({ ...filters, search: undefined, sort: 'ID', id: ids, page: 1, perPage: 50 }, false)
          if (!Array.isArray(res?.data?.Page?.media)) throw new Error('AniList cache search returned no media page')
          const byID = new Map(res.data.Page.media.map(media => [media.id, media]))
          snapshot.extras.push(...ids.map(id => byID.get(id)).filter(Boolean))
          snapshot.extraIndex += ids.length
        }
      }
      const media = [...snapshot.media, ...snapshot.extras]
      return { data: { Page: { pageInfo: { hasNextPage: snapshot.hasNextPage || media.length > end }, media: media.slice(start, end) } } }
    })
    snapshot.pending = request.catch(() => {})
    return request.catch(() => {
      if (this.searchSnapshots.get(key) === snapshot) this.searchSnapshots.delete(key)
      return this.fallbackSearch(variables)
    })
  }

  searchIDSingle(variables) {
    variables.sort = variables.sort || 'OMIT'
    debug(`Searching for ID: ${variables?.id || variables?.idMal}`)
    const cachedEntry = cache.cachedEntry(caches.QUERY_SEARCH_IDS, JSON.stringify(variables), status.value.match(/offline/i))
    if (cachedEntry) return cachedEntry
    const query = /* js */`
    query($id: Int, $idMal: Int) {
      Media(id: $id, idMal: $idMal, type: ANIME) {
        ${queryObjects}${settings.value.queryComplexity === 'Complex' ? `, ${queryComplexObjects}` : ``}
      }
    }`

    const request = (async () => {
      try {
        return await this.alRequest(query, variables)
      } catch {
        return this.fallbackSearch(variables, true)
      }
    })()

    return cache.cacheEntry(caches.QUERY_SEARCH_IDS, JSON.stringify(variables), { ...variables, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, request, Date.now() + getRandomInt(80, 100) * 60 * 1_000)
  }

  /** returns {import('./al.d.ts').PagedQuery<{media: import('./al.d.ts').Media[]}>} */
  searchIDS(variables) {
    if (variables?.id?.length === 0) return
    variables.sort = variables.sort || 'OMIT'
    if (settings.value.adult === 'none') variables.isAdult = false
    if (settings.value.adult !== 'hentai' && (!variables.genre_not || !variables.genre_not.includes('Hentai'))) variables.genre_not = [ ...(variables.genre_not ? variables.genre_not : []), 'Hentai' ]
    if (variables.search?.trim().length >= 3) return this.searchWithCache({ ...variables })
    if (variables.search) variables.search = normalizeASCII(variables.search) // stupid fix because AniList search sucks.

    debug(`Searching for IDs ${JSON.stringify(variables)}`)
    const cachedEntry = !variables.skipCache && cache.cachedEntry(caches.QUERY_SEARCH_IDS, JSON.stringify(variables), status.value.match(/offline/i))
    if (cachedEntry) return cachedEntry
    const query = /* js */`
    query($id: [Int], $idMal: [Int], $id_not: [Int], $page: Int, $perPage: Int, $status: [MediaStatus], $onList: Boolean, $sort: [MediaSort], $search: String, $season: MediaSeason, $year: Int, $genre: [String], $genre_not: [String], $tag: [String], $tag_not: [String], $format: [MediaFormat], $isAdult: Boolean) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          hasNextPage
        },
        media(id_in: $id, idMal_in: $idMal, id_not_in: $id_not, type: ANIME, status_in: $status, onList: $onList, search: $search, sort: $sort, season: $season, seasonYear: $year, genre_in: $genre, genre_not_in: $genre_not, tag_in: $tag, tag_not_in: $tag_not, format_in: $format, isAdult: $isAdult) {
          ${queryObjects}${settings.value.queryComplexity === 'Complex' ? `, ${queryComplexObjects}` : ``}
        }
      }
    }`

    const request = (async () => {
      try {
        return await this.alRequest(query, variables)
      } catch {
        return this.fallbackSearch(variables)
      }
    })()

    return cache.cacheEntry(caches.QUERY_SEARCH_IDS, JSON.stringify(variables), { ...variables, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, request, Date.now() + getRandomInt(24, 30) * 60 * 1_000)
  }

  /** returns {import('./al.d.ts').PagedQuery<{media: import('./al.d.ts').Media[]}>} */
  async searchAllIDS(variables) {
    variables.sort = variables.sort || 'OMIT'
    if (settings.value.adult === 'none') variables.isAdult = false
    if (settings.value.adult !== 'hentai' && (!variables.genre_not || !variables.genre_not.includes('Hentai'))) variables.genre_not = [ ...(variables.genre_not ? variables.genre_not : []), 'Hentai' ]
    debug(`Searching for (ALL) IDs ${JSON.stringify(variables)}`)
    const cachedEntry = !variables.skipCache && cache.cachedEntry(caches.QUERY_SEARCH_IDS, JSON.stringify(variables), status.value.match(/offline/i))
    if (cachedEntry) return cachedEntry
    let fetchedIDS = []
    let currentPage = 1
    let failedRes
    while (true) { // cycle until all paged ids are resolved.
      const res = await this.searchIDS({ ...variables, page: currentPage, perPage: 50, ...(variables?.id && variables?.id?.length !== 0 ? { id: [...new Set(variables.id)] } : { idMal: [...new Set(variables.idMal)] }) })
      if (!res?.data && res?.errors) { failedRes = res }
      if (res?.data?.Page.media) fetchedIDS = fetchedIDS.concat(res?.data?.Page.media)
      if (!res?.data?.Page.pageInfo.hasNextPage) break
      currentPage++
    }
    return cache.cacheEntry(caches.QUERY_SEARCH_IDS, JSON.stringify(variables), { ...variables, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, ({ ...(failedRes || failedRes?.errors ? {errors: failedRes?.errors ? failedRes.errors : failedRes} : {}), data: { Page: {  pageInfo: { hasNextPage: false }, media: fetchedIDS } } }), Date.now() + getRandomInt(34, 46) * 60 * 1_000)
  }

  /** @returns {Promise<import('./al.d.ts').PagedQuery<{ airingSchedules: { airingAt: number, episode: number }[]}>>} */
  episodes(variables = {}) {
    debug(`Getting episodes for ${variables.id}`)
    const cachedEntry = cache.cachedEntry(caches.QUERY_EPISODES, variables.id, status.value.match(/offline/i))
    if (cachedEntry) return cachedEntry
    const query = /* js */`
      query($id: Int) {
        Page(page: 1, perPage: 1000) {
          airingSchedules(mediaId: $id) {
            airingAt,
            episode
          }
        }
      }`
    return cache.cacheEntry(caches.QUERY_EPISODES, variables.id, variables, this.alRequest(query, variables), Date.now() + getRandomInt(75, 100) * 60 * 1_000)
  }

  /** @returns {Promise<import('./al.d.ts').Query<{ AiringSchedule: { airingAt: number }}>>} */
  episodeDate(variables) {
    debug(`Searching for episode date: ${variables.id}, ${variables.ep}`)
    const cachedEntry = cache.cachedEntry(caches.QUERY_EPISODES, JSON.stringify(variables), status.value.match(/offline/i))
    if (cachedEntry) return cachedEntry
    const query = /* js */`
      query($id: Int, $ep: Int) {
        AiringSchedule(mediaId: $id, episode: $ep) {
          airingAt
        }
      }`
    return cache.cacheEntry(caches.QUERY_EPISODES, JSON.stringify(variables), variables, this.alRequest(query, variables), Date.now() + getRandomInt(90, 100) * 60 * 1_000)
  }

  /** @returns {Promise<import('./al.d.ts').PagedQuery<{ mediaList: import('./al.d.ts').Following[]}>>} */
  following(variables) {
    debug('Getting following')
    const cachedEntry = cache.cachedEntry(caches.QUERY_FOLLOWING, JSON.stringify(variables), status.value.match(/offline/i))
    if (cachedEntry) return cachedEntry
    const query = /* js */`
      query($id: Int) {
        Page {
          mediaList(mediaId: $id, isFollowing: true, sort: UPDATED_TIME_DESC) {
            score(format: POINT_10),
            status,
            progress,
            user {
              id,
              name,
              about,
              siteUrl,
              createdAt,
              isBlocked,
              isFollowing,
              isFollower,
              bannerImage,
              donatorBadge,
              moderatorRoles,
              options {
                profileColor
              },
              avatar {
                large,
                medium
              },
              statistics {
                anime {
                  count,
                  meanScore,
                  minutesWatched,
                  episodesWatched
                }
              }
            }
          }
        }
      }`
    return cache.cacheEntry(caches.QUERY_FOLLOWING, JSON.stringify(variables), variables, this.alRequest(query, variables), Date.now() + getRandomInt(200, 300) * 60 * 1_000)
  }

  /** @returns {Promise<import('./al.d.ts').Query<{Media: import('./al.d.ts').Media}>>} */
  async recommendations(variables) {
    debug(`Getting recommendations for ${variables.id}`)
    if (settings.value.queryComplexity === 'Complex' && await cache.requestMedia(variables?.id)) {
      debug(`Complex queries are enabled, returning cached recommendations from media ${variables.id}`)
      return { data: { Media: { ...(await cache.requestMedia(variables?.id)) } } }
    }
    const cachedEntry = cache.cachedEntry(caches.QUERY_RECOMMENDATIONS, variables.id, status.value.match(/offline/i))
    if (cachedEntry) return cachedEntry

    const query = /* js */`
      query($id: Int) {
        Media(id: $id, type: ANIME) {
          id,
          idMal,
          ${queryComplexObjects}
        }
      }`
    return cache.cacheEntry(caches.QUERY_RECOMMENDATIONS, variables.id, variables, this.alRequest(query, variables), Date.now() + getRandomInt(1_500, 2_000) * 60 * 1_000)
  }

  favourite(variables) {
    debug(`Toggling favourite for ${variables.id}`)
    const cachedMedia = cache.getMedia(variables.id)
    if (cachedMedia) cachedMedia.isFavourite = variables.isFavourite
    if (status.value.match(/offline/i) && settings.value.offlineSync) {
      debug(`We are offline and offline syncing is enabled, queuing favourite for media ${variables.id}`)
      this.mutationQueue.enqueue('favourite', variables.id, variables, null, null, false)
      return variables.isFavourite
    }
    this.#toggleFavourite(variables).catch(error => debug('Failed to toggle favourite:', error))
    return variables.isFavourite
  }

  async #toggleFavourite(variables) {
    const query = /* js */`
      mutation($id: Int) {
        ToggleFavourite(animeId: $id) { anime { nodes { id } } }
      }`
    const res = await this.alRequest(query, variables)
    if (res?.errors?.length || !res?.data?.ToggleFavourite) throw new Error('AniList favourite update failed')
    this.mutationQueue.enqueue('favourite', variables.id, variables, variables.isFavourite)
  }

  /** @param {import('./al.d.ts').Media} media */
  title(media) {
    const cachedMedia = mediaCache.value[media?.id || media] || media
    const preferredTitle = cachedMedia?.title?.userPreferred
    if (alToken) return preferredTitle
    if (settings.value.titleLang === 'romaji') return cachedMedia?.title?.romaji || preferredTitle
    else return cachedMedia?.title?.english || preferredTitle
  }

  /** @param {import('./al.d.ts').Media} media */
  reviews(media) {
    const totalReviewers = media.stats?.scoreDistribution?.reduce((total, score) => total + score.amount, 0)
    return media.averageScore && totalReviewers ? totalReviewers.toLocaleString() : '?'
  }

  /**
   * Flushes the mutation queue after userLists.value has been set.
   * Skips if a userlist fetch is in progress to avoid overwriting stale data.
   * Re-applies executed mutations to local cache and executes offline mutations against the API, both validated against the current resolved list.
   */
  async #flushMutationQueue() {
    if (this.mutationQueue.isFetchingList || this.#isFlushingMutations) return
    this.#isFlushingMutations = true
    try {
      const mediaList = (await this.userLists.value)?.data?.MediaListCollection
      await this.mutationQueue.flush(
        mediaList,
        async (mutation) => {
          if (mutation.type === 'entry') await this.updateListEntry(mutation.mediaId, mutation.result)
          else if (mutation.type === 'delete') await this.deleteListEntry(mutation.mediaId)
          else if (mutation.type === 'favourite') {
            const media = cache.getMedia(mutation.mediaId)
            if (media?.id) cache.updateMedia([{ ...media, isFavourite: mutation.result }])
          }
        },
        async (mutation) => {
          if (status.value.match(/offline/i)) throw new Error('Cannot replay AniList mutations while offline')
          if (mutation.type === 'entry') {
            const res = await this.entry(mutation.variables)
            if (!res?.data?.SaveMediaListEntry) throw new Error('AniList entry update failed')
            return res.data.SaveMediaListEntry
          } else if (mutation.type === 'delete') {
            const res = await this.delete(mutation.variables)
            if (res?.data?.DeleteMediaListEntry?.deleted !== true) throw new Error('AniList entry deletion failed')
          } else if (mutation.type === 'favourite') await this.#toggleFavourite(mutation.variables)
        }
      )
    } finally {
      this.#isFlushingMutations = false
    }
  }

  /**
   * Builds and applies an optimistic local cache entry from raw mutation variables, merging with the existing mediaListEntry so unset fields are preserved.
   * Used to update the UI immediately when offline or before the API responds.
   * @param {Record<string, any>} variables The mutation variables from entry()
   * @returns {Promise<Record<string, any> | undefined>} The constructed list entry, or undefined if media not found
   */
  async #applyEntry(variables) {
    const existing = cache.getMedia(variables.id)
    if (!existing) return
    const updatedEntry = {
      ...(existing.mediaListEntry ?? {}),
      status: variables.status ?? existing.mediaListEntry?.status,
      progress: variables.episode ?? existing.mediaListEntry?.progress,
      repeat: variables.repeat ?? existing.mediaListEntry?.repeat,
      score: variables.score ?? existing.mediaListEntry?.score,
      updatedAt: Math.floor(Date.now() / 1_000)
    }
    Object.assign(updatedEntry, Helper.getFuzzyDate(existing, variables.status))
    if (!variables.token) await this.updateListEntry(variables.id, updatedEntry)
    return updatedEntry
  }

  /** @type {Set<number>} */
  queuedMediaIDs = new Set()
  /** @type {Map<number, { promise: Promise, resolve: Function, reject: Function }>} */
  mediaIDHandlers = new Map()
  /**
   * Processes all queued media IDs in a single batch.
   * Resolves or rejects the stored promises when the data is fetched or if an error occurs.
   * Debounced to avoid too frequent requests.
   */
  processQueuedMediaIDs = debounce(async () => {
    const ids = Array.from(this.queuedMediaIDs)
    this.queuedMediaIDs.clear()
    if (!ids.length) return
    let result
    try {
      result = await this.searchAllIDS({ id: ids, skipCache: true })
    } catch (error) {
      for (const id of ids) {
        const handler = this.mediaIDHandlers.get(id) || {}
        handler?.reject(error)
        this.mediaIDHandlers.delete(id)
      }
      return
    }
    const mediaMap = new Map((result?.data?.Page?.media || []).map(media => [media.id, media]))
    for (const id of ids) {
      const media = mediaMap.get(id) ?? null
      const handler = this.mediaIDHandlers.get(id) || {}
      handler?.resolve(media)
      this.mediaIDHandlers.delete(id)
    }
    debug('Processed media IDs successfully:', ids)
  }, 1_500)

  /**
   * Returns a Promise for a given AniList media ID.
   * Deduplicates multiple requests for the same ID, returning the same promise.
   * @param {number} id AniList media ID
   * @returns {Promise<import('./al.d.ts').Media | null>}
   */
  requestMediaID(id) {
    debug(`Requesting media ID: ${id}`, `Current queue: ${Array.from(this.queuedMediaIDs)}`)
    if (status.value.match(/offline/i)) return Promise.resolve(null)
    if (this.mediaIDHandlers.get(id)?.promise) return this.mediaIDHandlers.get(id).promise
    let resolveFn, rejectFn
    const promise = new Promise((resolve, reject) => { resolveFn = resolve; rejectFn = reject })
    this.mediaIDHandlers.set(id, { promise, resolve: resolveFn, reject: rejectFn })
    this.queuedMediaIDs.add(id)
    this.processQueuedMediaIDs()
    return promise
  }

  /**
   * Filter and fuzzy-match cached media for search candidates or offline results.
   * @param {object} variables The query variables.
   * @param {boolean} [single=false] Whether to return a single media object or a paged result.
   * @returns {Promise<import('./al.d.ts').Media | { data: { Page: { pageInfo: { hasNextPage: boolean }, media: import('./al.d.ts').Media[] } } }>}
   */
  fallbackSearch(variables, single = false) {
    debug('Searching the mediaCache...')
    let media = Object.values(mediaCache.value || {}).filter(Boolean)
    const filters = Object.fromEntries(['id', 'idMal', 'id_not', 'idMal_not', 'status', 'status_not', 'format', 'format_not', 'genre', 'genre_not', 'tag', 'tag_not'].map(key => [key, [variables[key] ?? []].flat()]))
    for (const key of ['genre', 'genre_not', 'tag', 'tag_not']) filters[key] = filters[key].map(value => String(value).trim().toLowerCase())
    for (const key of ['id', 'idMal', 'id_not', 'idMal_not']) filters[key] = new Set(filters[key])
    const scores = new Map()

    if (single) {
      media = media.filter(_media => !(variables.id && _media.id !== variables.id) && !(variables.idMal && _media.idMal !== variables.idMal))
    } else {
      media = media.filter(_media => {
        if (variables.id != null && !filters.id.has(_media.id)) return false
        if (variables.idMal != null && !filters.idMal.has(_media.idMal)) return false
        if (filters.id_not.has(_media.id)) return false
        if (filters.idMal_not.has(_media.idMal)) return false

        if ((variables.onList === true && !_media.mediaListEntry) || (variables.onList === false && _media.mediaListEntry)) return false
        if (variables.isAdult != null && _media.isAdult !== variables.isAdult) return false

        if (filters.status.length && !filters.status.includes(_media.status)) return false
        if (filters.status_not.includes(_media.status)) return false
        if (variables.season && _media.season !== variables.season) return false
        if (variables.year && Number(_media.seasonYear) !== Number(variables.year)) return false
        if (filters.format.length && !filters.format.includes(_media.format)) return false
        if (filters.format_not.includes(_media.format) || _media.format === 'MUSIC') return false

        if (filters.genre.length || filters.genre_not.length) {
          const genres = new Set((_media.genres || []).map(genre => genre.trim().toLowerCase()))
          if (!filters.genre.every(genre => genres.has(genre))) return false
          if (filters.genre_not.some(genre => genres.has(genre))) return false
        }
        if (filters.tag.length || filters.tag_not.length) {
          const tags = new Set((_media.tags || []).filter(tag => tag.rank >= 18).map(tag => tag.name.trim().toLowerCase()))
          if (!filters.tag.every(tag => tags.has(tag))) return false
          if (filters.tag_not.some(tag => tags.has(tag))) return false
        }
        return true
      })

      const search = variables.search?.trim()
      if (search) {
        const normalize = text => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f'\u2018\u2019]/g, '').replace(/[\u2010-\u2015]/g, '-')
        // Avoid Unicode-property regex requirements on older Android WebViews.
        const tokenize = text => text.split(/[\s\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]+/).filter(Boolean)
        this.titleSearchCache ||= new WeakMap()
        const candidates = media.map(media => {
          const titles = [...Object.values(media.title || {}), ...(media.synonyms || [])].filter(title => typeof title === 'string')
          let cached = this.titleSearchCache.get(media)
          if (cached?.compact == null || cached.version !== 2 || titles.length !== cached.titles.length || titles.some((title, index) => title !== cached.titles[index])) {
            const normalized = [...new Set(titles.map(normalize))]
            // Ignore spacing and letter-joining hyphens within each title, keeping aliases separate.
            cached = { version: 2, titles, text: normalized.join('\n'), compact: normalized.map(title => title.replace(/\s+/g, '').replace(/([a-z])-+(?=[a-z])/g, '$1')).join('\n'), words: null }
            this.titleSearchCache.set(media, cached)
          }
          return { media, cached }
        })
        const terms = tokenize(normalize(search))
        const findExact = terms => terms.length ? candidates.filter(({ cached }) => terms.every(term => cached.compact.includes(term))) : []
        const wordMatches = terms.map(() => new Map())
        // Test short, exact-only terms first, calculate each possible word edit once.
        const order = terms.map((_, index) => index).sort((a, b) => Math.min(terms[a].length, 5) - Math.min(terms[b].length, 5))
        let matches = terms.length ? candidates.filter(({ cached }) => order.every(index => {
          const term = terms[index]
          if (cached.compact.includes(term)) return true
          const limit = Math.floor(term.length / 5)
          if (!limit || !/^[a-z]+$/.test(term)) return false
          cached.words ||= [...new Set(tokenize(cached.text))]
          return cached.words.some(word => {
            if (word.length < term.length - limit) return false
            let match = wordMatches[index].get(word)
            if (match === undefined) {
              match = lavenshtein(term, word.slice(0, term.length)) <= limit || (word.length > term.length && word.length <= term.length + limit && lavenshtein(term, word) <= limit)
              wordMatches[index].set(word, match)
            }
            return match
          })
        })) : []
        // Keep the existing contextual corrections and ambiguity rejection.
        if (!matches.length) {
          const wordPattern = /^[a-z]{4,9}$/i
          if (terms.some(term => wordPattern.test(term) && (term.length > 4 || terms.length > 1))) {
            const variants = new Set()
            for (let index = 0; index < terms.length; index++) {
              const term = terms[index]
              if (!wordPattern.test(term)) continue
              const others = terms.filter((_, position) => position !== index)
              const context = findExact(others)
              if (others.length && !context.length) continue
              if (term.length === 4) {
                if (!context.length) continue
                const words = new Set(context.flatMap(({ cached }) => {
                  cached.words ||= [...new Set(tokenize(cached.text))]
                  return cached.words
                }))
                for (const word of words) {
                  if (/^[a-z]{3,5}$/.test(word) && lavenshtein(term, word) === 1) {
                    variants.add(terms.map((token, position) => position === index ? word : token).join(' '))
                  }
                }
                continue
              }
              for (let letter = 0; letter < term.length - 1; letter++) {
                if (term[letter] === term[letter + 1]) continue
                const swapped = term.slice(0, letter) + term[letter + 1] + term[letter] + term.slice(letter + 2)
                variants.add(terms.map((word, position) => position === index ? swapped : word).join(' '))
              }
            }
            for (const variant of variants) {
              const corrected = findExact(tokenize(variant))
              if (!corrected.length) continue
              if (matches.length) {
                matches = []
                break
              }
              matches = corrected
            }
          }
        }
        media = matches.map(({ media }) => {
          scores.set(media.id, getDistanceFromTitle(media, search).lavenshtein)
          return media
        })
      }
    }

    if (variables.sort || !single) {
      media.sort((a, b) => {
        switch ([variables.sort].flat()[0] || 'TRENDING_DESC') {
          case 'SEARCH_MATCH':
            return (scores.get(a.id) ?? 1) - (scores.get(b.id) ?? 1)
          case 'TRENDING_DESC':
            return (b.trending || 0) - (a.trending || 0)
          case 'POPULARITY_DESC':
            return (b.popularity ?? b.stats?.scoreDistribution?.reduce((acc, score) => acc + (score.amount || 0), 0) ?? 0) - (a.popularity ?? a.stats?.scoreDistribution?.reduce((acc, score) => acc + (score.amount || 0), 0) ?? 0)
          case 'TITLE_ROMAJI':
            return (a.title?.romaji || a.title?.userPreferred || '').localeCompare(b.title?.romaji || b.title?.userPreferred || '')
          case 'SCORE_DESC':
            return (b.averageScore || 0) - (a.averageScore || 0)
          case 'START_DATE_DESC':
            return ((b.startDate?.year || 0) * 10_000 + (b.startDate?.month || 0) * 100 + (b.startDate?.day || 0)) - ((a.startDate?.year || 0) * 10_000 + (a.startDate?.month || 0) * 100 + (a.startDate?.day || 0))
          case 'FINISHED_ON_DESC':
            return (b.mediaListEntry?.completedAt ? (b.mediaListEntry.completedAt.year || 0) * 10_000 + (b.mediaListEntry.completedAt.month || 0) * 100 + (b.mediaListEntry.completedAt.day || 0) : 0) - (a.mediaListEntry?.completedAt ? (a.mediaListEntry.completedAt.year || 0) * 10_000 + (a.mediaListEntry.completedAt.month || 0) * 100 + (a.mediaListEntry.completedAt.day || 0) : 0)
          case 'STARTED_ON_DESC':
            return (b.mediaListEntry?.startedAt ? (b.mediaListEntry.startedAt.year || 0) * 10_000 + (b.mediaListEntry.startedAt.month || 0) * 100 + (b.mediaListEntry.startedAt.day || 0) : 0) - (a.mediaListEntry?.startedAt ? (a.mediaListEntry.startedAt.year || 0) * 10_000 + (a.mediaListEntry.startedAt.month || 0) * 100 + (a.mediaListEntry.startedAt.day || 0) : 0)
          case 'UPDATED_TIME_DESC':
            return (b.mediaListEntry?.updatedAt || 0) - (a.mediaListEntry?.updatedAt || 0)
          case 'PROGRESS_DESC': {
            const getSortValue = (media) => {
              const progress = media?.mediaListEntry?.progress ?? 0
              const totalEpisodes = media?.episodes ?? getMediaMaxEp(media) ?? 0
              if (progress === 0) return Infinity
              if (totalEpisodes === 0) return -progress
              const distance = totalEpisodes - progress
              return distance <= 0 ? -Infinity : distance
            }
            return getSortValue(a) - getSortValue(b)
          }
          case 'USER_SCORE_DESC': // doesn't exist, AniList uses SCORE_DESC for both MediaSort and MediaListSort.
            return (b.mediaListEntry?.score || 0) - (a.mediaListEntry?.score || 0)
          default:
            return 0
        }
      })
    }

    const perPage = variables.perPage || 50
    const start = ((variables.page || 1) - 1) * perPage
    const end = start + perPage
    return Promise.resolve(single ? { data: { Media: media[0] || null } } : {
      data: {
        Page: {
          pageInfo: { hasNextPage: end < media.length },
          media: media.slice(start, end)
        }
      }
    })
  }

  // Graveyard of no longer used/needed methods, good for reference.
  //
  // async searchName(variables = {}) {
  //   debug(`Searching name for ${variables?.name}`)
  //   const query = /* js */`
  //   query($page: Int, $perPage: Int, $sort: [MediaSort], $name: String, $status: [MediaStatus], $year: Int, $isAdult: Boolean) {
  //     Page(page: $page, perPage: $perPage) {
  //       pageInfo {
  //         hasNextPage
  //       },
  //       media(type: ANIME, search: $name, sort: $sort, status_in: $status, isAdult: $isAdult, format_not: MUSIC, seasonYear: $year) {
  //         ${queryObjects}${settings.value.queryComplexity === 'Complex' ? `, ${queryComplexObjects}` : ``}
  //       }
  //     }
  //   }`
  //
  //   variables.isAdult = variables.isAdult ?? false
  //
  //   /** @type {import('./al.d.ts').PagedQuery<{media: import('./al.d.ts').Media[]}>} */
  //   const res = await this.alRequest(query, variables)
  //   cache.updateMedia(res?.data?.Page?.media)
  //
  //   return res
  // }

  // async alSearch(method) {
  //   const res = await this.searchName(method)
  //   const media = res.data.Page.media.map(media => getDistanceFromTitle(media, method.name))
  //   if (!media.length) return null
  //   return media.reduce((prev, curr) => prev.lavenshtein <= curr.lavenshtein ? prev : curr)
  // }

  // async searchAiringSchedule(variables = {}) {
  //   debug('Searching for airing schedule')
  //   variables.to = (variables.from + 7 * 24 * 60 * 60)
  //   const query = /* js */`
  //   query($page: Int, $perPage: Int, $from: Int, $to: Int) {
  //     Page(page: $page, perPage: $perPage) {
  //       pageInfo {
  //         hasNextPage
  //       },
  //       airingSchedules(airingAt_greater: $from, airingAt_lesser: $to) {
  //         episode,
  //         timeUntilAiring,
  //         airingAt,
  //         media {
  //           ${queryObjects}${settings.value.queryComplexity === 'Complex' ? `, ${queryComplexObjects}` : ``}
  //         }
  //       }
  //     }
  //   }`
  //
  //   /** @type {import('./al.d.ts').PagedQuery<{ airingSchedules: { timeUntilAiring: number, airingAt: number, episode: number, media: import('./al.d.ts').Media}[]}>} */
  //   const res = await this.alRequest(query, variables)
  //
  //   cache.updateMedia(res?.data?.Page?.airingSchedules?.map(({media}) => media))
  //
  //   return res
  // }


  // customList(variables = {}) {
  //   debug('Updating custom list')
  //   const query = /* js */`
  //     mutation($lists: [String]) {
  //       UpdateUser(animeListOptions: { customLists: $lists }) {
  //         id
  //       }
  //     }`
  //
  //   return this.alRequest(query, variables)
  // }

  // /** @returns {Promise<import('./al.d.ts').Query<{ MediaList: { status: string, progress: number, repeat: number }}>>} */
  // async searchIDStatus(variables = {}) {
  //   variables.id = this.userID?.viewer?.data?.Viewer?.id
  //   variables.sort = variables.sort || 'OMIT'
  //   debug(`Searching for ID status: ${variables.id}`)
  //   const query = /* js */`
  //     query($id: Int, $mediaId: Int) {
  //       MediaList(userId: $id, mediaId: $mediaId) {
  //         status,
  //         progress,
  //         repeat
  //       }
  //     }`
  //
  //   return await this.alRequest(query, variables)
  // }
}

export const anilistClient = new AnilistClient()
