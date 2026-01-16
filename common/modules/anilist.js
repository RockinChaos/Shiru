import lavenshtein from 'js-levenshtein'
import { writable } from 'simple-store-svelte'
import Bottleneck from 'bottleneck'

import { alToken, settings } from '@/modules/settings.js'
import { malDubs } from '@/modules/anime/animedubs.js'
import { isSubbedProgress, getMediaMaxEp } from '@/modules/anime/anime.js'
import { getRandomInt, sleep, debounce } from '@/modules/util.js'
import { printError, status } from '@/modules/networking.js'
import { cache, caches, mediaCache } from '@/modules/cache.js'
import { malClient } from '@/modules/myanimelist.js'
import Helper from '@/modules/helper.js'
import Debug from 'debug'
const debug = Debug('ui:anilist')
const query = Debug('ui:alquery')

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
popularity,
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
      if (status.value.match(/offline/i)) throw new Error('Failed making request to Anilist, network is offline... not retrying')
      else await printError('Search Failed', 'Failed making request to Anilist!\nTry again in a minute.', error)
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
      this.findNewNotifications().catch((error) => debug('Failed to get new anilist notifications at the scheduled interval, this is likely a temporary connection issue:', JSON.stringify(error)))
      // update userLists every 15 mins
      setInterval(async () => {
        try {
          const updatedLists = await this.getUserLists({sort: 'UPDATED_TIME_DESC'})
          this.userLists.value = Promise.resolve(updatedLists) // no need to have userLists await the entire query process while we already have previous values, (it's awful to wait 15+ seconds for the query to succeed with large lists)
        } catch (error) {
          debug('Failed to update user lists at the scheduled interval, this is likely a temporary connection issue:', JSON.stringify(error))
        }
      }, 1000 * 60 * 15)
      // check notifications every 5 mins
      setInterval(() => {
        this.findNewNotifications().catch((error) => debug('Failed to get new anilist notifications at the scheduled interval, this is likely a temporary connection issue:', JSON.stringify(error)))
      }, 1000 * 60 * 5)
    }
  }

  numberOfQueries = 0
  /** @type {(options: RequestInit) => Promise<any>} */
  handleRequest = this.limiter.wrap(async opts => {
    await this.rateLimitPromise
    query(`[${this.numberOfQueries}] requesting`, JSON.stringify(opts))
    this.numberOfQueries++
    if (status.value.match(/offline/i)) throw new Error('AniList API is temporarily disabled or network is offline')
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
      if (res.ok) printError('Search Failed', 'Failed making request to Anilist!\nTry again in a minute.', error)
    }
    if (!res.ok && res.status !== 404) {
      if (json) {
        for (const error of json?.errors || []) {
          printError('Search Failed', 'Failed making request to Anilist!\nTry again in a minute.', error)
        }
      } else {
        printError('Search Failed', 'Failed making request to Anilist!\nTry again in a minute.', res)
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
        if ((settings.value.aniNotify !== 'limited' || type !== 'AIRING') && media.type === 'ANIME' && media.format !== 'MUSIC' && (!settings.value.preferDubs || (media?.status === 'FINISHED' && !['CURRENT', 'REPEATING']?.includes(media?.mediaListEntry?.status)) || !(await malDubs.isDubMedia(media)) || await isSubbedProgress(await cache.requestMedia(media?.id)))) {
          window.dispatchEvent(new CustomEvent('notification-app', {
            detail: {
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
    const cachedEntry = cache.cachedEntry(caches.NOTIFICATIONS, JSON.stringify(variables), ignoreExpiry || status.value.match(/offline/i))
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
    return cache.cacheEntry(caches.NOTIFICATIONS, JSON.stringify(variables), variables, this.alRequest(query, variables), Date.now() + 4 * 60 * 1000) // expire after 4 minutes as this will be re-cached by our 5-minute interval.
  }

  /** @returns {Promise<import('./al.d.ts').Query<{ MediaListCollection: import('./al.d.ts').MediaListCollection }>>} */
  async getUserLists(variables = {}, ignoreExpiry) {
    debug('Getting user lists')
    variables.id = variables.userID || this.userID?.viewer?.data?.Viewer.id
    const userSort = variables.sort || 'UPDATED_TIME_DESC'
    if (!variables.sort || Helper.isUserSort(variables)) variables.sort = 'UPDATED_TIME_DESC'
    const cachedEntry = this.sortListEntries(userSort, await cache.cachedEntry(caches.USER_LISTS, JSON.stringify(variables), ignoreExpiry || status.value.match(/offline/i)))
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
    const res = data
    debug('Sorting user lists based on custom sort order:', sort)
    const getSortValue = (entry) => {
      switch (sort) {
        case 'STARTED_ON_DESC':
          return entry?.media?.mediaListEntry?.startedAt ? (entry.media.mediaListEntry.startedAt.year || 0) * 10000 + (entry.media.mediaListEntry.startedAt.month || 0) * 100 + (entry.media.mediaListEntry.startedAt.day || 0) : 0
        case 'FINISHED_ON_DESC':
          return entry?.media?.mediaListEntry?.completedAt ? (entry.media.mediaListEntry.completedAt.year || 0) * 10000 + (entry.media.mediaListEntry.completedAt.month || 0) * 100 + (entry.media.mediaListEntry.completedAt.day || 0) : 0
        case 'PROGRESS_DESC':
          const totalEpisodes = entry?.media?.episodes ?? getMediaMaxEp(entry?.media) ?? 0
          const progress = entry?.media?.mediaListEntry?.progress ?? 0
          if (progress === 0) return Infinity
          if (totalEpisodes === 0) return -progress
          const distance = totalEpisodes - progress
          return distance <= 0 ? -Infinity : distance
        case 'USER_SCORE_DESC': // doesn't exist, AniList uses SCORE_DESC for both MediaSort and MediaListSort.
          return entry?.media?.mediaListEntry?.score || 0
        case 'UPDATED_TIME_DESC':
          return entry?.media?.mediaListEntry?.updatedAt || 0
        default:
          return 0
      }
    }
    res.data.MediaListCollection.lists.forEach(list => {
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
    const res = await this.alRequest(query, variables)
    if (!variables.token) await this.updateListEntry(variables.id, res?.data?.SaveMediaListEntry)
    //TODO: need to implement "else" for anilist syncing functionality. #updateListEntry
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
    //TODO: need to implement "else" for anilist syncing functionality. #deleteListEntry
    return res
  }

  async updateListEntry(mediaId, listEntry) {
    const lists = (await this.userLists.value).data.MediaListCollection.lists?.map(list => { return { ...list, entries: list.entries.filter(entry => entry.media.id !== mediaId) } })
    let targetList = lists.find(list => list.status === listEntry?.status)
    if (!targetList) {
      targetList = { status: listEntry?.status, entries: [] }
      lists.push(targetList)
    }
    await cache.updateMedia([{ ...(await cache.requestMedia(mediaId)), mediaListEntry: listEntry }])
    targetList.entries.unshift({ media: await cache.requestMedia(mediaId) })
    const res = Promise.resolve({
      data: {
        MediaListCollection: {
          lists: lists
        }
      }
    })
    cache.cacheEntry(caches.USER_LISTS, JSON.stringify({ sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer.id }), { sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer.id }, res, (await cache.cachedEntry(caches.USER_LISTS, JSON.stringify({ sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer.id })))?.expiry || (Date.now() + 14 * 60 * 1000))
    this.userLists.value = res
  }

  async deleteListEntry(mediaId) {
    await cache.updateMedia([{ ...(await cache.requestMedia(mediaId)), mediaListEntry: null }])
    const res = Promise.resolve({
      data: {
        MediaListCollection: {
          lists: (await this.userLists.value)?.data?.MediaListCollection?.lists?.map(list => {
            return {...list, entries: list.entries.filter(entry => entry.media.id !== mediaId)}
          })
        }
      }
    })
    cache.cacheEntry(caches.USER_LISTS, JSON.stringify({ sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer.id }), { sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer.id }, res, (await cache.cachedEntry(caches.USER_LISTS, JSON.stringify({ sort: 'UPDATED_TIME_DESC', id: this.userID?.viewer?.data?.Viewer.id })))?.expiry || (Date.now() + 14 * 60 * 1000))
    this.userLists.value = res
  }

  /**
   * @param {{key: string, title: string, year?: string, isAdult: boolean}[]} flattenedTitles
   **/
  async alSearchCompound(flattenedTitles) {
    debug(`Searching for ${flattenedTitles?.length} titles via compound search`)
    const cachedEntry = cache.cachedEntry(caches.COMPOUND, JSON.stringify(flattenedTitles),  status.value.match(/offline/i))
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
     * */
    const res = await this.alRequest(query, requestVariables)
    if (!res?.data) return cache.cachedEntry(caches.COMPOUND, JSON.stringify(flattenedTitles), true) // if the query failed just return the potential cache... better to have something than nothing.

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
    return mappedResults ? cache.cacheEntry(caches.COMPOUND, JSON.stringify(flattenedTitles), { mappings: true, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, mappedResults, Date.now() + getRandomInt(60, 90) * 60 * 1000) : cache.cachedEntry(caches.COMPOUND, JSON.stringify(flattenedTitles), true)
  }

  search(variables = {}) {
    if (settings.value.adult === 'none') variables.isAdult = false
    if (settings.value.adult !== 'hentai' && (!variables.genre_not || !variables.genre_not.includes('Hentai'))) variables.genre_not = [ ...(variables.genre_not ? variables.genre_not : []), 'Hentai' ]

    debug(`Searching ${JSON.stringify(variables)}`)
    const cachedEntry = cache.cachedEntry(caches.SEARCH, JSON.stringify(variables), status.value.match(/offline/i))
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
      } catch {
        return this.fallbackSearch(variables)
      }
    })()

    return cache.cacheEntry(caches.SEARCH, JSON.stringify(variables), { ...variables, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, request, Date.now() + getRandomInt(75, 100) * 60 * 1000)
  }

  searchIDSingle(variables) {
    variables.sort = variables.sort || 'OMIT'
    debug(`Searching for ID: ${variables?.id || variables?.idMal}`)
    const cachedEntry = cache.cachedEntry(caches.SEARCH_IDS, JSON.stringify(variables), status.value.match(/offline/i))
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

    return cache.cacheEntry(caches.SEARCH_IDS, JSON.stringify(variables), { ...variables, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, request, Date.now() + getRandomInt(80, 100) * 60 * 1000)
  }

  /** returns {import('./al.d.ts').PagedQuery<{media: import('./al.d.ts').Media[]}>} */
  searchIDS(variables) {
    if (variables?.id?.length === 0) return
    variables.sort = variables.sort || 'OMIT'
    if (settings.value.adult === 'none') variables.isAdult = false
    if (settings.value.adult !== 'hentai' && (!variables.genre_not || !variables.genre_not.includes('Hentai'))) variables.genre_not = [ ...(variables.genre_not ? variables.genre_not : []), 'Hentai' ]

    debug(`Searching for IDs ${JSON.stringify(variables)}`)
    const cachedEntry = !variables.skipCache && cache.cachedEntry(caches.SEARCH_IDS, JSON.stringify(variables), status.value.match(/offline/i))
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

    return cache.cacheEntry(caches.SEARCH_IDS, JSON.stringify(variables), { ...variables, ...(malClient.userID ? { fillLists: malClient.userLists.value } : {}) }, request, Date.now() + getRandomInt(24, 30) * 60 * 1000)
  }

  /** returns {import('./al.d.ts').PagedQuery<{media: import('./al.d.ts').Media[]}>} */
  async searchAllIDS(variables) {
    variables.sort = variables.sort || 'OMIT'
    if (settings.value.adult === 'none') variables.isAdult = false
    if (settings.value.adult !== 'hentai' && (!variables.genre_not || !variables.genre_not.includes('Hentai'))) variables.genre_not = [ ...(variables.genre_not ? variables.genre_not : []), 'Hentai' ]
    debug(`Searching for (ALL) IDs ${JSON.stringify(variables)}`)
    const cachedEntry = !variables.skipCache && cache.cachedEntry(caches.SEARCH_IDS, JSON.stringify(variables), status.value.match(/offline/i))
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
    const cachedEntry = cache.cachedEntry(caches.EPISODES, variables.id, status.value.match(/offline/i))
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
    const cachedEntry = cache.cachedEntry(caches.EPISODES, JSON.stringify(variables), status.value.match(/offline/i))
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
    const cachedEntry = cache.cachedEntry(caches.FOLLOWING, JSON.stringify(variables), status.value.match(/offline/i))
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
    return cache.cacheEntry(caches.FOLLOWING, JSON.stringify(variables), variables, this.alRequest(query, variables), Date.now() + getRandomInt(200, 300) * 60 * 1000)
  }

  /** @returns {Promise<import('./al.d.ts').Query<{Media: import('./al.d.ts').Media}>>} */
  async recommendations(variables) {
    debug(`Getting recommendations for ${variables.id}`)
    if (settings.value.queryComplexity === 'Complex' && await cache.requestMedia(variables?.id)) {
      debug(`Complex queries are enabled, returning cached recommendations from media ${variables.id}`)
      return { data: { Media: { ...(await cache.requestMedia(variables?.id)) } } }
    }
    const cachedEntry = cache.cachedEntry(caches.RECOMMENDATIONS, variables.id, status.value.match(/offline/i))
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
    const cachedMedia = cache.getMedia(variables.id)
    const isFavourite = cachedMedia?.isFavourite
    if (cachedMedia) cachedMedia.isFavourite = !isFavourite
    this.alRequest(query, variables)
    return !isFavourite
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
   *
   * @param {number} id - AniList media ID
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
   * Fallback search using mediaCache if the network/API fails.
   * @param {object} variables - The query variables.
   * @param {boolean} [single=false] - Whether to return a single media object or a paged result.
   * @returns {Promise<import('./al.d.ts').Media | { data: { Page: { pageInfo: { hasNextPage: boolean }, media: import('./al.d.ts').Media[] } } }>}
   */
  fallbackSearch(variables, single = false) {
    debug('AniList search failed, falling back to searching the mediaCache...')
    let media = Object.values(mediaCache.value || {})

    if (single) {
      media = media.filter(_media => !(variables.id && _media.id !== variables.id) && !(variables.idMal && _media.idMal !== variables.idMal))
    } else {
      media = media.filter(_media => {
        if (variables.id && !variables.id.includes(_media.id)) return false
        if (variables.idMal && !variables.idMal.includes(_media.idMal)) return false
        if (variables.id_not?.includes(_media.id)) return false
        if (variables.idMal_not?.includes(_media.idMal)) return false

        if ((variables.onList === true && !_media.mediaListEntry) || (variables.onList === false && _media.mediaListEntry)) return false
        if (variables.isAdult === false && _media.isAdult) return false

        if (variables.status && !variables.status.includes(_media.status)) return false
        if (variables.status_not && variables.status_not.includes(_media.status)) return false

        if (variables.season && _media.season !== variables.season) return false
        if (variables.year && _media.seasonYear !== variables.year) return false

        if (variables.format && !variables.format.includes(_media.format)) return false
        if (variables.format_not && variables.format_not.includes(_media.format)) return false
        if (_media.format === 'MUSIC') return false

        if (variables.genre && !variables.genre.some(genre => _media.genres?.includes(genre))) return false
        if (variables.genre_not && variables.genre_not.some(genre => _media.genres?.includes(genre))) return false

        if (variables.tag && !variables.tag.some(tag => _media.tags?.some(mediaTag => mediaTag.name === tag))) return false
        if (variables.tag_not && variables.tag_not.some(tag => _media.tags?.some(mediaTag => mediaTag.name === tag))) return false

        if (variables.search) {
          const searchText = variables.search.toLowerCase()
          const titles = [_media.title?.romaji, _media.title?.english, _media.title?.native, _media.title?.userPreferred, ...(_media.synonyms || [])].filter(Boolean).map(t => t.toLowerCase())
          if (!titles.some(t => t.includes(searchText))) return false
        }
        return true
      })
    }

    if (variables.sort) {
      media.sort((a, b) => {
        switch (variables.sort) {
          case 'TRENDING_DESC':
            return (b.popularity || 0) - (a.popularity || 0)
          case 'POPULARITY_DESC':
            return (b.popularity ?? b.stats?.scoreDistribution?.reduce((acc, score) => acc + (score.amount || 0), 0) ?? 0) - (a.popularity ?? a.stats?.scoreDistribution?.reduce((acc, score) => acc + (score.amount || 0), 0) ?? 0)
          case 'TITLE_ROMAJI':
            return (a.title?.romaji || a.title?.userPreferred || '').localeCompare(b.title?.romaji || b.title?.userPreferred || '')
          case 'SCORE_DESC':
            return (b.averageScore || 0) - (a.averageScore || 0)
          case 'START_DATE_DESC':
            return ((b.startDate?.year || 0) * 10000 + (b.startDate?.month || 0) * 100 + (b.startDate?.day || 0)) - ((a.startDate?.year || 0) * 10000 + (a.startDate?.month || 0) * 100 + (a.startDate?.day || 0))
          case 'FINISHED_ON_DESC':
            return (b.mediaListEntry?.completedAt ? (b.mediaListEntry.completedAt.year || 0) * 10000 + (b.mediaListEntry.completedAt.month || 0) * 100 + (b.mediaListEntry.completedAt.day || 0) : 0) - (a.mediaListEntry?.completedAt ? (a.mediaListEntry.completedAt.year || 0) * 10000 + (a.mediaListEntry.completedAt.month || 0) * 100 + (a.mediaListEntry.completedAt.day || 0) : 0)
          case 'STARTED_ON_DESC':
            return (b.mediaListEntry?.startedAt ? (b.mediaListEntry.startedAt.year || 0) * 10000 + (b.mediaListEntry.startedAt.month || 0) * 100 + (b.mediaListEntry.startedAt.day || 0) : 0) - (a.mediaListEntry?.startedAt ? (a.mediaListEntry.startedAt.year || 0) * 10000 + (a.mediaListEntry.startedAt.month || 0) * 100 + (a.mediaListEntry.startedAt.day || 0) : 0)
          case 'UPDATED_TIME_DESC':
            return (b.mediaListEntry?.updatedAt || 0) - (a.mediaListEntry?.updatedAt || 0)
          case 'PROGRESS_DESC':
            const getSortValue = (media) => {
              const progress = media?.mediaListEntry?.progress ?? 0
              const totalEpisodes = media?.episodes ?? getMediaMaxEp(media) ?? 0
              if (progress === 0) return Infinity
              if (totalEpisodes === 0) return -progress
              const distance = totalEpisodes - progress
              return distance <= 0 ? -Infinity : distance
            }
            return getSortValue(a) - getSortValue(b)
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
