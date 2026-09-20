import { writable } from 'simple-store-svelte'
import Bottleneck from 'bottleneck'

import { malToken, refreshMalToken, settings } from '@/modules/settings.js'
import { mediaCache } from '@/modules/cache.js'
import { sleep, uniqueStore } from '@/modules/util.js'
import { printError, status, previousStatus } from '@/modules/networking.js'
import { MutationQueue } from '@/modules/providers/lib/mutationqueue.js'
import Helper from '@/modules/providers/helper.js'
import Debug from 'debug'
const debug = Debug('ui:myanimelist')
const trace = Debug('net:myanimelist')

export const clientID = atob('YmI3ZGNlMzg4MWQ4MDNlNjU2YzQ1YWEzOWJkYTljY2M=') // app type MUST be set to other, do not generate a seed.

const queryFields =  [
  'synopsis',
  'alternative_titles',
  'mean',
  'rank',
  'popularity',
  'num_list_users',
  'num_scoring_users',
  'related_anime',
  'media_type',
  'num_episodes',
  'status',
  'my_list_status',
  'start_date',
  'end_date',
  'start_season',
  'broadcast',
  'studios',
  'authors{first_name,last_name}',
  'source',
  'genres',
  'average_episode_duration',
  'rating'
]

class MALClient {
  limiter = new Bottleneck({
    reservoir: 20,
    reservoirRefreshAmount: 20,
    reservoirRefreshInterval: 4 * 1_000,
    maxConcurrent: 2,
    minTime: 1_000
  })

  rateLimitPromise = null

  #listPromise = Promise.resolve()

  /** @type {import('simple-store-svelte').Writable<ReturnType<MALClient['getUserLists']>>} */
  userLists = writable()

  mutationQueue = new MutationQueue('syncQueueMal', !!malToken)

  userID = malToken

  constructor () {
    debug('Initializing MyAnimeList Client for ID ' + this.userID?.viewer?.data?.Viewer?.id)
    this.limiter.on('failed', async (error, jobInfo) => {
      printError('Search Failed', 'Failed making request to MyAnimeList! Try again in a minute.', error)

      if (error.status === 500) return 1

      if (!error.statusText) {
        if (!this.rateLimitPromise) this.rateLimitPromise = sleep(5 * 1_000).then(() => { this.rateLimitPromise = null })
        return 5 * 1_000
      }
      const time = ((error.headers.get('retry-after') || 5) + 1) * 1_000
      if (!this.rateLimitPromise) this.rateLimitPromise = sleep(time).then(() => { this.rateLimitPromise = null })
      return time
    })

    if (this.userID?.viewer?.data?.Viewer) {
      this.userLists.value = this.getUserLists({ sort: 'list_updated_at' })
      //  update userLists every 15 mins
      setInterval(async () => {
        this.getUserLists({ sort: 'list_updated_at' }).then(updatedLists => {
          this.userLists.value = Promise.resolve(updatedLists) // no need to have userLists await the entire query process while we already have previous values, (it's awful to wait 15+ seconds for the query to succeed with large lists)
        }).catch(error => debug('Failed to update user lists at the scheduled interval, this is likely a temporary connection issue:', error))
      }, 1_000 * 60 * 15)
      // update userLists and flush queued offline mutations when back online
      uniqueStore(status).subscribe(value => {
        if (!(previousStatus.value.match(/offline/i) && value === 'online')) return
        debug(`Back online${this.mutationQueue.hasPending ? ' with pending mutations' : ''}, refreshing user lists`)
        this.getUserLists({ sort: 'list_updated_at' }).then(updatedLists => {
          this.userLists.value = Promise.resolve(updatedLists)
          if (this.mutationQueue.hasPending) this.#flushMutationQueue()
        }).catch(error => debug('Failed to refresh user lists after coming online:', error))
      })
    } else {
      uniqueStore(status).subscribe(value => {
        if (!(previousStatus.value.match(/offline/i) && value === 'online') || !this.mutationQueue.hasPending) return
        debug('Back online with pending mutations, flushing mutation queue...')
        this.#flushMutationQueue()
      })
    }
  }

  /**
   * @param {Record<string, any>} query
   * @param {Record<string, any>} body
   * @returns {Promise<import('../myanimelist/mal.d.ts').Query<any>>}
   */
  malRequest (query, body = {}) {
    /** @type {RequestInit} */
    const options = {
      method: `${query.type}`,
      headers: {
        'Authorization': `Bearer ${query.eToken ? query.eToken : query.token ? query.token : this.userID.token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
    if (Object.keys(body).length > 0) {
      options.body = new URLSearchParams(body)
    }
    return this.handleRequest(query, options)
  }

  failedRefresh = []
  numberOfQueries = 0

  /**
   * @param {Record<string, any>} query
   * @param {Record<string, any>} options
   * @returns {Promise<import('../myanimelist/mal.d.ts').Query<any>>}
   */
  handleRequest = this.limiter.wrap(async (query, options) => {
    await this.rateLimitPromise
    trace(`[${this.numberOfQueries}] requesting`, `query: ${JSON.stringify({ ...query, token: query.token ? '[redacted]' : undefined })}`, `options: ${JSON.stringify({ ...options, headers: { ...options.headers, Authorization: options.headers?.Authorization ? '[redacted]' : undefined } })}`)
    this.numberOfQueries++
    let res = {}
    if (!query.eToken && (this.failedRefresh.includes(query.token ? query.token : this.userID.token) || (!query.token && this.userID.reauth))) return {}
    try {
      if (!query.eToken && (Math.floor(Date.now() / 1_000) >= ((query.token ? query.refresh_in : this.userID.refresh_in) || 0))) {
        const oauth = await this.refreshToken(query)
        if (oauth) {
          options.headers = {
            'Authorization': `Bearer ${oauth.access_token}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        } else return {}
      }
      res = await fetch(`https://api.myanimelist.net/v2/${query.path}`, options)
    } catch (e) {
      if (!res || res.status !== 404) throw e
    }
    if (!res?.ok && (res?.status === 429 || res?.status === 500)) {
      throw res
    }
    let json = null
    try {
      json = await res.json()
    } catch (error) {
      if (res?.ok) printError('Search Failed', 'Failed making request to MyAnimeList! Try again in a minute.', error)
    }
    if (!res?.ok && res?.status !== 404) {
      if (json) {
        for (const error of json?.errors || [json?.error] || []) {
          let code
          switch (error) {
            case 'forbidden':
              code = 403
              break
            case 'invalid_token': { // 401
              const oauth = await this.refreshToken(query)
              if (oauth) {
                options.headers = {
                  'Authorization': `Bearer ${oauth.access_token}`,
                  'Content-Type': 'application/x-www-form-urlencoded'
                }
                return this.handleRequest(query, options)
              } else return {}
            }
            case 'invalid_content':
              code = 422
              break
            default:
              code = res?.status
          }
          printError('Search Failed', 'Failed making request to MyAnimeList! Try again in a minute.', code)
        }
      } else {
        printError('Search Failed', 'Failed making request to MyAnimeList! Try again in a minute.', res)
      }
    }
    return json
  })

  async refreshToken(query) {
    const oauth = await refreshMalToken(query.token ? query.token : this.userID.token) // refresh authorization token as it typically expires every 31 days. Refresh token also expires every 31 days, so we refresh every two weeks.
    if (oauth) {
      if (!query.token) {
        this.userID = malToken
      }
      return oauth
    }
    this.failedRefresh.push(query.token ? query.token : this.userID.token)
    return oauth
  }

  async malEntry (media, variables) {
    variables.idMal = media.idMal
    const res = await this.entry(variables)
    if (!variables.token) mediaCache.value[media.id].mediaListEntry = res?.data?.SaveMediaListEntry
    return res
  }

  /** @returns {Promise<import('../myanimelist/mal.d.ts').Query<{ MediaList: import('../myanimelist/mal.d.ts').MediaList }>>} */
  async getUserLists (variables, skipList = false) {
    debug('Getting user lists')
    if (!skipList) await this.#listPromise
    const limit = 1_000 // max possible you can fetch
    let offset = 0
    let allMediaList = []
    let hasNextPage = true

    // Check and replace specific sort values
    const customSorts = ['list_start_date_nan', 'list_finish_date_nan', 'list_progress_nan']
    if (customSorts.includes(variables.sort)) {
      variables.originalSort = variables.sort
      variables.sort = 'list_updated_at'
    }
    while (hasNextPage) {
      const query = {
        type: 'GET',
        path: `users/@me/animelist?fields=${queryFields}&nsfw=true&limit=${limit}&offset=${offset}&sort=${variables.sort}`
      }
      const res = await this.malRequest(query)
      allMediaList = res?.data ? allMediaList.concat(res.data) : []

      if ((res?.data?.length < limit) || !res?.data) {
        hasNextPage = false
      } else {
        offset += limit
      }
    }
    // Custom sorting based on original variables.sort value
    if (variables.originalSort === 'list_start_date_nan') {
      allMediaList?.sort((a, b) => {
        return new Date(b.node.my_list_status.start_date) - new Date(a.node.my_list_status.start_date)
      })
    } else if (variables.originalSort === 'list_finish_date_nan') {
      allMediaList?.sort((a, b) => {
        return new Date(b.node.my_list_status.finish_date) - new Date(a.node.my_list_status.finish_date)
      })
    } else if (variables.originalSort === 'list_progress_nan') {
      allMediaList?.sort((a, b) => {
        const getSortValue = (item) => {
          const watched = item.node.my_list_status.num_episodes_watched ?? 0
          if (watched === 0) return Infinity
          if ((item.node.num_episodes ?? 0) === 0) return -watched
          const distance = (item.node.num_episodes ?? 0) - watched
          if (distance <= 0) return -Infinity - watched
          return distance + watched / 100_000
        }
        return getSortValue(a) - getSortValue(b)
      })
    }

    return { data: { MediaList: allMediaList } }
  }

  /** @returns {Promise<import('../myanimelist/mal.d.ts').Query<{ Viewer: import('../myanimelist/mal.d.ts').Viewer }>>} */
  async viewer (token) {
    debug('Getting viewer')
    const query = {
      type: 'GET',
      path: 'users/@me',
      eToken: token
    }
    const res = await this.malRequest(query)
    const viewer = { data: { Viewer: res } }
    if (viewer?.data?.Viewer && !viewer?.data?.Viewer?.picture) {
      viewer.data.Viewer.picture = 'https://cdn.myanimelist.net/images/kaomoji_mal_white.png' // set default image if user doesn't have an image, viewer doesn't return the default image if none is set for whatever reason...
    }
    return viewer
  }

  async entry (variables) {
    debug(`Updating entry for ${variables.idMal}`)

    const query = {
      type: 'PUT',
      path: `anime/${variables.idMal}/my_list_status`,
      token: variables.token,
      refresh_in: variables.refresh_in
    }
    const padNumber = (num) => num != null ? String(num).padStart(2, '0') : null
    let start_date = variables.startedAt?.year && variables.startedAt.month && variables.startedAt.day ? `${variables.startedAt.year}-${padNumber(variables.startedAt.month)}-${padNumber(variables.startedAt.day)}` : null
    let finish_date = variables.completedAt?.year && variables.completedAt.month && variables.completedAt.day ? `${variables.completedAt.year}-${padNumber(variables.completedAt.month)}-${padNumber(variables.completedAt.day)}` : null
    if (start_date && finish_date && start_date > finish_date) {
      const currentDate = new Date()
      const dayAgo = new Date(currentDate)
      dayAgo.setDate(currentDate.getDate() - 1)
      finish_date = `${currentDate.getFullYear()}-${padNumber(currentDate.getMonth() + 1)}-${padNumber(currentDate.getDate())}`
      start_date = `${dayAgo.getFullYear()}-${padNumber(dayAgo.getMonth() + 1)}-${padNumber(dayAgo.getDate())}`
    }
    const updateData = {
      status: Helper.statusMap(variables.status),
      is_rewatching: variables.status?.includes('REPEATING'),
      num_watched_episodes: variables.episode || 0,
      num_times_rewatched: variables.repeat || 0,
      score: variables.score || 0
    }
    if (start_date) updateData.start_date = start_date
    if (finish_date) updateData.finish_date = finish_date

    const entryData = {
      data: {
        SaveMediaListEntry: {
          id: variables.id,
          status: variables.status,
          progress: variables.episode,
          score: variables.score,
          repeat: variables.repeat,
          startedAt: variables.startedAt,
          completedAt: variables.completedAt,
          customLists: []
        }
      }
    }
    if (status.value === 'offline' && settings.value.offlineSync) {
      debug(`We are offline and offline syncing is enabled, queuing entry update for media ${variables.idMal}`)
      this.mutationQueue.enqueue('entry', variables.idMal, variables, null, this.mutationQueue.getProgressBefore(variables.idMal) ?? variables.episode ?? null, false)
      return entryData
    }
    const result = this.#listPromise.then(async () => {
      const res = await this.malRequest(query, updateData)
      setTimeout(async () => {
        if (!variables.token) this.userLists.value = Promise.resolve(await this.getUserLists({ sort: 'list_updated_at' }, true)) // awaits before setting the value as it is super jarring to have stuff constantly re-rendering when it's not needed.
      }).unref?.()
      return res ? entryData : res
    })
    this.#listPromise = result.catch(() => {})
    return await result
  }

  async delete (variables) {
    debug(`Deleting entry for ${variables.idMal}`)

    if (status.value === 'offline' && settings.value.offlineSync) {
      debug(`We are offline and offline syncing is enabled, queuing entry deletion for media ${variables.idMal}`)
      this.mutationQueue.enqueue('delete', variables.idMal, variables, null, null, false)
      return []
    }

    const query = {
      type: 'DELETE',
      path: `anime/${variables.idMal}/my_list_status`,
      token: variables.token,
      refresh_in: variables.refresh_in
    }
    const result = this.#listPromise.then(async () => {
      const res = await this.malRequest(query)
      setTimeout(async () => {
        if (!variables.token) this.userLists.value = Promise.resolve(await this.getUserLists({ sort: 'list_updated_at' }, true)) // awaits before setting the value as it is super jarring to have stuff constantly re-rendering when it's not needed.
      }).unref?.()
      return res
    })
    this.#listPromise = result.catch(() => {})
    return await result
  }

  /**
   * Flush offline mutations against the current userlist for validation.
   * MAL has no isFetchingList race condition so there are never any executed mutations to re-apply, only offline ones to execute.
   */
  async #flushMutationQueue() {
    const lists = (await this.userLists.value)?.data?.MediaList ?? null
    await this.mutationQueue.flush(
      lists,
      async () => {}, // no executed mutations for MAL
      async (mutation) => {
        if (mutation.type === 'entry') await this.entry(mutation.variables)
        else if (mutation.type === 'delete') await this.delete(mutation.variables)
      }
    )
  }
}

export const malClient = new MALClient()
