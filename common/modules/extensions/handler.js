import { settings } from '@/modules/settings.js'
import WPC from '@/modules/wpc.js'
import { sleep, isValidNumber } from '@/modules/util.js'
import { anilistClient } from '@/modules/anilist.js'
import { anitomyscript, getAniMappings, getMediaMaxEp } from '@/modules/anime/anime.js'
import { checkForZero } from '@/components/MediaHandler.svelte'
import { status } from '@/modules/networking.js'
import { extensionManager } from '@/modules/extensions/manager.js'
import AnimeResolver from '@/modules/anime/animeresolver.js'
import Debug from 'debug'
const debug = Debug('ui:extensions')

/** @typedef {import('../../../extensions').TorrentQuery} Options */
/** @typedef {import('../../../extensions').TorrentResult} Result */

const exclusions = []
const isDev = location.hostname === 'localhost'

const video = document.createElement('video')
if (!isDev) {
  if (!video.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"')) exclusions.push('HEVC', 'x265', 'H.265', '[EMBER]')
  if (!video.canPlayType('audio/mp4; codecs="ac-3"')) exclusions.push('AC3', 'AC-3')
  if (!video.canPlayType('audio/mp4; codecs="dtsc"')) exclusions.push('DTS')
  if (!video.canPlayType('audio/mp4; codecs="truehd"')) exclusions.push('TrueHD')
  if (!('audioTracks' in HTMLVideoElement.prototype)) exclusions.push('DUAL')
}
video.remove()

/**
 * @param {{media: import('@/modules/al.js').Media, episode?: number, batch: boolean, movie: boolean, resolution: string}} opts
 * @returns {Promise<Map<string, { name: string, icon?: string, promise: Promise<any> }>>}
 * Returns a Map of extension results keyed by extension id, each containing metadata and a result promise.
 */
export async function getResultsFromExtensions({ media, episode, batch, movie, resolution }) {
  await extensionManager.whenReady.promise
  debug(`Fetching sources for ${media?.id}:${media?.title?.userPreferred} ${episode} ${batch} ${movie} ${resolution}`)
  const aniDBMeta = await ALToAniDB(media)
  const { anidb_id: anidbAid, imdb_id: imdbAid, thetvdb_id: tvdbAid, themoviedb_id: mvdbAid } = aniDBMeta?.mappings || {}
  const mappingsE = ((anidbAid || tvdbAid) && (await ALtoAniDBEpisode({ media, episode }, aniDBMeta))) || {}
  const anidbEid = anidbAid && mappingsE?.anidbEid
  const tvdbEid = tvdbAid && mappingsE?.tvdbId
  debug(`AniDB Mapping: ${anidbAid} ${anidbEid}`)

  /** @type {Options} */
  const options = {
    anilistId: media.id,
    episodeCount: getMediaMaxEp(media),
    media,
    mappingsA: aniDBMeta?.mappings || {},
    mappingsE,
    episode,
    anidbAid,
    anidbEid,
    tvdbAid,
    tvdbEid,
    imdbAid,
    mvdbAid,
    titles: createTitles(media),
    resolution,
    exclusions: settings.value.enableExternal ? [] : exclusions
  }

  const promises = new Map()
  const allExtensionKeys = Object.keys(settings.value.sourcesNew || {})
  if (!allExtensionKeys.length) {
    debug(status.value !== 'offline' ? 'No torrent sources configured' : 'Torrent sources detected but are inactive')
    return new Map([
      ['NaN', {
        name: 'no-sources',
        promise: Promise.resolve({
          results: [],
          errors: [{ message: status.value !== 'offline' ? 'No torrent sources configured. Add sources in settings.' : 'Sources are inactive.. found no results.' }]
        })
      }]
    ])
  }

  for (const key of allExtensionKeys) {
    const source = settings.value.sourcesNew[key]
    if (!source?.nsfw || settings.value.adult !== 'none') {
      const promise = (async () => {
        try {
          const extensionEnabled = settings.value.extensionsNew?.[key]?.enabled
          const worker = extensionEnabled && await extensionManager.whenExtensionReady(key)
          if (!worker) {
            if (!extensionEnabled) return { results: [], errors: [{ message: 'Extension is not enabled.. skipping...' }] }
            debug(`Extension ${key} is not available`)
            return { results: [], errors: [{ message: `Source ${source?.name || source?.id} is currently unavailable` }] }
          }
          const { results, errors } = await worker.query(options, { movie, batch }, status.value !== 'offline', settings.value.extensionsNew?.[key])
          if (errors?.length && !JSON.stringify(errors)?.match(/no anidb[ae]id provided/i)) throw new Error(errors?.map(error => (error?.message || JSON.stringify(error)).replace(/\\n/g, ' ').replace(/"/g, '')).join('\n') || 'Unknown error')
          else if (errors?.length) throw new Error('Source ' + source.id + ' found no results.')
          debug(`Extension ${key} found ${results?.length} results with ${errors?.length} errors`)
          const deduped = dedupe(results)
          if (!deduped.length) return []
          const parseObjects = await anitomyscript(deduped.map(r => r.title))
          deduped.forEach((r, i) => r.parseObject = parseObjects[i])
          return await updatePeerCounts(deduped, !settings.value.torrentAutoScrape)
        } catch (error) {
          debug(`Extension ${key} failed: ${error}`)
          return { results: [], errors: [{ message: error?.[0]?.message || error?.message }] }
        }
      })()
      promises.set(key, { name: source?.name || source?.id, icon: source?.icon, promise })
    }
  }
  return promises
}

const peerCache = new Map()
export async function updatePeerCounts(entries, cacheOnly = false) {
  const now = Date.now()
  if (cacheOnly) {
    let updatedEntries = 0
    for (const entry of entries) {
      const cached = peerCache.get(entry.hash)
      if (cached && ((now - cached.timestamp) < 600_000 || status.value === 'offline')) {
        entry.downloads = cached.downloads
        entry.leechers = cached.leechers
        entry.seeders = cached.seeders
        updatedEntries++
      }
    }
    debug(`Cache-only mode: applied cached peer counts to ${updatedEntries} entries`)
    return entries
  }

  const toScrape = entries.filter(entry => {
    const cached = peerCache.get(entry.hash)
    return !cached || ((now - cached.timestamp) > 90_000 && status.value !== 'offline')
  })

  for (const entry of entries) {
    const cached = peerCache.get(entry.hash)
    if (cached) {
      entry.downloads = cached.downloads
      entry.leechers = cached.leechers
      entry.seeders = cached.seeders
    }
  }

  if (!toScrape.length) {
    debug('All peer counts are fresh, returning cached entries...')
    return entries
  }

  const id = Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER).toString()
  debug(`Updating peer counts for ${toScrape.length} entries (${entries.length - toScrape.length} served from cache)`)

  const updated = await Promise.race([
    new Promise(resolve => {
      function check(detail) {
        if (detail.id !== id) return
        debug('Got scrape response')
        WPC.clear('scrape_done', check)
        resolve(detail.result)
      }
      WPC.listen('scrape_done', check)
      WPC.send('scrape', { id, infoHashes: toScrape.map(({ hash }) => hash) })
    }),
    sleep(15_000)
  ])
  debug('Scrape complete')

  const scrapedHashes = new Set((updated || []).map(entry => entry.hash))
  for (const { hash, complete, downloaded, incomplete } of updated || []) {
    const entry = entries.find(e => e.hash === hash)
    if (entry) {
      entry.downloads = downloaded
      entry.leechers = incomplete
      entry.seeders = complete
    }
    peerCache.set(hash, { downloads: downloaded, leechers: incomplete, seeders: complete, timestamp: Date.now() })
  }

  for (const entry of toScrape) {
    if (!scrapedHashes.has(entry.hash)) peerCache.set(entry.hash, { downloads: entry.downloads ?? 0, leechers: entry.leechers ?? 0, seeders: entry.seeders ?? 0, timestamp: Date.now() })
  }

  debug(`Scraped ${(updated || []).length} entries, ${entries.length - toScrape.length} from cache`)
  return entries
}

/** @param {import('@/modules/al.js').Media} media */
async function ALToAniDB (media) {
  const json = await getAniMappings(media?.id) || {}
  if (json.mappings?.anidb_id) return json

  const parentID = getParentForSpecial(media)
  if (!parentID) return

  return getAniMappings(parentID)
}

/** @param {import('@/modules/al.js').Media} media */
function getParentForSpecial (media) {
  if (!['SPECIAL', 'OVA', 'ONA'].some(format => media.format === format)) return false
  const animeRelations = media.relations.edges.filter(({ node }) => node.type === 'ANIME')

  return getRelation(animeRelations, 'PARENT') || getRelation(animeRelations, 'PREQUEL') || getRelation(animeRelations, 'SEQUEL')
}

function getRelation (list, type) {
  return list.find(({ relationType }) => relationType === type)?.node.id
}

// TODO: https://anilist.co/anime/13055/
/**
 * @param {{media: import('@/modules/al.js').Media, episode: number}} param0
 * @param {{episodes: any, episodeCount: number, specialCount: number}} param1
 **/
async function ALtoAniDBEpisode ({ media, episode }, { episodes, episodeCount, specialCount }) {
  debug(`Fetching AniDB episode for ${episode}:${media?.id}:${media?.title?.userPreferred}`)
  if (!isValidNumber(episode) || !Object.values(episodes).length) return
  // if media has no specials or their episode counts don't match
  if (!specialCount || (media.episodes && media.episodes === episodeCount && episodes[Number(episode)])) {
    debug('No specials found, or episode count matches between AL and AniDB')
    return episodes[Number(episode)]
  }
  debug(`Episode count mismatch between AL and AniDB for ${media?.id}:${media?.title?.userPreferred}`)
  let alDate

  // Track zero episodes and offset episode by 1 when searching AniList as matching dates would correlate to episode + 1.
  const hasZeroEpisode = specialCount && await checkForZero(media)
  // Cached media generally contains the full airing schedule including already aired episodes... best to check this first to reduce the number of anilist queries.
  const scheduleNode = media?.airingSchedule?.nodes?.find(node => node.episode === (episode + (hasZeroEpisode ? 1 : 0)))
  if (scheduleNode?.airingAt) {
    debug(`Found airdate in cached media for episode ${episode}:${!!hasZeroEpisode}:${media?.id}:${media?.title?.userPreferred}`)
    alDate = new Date(scheduleNode.airingAt * 1_000)
  } else {
    debug(`No airdate in cached media, querying episodeDate for episode ${episode}:${!!hasZeroEpisode}:${media?.id}:${media?.title?.userPreferred}`)
    let res
    try {
      res = await anilistClient.episodeDate({ id: media.id, ep: episode + (hasZeroEpisode ? 1 : 0) })
    } catch (e) {
      debug(`Failed to get episode (network status: ${status.value}) for ${episode}:${!!hasZeroEpisode}:${media?.id}:${media?.title?.userPreferred}`)
    }

    const airingAt = res?.data?.AiringSchedule?.airingAt
    if (airingAt) {
      alDate = new Date(airingAt * 1_000)
    } else {
      debug(`No airing date found for episode ${episode}`)
      // if media only has one episode or , and airdate doesn't exist use start/end dates
      const oneEpisode = media.episodes === 1 || (!media.episodes && (media.format === 'MOVIE' || media.format === 'OVA' || media.format === 'SPECIAL'))
      if (oneEpisode || episode <= 1) {
        const endDate = media.endDate
        const startDate = media.startDate
        if (startDate?.year && startDate?.month && startDate?.day) { // We can use the start date for 'episode 0 or episode 1' with a series.
          alDate = new Date(startDate.year, startDate.month - 1, startDate.day)
          debug(`Using start date as fallback: ${alDate} for ${episode}:${media?.id}:${media?.title?.userPreferred}`)
        } else if ((oneEpisode && episode <= 1) && endDate?.year && endDate?.month && endDate?.day) { // We can't reliably use the series end date if the number of episodes is not specified, and we are expecting more than one episode.
          alDate = new Date(endDate.year, endDate.month - 1, endDate.day)
          debug(`Using end date as fallback: ${alDate} for ${episode}:${media?.id}:${media?.title?.userPreferred}`)
        } else {
          debug(`No date information available for ${episode}:${media?.id}:${media?.title?.userPreferred}`)
          return episodes[Number(episode)] // Best guess fallback
        }
      } else {
        // For multi-episode shows without airdate, we can't reliably match
        return episodes[Number(episode)]
      }
    }
  }

  debug(`AL Airdate: ${alDate} for ${episode}:${media?.id}:${media?.title?.userPreferred}`)
  return episodeByAirDate(alDate, episodes, episode)
}

/**
 * @param {Date} alDate
 * @param {any} episodes
 * @param {number} episode
 **/
export function episodeByAirDate (alDate, episodes, episode) {
  // TODO handle special cases where anilist reports that 3 episodes aired at the same time because of pre-releases
  if (!+alDate) return episodes[Number(episode)] || episodes[1] // what the fuck, are you braindead anilist?, the source episode number to play is from an array created from AL ep count, so how come it's missing?
  // 1 is key for episode 1, not index

  // find the closest episodes by air date, multiple episodes can have the same air date distance
  // inefficient but reliable
  const closestEpisodes = Object.values(episodes).reduce((prev, curr) => {
    if (!prev[0]) return [curr]
    const prevDate = Math.abs(+new Date(prev[0]?.airdate) - +alDate)
    const currDate = Math.abs(+new Date(curr.airdate) - +alDate)
    if (prevDate === currDate) {
      prev.push(curr)
      return prev
    }
    if (currDate < prevDate) return [curr]
    return prev
  }, [])

  return closestEpisodes.reduce((prev, curr) => {
    return Math.abs(curr.episodeNumber - episode) < Math.abs(prev.episodeNumber - episode) ? curr : prev
  })
}

/** @param {import('@/modules/al.js').Media} media */
function createTitles (media) {
  // group and de-duplicate
  const groupedTitles = [...new Set(Object.values(media.title).concat(media.synonyms).filter(name => name != null && name.length > 3))]
  const titles = []
  /** @param {string} title */
  const appendTitle = title => {
    titles.push(title)

    // replace Season 2 with S2, else replace 2nd Season with S2, but keep the original title
    const match1 = title.match(/(\d)(?:nd|rd|th) Season/i)
    const match2 = title.match(/Season (\d)/i)

    if (match2) {
      titles.push(title.replace(/Season \d/i, `S${match2[1]}`))
    } else if (match1) {
      titles.push(title.replace(/(\d)(?:nd|rd|th) Season/i, `S${match1[1]}`))
    }
  }
  for (const title of groupedTitles) {
    const titleVariants = new Set([title, title.replaceAll('-', ' '), title.replaceAll("'", ''), title.replaceAll('"', ''), title.replaceAll('-', ' ').replaceAll("'", '').replaceAll('"', '')])
    for (const titleVariant of titleVariants) appendTitle(titleVariant)
  }
  return titles
}

/** @param {Result[]} entries */
export function dedupe (entries) {
  /** @type {Record<string, Result>} */
  const deduped = {}
  for (const entry of entries) {
    if (deduped[entry.hash] && !deduped[entry.hash]?.source?.managed) {
      const dupe = deduped[entry.hash]
      dupe.title = AnimeResolver.cleanFileName(entry.title)
      dupe.link = entry.link
      dupe.id ??= entry.id
      dupe.seeders ||= entry.seeders >= 30_000 ? 0 : entry.seeders
      dupe.leechers ||= entry.leechers >= 30_000 ? 0 : entry.leechers
      dupe.downloads ||= entry.downloads
      dupe.accuracy ??= entry.accuracy
      dupe.size ||= entry.size
      dupe.date ||= entry.date
      dupe.type ??= entry.type
    } else {
      entry.title = AnimeResolver.cleanFileName(entry.title)
      entry.seeders = entry.seeders && entry.seeders < 30_000 ? entry.seeders : 0
      entry.leechers = entry.leechers && entry.leechers < 30_000 ? entry.leechers : 0
      entry.downloads ||= 0
      entry.date ||= new Date(Date.now() - 1_000).toUTCString()
      deduped[entry.hash] = entry
    }
  }

  return Object.values(deduped)
}
