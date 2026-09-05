import { anilistClient, seasons, currentSeason, currentYear } from '@/modules/providers/anilist/anilist.js'
import { animeSchedule } from '@/modules/anime/animeschedule.js'
import { cache, caches } from '@/modules/cache.js'
import { malDubs } from '@/modules/anime/animedubs.js'
import { writable } from 'simple-store-svelte'
import { settings } from '@/modules/settings.js'
import { RSSManager } from '@/modules/rss.js'
import { debounce, uniqueStore } from '@/modules/util.js'
import equal from 'fast-deep-equal/es6'
import Helper from '@/modules/providers/helper.js'
import Debug from 'debug'
const debug = Debug('ui:sections')

const lastSearched = cache.getEntry(caches.HISTORY, 'lastSearched')
export const hasNextPage = writable(true)
export const key = writable({})
export const search = writable(lastSearched || { genre: [], genre_not: [], tag: [], tag_not: [], format: [], format_not: [], status: [], status_not: [] })
search.subscribe(value => {
  if (!value.clearNext) {
    const searched = { ...value }
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
    return (page = 1, perPage = 50, search = variables, background = false) => {
      const res = (search.hideSubs ? malDubs.dubLists.value : Promise.resolve()).then(dubLists => {
        const hideSubs = search.hideSubs ? { idMal: dubLists?.dubbed } : {}
        if ((search.hideMyAnime || search.showMyAnime) && Helper.isAuthorized()) {
          return Helper.userLists(search).then(_res => {
            if (!_res?.data && _res?.errors) throw _res.errors[0]
            let animeFilter = {}
            const hasHideSubs = Object.keys(hideSubs)?.length > 0
            const targetLists = Helper.isAniAuth() ? _res.data.MediaListCollection?.lists : _res.data.MediaList || []
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
      return SectionsManager.wrapResponse(res, perPage, type, background)
    }
  }

  static wrapResponse (res, length, type, background = false) {
    if (!background) res.then(res => hasNextPage.value = res?.data?.Page?.pageInfo?.hasNextPage)
    return Array.from({ length }, (_, i) => ({ type, data: SectionsManager.fromPending(res, i) }))
  }

  static async fromPending (_arr, i) {
    const arr = await _arr
    if (!arr) return null
    const { data, errors } = arr
    if (!data?.Page && errors) throw errors[0]
    return data?.Page?.media?.[i]
  }

  static sanitiseObject = Helper.sanitiseObject
}

// list of all possible home screen sections
export const sections = writable(createSections() || [])
const updateStores = [
  { store: writable(structuredClone(settings.value.homeSections)), key: 'homeSections', canRemap: true },
  { store: writable(structuredClone(settings.value.customSections)), key: 'customSections' },
  { store: writable(structuredClone(settings.value.rssFeedsNew)), key: 'rssFeedsNew' }
]
const debounceUpdate = debounce((value) => {
  let updated = false
  for (const { store, key, canRemap } of updateStores) {
    if (JSON.stringify(store.value) !== JSON.stringify(value[key])) {
      if (!updated) {
        for (const section of sections.value) clearInterval(section.interval)
        sections.value = createSections()
        updated = true
      }
      if (canRemap) remapSections()
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
    ...settings.value.rssFeedsNew.filter(([url]) => url).map(([title, url]) => {
      const section = {
        title,
        sort: 'N/A',
        format: ['N/A'],
        load: (page = 1, perPage = 12, variables, background = false) => RSSManager.getMediaForRSS(page, perPage, url, false, false, background),
        preview: writable(RSSManager.getMediaForRSS(1, 12, url, false, false, true)),
        variables: { disableSearch: true },
        isRSS: true
      }

      // update every 30 seconds
      section.interval = setInterval(async () => {
        try {
          if (await RSSManager.getContentChanged(1, 12, url)) {
            section.preview.value = RSSManager.getMediaForRSS(1, 12, url, true, false, true)
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
        load: (page = 1, perPage = 50, variables, background = false) => animeSchedule.getMediaForRSS(page, perPage, type, background),
        preview: writable(animeSchedule.getMediaForRSS(1, 50, type, true))
      }
    }),
    // user specific sections
    createSection({ title: 'Sequels You Missed', sort: 'POPULARITY_DESC', format: [], hide: !Helper.isAuthorized() || Helper.isMalAuth(),
      load: (page = 1, perPage = 50, variables = {}, background = false) => {
        if (Helper.isMalAuth()) return {} // not going to bother handling this, see below.
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = (res.data.MediaListCollection?.lists || []).find(({ status }) => status === 'COMPLETED')?.entries
          const excludeIds = (res.data.MediaListCollection?.lists || []).reduce((filtered, { status, entries }) => { return (['CURRENT', 'REPEATING', 'COMPLETED', 'DROPPED', 'PAUSED'].includes(status)) ? filtered.concat(entries) : filtered}, []).map(({ media }) => media.id).filter(Boolean) || []
          if (!mediaList) return {}
          const ids = mediaList.flatMap(({ media }) => media.relations.edges.filter(edge => edge.relationType === 'SEQUEL')).map(({ node }) => node.id).filter(Boolean)
          if (!ids.length) return {}
          return anilistClient.searchIDS({ page, perPage, id: ids, id_not: excludeIds, ...SectionsManager.sanitiseObject(variables), status: ['FINISHED', 'RELEASING'] })
        })
        return SectionsManager.wrapResponse(res, perPage, undefined, background)
      } // disable this section when authenticated with MyAnimeList. API for userLists fail to return relations and likely will never be fixed on their end.
    }, { userList: true, missedList: true, disableHide: true }),
    createSection({ title: 'Stories You Missed', sort: 'POPULARITY_DESC', format: [], hide: !Helper.isAuthorized() || Helper.isMalAuth(),
      load: (page = 1, perPage = 50, variables = {}, background = false) => {
        if (Helper.isMalAuth()) return {} // same as Sequels You Missed
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = (res.data.MediaListCollection?.lists || []).find(({ status }) => status === 'COMPLETED')?.entries
          const excludeIds = (res.data.MediaListCollection?.lists || []).reduce((filtered, { status, entries }) => { return (['CURRENT', 'REPEATING', 'COMPLETED', 'DROPPED', 'PAUSED'].includes(status)) ? filtered.concat(entries) : filtered}, []).map(({ media }) => media.id).filter(Boolean) || []
          if (!mediaList) return {}
          const ids = mediaList.flatMap(({ media }) => media.relations.edges.filter(edge => !['SEQUEL', 'CHARACTER', 'OTHER'].includes(edge.relationType))).map(({ node }) => node.id).filter(Boolean)
          if (!ids.length) return {}
          return anilistClient.searchIDS({ page, perPage, id: ids, id_not: excludeIds, ...SectionsManager.sanitiseObject(variables), status: ['FINISHED', 'RELEASING'] })
        })
        return SectionsManager.wrapResponse(res, perPage, undefined, background)
      } // disable this section when authenticated with MyAnimeList. API for userLists fail to return relations and likely will never be fixed on their end.
    }, { userList: true, missedList: true, disableHide: true }),
    createSection({ title: 'Continue Watching', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}, background = false) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          let mediaList = Helper.isAniAuth() ? (res.data.MediaListCollection?.lists || []).reduce((filtered, { status, entries }) => (status === 'CURRENT' || status === 'REPEATING') ? filtered.concat(entries) : filtered, []) : (res.data.MediaList || []).filter(({ node }) => (node.my_list_status.status === Helper.statusMap('CURRENT') || node.my_list_status.is_rewatching))
          if (!mediaList) return {}
          return Promise.all([animeSchedule.dubAiringLists.value, animeSchedule.dubAiredLists.value, malDubs.dubLists.value]).then(([airing, dubAired, dubLists]) => {
            if (settings.value.preferDubs) {
              const ids = []
              const twoWeeksAgo = Date.now() - (14 * 24 * 60 * 60 * 1_000)
              mediaList.forEach(watchMedia => {
                const media = watchMedia?.media || watchMedia?.node
                const isDubbed = dubLists?.dubbed?.includes(media?.idMal || media?.id)
                const isPartialDub = dubLists?.incomplete?.includes(media?.idMal || media?.id)
                const matchingAiring = airing?.find(item => (watchMedia?.media ? item?.media?.media?.id : item?.media?.media?.idMal) === media?.id)
                const airedDubs = (dubAired || []).filter(item => item?.id === media?.id || item?.idMal === media?.id)
                const latestDub = airedDubs.sort((a, b) => b?.episode?.aired - a?.episode?.aired)[0]
                const progress = media?.mediaListEntry?.progress ?? media?.my_list_status?.num_episodes_watched ?? 0
                if (isDubbed && (latestDub && progress === (latestDub.episode.aired + (airedDubs.some(item => item?.episode?.aired === 0) ? 1 : 0))) && ((media?.status === 'RELEASING' || media?.status === 'currently_airing') || (!isPartialDub && new Date(latestDub.episode.airedAt).getTime() >= twoWeeksAgo))) {
                  ids.push(media?.id)
                  return
                }
                if (matchingAiring && (media?.mediaListEntry || media?.my_list_status)) {
                  const now = new Date()
                  const episodes = matchingAiring?.media?.media?.airingSchedule?.nodes
                  const progress = (media?.mediaListEntry?.progress || media?.my_list_status?.num_episodes_watched || 0) - (matchingAiring?.media?.media?.zeroEpisode ? 1 : 0)
                  const sorted = episodes?.slice().sort((a, b) => a.episode - b.episode)
                  const closestDate = sorted?.findLast(episode => new Date(episode.airingAt) <= now)?.airingAt ?? sorted?.[0]?.airingAt
                  const targetEpisode = sorted?.findLast(episode => episode.airingAt === closestDate)
                  const episodeNumber = (targetEpisode?.episode ?? 0) - (new Date(targetEpisode?.airingAt) > now ? 1 : 0)
                  if ((progress === (episodeNumber + (media.episodes && (episodeNumber === media.episodes) ? 1 : 0))) && ((media?.status === 'RELEASING' || media?.status === 'currently_airing') || !(progress >= media?.num_episodes))) ids.push(media?.id)
                }
              })
              mediaList = mediaList.filter(media => !ids.includes(media?.media?.id || media?.node?.id))
            }
            return Promise.all([animeSchedule.subAiringLists.value, animeSchedule.subAiredLists.value, animeSchedule.hentaiAiredLists.value]).then(([airing, subAired, hentaiAired]) => {
              if (Helper.isMalAuth()) {
                const ids = []
                mediaList.forEach(watchMedia => {
                  const media = watchMedia?.node
                  const matchingAiring = airing?.find(item => item?.idMal === media?.id)
                  const airedSubs = (subAired || []).filter(item => item?.idMal === media?.id)
                  const airedEpisodes = airedSubs.length ? airedSubs : (hentaiAired || []).filter(item => item?.idMal === media?.id)
                  if (matchingAiring && media?.my_list_status) {
                    const now = Date.now() / 1000
                    const episodes = matchingAiring?.airingSchedule?.nodes || []
                    const closest = episodes.sort((a, b) => Math.abs(a.airingAt - now) - Math.abs(b.airingAt - now))[0]
                    const closestEpisodes = episodes.filter(ep => ep.airingAt === closest?.airingAt).map(ep => ep.episode)
                    const episodeNumber = closest ? closest.airingAt > now ? Math.min(...closestEpisodes) - 1 : Math.max(...closestEpisodes) : null
                    if (media?.my_list_status?.num_episodes_watched >= (episodeNumber || media?.num_episodes)) ids.push(media?.id)
                  } else if (media?.status === 'currently_airing' && airedEpisodes.length) {
                    const latestEpisode = Math.max(...airedEpisodes.map(item => item?.episode?.aired ?? 0))
                    if (media?.my_list_status?.num_episodes_watched === latestEpisode) ids.push(media?.id)
                  }
                })
                mediaList = mediaList.filter(media => !ids.includes(media?.media?.id || media?.node?.id))
              }
              return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
            })
          })
        })
        return SectionsManager.wrapResponse(res, perPage, undefined, background)
      }
    }, { userList: true, continueWatching: true, disableHide: true, status_not }),
    createSection({ title: 'Watching List', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}, background = false) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? (res.data.MediaListCollection?.lists || []).find(({ status }) => status === 'CURRENT')?.entries
            : (res.data.MediaList || []).filter(({ node }) => node.my_list_status.status === Helper.statusMap('CURRENT'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage, undefined, background)
      }
    }, { userList: true, disableHide: true, status_not }),
    createSection({ title: 'Rewatching List', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}, background = false) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? (res.data.MediaListCollection?.lists || []).find(({ status }) => status === 'REPEATING')?.entries
            : (res.data.MediaList || []).filter(({ node }) => node.my_list_status.status === Helper.statusMap('REPEATING'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage, undefined, background)
      }
    }, { userList: true, disableHide: true, status_not }),
    createSection({ title: 'Completed List', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}, background = false) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? (res.data.MediaListCollection?.lists || []).find(({ status }) => status === 'COMPLETED')?.entries
            : (res.data.MediaList || []).filter(({ node }) => node.my_list_status.status === Helper.statusMap('COMPLETED'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage, undefined, background)
      }
    }, { userList: true, completedList: true, disableHide: true, status_not }),
    createSection({ title: 'Planning List', sort: 'POPULARITY_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}, background = false) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? (res.data.MediaListCollection?.lists || []).find(({ status }) => status === 'PLANNING')?.entries
            : (res.data.MediaList || []).filter(({ node }) => node.my_list_status.status === Helper.statusMap('PLANNING'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage, undefined, background)
      }
    }, { userList: true, planningList: true, disableHide: true, status_not }),
    createSection({ title: 'Paused List', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}, background = false) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? (res.data.MediaListCollection?.lists || []).find(({ status }) => status === 'PAUSED')?.entries
            : (res.data.MediaList || []).filter(({ node }) => node.my_list_status.status === Helper.statusMap('PAUSED'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage, undefined, background)
      }
    }, { userList: true, disableHide: true, status_not }),
    createSection({ title: 'Dropped List', sort: 'UPDATED_TIME_DESC', format: [], hide: !Helper.isAuthorized(),
      load: (page = 1, perPage = 50, variables = {}, background = false) => {
        const res = Helper.userLists(variables).then(res => {
          if (!res?.data && res?.errors) throw res.errors[0]
          const mediaList = Helper.isAniAuth()
            ? (res.data.MediaListCollection?.lists || []).find(({ status }) => status === 'DROPPED')?.entries
            : (res.data.MediaList || []).filter(({ node }) => node.my_list_status.status === Helper.statusMap('DROPPED'))
          if (!mediaList) return {}
          return Helper.getPaginatedMediaList(page, perPage, variables, mediaList)
        })
        return SectionsManager.wrapResponse(res, perPage, undefined, background)
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

let mappedSections = {}
export const manager = new SectionsManager()
mapSections()

export function remapSections() {
  manager.clear()
  mappedSections = {}
  mapSections()
}

function mapSections() {
  for (const section of sections.value) mappedSections[section.title] = section
  for (const sectionTitle of settings.value.homeSections) manager.add(mappedSections[sectionTitle[0]])
}

const continueWatching = 'Continue Watching'
const resolveData = async (data) => Promise.all(
  data.map(async item => {
    const resolved = item.data && typeof item.data.then === 'function' ? await item.data : item.data
    const media = resolved?.media || resolved
    return { ...item, data: (media ? { id: media.id, idMal: media.idMal, title: media.title, bannerImage: media.bannerImage, isAdult: media.isAdult, duration: media.duration, episodes: media.episodes, format: media.format } : resolved) }
  })
)
if (Helper.getUser()) {
  refreshSections(Helper.getClient().userLists, ['Dubbed Releases', 'Subbed Releases', 'Hentai Releases'], true)
  refreshSections(Helper.getClient().userLists, [continueWatching, 'Sequels You Missed', 'Stories You Missed', 'Planning List', 'Completed List', 'Paused List', 'Dropped List', 'Watching List', 'Rewatching List'])
}
if (Helper.isMalAuth()) refreshSections(animeSchedule.subAiredLists, continueWatching) // When authorized with Anilist, this is already automatically handled.
refreshSections(animeSchedule.dubAiredLists, continueWatching)
function refreshSections(list, sections, schedule = false) {
  uniqueStore(list).subscribe(async (_value) => {
    const value = await _value
    if (!value) return
    for (const section of manager.sections) {
      // remove preview value, to force UI to re-request data, which updates it once in viewport
      if (sections.includes(section.title) && !section.hide && (!schedule || section.isSchedule)) {
        const loaded = section.load(1, 50, section.variables, true)
        if (section.preview.value && !equal(await resolveData(loaded), await resolveData(section.preview.value))) section.preview.value = loaded
      }
    }
  })
}

// update AniSchedule 'Releases' feeds when a change is detected for the specified feed(s).
export function updateSections(updateFeeds, manifest) {
  for (const section of manager.sections) {
    try {
      if (section.isSchedule && updateFeeds.includes(section.title)) {
        animeSchedule.feedChanged(section.title.includes('Subbed') ? 'Sub' : section.title.includes('Dubbed') ? 'Dub' : 'Hentai', false, true, manifest).then((changed) => {
          if (changed) section.preview.value = section.load(1, 50, section.variables, true)
        })
      }
    } catch (error) {
      debug(`Failed to update ${section.title} feed, this is likely a temporary connection issue:`, error)
    }
  }
}

// force update RSS feed when the user adjusts a series in the FileManager.
export async function updateRSS() {
  for (const section of manager.sections) {
    if (section.isRSS && !section.isSchedule) {
      const url = settings.value.rssFeedsNew.find(([feedTitle]) => feedTitle === section.title)?.[1]
      if (url) {
        const loaded = RSSManager.getMediaForRSS(1, 12, url, false, true, true)
        if (!section.preview.value || !equal(await resolveData(loaded), await resolveData(section.preview.value))) section.preview.value = loaded
      }
    }
  }
}
window.addEventListener('fileEdit', async () => updateRSS)