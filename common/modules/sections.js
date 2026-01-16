import { anilistClient, seasons, currentSeason, currentYear } from '@/modules/anilist.js'
import { animeSchedule } from '@/modules/anime/animeschedule.js'
import { cache, caches } from '@/modules/cache.js'
import { malDubs } from '@/modules/anime/animedubs.js'
import { writable } from 'simple-store-svelte'
import { settings } from '@/modules/settings.js'
import { RSSManager } from '@/modules/rss.js'
import { debounce } from '@/modules/util.js'
import Helper from '@/modules/helper.js'
import Debug from 'debug'
import WPC from '@/modules/wpc.js'
const debug = Debug('ui:sections')

const lastSearched = cache.getEntry(caches.HISTORY, 'lastSearched')
export const hasNextPage = writable(true)
export const key = writable({})
export const search = writable(lastSearched || { genre: [], genre_not: [], tag: [], tag_not: [], format: [], format_not: [], status: [], status_not: [] })
search.subscribe(value => {
  if (!value.clearNext) {
    const searched = {...value}
    delete searched.load
    delete searched.preview
    cache.setEntry(caches.HISTORY, 'lastSearched', searched)
  }
})

const hideStatus = ['CURRENT', 'REPEATING', 'COMPLETED', 'DROPPED']
const format = ['TV', 'MOVIE']
const status_not = ['NOT_YET_RELEASED', 'CANCELLED']

export default class SectionsManager {
  constructor (data = []) {
    this.sections = []
    for (const section of data) this.add(section)
  }

  /**
   * @param {object} data
   */
  add (data) {
    if (!data) return
    const { title, variables = {}, type, load = SectionsManager.createFallbackLoad(variables, type), preview = writable() } = data
    const section = { ...data, load, title, preview, variables }
    this.sections.push(section)
    return section
  }

  clear() {
    this.sections = []
  }

  static createFallbackLoad (variables, type) {
    return (page = 1, perPage = 50, search = variables) => {
      const res = (search.hideSubs ? malDubs.dubLists.value : Promise.resolve()).then(dubLists => {
        const hideSubs = search.hideSubs ? { idMal: dubLists?.dubbed } : {}
        if ((search.hideMyAnime || search.showMyAnime) && Helper.isAuthorized()) {
          return Helper.userLists(search).then(_res => {
            if (!_res?.data && _res?.errors) throw _res.errors[0]
            let animeFilter = {}
            const hasHideSubs = Object.keys(hideSubs)?.length > 0
            const targetLists = Helper.isAniAuth() ? _res.data.MediaListCollection.lists : _res.data.MediaList
            const statusFilter = search.hideMyAnime ? search.hideStatus : search.showStatus
            const userAnimeIds = Array.from(new Set(Helper.isAniAuth() ? targetLists.filter(({ status }) => statusFilter.includes(status)).flatMap(list => list.entries.map(({ media }) => hasHideSubs ? media.idMal : media.id)) : targetLists.filter(({ node }) => statusFilter.includes(Helper.statusMap(node.my_list_status.status))).map(({ node }) => node.id))).filter(Boolean)
            // anilist queries do not support mix and match, you have to use the same id includes as excludes, id_not_in cannot be used with idMal_in.
            if (search.hideMyAnime) animeFilter = userAnimeIds?.length ? (Helper.isAniAuth() ? { [hasHideSubs ? 'idMal_not' : 'id_not']: userAnimeIds.filter(Boolean) } : { idMal_not: userAnimeIds }) : {}
            else if (search.showMyAnime) animeFilter = userAnimeIds?.length ? { id: userAnimeIds.filter(Boolean) } : {}
            return anilistClient.search({ page, perPage, ...hideSubs, ...animeFilter, ...SectionsManager.sanitiseObject(search) })
          })
        }
        return anilistClient.search({ page, perPage, ...hideSubs, ...SectionsManager.sanitiseObject(search) })
      })
      return SectionsManager.wrapResponse(res, perPage, type)
    }
  }

  static wrapResponse (res, length, type) {
    res.then(res => {
      hasNextPage.value = res?.data?.Page.pageInfo.hasNextPage
    })
    return Array.from({ length }, (_, i) => ({ type, data: SectionsManager.fromPending(res, i) }))
  }

  static async fromPending (_arr, i) {
    const arr = await _arr
    if (!arr) return null
    const { data, errors } = arr
    if (!data && errors) throw errors[0]
    return data?.Page.media[i]
  }

  static sanitiseObject = Helper.sanitiseObject
}

// list of all possible home screen sections
export const sections = writable(createSections() || [])
const updateStores = [
  { store: writable(structuredClone(settings.value.homeSections)), key: 'homeSections', wpc: true },
  { store: writable(structuredClone(settings.value.customSections)), key: 'customSections' },
  { store: writable(structuredClone(settings.value.rssFeedsNew)), key: 'rssFeedsNew' }
]
const debounceUpdate = debounce((value) => {
  let updated = false
  for (const { store, key, wpc } of updateStores) {
    if (JSON.stringify(store.value) !== JSON.stringify(value[key])) {
      if (!updated) {
        for (const section of sections.value) clearInterval(section.interval)
        sections.value = createSections()
        updated = true
      }
      if (wpc) WPC.send('remap-sections')
      store.set(structuredClone(value[key]))
    }
  }
}, 3_000)
settings.subscribe((value) => debounceUpdate(value))

function createSections () {
  const sectionFormat = (title) => (settings.value.homeSections.find(([t]) => t === title)?.[2] || [])
  const createSection = (section, variables = {}, staticSort) => ({ ...section, ...(section.sort && staticSort ? { sort: 'N/A' } : {}), variables: { ...variables, sort: settings.value.homeSections.find(([t]) => !staticSort && t === section.title)?.[1] ?? section.sort, ...(Array.isArray(sectionFormat(section.title)) && sectionFormat(section.title).length > 0 ? { format : sectionFormat(section.title) } : {}) } })
  return [
    // RSS feeds
    ...settings.value.rssFeedsNew.filter(([title, url]) => url).map(([title, url]) => {
      const section = {
        title,
        sort: 'N/A',
        format: ['N/A'],
        load: (page = 1, perPage = 12) => RSSManager.getMediaForRSS(page, perPage, url),
        preview: writable(RSSManager.getMediaForRSS(1, 12, url)),
        variables: { disableSearch: true },
        isRSS: true
      }

      // update every 30 seconds
      section.interval = setInterval(async () => {
        try {
          if (await RSSManager.getContentChanged(1, 12, url)) {
            section.preview.value = RSSManager.getMediaForRSS(1, 12, url, true)
          }
        } catch (error) {
          debug(`Failed to update RSS feed for ${url} at the scheduled interval, this is likely a temporary connection issue:`, JSON.stringify(error))
        }
      }, 30000)

      return section
    }),
    // official episode releases section
    ...['Dubbed Releases', 'Subbed Releases', ...(settings.value.adult === 'hentai' ? ['Hentai Releases'] : [])].map((title) => {
      const type = title.includes('Subbed') ? 'Sub' : title.includes('Dubbed') ? 'Dub' : 'Hentai'
      return {
        title,
        sort: 'N/A',
        format: !title.includes('Hentai') ? ['TV', 'MOVIE', 'OVA', 'ONA'] : ['OVA'],
        variables: { disableSearch: true },
        isRSS: true,
        isSchedule: true,
        load: (page = 1, perPage = 50) => animeSchedule.getMediaForRSS(page, perPage, type),
        preview: writable(animeSchedule.getMediaForRSS(1, 50, type)),
      }
    }),
    // user specific sections
    createSection({ title: 'Sequels You Missed', sort: 'POPULARITY_DESC', format: [], hide: !Helper.isAuthorized() || Helper.isMalAuth(),
      load: (page = 1, perPage = 50, variables = {}) => {
        if (Helper.isMalAuth()) return {} // not going to bother handling this, see below.
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = res.data.MediaListCollection.lists.find(({ status }) => status === 'COMPLETED')?.entries
          const excludeIds = res.data.MediaListCollection.lists.reduce((filtered, { status, entries }) => { return (['CURRENT', 'REPEATING', 'COMPLETED', 'DROPPED', 'PAUSED'].includes(status)) ? filtered.concat(entries) : filtered}, []).map(({ media }) => media.id).filter(Boolean) || []
          if (!mediaList) return {}
          const ids = mediaList.flatMap(({ media }) => media.relations.edges.filter(edge => edge.relationType === 'SEQUEL')).map(({ node }) => node.id).filter(Boolean)
          if (!ids.length) return {}
          return anilistClient.searchIDS({ page, perPage, id: ids, id_not: excludeIds, ...SectionsManager.sanitiseObject(variables), status: ['FINISHED', 'RELEASING'] })
        })
        return SectionsManager.wrapResponse(res, perPage)
      } // disable this section when authenticated with MyAnimeList. API for userLists fail to return relations and likely will never be fixed on their end.
    }, { userList: true, missedList: true, disableHide: true }),
    createSection({ title: 'Stories You Missed', sort: 'POPULARITY_DESC', format: [], hide: !Helper.isAuthorized() || Helper.isMalAuth(),
      load: (page = 1, perPage = 50, variables = {}) => {
        if (Helper.isMalAuth()) return {} // same as Sequels You Missed
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = res.data.MediaListCollection.lists.find(({ status }) => status === 'COMPLETED')?.entries
          const excludeIds = res.data.MediaListCollection.lists.reduce((filtered, { status, entries }) => { return (['CURRENT', 'REPEATING', 'COMPLETED', 'DROPPED', 'PAUSED'].includes(status)) ? filtered.concat(entries) : filtered}, []).map(({ media }) => media.id).filter(Boolean) || []
          if (!mediaList) return {}
          const ids = mediaList.flatMap(({ media }) => media.relations.edges.filter(edge => !['SEQUEL', 'CHARACTER', 'OTHER'].includes(edge.relationType))).map(({ node }) => node.id).filter(Boolean)
          if (!ids.length) return {}
          return anilistClient.searchIDS({ page, perPage, id: ids, id_not: excludeIds, ...SectionsManager.sanitiseObject(variables), status: ['FINISHED', 'RELEASING'] })
        })
        return SectionsManager.wrapResponse(res, perPage)
      } // disable this section when authenticated with MyAnimeList. API for userLists fail to return relations and likely will never be fixed on their end.
    }, { userList: true, missedList: true, disableHide: true }),
    createSection({ title: 'Continue Watching', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          let mediaList = Helper.isAniAuth() ? res.data.MediaListCollection.lists.reduce((filtered, { status, entries }) => (status === 'CURRENT' || status === 'REPEATING') ? filtered.concat(entries) : filtered, []) : res.data.MediaList.filter(({ node }) => (node.my_list_status.status === Helper.statusMap('CURRENT') || node.my_list_status.is_rewatching))
          if (!mediaList) return {}
          return animeSchedule.dubAiringLists.value.then(airing => {
            if (settings.value.preferDubs) {
              const ids = []
              mediaList.forEach(watchMedia => {
                const media = watchMedia?.media || watchMedia?.node
                const matchingAiring = airing?.find(item => (watchMedia?.media ? item?.media?.media?.id : item?.media?.media?.idMal) === media?.id)
                if (matchingAiring && (media?.mediaListEntry || media?.my_list_status)) {
                  const episodes = matchingAiring?.media?.media?.airingSchedule?.nodes
                  const progress = (media?.mediaListEntry?.progress || media?.my_list_status?.num_episodes_watched || 0) - (matchingAiring?.media?.media?.zeroEpisode ? 1 : 0)
                  const episodeNumber = episodes?.[episodes.length > 1 ? episodes.length - 1 : 0]?.episode - (new Date(episodes?.[episodes.length > 1 ? episodes.length - 1 : 0]?.airingAt) > new Date() ? 1 : 0)
                  if ((progress === (episodeNumber + (media.episodes && (episodeNumber === media.episodes) ? 1 : 0))) && ((media?.status === 'RELEASING' || media?.status === 'currently_airing') || !(progress >= media?.num_episodes))) ids.push(media?.id)
                }
              })
              mediaList = mediaList.filter(media => !ids.includes(media?.media?.id || media?.node?.id))
            }
            return animeSchedule.subAiringLists.value.then(airing => {
              if (Helper.isMalAuth()) {
                const ids = []
                mediaList.forEach(watchMedia => {
                  const media = watchMedia?.node
                  const matchingAiring = airing?.find(item => item?.idMal === media?.id)
                  if (matchingAiring && media?.my_list_status) {
                    const now = Date.now() / 1000
                    const episodes = matchingAiring?.airingSchedule?.nodes || []
                    const closest = episodes.sort((a, b) => Math.abs(a.airingAt - now) - Math.abs(b.airingAt - now))[0]
                    const highestEpisode = Math.max(...episodes.filter(ep => ep.airingAt === closest?.airingAt)?.map(ep => ep.episode))
                    const episodeNumber = closest ? closest.airingAt > now ? highestEpisode - 1 : highestEpisode : null
                    if (media?.my_list_status?.num_episodes_watched >= (episodeNumber || media?.num_episodes)) ids.push(media?.id)
                  }
                })
                mediaList = mediaList.filter(media => !ids.includes(media?.media?.id || media?.node?.id))
              }
              return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
            })
          })
        })
        return SectionsManager.wrapResponse(res, perPage)
      }
    }, { userList: true, continueWatching: true, disableHide: true, status_not }),
    createSection({ title: 'Watching List', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? res.data.MediaListCollection.lists.find(({ status }) => status === 'CURRENT')?.entries
            : res.data.MediaList.filter(({ node }) => node.my_list_status.status === Helper.statusMap('CURRENT'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage)
      }
    }, { userList: true, disableHide: true, status_not }),
    createSection({ title: 'Rewatching List', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? res.data.MediaListCollection.lists.find(({ status }) => status === 'REPEATING')?.entries
            : res.data.MediaList.filter(({ node }) => node.my_list_status.status === Helper.statusMap('REPEATING'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage)
      }
    }, { userList: true, disableHide: true, status_not }),
    createSection({ title: 'Completed List', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? res.data.MediaListCollection.lists.find(({ status }) => status === 'COMPLETED')?.entries
            : res.data.MediaList.filter(({ node }) => node.my_list_status.status === Helper.statusMap('COMPLETED'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage)
      }
    }, { userList: true, completedList: true, disableHide: true, status_not }),
    createSection({ title: 'Planning List', sort: 'POPULARITY_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? res.data.MediaListCollection.lists.find(({ status }) => status === 'PLANNING')?.entries
            : res.data.MediaList.filter(({ node }) => node.my_list_status.status === Helper.statusMap('PLANNING'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage)
      }
    }, { userList: true, planningList: true, disableHide: true, status_not }),
    createSection({ title: 'Paused List', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? res.data.MediaListCollection.lists.find(({ status }) => status === 'PAUSED')?.entries
            : res.data.MediaList.filter(({ node }) => node.my_list_status.status === Helper.statusMap('PAUSED'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage)
      }
    }, { userList: true, disableHide: true, status_not }),
    createSection({ title: 'Dropped List', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? res.data.MediaListCollection.lists.find(({ status }) => status === 'DROPPED')?.entries
            : res.data.MediaList.filter(({ node }) => node.my_list_status.status === Helper.statusMap('DROPPED'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage)
      }
    }, { userList: true, droppedList: true, disableHide: true, status_not }),
    // common, non-user specific sections
    createSection({ title: 'Popular This Season', sort: 'POPULARITY_DESC', format }, { season: currentSeason, year: currentYear, hideMyAnime: settings.value.hideMyAnime, hideStatus, status_not }, true),
    createSection({ title: 'Upcoming Next Season', sort: 'POPULARITY_DESC', format }, { season: seasons[(seasons.indexOf(currentSeason) + 1) % seasons.length], year: (currentYear + (currentSeason === 'FALL' ? 1 : 0)), hideMyAnime: settings.value.hideMyAnime, hideStatus, status: ['NOT_YET_RELEASED'], status_not: ['CANCELLED'] }),
    createSection({ title: 'Trending Now', sort: 'TRENDING_DESC', format }, { hideMyAnime: settings.value.hideMyAnime, hideStatus, status_not }, true),
    createSection({ title: 'All Time Popular', sort: 'POPULARITY_DESC', format }, { hideMyAnime: settings.value.hideMyAnime, hideStatus, status_not }, true),
    ...settings.value.customSections.map(([title, genres, tags, genre_not, tag_not]) => createSection({ title, sort: 'TRENDING_DESC', format }, { ...(genres?.length > 0 ? { genre: genres } : {}), ...(tags?.length > 0 ? { tag: tags } : {}), hideMyAnime: settings.value.hideMyAnime, hideStatus, status_not }))
  ]
}
