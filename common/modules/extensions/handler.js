import { settings } from '@/modules/settings.js'
import WPC from '@/modules/wpc.js'
import { sleep } from '@/modules/util.js'
import { anilistClient } from '@/modules/anilist.js'
import { anitomyscript, getAniMappings, getMediaMaxEp } from '@/modules/anime/anime.js'
import { status } from '@/modules/networking.js'
import { extensionManager } from '@/modules/extensions/manager.js'
import AnimeResolver from '@/modules/anime/animeresolver.js'
import Debug from 'debug'
const debug = Debug('ui:extensions')

/** @typedef {import('extensions/index.d.ts').TorrentQuery} Options */
/** @typedef {import('extensions/index.d.ts').TorrentResult} Result */

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
  const anidbAid = aniDBMeta?.mappings?.anidb_id
  const anidbEid = anidbAid && (await ALtoAniDBEpisode({ media, episode }, aniDBMeta))?.anidbEid
  debug(`AniDB Mapping: ${anidbAid} ${anidbEid}`)

  /** @type {Options} */
  const options = {
    anilistId: media.id,
    episodeCount: getMediaMaxEp(media),
    episode,
    anidbAid,
    anidbEid,
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
          return await updatePeerCounts(deduped)
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
async function updatePeerCounts (entries) {
  const cacheKey = JSON.stringify(entries)
  const cached = peerCache.get(cacheKey)
  if (cached && (((Date.now() - cached.timestamp) <= 90000) || status.value === 'offline')) {
    debug(`The previously cached peer counts are less than two minutes old, returning cached entries...`, entries)
    return cached.scrape
  }

  const id = Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER).toString()
  debug(`Updating peer counts for ${entries?.length} entries`)
  const updated = await Promise.race([
    new Promise(resolve => {
      function check (detail) {
        if (detail.id !== id) return
        debug('Got scrape response')
        WPC.clear('scrape_done', check)
        resolve(detail.result)
      }
      WPC.listen('scrape_done', check)
      WPC.send('scrape', { id, infoHashes: entries.map(({ hash }) => hash) })
    }),
    sleep(15000)
  ])
  debug('Scrape complete')

  for (const { hash, complete, downloaded, incomplete } of updated || []) {
    const found = entries.find(mapped => mapped.hash === hash)
    found.downloads = downloaded
    found.leechers = incomplete
    found.seeders = complete
  }

  debug(`Found ${(updated || []).length} entries: ${JSON.stringify(updated)}`)
  peerCache.set(cacheKey, { scrape: entries, timestamp: Date.now() })
  return peerCache.get(cacheKey)?.scrape
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
  debug(`Fetching AniDB episode for ${media?.id}:${media?.title?.userPreferred} ${episode}`)
  if (!episode || !Object.values(episodes).length) return
  // if media has no specials or their episode counts don't match
  if (!specialCount || (media.episodes && media.episodes === episodeCount && episodes[Number(episode)])) {
    debug('No specials found, or episode count matches between AL and AniDB')
    return episodes[Number(episode)]
  }
  debug(`Episode count mismatch between AL and AniDB for ${media?.id}:${media?.title?.userPreferred}`)
  const res = await anilistClient.episodeDate({ id: media.id, ep: episode })
  // TODO: if media only has one episode, and airdate doesn't exist use start/release/end dates
  const alDate = new Date((res.data.AiringSchedule?.airingAt || 0) * 1000)
  debug(`AL Airdate: ${alDate}`)

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
  // 1 is key for episod 1, not index

  // find closest episodes by air date, multiple episodes can have the same air date distance
  // ineffcient but reliable
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
  const grouped = [...new Set(Object.values(media.title).concat(media.synonyms).filter(name => name != null && name.length > 3))]
  const titles = []
  /** @param {string} title */
  const appendTitle = title => {
    // replace & with encoded
    // title = title.replace(/&/g, '%26').replace(/\?/g, '%3F').replace(/#/g, '%23')
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
  for (const t of grouped) {
    if (t.includes('-')) appendTitle(t.replaceAll('-', ' '))
    if (t.includes("'")) appendTitle(t.replaceAll("'", ''))
    appendTitle(t.replaceAll('-', '').replaceAll('"', ''))
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
      dupe.seeders ||= entry.seeders >= 30000 ? 0 : entry.seeders
      dupe.leechers ||= entry.leechers >= 30000 ? 0 : entry.leechers
      dupe.downloads ||= entry.downloads
      dupe.accuracy ??= entry.accuracy
      dupe.size ||= entry.size
      dupe.date ||= entry.date
      dupe.type ??= entry.type
    } else {
      entry.title = AnimeResolver.cleanFileName(entry.title)
      entry.seeders = entry.seeders && entry.seeders < 30000 ? entry.seeders : 0
      entry.leechers = entry.leechers && entry.leechers < 30000 ? entry.leechers : 0
      entry.downloads ||= 0
      entry.date ||= new Date(Date.now() - 1_000).toUTCString()
      deduped[entry.hash] = entry
    }
  }

  return Object.values(deduped)
}
