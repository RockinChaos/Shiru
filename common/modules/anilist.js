import lavenshtein from 'js-levenshtein'
import { writable } from 'simple-store-svelte'
import Bottleneck from 'bottleneck'

import { alToken, settings } from '@/modules/settings.js'
import { malDubs } from '@/modules/animedubs.js'
import { toast } from 'svelte-sonner'
import { getRandomInt, sleep, matchKeys } from '@/modules/util.js'
import { cache, caches, mediaCache } from '@/modules/cache.js'
import { malClient } from '@/modules/myanimelist.js'
import Helper from '@/modules/helper.js'
import IPC from '@/modules/ipc.js'
import Debug from 'debug'

const debug = Debug('ui:anilist')
const query = Debug('ui:alquery')

export const codes = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  406: 'Not Acceptable',
  408: 'Request Time-out',
  409: 'Conflict',
  410: 'Gone',
  412: 'Precondition Failed',
  413: 'Request Entity Too Large',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Time-out',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  509: 'Bandwidth Limit Exceeded',
  510: 'Not Extended',
  511: 'Network Authentication Required'
}

function printError(error) {
  debug(`Error: ${error.status || 429} - ${error.message || codes[error.status || 429]}`)
  if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Errors')) {
    toast.error('Search Failed', {
      description: `Failed making request to anilist!\nTry again in a minute.\n${error.status || 429} - ${error.message || codes[error.status || 429]}`,
      duration: 3000
    })
  }
}

const date = new Date()
export const currentSeason = ['WINTER', 'SPRING', 'SUMMER', 'FALL'][Math.floor((date.getMonth() / 12) * 4) % 4]
export const currentYear = date.getFullYear()

/**
 * @param {import('./al.d.ts').Media & {lavenshtein?: number}} media
 * @param {string} name
 */
function getDistanceFromTitle(media, name) {
  if (media) {
    const titles = Object.values(media.title).filter(v => v).map(title => lavenshtein(title.toLowerCase(), name.toLowerCase()))
    const synonyms = media.synonyms.filter(v => v).map(title => lavenshtein(title.toLowerCase(), name.toLowerCase()) + 2)
    const distances = [...titles, ...synonyms]
    media.lavenshtein = distances.reduce((prev, curr) => prev < curr ? prev : curr)
    return media
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
  rank
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
        id
      }
    }
  }
}`

class AnilistClient {
  limiter = new Bottleneck({
    reservoir: 90,
    reservoirRefreshAmount: 90,
    reservoirRefreshInterval: 60 * 1000,
    maxConcurrent: 10,
    minTime: 100
  })

  rateLimitPromise = null

  /** @type {import('simple-store-svelte').Writable<ReturnType<AnilistClient['getUserLists']>>} */
  userLists = writable()

  userID = alToken

  constructor() {
    debug('Initializing Anilist Client for ID ' + this.userID?.viewer?.data?.Viewer?.id)
    this.limiter.on('failed', async (error) => {
      printError(error)

      if (error.status === 500) return 1

      if (!error.statusText) {
        if (!this.rateLimitPromise) this.rateLimitPromise = sleep(61 * 1000).then(() => { this.rateLimitPromise = null })
        return 61 * 1000
      }
      const time = (Number((error.headers.get('retry-after') || 60)) + 1) * 1000
      if (!this.rateLimitPromise) this.rateLimitPromise = sleep(time).then(() => { this.rateLimitPromise = null })
      return time
    })

    if (this.userID?.viewer?.data?.Viewer) {
      this.userLists.value = this.getUserLists({ sort: 'UPDATED_TIME_DESC'}, true)
      setTimeout(async () => {
        const updatedLists = await this.getUserLists({sort: 'UPDATED_TIME_DESC'})
        this.userLists.value = Promise.resolve(updatedLists) // no need to have userLists await the entire query process while we already have previous values, (it's awful to wait 15+ seconds for the query to succeed with large lists)
      })
      this.findNewNotifications().catch((error) => debug(`Failed to get new anilist notifications at the scheduled interval, this is likely a temporary connection issue: ${JSON.stringify(error)}`))
      // update userLists every 15 mins
      setInterval(async () => {
        try {
          const updatedLists = await this.getUserLists({sort: 'UPDATED_TIME_DESC'})
          this.userLists.value = Promise.resolve(updatedLists) // no need to have userLists await the entire query process while we already have previous values, (it's awful to wait 15+ seconds for the query to succeed with large lists)
        } catch (error) {
          debug(`Failed to update user lists at the scheduled interval, this is likely a temporary connection issue: ${JSON.stringify(error)}`)
        }
      }, 1000 * 60 * 15)
      // check notifications every 5 mins
      setInterval(() => {
        this.findNewNotifications().catch((error) => debug(`Failed to get new anilist notifications at the scheduled interval, this is likely a temporary connection issue: ${JSON.stringify(error)}`))
      }, 1000 * 60 * 5)
    }
  }

  numberOfQueries = 0
  /** @type {(options: RequestInit) => Promise<any>} */
  handleRequest = this.limiter.wrap(async opts => {
    await this.rateLimitPromise
    query(`[${this.numberOfQueries}] requesting`, JSON.stringify(opts))
    this.numberOfQueries++
    let res = {}
    try {
      res = await fetch('https://graphql.anilist.co', opts)
    } catch (e) {
      if (!res || res.status !== 404) throw e
    }
    if (!res.ok && (res.status === 429 || res.status === 500)) {
      throw res
    }
    let json = null
    try {
      json = await res.json()
    } catch (error) {
      if (res.ok) printError(error)
    }
    if (!res.ok && res.status !== 404) {
      if (json) {
        for (const error of json?.errors || []) {
          printError(error)
        }
      } else {
        printError(res)
      }
    }
    return json || res
  })

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
    if (vars?.variables?.sort === 'OMIT') { delete vars.variables.sort}

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
        if ((settings.value.aniNotify !== 'limited' || type !== 'AIRING') && media.type === 'ANIME' && media.format !== 'MUSIC' && (!settings.value.preferDubs || !malDubs.isDubMedia(media))) {
          const details = {
            title: media.title.userPreferred,
            message: type === 'AIRING' ? `${media.format !== 'MOVIE' ? `Episode ${episode}` : `The Movie`} (Sub) is out in Japan, ${media.format !== 'MOVIE' ? `it should be available soon.` : `, if this is a theatrical release it will likely a few months before it is available for streaming.`}` : 'Was recently announced!',
            icon: media.coverImage.medium,
            iconXL: media.coverImage.extraLarge,
            heroImg: media?.bannerImage
          }
          if (settings.value.systemNotify) {
            IPC.emit('notification', {
              ...details,
              button: [
                {text: 'View Anime', activation: `shiru://anime/${media?.id}`},
              ],
              activation: {
                type: 'protocol',
                launch: `shiru://anime/${media?.id}`
              }
            })
          }
          window.dispatchEvent(new CustomEvent('notification-app', {
            detail: {
              ...details,
              id: media?.id,
              ...(type === 'AIRING' ? { episode: episode } : {}),
              timestamp: createdAt,
              format: media?.format,
              dub: false,
              click_action: (type === 'AIRING' ? 'PLAY' : 'VIEW')
            }
          }))
        }
      }
    }
    if ((newNotifications?.length > 0) || (lastNotified <= 1)) cache.setEntry(caches.NOTIFICATIONS, 'lastAni', Date.now() / 1000)
  }

  /** @returns {Promise<import('./al.d.ts').PagedQuery<{ notifications: { id: number, type: string, createdAt: number, episode: number, media: import('./al.d.ts').Media}[] }>>} */
  getNotifications(variables = {}) {
    debug('Getting notifications')
    const cachedEntry = cache.cachedEntry(caches.NOTIFICATIONS, JSON.stringify(variables), ignoreExpiry)
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
    return cache.cacheEntry(caches.NOTIFICATIONS, JSON.stringify(variables), variables, this.alRequest(query, variables), Date.now() + 4 * 60 * 1000) // expire after 4 minutes as this will be re-cached by our 5-minute interval.
  }

  /** @returns {Promise<import('./al.d.ts').Query<{ MediaListCollection: import('./al.d.ts').MediaListCollection }>>} */
  async getUserLists(variables = {}, ignoreExpiry) {
    debug('Getting user lists')
    variables.id = !variables.userID ? this.userID?.viewer?.data?.Viewer.id : variables.userID
    const userSort = variables.sort || 'UPDATED_TIME_DESC'
    if (Helper.isUserSort(variables)) variables.sort = 'UPDATED_TIME_DESC'
    const cachedEntry = this.sortListEntries(userSort, await cache.cachedEntry(caches.USER_LISTS, JSON.stringify(variables), ignoreExpiry))
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
    let res
    for (let attempt = 1; attempt <= 3; attempt++) { // VERY large user lists can sometimes result in a timeout, typically trying again succeeds.
      res = await this.alRequest(query, variables)
      if (res?.data?.MediaListCollection) break
      if (attempt < 3) { // stupid fix... probably could be improved...
        debug(`Error fetching user lists, attempt ${attempt} failed. Retrying in 5 seconds...`)
        await new Promise(resolve => setTimeout(resolve, 5000))
      } else {
        debug('Failed fetching user lists. Maximum of 3 attempts reached, giving up.')
      }
    }
    return this.sortListEntries(userSort, await cache.cacheEntry(caches.USER_LISTS, JSON.stringify(variables), variables, res, Date.now() + 14 * 60 * 1000)) // expire after 14 minutes as this will be re-cached by our 15-minute interval.
  }

  /**
   * Sorts the media list entries based on the specified sorting criteria.
   * UPDATED_TIME_DESC should be the default sort for the data, so if this is used the list will not be sorted.
   *
   * @param {string} sort - The sorting type (e.g., 'STARTED_ON_DESC', 'FINISHED_ON_DESC').
   * @param {Object} data - The media list data containing the lists and entries.
   * @returns {Object} The reorganized media list with sorted entries.
   */
  sortListEntries(sort, data) {
    if (!data?.data?.MediaListCollection?.lists) return data
    const res = structuredClone(data)
    debug(`Sorting user lists based on custom sort order: ${sort}`)
    const getSortValue = (entry) => {
      const { mediaListEntry } = entry.media
      switch (sort) {
        case 'STARTED_ON_DESC':
          return mediaListEntry?.startedAt ? (mediaListEntry.startedAt.year || 0) * 10000 + (mediaListEntry.startedAt.month || 0) * 100 + (mediaListEntry.startedAt.day || 0) : 0
        case 'FINISHED_ON_DESC':
          return mediaListEntry?.completedAt ? (mediaListEntry.completedAt.year || 0) * 10000 + (mediaListEntry.completedAt.month || 0) * 100 + (mediaListEntry.completedAt.day || 0) : 0
        case 'PROGRESS_DESC':
          return mediaListEntry?.progress || 0
        case 'USER_SCORE_DESC': // doesn't exist, AniList uses SCORE_DESC for both MediaSort and MediaListSort.
          return mediaListEntry?.score || 0
        default:
          return 0
      }
    }
    res.data.MediaListCollection.lists.forEach(list => {
      list.entries.sort((a, b) => {
        const aValue = getSortValue(a)
        const bValue = getSortValue(b)
        if (aValue === 0 && bValue !== 0) return 1
        if (bValue === 0 && aValue !== 0) return -1
        return bValue - aValue // Descending order, this will need to change to implement different sort orders in the future.
      })
    })
    return res
  }

  alEntry (lists, variables) {
    return this.entry(variables)
  }

  async entry(variables) {
    debug(`Updating entry for ${variables.id}`)
    const query = /* js */`
      mutation($lists: [String], $id: Int, $status: MediaListStatus, $episode: Int, $repeat: Int, $score: Int, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
        SaveMediaListEntry(mediaId: $id, status: $status, progress: $episode, repeat: $repeat, scoreRaw: $score, customLists: $lists, startedAt: $startedAt, completedAt: $completedAt) {
          id,
          status,
          progress,
          score,
          repeat,
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
    const res = await this.alRequest(query, variables)
    if (!variables.token) await this.updateListEntry(variables.id, res?.data?.SaveMediaListEntry)
    return res
  }

  async delete(variables) {
    debug(`Deleting entry for ${variables.id}`)
    const query = /* js */`
      mutation($id: Int) {
        DeleteMediaListEntry(id: $id) {
          deleted
        }
      }`
    const res = await this.alRequest(query, variables)
    if (!variables.token) await this.deleteListEntry(variables.idAni)
    return res
  }

  async updateListEntry(mediaId, listEntry) {
    const lists = (await this.userLists.value).data.MediaListCollection.lists?.map(list => { return { ...list, entries: list.entries.filter(entry => entry.media.id !== mediaId) } })
    let targetList = lists.find(list => list.status === listEntry?.status)
    if (!targetList) {
      targetList = { status: listEntry?.status, entries: [] }
      lists.push(targetList)
    }
    await cache.updateMedia([{ ...mediaCache.value[mediaId], mediaListEntry: listEntry }])
    targetList.entries.unshift({ media: mediaCache.value[mediaId] })
    this.userLists.value = Promise.resolve({
      data: {
        MediaListCollection: {
          lists: lists
        }
      }
    })
  }

  async deleteListEntry(mediaId) {
    await cache.updateMedia([{ ...mediaCache.value[mediaId], mediaListEntry: null }])
    this.userLists.value = Promise.resolve({
      data: {
        MediaListCollection: {
          lists: (await this.userLists.value)?.data?.MediaListCollection?.lists?.map(list => {
            return {...list, entries: list.entries.filter(entry => entry.media.id !== mediaId)}
          })
        }
      }
    })
  }

  /**
   * @param {{key: string, title: string, year?: string, isAdult: boolean}[]} flattenedTitles
   **/
  async alSearchCompound(flattenedTitles) {
    debug(`Searching for ${flattenedTitles?.length} titles via compound search`)
    const cachedEntry = cache.cachedEntry(caches.COMPOUND, JSON.stringify(flattenedTitles))
    if (cachedEntry) return cachedEntry

    if (!flattenedTitles.length) return []
    // isAdult doesn't need an extra variable, as the title is the same regardless of type, so we re-use the same variable for adult and non-adult requests
    /** @type {Record<`v${number}`, string>} */
    const requestVariables = flattenedTitles.reduce((obj, { title, isAdult }, i) => {
      if (isAdult && i !== 0) return obj
      obj[`v${i}`] = title
      return obj
    }, {})

    const queryVariables = flattenedTitles.reduce((arr, { isAdult }, i) => {
      if (isAdult && i !== 0) return arr
      arr.push(`$v${i}: String`)
      return arr
    }, []).join(', ')
    const fragmentQueries = flattenedTitles.map(({ year, isAdult }, i) => /* js */`
    v${i}: Page(perPage: 10) {
      media(type: ANIME, search: $v${(isAdult && i !== 0) ? i - 1 : i}, status_in: [NOT_YET_RELEASED, RELEASING, FINISHED], isAdult: ${!!isAdult} ${year ? `, seasonYear: ${year}` : ''}) {
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
     * */
    const res = await this.alRequest(query, requestVariables)
    if (!res?.data) return cache.cachedEntry(caches.COMPOUND, JSON.stringify(flattenedTitles), true) // if the query failed just return the potential cache... better to have something than nothing.

    /** @type {Record<string, number>} */
    const searchResults = {}
    for (const [variableName, { media }] of Object.entries(res.data)) {
      if (!media.length) continue
      const titleObject = flattenedTitles[Number(variableName.slice(1))]
      if (searchResults[titleObject.key]) continue
      for (const mediaItem of media) {
        if (matchKeys(mediaItem, titleObject.title, ['title.userPreferred', 'title.english', 'title.romaji', 'title.native', 'synonyms'], titleObject.title.length > 15 ? 0.2 : titleObject.title.length > 9 ? 0.15 : 0.1)) {
          searchResults[titleObject.key] = mediaItem.id
          break
        }
      }
      searchResults[titleObject.key] = !searchResults[titleObject.key] ? media.map(media => getDistanceFromTitle(media, titleObject.title)).reduce((prev, curr) => prev.lavenshtein <= curr.lavenshtein ? prev : curr).id : searchResults[titleObject.key]
    }

    const ids = Object.values(searchResults)
    const search = await this.searchIDS({ id: ids, perPage: 50, sort: 'OMIT' })
    const mappedResults = Object.entries(searchResults)?.map(([filename, id]) => [filename, search?.data?.Page?.media?.find(media => media.id === id)])
    return mappedResults ? cache.cacheEntry(caches.COMPOUND, JSON.stringify(flattenedTitles), { mappings: true, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, mappedResults, Date.now() + getRandomInt(60, 90) * 60 * 1000) : cache.cachedEntry(caches.COMPOUND, JSON.stringify(flattenedTitles), true)
  }

  search(variables = {}) {
    if (settings.value.adult === 'none') variables.isAdult = false
    if (settings.value.adult !== 'hentai') variables.genre_not = [ ...(variables.genre_not ? variables.genre_not : []), 'Hentai' ]

    debug(`Searching ${JSON.stringify(variables)}`)
    const cachedEntry = cache.cachedEntry(caches.SEARCH, JSON.stringify(variables))
    if (cachedEntry) return cachedEntry
    const query = /* js */` 
    query($page: Int, $perPage: Int, $sort: [MediaSort], $search: String, $onList: Boolean, $status: [MediaStatus], $status_not: [MediaStatus], $season: MediaSeason, $year: Int, $genre: [String], $genre_not: [String], $tag: [String], $format: [MediaFormat], $format_not: [MediaFormat], $id_not: [Int], $idMal_not: [Int], $idMal: [Int], $isAdult: Boolean) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          hasNextPage
        },
        media(id_not_in: $id_not, idMal_not_in: $idMal_not, idMal_in: $idMal, type: ANIME, search: $search, sort: $sort, onList: $onList, status_in: $status, status_not_in: $status_not, season: $season, seasonYear: $year, genre_in: $genre, genre_not_in: $genre_not, tag_in: $tag, format_in: $format, format_not: MUSIC, format_not_in: $format_not, isAdult: $isAdult) {
          ${queryObjects}${settings.value.queryComplexity === 'Complex' ? `, ${queryComplexObjects}` : ``}
        }
      }
    }`
    return cache.cacheEntry(caches.SEARCH, JSON.stringify(variables), { ...variables, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, this.alRequest(query, variables), Date.now() + getRandomInt(75, 100) * 60 * 1000)
  }

  searchIDSingle(variables) {
    variables.sort = variables.sort || 'OMIT'
    debug(`Searching for ID: ${variables?.id || variables?.idMal}`)
    const cachedEntry = cache.cachedEntry(caches.SEARCH_IDS, JSON.stringify(variables))
    if (cachedEntry) return cachedEntry
    const query = /* js */` 
    query($id: Int, $idMal: Int) { 
      Media(id: $id, idMal: $idMal, type: ANIME) {
        ${queryObjects}${settings.value.queryComplexity === 'Complex' ? `, ${queryComplexObjects}` : ``}
      }
    }`
    return cache.cacheEntry(caches.SEARCH_IDS, JSON.stringify(variables), { ...variables, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, this.alRequest(query, variables), Date.now() + getRandomInt(80, 100) * 60 * 1000)
  }

  /** returns {import('./al.d.ts').PagedQuery<{media: import('./al.d.ts').Media[]}>} */
  searchIDS(variables) {
    if (variables?.id?.length === 0) return
    variables.sort = variables.sort || 'OMIT'
    if (settings.value.adult === 'none') variables.isAdult = false
    if (settings.value.adult !== 'hentai') variables.genre_not = [ ...(variables.genre_not ? variables.genre_not : []), 'Hentai' ]

    debug(`Searching for IDs ${JSON.stringify(variables)}`)
    const cachedEntry = cache.cachedEntry(caches.SEARCH_IDS, JSON.stringify(variables))
    if (cachedEntry) return cachedEntry
    const query = /* js */` 
    query($id: [Int], $idMal: [Int], $id_not: [Int], $page: Int, $perPage: Int, $status: [MediaStatus], $onList: Boolean, $sort: [MediaSort], $search: String, $season: MediaSeason, $year: Int, $genre: [String], $genre_not: [String], $tag: [String], $format: [MediaFormat], $isAdult: Boolean) { 
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          hasNextPage
        },
        media(id_in: $id, idMal_in: $idMal, id_not_in: $id_not, type: ANIME, status_in: $status, onList: $onList, search: $search, sort: $sort, season: $season, seasonYear: $year, genre_in: $genre, genre_not_in: $genre_not, tag_in: $tag, format_in: $format, isAdult: $isAdult) {
          ${queryObjects}${settings.value.queryComplexity === 'Complex' ? `, ${queryComplexObjects}` : ``}
        }
      }
    }`
    return cache.cacheEntry(caches.SEARCH_IDS, JSON.stringify(variables), { ...variables, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, this.alRequest(query, variables), Date.now() + getRandomInt(24, 30) * 60 * 1000)
  }

  /** returns {import('./al.d.ts').PagedQuery<{media: import('./al.d.ts').Media[]}>} */
  async searchAllIDS(variables) {
    variables.sort = variables.sort || 'OMIT'
    debug(`Searching for (ALL) IDs ${JSON.stringify(variables)}`)
    const cachedEntry = cache.cachedEntry(caches.SEARCH_IDS, JSON.stringify(variables))
    if (cachedEntry) return cachedEntry
    let fetchedIDS = []
    let currentPage = 1
    let failedRes
    while (true) { // cycle until all paged ids are resolved.
      const res = await this.searchIDS({ ...variables, page: currentPage, perPage: 50, ...( variables?.id && variables?.id?.length !== 0 ? { id: [...new Set(variables.id)] } : { idMal: [...new Set(variables.idMal)] }) })
      if (!res?.data && res?.errors) { failedRes = res }
      if (res?.data?.Page.media) fetchedIDS = fetchedIDS.concat(res?.data?.Page.media)
      if (!res?.data?.Page.pageInfo.hasNextPage) break
      currentPage++
    }
    return cache.cacheEntry(caches.SEARCH_IDS, JSON.stringify(variables), { ...variables, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, ({ ...(failedRes || failedRes?.errors ? {errors: failedRes?.errors ? failedRes.errors : failedRes} : {}), data: { Page: {  pageInfo: { hasNextPage: false }, media: fetchedIDS } } }), Date.now() + getRandomInt(34, 46) * 60 * 1000)
  }

  /** @returns {Promise<import('./al.d.ts').PagedQuery<{ airingSchedules: { airingAt: number, episode: number }[]}>>} */
  episodes(variables = {}) {
    debug(`Getting episodes for ${variables.id}`)
    const cachedEntry = cache.cachedEntry(caches.EPISODES, variables.id)
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
    return cache.cacheEntry(caches.EPISODES, variables.id, variables, this.alRequest(query, variables), Date.now() + getRandomInt(75, 100) * 60 * 1000)
  }

  /** @returns {Promise<import('./al.d.ts').Query<{ AiringSchedule: { airingAt: number }}>>} */
  episodeDate(variables) {
    debug(`Searching for episode date: ${variables.id}, ${variables.ep}`)
    const cachedEntry = cache.cachedEntry(caches.EPISODES, JSON.stringify(variables))
    if (cachedEntry) return cachedEntry
    const query = /* js */`
      query($id: Int, $ep: Int) {
        AiringSchedule(mediaId: $id, episode: $ep) {
          airingAt
        }
      }`
    return cache.cacheEntry(caches.EPISODES, JSON.stringify(variables), variables, this.alRequest(query, variables), Date.now() + getRandomInt(90, 100) * 60 * 1000)
  }

  /** @returns {Promise<import('./al.d.ts').PagedQuery<{ mediaList: import('./al.d.ts').Following[]}>>} */
  following(variables) {
    debug('Getting following')
    const cachedEntry = cache.cachedEntry(caches.FOLLOWING, JSON.stringify(variables))
    if (cachedEntry) return cachedEntry
    const query = /* js */`
      query($id: Int) {
        Page {
          mediaList(mediaId: $id, isFollowing: true, sort: UPDATED_TIME_DESC) {
            status,
            score,
            user {
              id,
              name,
              avatar {
                medium
              }
            }
          }
        }
      }`
    return cache.cacheEntry(caches.FOLLOWING, JSON.stringify(variables), variables, this.alRequest(query, variables), Date.now() + getRandomInt(200, 300) * 60 * 1000)
  }

  /** @returns {Promise<import('./al.d.ts').Query<{Media: import('./al.d.ts').Media}>>} */
  async recommendations(variables) {
    debug(`Getting recommendations for ${variables.id}`)
    if (settings.value.queryComplexity === 'Complex' && mediaCache.value[variables.id]) {
      debug(`Complex queries are enabled, returning cached recommendations from media ${variables.id}`)
      return { data: { Media: { ...mediaCache.value[variables.id] } } }
    }
    const cachedEntry = cache.cachedEntry(caches.RECOMMENDATIONS, variables.id)
    if (cachedEntry) return cachedEntry

    const query = /* js */`
      query($id: Int) {
        Media(id: $id, type: ANIME) {
          id,
          idMal,
          ${queryComplexObjects}
        }
      }`
    return cache.cacheEntry(caches.RECOMMENDATIONS, variables.id, variables, this.alRequest(query, variables), Date.now() + getRandomInt(1500, 2000) * 60 * 1000)
  }

  favourite(variables) {
    debug(`Toggling favourite for ${variables.id}`)
    const query = /* js */`
      mutation($id: Int) {
        ToggleFavourite(animeId: $id) { anime { nodes { id } } } 
      }`
    return this.alRequest(query, variables)
  }

  /** @param {import('./al.d.ts').Media} media */
  title(media) {
    const cachedMedia = mediaCache.value[media?.id || media] || media
    const preferredTitle = cachedMedia?.title.userPreferred
    if (alToken) return preferredTitle
    if (settings.value.titleLang === 'romaji') return cachedMedia?.title.romaji || preferredTitle
    else return cachedMedia?.title.english || preferredTitle
  }

  /** @param {import('./al.d.ts').Media} media */
  reviews(media) {
    const totalReviewers = media.stats?.scoreDistribution?.reduce((total, score) => total + score.amount, 0)
    return media.averageScore && totalReviewers ? totalReviewers.toLocaleString() : '?'
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
  //   await cache.updateMedia(res?.data?.Page?.media)
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
  //   await cache.updateMedia(res?.data?.Page?.airingSchedules?.map(({media}) => media))
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
  //   variables.id = this.userID?.viewer?.data?.Viewer.id
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
