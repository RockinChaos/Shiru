import { getRandomInt, DOMPARSER, base32toHex, isValidNumber } from '@/modules/util.js'
import { settings } from '@/modules/settings.js'
import { status } from '@/modules/networking.js'
import { cache, caches } from '@/modules/cache.js'
import { toast } from 'svelte-sonner'
import { add } from '@/modules/torrent.js'
import { getEpisodeMetadataForMedia, isSubbedProgress } from '@/modules/anime/anime.js'
import AnimeResolver from '@/modules/anime/animeresolver.js'
import { anilistClient } from '@/modules/anilist.js'
import { hasNextPage } from '@/modules/sections.js'
import { malDubs } from '@/modules/anime/animedubs.js'
import { episodesList } from '@/modules/episodes.js'
import { getId } from '@/modules/anime/animehash.js'
import Debug from 'debug'
const debug = Debug('ui:rss')

export function parseRSSNodes (nodes) {
  return nodes.map(item => {
    const pubDate = item.querySelector('pubDate')?.textContent
    const torrentLink = item.querySelector('enclosure')?.attributes.url.value || item.querySelector('link')?.textContent || '?'
    const title = item.querySelector('title')?.textContent || '?'
    let tracker = torrentLink?.includes(atob('bnlhYQ==')) ? encodeURIComponent(atob('aHR0cDovL255YWEudHJhY2tlci53Zjo3Nzc3L2Fubm91bmNl')) : torrentLink?.includes(atob('c3VrZWJlaQ==')) ? encodeURIComponent(atob('aHR0cDovL3N1a2ViZWkudHJhY2tlci53Zjo4ODg4L2Fubm91bmNl')) : ''
    let infoHash = item.querySelector('infoHash')?.textContent
    if (!infoHash) {
      try {
        const match = torrentLink.match(/\b([a-fA-F0-9]{40}|[A-Z2-7]{32})\b/)
        if (match) {
          let foundHash = match[1].toLowerCase()
          if (foundHash.length === 32) infoHash = base32toHex(foundHash)
          else infoHash = foundHash
        }
      } catch (e) {}
    }
    const magnetLink = torrentLink?.toLowerCase().endsWith('.torrent') && infoHash ? `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}${tracker ? `&tr=${tracker}` : ''}` : ''
    return {
      title,
      link: magnetLink || torrentLink || '?',
      ...(infoHash ? { hash: infoHash } : {}),
      seeders: item.querySelector('seeders')?.textContent ?? '?',
      leechers: item.querySelector('leechers')?.textContent ?? '?',
      downloads: item.querySelector('downloads')?.textContent ?? '?',
      size: item.querySelector('size')?.textContent ?? '?',
      date: pubDate && new Date(pubDate)
    }
  })
}

export async function getRSSContent (url) {
  if (!url) return null
  let res = {}
  try {
    res = await fetch(url)
  } catch (e) {
    if (!res || res.status !== 404) throw e
  }
  if (!res.ok) {
    debug(`Failed to fetch RSS feed: ${res.statusText}`)
    throw new Error(res.statusText)
  }
  return DOMPARSER(await res.text(), 'text/xml')
}

class RSSMediaManager {
  constructor () {
    this.resultMap = {}
  }

  getMediaForRSS (page, perPage, url, ignoreErrors = false, ignoreChanged = false) {
    const res = this._getMediaForRSS(page, perPage, url, ignoreChanged)
    if (!ignoreErrors) {
      res.catch(error => {
        if ((settings.value.toasts.includes('All') || settings.value.toasts.includes('Errors')) && !status.value.match(/offline/i)) {
          toast.error('Search Failed', {
            description: 'Failed to load media for home feed!\n' + error.message
          })
        }
        debug('Failed to load media for home feed', error.stack)
      })
    }
    return Array.from({ length: perPage }, (_, i) => ({ type: 'episode', data: this.fromPending(res, i) }))
  }

  async fromPending (result, i) {
    const array = await result
    return array[i]
  }

  async getContentChanged (page, perPage, url, ignoreChanged = false) {
    let content
    try {
      content = await getRSSContent(url)
    } catch (e) {
      const cachedEntry = await cache.cachedEntry(caches.RSS, `${btoa(url)}`, true)
      if (cachedEntry) {
        debug(`Failed to request RSS feed for ${url}, this is likely due to an outage... falling back to cached data.`)
        content = DOMPARSER(cachedEntry, 'text/xml')
      }
      else throw e
    }
    if (!content) return false

    const pubDate = +(new Date(content.querySelector('pubDate').textContent)) * page * perPage
    const pullDate = +(new Date(content.querySelector('pubDate').textContent))
    if (!ignoreChanged && this.resultMap[url]?.date === pubDate) return false

    cache.cacheEntry(caches.RSS, `${btoa(url)}`, { mappings: true }, new XMLSerializer().serializeToString(content), Date.now() + getRandomInt(10, 15) * 60 * 1000)
    return { content, pubDate, pullDate }
  }

  async _getMediaForRSS (page, perPage, url, ignoreChanged = false) {
    debug(`Getting media for RSS feed ${url} page ${page} perPage ${perPage}`)
    const changed = await this.getContentChanged(page, perPage, url, ignoreChanged)
    if (!changed) return this.resultMap[url].result
    debug(`Feed ${url} has changed, updating`)

    const index = (page - 1) * perPage
    const targetPage = [...changed.content.querySelectorAll('item')].slice(index, index + perPage)
    const items = parseRSSNodes(targetPage)
    hasNextPage.value = items.length === perPage
    const result = this.structureResolveResults(items)

    const encodedUrl = btoa(url)
    await this.findNewReleasesAndNotify(result, cache.getEntry(caches.NOTIFICATIONS, 'lastRSS')?.[encodedUrl]?.date)
    cache.setEntry(caches.NOTIFICATIONS, 'lastRSS', (current) => ({...current, [encodedUrl]: { date: changed.pullDate }}))

    this.resultMap[url] = {
      date: changed.pubDate,
      result
    }
    return result
  }

  async findNewReleasesAndNotify (results, oldDate) {
    if (!oldDate) return
    const res = await Promise.all(await results)
    const newReleases = res.filter(({ date }) => date?.getTime() > oldDate)
    debug(`Found ${newReleases?.length} new releases, notifying...`)
    for (const { media, parseObject, episode, link, hash, date } of newReleases) {
      const notify = (!media?.mediaListEntry && settings.value.rssNotify?.includes('NOTONLIST')) || (media?.mediaListEntry && settings.value.rssNotify?.includes(media?.mediaListEntry?.status))
      const dubbed = await malDubs.isDubMedia(parseObject)
      if (notify && (!settings.value.preferDubs || (media?.status === 'FINISHED' && !['CURRENT', 'REPEATING']?.includes(media?.mediaListEntry?.status)) || dubbed || !(await malDubs.isDubMedia(media)) || await isSubbedProgress(media))) {
        const highestEp = isValidNumber(episode) ? Number(episode) : Number(episodesList.handleArray(episode, episode)?.last)
        const progress = media?.mediaListEntry?.progress
        const behind = progress < (highestEp - 1)
        window.dispatchEvent(new CustomEvent('notification-app', {
          detail: {
            id: media?.id,
            title: anilistClient.title(media) || parseObject.anime_title,
            message: `${media?.format === 'MOVIE' && (media?.episodes ?? 0) <= 1 ? `The Movie` : isValidNumber(highestEp) ? `${media?.episodes === highestEp ? `The wait is over! ` : ``}Episode ${highestEp}` : parseObject?.anime_title?.match(/S(\d{2})/) ? `Season ${parseInt(parseObject.anime_title.match(/S(\d{2})/)[1], 10)}` : `Batch`} (${dubbed ? 'Dub' : 'Sub'}) ${isValidNumber(highestEp) || media?.format === 'MOVIE' ? `is out${media?.format !== 'MOVIE' && media?.episodes === highestEp ? `, this season is now ready to binge` : ``}!` : `is now ready to binge!`}`,
            icon: media?.coverImage.medium,
            iconXL: media?.coverImage?.extraLarge,
            heroImg: media?.bannerImage || (media?.trailer?.id && `https://i.ytimg.com/vi/${media?.trailer?.id}/hqdefault.jpg`),
            episode: isValidNumber(highestEp) ? highestEp : (parseObject?.anime_title?.match(/S(\d{2})/) ? parseInt(parseObject.anime_title.match(/S(\d{2})/)[1], 10) : highestEp),
            timestamp: Math.floor(new Date(date).getTime() / 1000),
            format: media?.format,
            season: !isValidNumber(highestEp) && parseObject.anime_title.match(/S(\d{2})/),
            dub: dubbed,
            click_action: 'TORRENT',
            hash: hash,
            magnet: link,
            button: [
              { text: `${!progress || progress === 0 ? 'Start Watching' : behind ? 'Continue Watching' : 'Watch Now'}`, activation: `${!progress || progress === 0 || behind ? 'shiru://search/' + media?.id : 'shiru://torrent/' + link}` },
              { text: 'View Anime', activation: `shiru://anime/${media?.id}` }
            ],
            activation: {
              type: 'protocol',
              launch: `shiru://anime/${media?.id}`
            }
          }
        }))
      }
    }
  }

  async structureResolveResults (items) {
    let resolveIndex = 0
    let resolvedData = []
    const processedItems = items.map(item => {
      if (item.hash) {
        const idData = getId(item.hash, {})
        if (idData && idData.files?.length) {
          return {
            fromId: true,
            original: item,
            ...idData,
            media: cache.getMedia(idData.mediaId),
            ...(!idData.parseObject && idData.files?.length ? { parseObject: idData.files[0].parseObject } : {}),
            ...(!idData.episodeRange && idData.files?.length === 1 ? { episodeRange: idData.files[0].episodeRange || idData.files[0].parseObject?.episodeRange } : {}),
            ...(!idData.episode && idData.files?.length === 1 ? { episode: idData.files[0].episode || idData.files[0].parseObject?.episode_number } : {}),
            ...(!idData.season && idData.files?.length === 1 ? { season: idData.files[0].season || idData.files[0].parseObject?.anime_season } : {}),
            ...(!idData.failed && idData.files?.length === 1 ? { failed: idData.files[0].failed || idData.files[0].parseObject?.failed } : {})
          }
        }
      }
      return { fromId: false, original: item }
    })

    const unresolvedItems = processedItems.filter(item => !item.fromId).map(item => item.original.title)
    if (unresolvedItems.length > 0) resolvedData = await AnimeResolver.resolveFileAnime(unresolvedItems)
    const results = processedItems.map(item => {
      if (item.fromId) {
        const { original, fromId, ...rest } = item
        return { ...item.original, ...rest }
      } else {
        const resolved = resolvedData[resolveIndex]
        resolveIndex++
        return { ...item.original, ...resolved }
      }
    })

    return results.map(async (result, i) => {
      const res = {
        ...result,
        episodeData: undefined,
        date: undefined,
        link: undefined,
        hash: undefined,
        onclick: undefined
      }
      res.date = items[i].date
      res.link = items[i].link
      res.hash = items[i].hash
      if (!res.episodeRange && !res.parseObject?.episodeRange) {
        const rangeEpisodes = episodesList.handleArray(res.episode, res.parseObject?.file_name)
        if (rangeEpisodes) res.episodeRange = rangeEpisodes
      }
      if (res.media?.id) {
        const requestEpisode = res.episodeRange?.first || res.parseObject?.episodeRange?.first || res.episode
        try {
          res.episodeData = (await getEpisodeMetadataForMedia(res.media))?.[requestEpisode]
        } catch (e) {
          debug(`Warn: failed fetching episode metadata for ${res.media.title?.userPreferred} episode ${requestEpisode}:`, e.stack)
        }
      }
      res.onclick = () => add(res.link, { media: res.media, episode: res.episode, episodeRange: res.episodeRange }, res.hash || res.link)
      return res
    })
  }
}

export const RSSManager = new RSSMediaManager()