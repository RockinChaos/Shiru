import { alToken, malToken, settings, sync, isAuthorized } from '@/modules/settings.js'
import { anilistClient } from '@/modules/anilist.js'
import { malClient } from '@/modules/myanimelist.js'
import { malDubs } from '@/modules/anime/animedubs.js'
import { profiles } from '@/modules/settings.js'
import { cache, mediaCache, mapStatus } from '@/modules/cache.js'
import { getMediaMaxEp, hasZeroEpisode } from '@/modules/anime/anime.js'
import { codes, matchKeys, isValidNumber } from '@/modules/util.js'
import { toast } from 'svelte-sonner'
import Debug from 'debug'
const debug = Debug('ui:helper')

export default class Helper {

  static statusName = {
    CURRENT: 'Watching',
    PLANNING: 'Planning',
    COMPLETED: 'Completed',
    PAUSED: 'Paused',
    DROPPED: 'Dropped',
    REPEATING: 'Rewatching'
  }

  static sortMap(sort) {
    switch(sort) {
      case 'UPDATED_TIME_DESC':
        return 'list_updated_at'
      case 'STARTED_ON_DESC':
        return 'list_start_date_nan' // doesn't exist, therefore we use custom logic.
      case 'FINISHED_ON_DESC':
        return 'list_finish_date_nan' // doesn't exist, therefore we use custom logic.
      case 'PROGRESS_DESC':
        return 'list_progress_nan' // doesn't exist, therefore we use custom logic.
      case 'USER_SCORE_DESC':
        return 'list_score'
    }
  }

  static statusMap(status) {
    return mapStatus(status)
  }

  static airingMap(status) {
    switch(status) {
      case 'finished_airing':
        return 'FINISHED'
      case 'currently_airing':
        return 'RELEASING'
      case 'not_yet_aired':
        return 'NOT_YET_RELEASED'
    }
  }

  static getFuzzyDate(media, status) {
    const updatedDate = new Date()
    const fuzzyDate = { year: updatedDate.getFullYear(), month: updatedDate.getMonth() + 1, day: updatedDate.getDate() }
    let startedAt = media.mediaListEntry?.startedAt?.year && media.mediaListEntry?.startedAt?.month && media.mediaListEntry?.startedAt?.day ? media.mediaListEntry.startedAt : (['CURRENT', 'REPEATING'].includes(status) ? fuzzyDate : undefined)
    let completedAt = media.mediaListEntry?.completedAt?.year && media.mediaListEntry?.completedAt?.month && media.mediaListEntry?.completedAt?.day ? media.mediaListEntry.completedAt : (status === 'COMPLETED' ? fuzzyDate : undefined)
    if (startedAt && completedAt) {
      if (`${startedAt.year}-${String(startedAt.month).padStart(2, '0')}-${String(startedAt.day).padStart(2, '0')}` > `${completedAt.year}-${String(completedAt.month).padStart(2, '0')}-${String(completedAt.day).padStart(2, '0')}`) {
        const yesterday = new Date(updatedDate)
        yesterday.setDate(updatedDate.getDate() - 1)
        completedAt = fuzzyDate
        startedAt = { year: yesterday.getFullYear(), month: yesterday.getMonth() + 1, day: yesterday.getDate() }
      }
    }
    return { startedAt, completedAt }
  }

  static sanitiseObject (object = {}) {
    const safe = {}
    for (const [key, value] of Object.entries(object)) {
      if (value) safe[key] = value
    }
    return safe
  }

  static isAniAuth() {
    return alToken
  }

  static isMalAuth() {
    return malToken
  }

  static isAuthorized() {
    return isAuthorized()
  }

  static getClient() {
    return this.isAniAuth() ? anilistClient : malClient
  }

  static getUser() {
    return (alToken || malToken)?.viewer?.data?.Viewer
  }

  static getUserAvatar() {
    return this.getUser()?.avatar?.large || this.getUser()?.avatar?.medium || this.getUser()?.picture
  }

  static isUserSort(variables) {
    return ['UPDATED_TIME_DESC', 'STARTED_ON_DESC', 'FINISHED_ON_DESC', 'PROGRESS_DESC', 'USER_SCORE_DESC'].includes(variables?.sort)
  }

  static userLists(variables) {
    return (!this.isUserSort(variables) || variables.sort === 'UPDATED_TIME_DESC')
        ? this.getClient().userLists.value
        : this.getClient().getUserLists({sort: (this.isAniAuth() ? variables.sort : this.sortMap(variables.sort))})
  }

  static async entry(media, variables) {
    let res
    if (!variables.token) {
      res = await this.getClient().entry(variables)
      if (res?.data?.SaveMediaListEntry) {
        mediaCache.update((currentCache) => ({ ...currentCache, [media.id]: { ...currentCache[media.id], mediaListEntry: res?.data?.SaveMediaListEntry } }))
        window.dispatchEvent(new CustomEvent('notification-read', {
          detail: {
            id: media.id,
            episode: res?.data?.SaveMediaListEntry?.progress,
            episodes: media.episodes
          }
        }))
      }
    } else {
      if (variables.anilist) {
        res = await anilistClient.entry(variables)
      } else {
        res = await malClient.entry(variables)
      }
    }
    return res
  }

  static async delete(media, variables) {
    let res
    if (!variables.token) {
      res = await this.getClient().delete(variables)
      if (res) mediaCache.update((currentCache) => ({ ...currentCache, [media.id]: { ...currentCache[media.id], mediaListEntry: undefined } }))
    } else {
      if (variables.anilist) {
        res = await anilistClient.delete(variables)
      } else {
        res = await malClient.delete(variables)
      }
    }
    return res
  }

  static async updateEntry(filemedia) {
    // check if values exist
    if (filemedia.media && this.isAuthorized()) {
      const { media, failed } = filemedia
      const cachedMedia = await cache.requestMedia(media?.id)
      debug(`Checking entry for ${cachedMedia?.title?.userPreferred}`)

      debug(`Media viability: ${cachedMedia?.status}, is from failed resolve: ${failed}`)
      if (failed) {
        toast.error('Failed to Update Progress', {
          description: 'The currently playing media failed to be identified, episode progress will not be updated... You can fix this in the File Manager.',
          duration: 9000
        })
        return
      }
      if (cachedMedia.status === 'CANCELLED') return // allow for not yet released as sometimes anilist is slow at updating or a few episodes were potentially leaked.

      // check if media can even be watched, ex: it was resolved incorrectly
      // some anime/OVA's can have a single episode, or some movies can have multiple episodes
      const zeroEpisode = await hasZeroEpisode(cachedMedia)
      const singleEpisode = ((!cachedMedia.episodes && (!isValidNumber(filemedia.episode) || Number(filemedia.episode) === 1)) | (cachedMedia.format === 'MOVIE' && cachedMedia.episodes === 1)) && 1 // movie check
      const videoEpisode = (Number(filemedia.episode) || singleEpisode) + (zeroEpisode ? 1 : 0)
      const mediaEpisode = getMediaMaxEp(cachedMedia) || singleEpisode

      debug(`Episode viability: ${videoEpisode}, ${mediaEpisode}, ${singleEpisode}`)
      if (!videoEpisode || !mediaEpisode) return
      // check episode range, safety check if `failed` didn't catch this
      if (videoEpisode > mediaEpisode) return

      const lists = cachedMedia.mediaListEntry?.customLists?.filter(list => list.enabled).map(list => list.name) || []
      const status = cachedMedia.mediaListEntry?.status === 'REPEATING' ? 'REPEATING' : 'CURRENT'
      const progress = cachedMedia.mediaListEntry?.progress

      debug(`User's progress: ${progress}, Media's progress: ${videoEpisode}`)
      // check user's own watch progress
      if (progress > videoEpisode) return
      if (progress === videoEpisode && videoEpisode !== mediaEpisode && !singleEpisode) return

      debug(`Updating entry for ${cachedMedia.title.userPreferred}`)
      const variables = {
        repeat: cachedMedia.mediaListEntry?.repeat || 0,
        id: cachedMedia.id,
        status,
        score: (cachedMedia.mediaListEntry?.score ? (this.isAniAuth() ? (cachedMedia.mediaListEntry?.score * 10) : cachedMedia.mediaListEntry?.score) : 0),
        episode: videoEpisode,
        lists
      }
      if (videoEpisode === mediaEpisode && cachedMedia.status !== 'NOT_YET_RELEASED') { // no chance you can watch all episodes while it's not yet released, maybe a few but not a whole season...
        variables.status = 'COMPLETED'
        if (cachedMedia.mediaListEntry?.status === 'REPEATING') variables.repeat = cachedMedia.mediaListEntry.repeat + 1
      }

      Object.assign(variables, this.getFuzzyDate(cachedMedia, status))
      if (cachedMedia.mediaListEntry?.status !== variables.status || cachedMedia.mediaListEntry?.progress !== variables.episode || cachedMedia.mediaListEntry?.score !== (this.isAniAuth() ? (variables.score / 10) : variables.score) || (cachedMedia.mediaListEntry?.repeat || 0) !== variables.repeat) {
        let res
        const description = `Title: ${anilistClient.title(cachedMedia)}\nStatus: ${this.statusName[variables.status]}\nEpisode: ${videoEpisode} / ${getMediaMaxEp(cachedMedia) ? getMediaMaxEp(cachedMedia) : '?'}${variables.score !== 0 ? `\nYour Score: ${this.isAniAuth() ? (variables.score / 10) : variables.score}` : ''}`
        if (this.isAniAuth()) {
          res = await anilistClient.entry(variables)
        } else if (this.isMalAuth()) {
          res = await malClient.malEntry(cachedMedia, variables)
        }
        if (res?.data?.mediaListEntry || res?.data?.SaveMediaListEntry) {
          window.dispatchEvent(new CustomEvent('notification-read', {
            detail: {
              id: media.id,
              episode: res?.data?.mediaListEntry?.progress || res?.data?.SaveMediaListEntry?.progress,
              episodes: cachedMedia.episodes
            }
          }))
        }
        this.listToast(res, description, false)

        if (sync.value.length > 0) { // handle profile entry syncing
          for (const profile of profiles.value) {
            if (sync.value.includes(profile?.viewer?.data?.Viewer?.id)) {
              let res
              if (profile.viewer?.data?.Viewer?.avatar) {
                variables.score = (cachedMedia.mediaListEntry?.score ? (cachedMedia.mediaListEntry?.score * 10) : 0)
                const lists = (await anilistClient.getUserLists({userID: profile.viewer.data.Viewer.id, token: profile.token}))?.data?.MediaListCollection?.lists?.flatMap(list => list.entries).find(({ media: listMedia }) => listMedia.id === cachedMedia.id)?.media?.mediaListEntry?.customLists?.filter(list => list.enabled).map(list => list.name) || []
                res = await anilistClient.entry({ ...variables, lists, token: profile.token })
              } else {
                variables.score = (cachedMedia.mediaListEntry?.score ? cachedMedia.mediaListEntry?.score : 0)
                res = await malClient.malEntry(cachedMedia, { ...variables, token: profile.token, refresh_in: profile.refresh_in })
              }
              this.listToast(res, description, profile)
            }
          }
        }
      } else {
        debug(`No entry changes detected for ${cachedMedia.title.userPreferred}`)
      }
    }
  }

  static listToast(res, description, profile)  {
    const who = (profile ? ' for ' + profile.viewer.data.Viewer.name + (profile.viewer?.data?.Viewer?.avatar ? ' (AniList)' : ' (MyAnimeList)')  : '')
    if (res?.data?.mediaListEntry || res?.data?.SaveMediaListEntry) {
      debug(`List Updated ${who}: ${description.replace(/\n/g, ', ')}`)
      if (!profile && (settings.value.toasts.includes('All') || settings.value.toasts.includes('Successes'))) {
        toast.success('List Updated', {
          description,
          duration: 6000
        })
      }
    } else {
      const error = `\n${429} - ${codes[429]}`
      debug(`Error: Failed to update user list${who} with: ${description.replace(/\n/g, ', ')} ${error}`)
      if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Errors')) {
        toast.error('Failed to Update List' + who, {
          description: description + error,
          duration: 9000
        })
      }
    }
  }

  static getPaginatedMediaList(page, perPage, variables, mediaList) {
    debug('Getting custom paged media list')
    return (variables.hideSubs ? malDubs.dubLists.value : Promise.resolve()).then(dubLists => {
      const ids = this.isAniAuth() ? mediaList.filter(({ media }) => {
          if ((!variables.hideSubs || dubLists.dubbed.includes(media.idMal)) &&
            matchKeys(media, variables.search, ['title.userPreferred', 'title.english', 'title.romaji', 'title.native']) &&
            (!variables.genre || variables.genre.map(genre => genre.trim().toLowerCase()).every(genre => media.genres.map(genre => genre.trim().toLowerCase()).includes(genre))) &&
            (!variables.tag || variables.tag.map(tag => tag.trim().toLowerCase()).every(tag => media.tags.map(tag => tag.name.trim().toLowerCase()).includes(tag))) &&
            (!variables.season || variables.season === media.season) &&
            (!variables.year || variables.year === media.seasonYear) &&
            (!variables.format || (Array.isArray(variables.format) && variables.format.includes(media.format)) || variables.format === media.format) &&
            (!variables.format_not || (Array.isArray(variables.format_not) && !variables.format_not.includes(media.format)) || variables.format_not !== media.format) &&
            (!variables.status || (typeof variables.status === 'string' && variables.status === media.status) || (Array.isArray(variables.status) && variables.status.includes(media.status))) &&
            (!variables.status_not || (typeof variables.status_not === 'string' && variables.status_not !== media.status) || (Array.isArray(variables.status_not) && !variables.status_not.includes(media.status))) &&
            (!variables.continueWatching || (media.status === 'FINISHED' || media.mediaListEntry?.progress < media.nextAiringEpisode?.episode - 1))) {
            return true
          }
        }).sort((a, b) => {
          if (this.isUserSort(variables)) {
            switch (variables.sort) {
              case 'STARTED_ON_DESC':
                return ((b.media?.mediaListEntry?.startedAt?.year || 0) * 10000 + (b.media?.mediaListEntry?.startedAt?.month || 0) * 100 + (b.media?.mediaListEntry?.startedAt?.day || 0))
                     - ((a.media?.mediaListEntry?.startedAt?.year || 0) * 10000 + (a.media?.mediaListEntry?.startedAt?.month || 0) * 100 + (a.media?.mediaListEntry?.startedAt?.day || 0))
              case 'FINISHED_ON_DESC':
                return ((b.media?.mediaListEntry?.completedAt?.year || 0) * 10000 + (b.media?.mediaListEntry?.completedAt?.month || 0) * 100 + (b.media?.mediaListEntry?.completedAt?.day || 0))
                     - ((a.media?.mediaListEntry?.completedAt?.year || 0) * 10000 + (a.media?.mediaListEntry?.completedAt?.month || 0) * 100 + (a.media?.mediaListEntry?.completedAt?.day || 0))
              case 'PROGRESS_DESC':
                const getSortValue = (media) => {
                  const progress = media?.mediaListEntry?.progress ?? 0
                  const totalEpisodes = media?.episodes ?? getMediaMaxEp(media) ?? 0
                  if (progress === 0) return Infinity
                  if (totalEpisodes === 0) return -progress
                  const distance = totalEpisodes - progress
                  return distance <= 0 ? -Infinity : distance
                }
                return getSortValue(a.media) - getSortValue(b.media)
              case 'USER_SCORE_DESC': // doesn't exist, AniList uses SCORE_DESC for both MediaSort and MediaListSort.
                return (b.media?.mediaListEntry?.score || 0) - (a.media?.mediaListEntry?.score || 0)
              case 'UPDATED_TIME_DESC':
                return (b.media?.mediaListEntry?.updatedAt || 0) - (a.media?.mediaListEntry?.updatedAt || 0)
            }
          }
          return 0
        }) // no need to handle sorting for this, we implemented sorting (above) for Anilist because Watching and Rewatching are separate lists. This is not the case for MyAnimeList, it uses "is_rewatching" boolean as an indicator instead.
          .map(({ media }) => (this.isUserSort(variables) ? media : media.id)) : mediaList.filter(({ node }) => {
          if ((!variables.hideSubs || dubLists.dubbed.includes(node.id)) &&
            matchKeys(node, variables.search, ['title', 'alternative_titles.en', 'alternative_titles.ja']) &&
            (!variables.season || variables.season.toLowerCase() === node.start_season?.season.toLowerCase()) &&
            (!variables.year || variables.year === node.start_season?.year) &&
            (!variables.format || (Array.isArray(variables.format) ? (variables.format.includes(node.media_type.toUpperCase()) || (variables.format.includes('TV_SHORT') && (node.media_type.toUpperCase() === 'TV') && (node.average_episode_duration < 1200))) && (!variables.format.includes('TV') || variables.format.includes('TV_SHORT') || (node.average_episode_duration >= 1200)) : ((variables.format === node.media_type.toUpperCase()) || ((variables.format === 'TV_SHORT') && (node.media_type.toUpperCase() === 'TV') && (node.average_episode_duration < 1200))) && ((variables.format !== 'TV') || (variables.format === 'TV_SHORT') || (node.average_episode_duration >= 1200)))) &&
            (!variables.format_not || (Array.isArray(variables.format_not) ? !((variables.format_not.includes(node.media_type.toUpperCase()) || (variables.format_not.includes('TV_SHORT') && (node.media_type.toUpperCase() === 'TV') && (node.average_episode_duration < 1200))) && (!variables.format_not.includes('TV') || variables.format_not.includes('TV_SHORT') || (node.average_episode_duration >= 1200))) : !(((variables.format_not === node.media_type.toUpperCase()) || ((variables.format_not === 'TV_SHORT') && (node.media_type.toUpperCase() === 'TV') && (node.average_episode_duration < 1200))) && ((variables.format_not !== 'TV') || (variables.format_not === 'TV_SHORT') || (node.average_episode_duration >= 1200))))) &&
            (!variables.status || (typeof variables.status === 'string' && variables.status === this.airingMap(node.status)) || (Array.isArray(variables.status) && variables.status.includes(this.airingMap(node.status)))) &&
            (!variables.status_not || (typeof variables.status_not === 'string' && variables.status_not !== this.airingMap(node.status)) || (Array.isArray(variables.status_not) && !variables.status_not.includes(this.airingMap(node.status))))) {
            // api does not provide airing episode or tags, additionally genres are inaccurate and tags do not exist.
            return true
          }
        }).map(({ node }) => node.id).filter(Boolean)
      if (!ids.length) return {}
      if (this.isUserSort(variables)) {
        debug(`Handling page media list with user specific sorting ${variables.sort}`)
        const updatedVariables = { ...variables }
        delete updatedVariables.sort // delete user sort as you can't sort by user specific sorting on AniList when logged into MyAnimeList.
        if (!this.isAniAuth()) delete updatedVariables.format // MyAnimeList series format can be different from Anilist, we don't need to include this since we just filtered what is needed above.
        const startIndex = (perPage * (page - 1))
        const endIndex = startIndex + perPage
        const paginatedIds = ids.slice(startIndex, endIndex)
        const hasNextPage = ids.length > endIndex
        const idIndexMap = paginatedIds.reduce((map, id, index) => { map[id] = index; return map }, {})
        return this.isAniAuth() ? {
          data: {
            Page: {
              pageInfo: {
                hasNextPage: hasNextPage
              },
              media: paginatedIds
            }
          }
        } : anilistClient.searchIDS({ page: 1, perPage, idMal: paginatedIds, ...this.sanitiseObject(updatedVariables) }).then(res => {
          res.data.Page.pageInfo.hasNextPage = hasNextPage
          res.data.Page.media = res.data.Page.media.sort((a, b) => { return idIndexMap[a.idMal] - idIndexMap[b.idMal] })
          return res
        })
      } else {
        debug(`Handling page media list with non-specific sorting ${variables.sort}`)
        return anilistClient.searchIDS({ page, perPage, ...({[this.isAniAuth() ? 'id' : 'idMal']: ids}), ...this.sanitiseObject(variables) }).then(res => {
          return res
        })
      }
    })
  }
}
