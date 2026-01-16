import { cache, caches } from '@/modules/cache.js'
import { getKitsuMappings } from '@/modules/anime/anime.js'
import { codes, getRandomInt, sleep } from '@/modules/util.js'
import { printError, status, isOffline } from '@/modules/networking.js'
import Bottleneck from 'bottleneck'
import Debug from 'debug'
const debug = Debug('ui:episodes')

/*
 * MAL Episode Information
 * Dub information is fetched from api.jikan.moe.
 */
class Episodes {
    limiter = new Bottleneck({
        reservoir: 60,
        reservoirRefreshAmount: 60,
        reservoirRefreshInterval: 60 * 1000,
        maxConcurrent: 3,
        minTime: 333
    })

    rateLimitPromise = null
    concurrentRequests = new Map()

    constructor() {
        this.limiter.on('failed', async (error) => {
            let info = (await error.json()) || error
            if (await isOffline(info)) throw new Error('Failed making episode request, network is offline... not retrying.')
            if (info.status === 500) return 1

            const time = ((error.headers.get('retry-after') || 2) + 1) * 1000
            if (!this.rateLimitPromise) this.rateLimitPromise = sleep(time).then(() => { this.rateLimitPromise = null })
            return time
        })
    }

    async getEpisodeData(idMal) {
        if (!idMal) return []
        let page = 1
        const res = await this.requestEpisodes(true, idMal, page)
        if (res && res.pagination?.has_next_page && res.pagination?.last_visible_page) {
            const lastRes = await this.requestEpisodes(true, idMal, res.pagination.last_visible_page * 100)
            const arr = lastRes?.data?.map(e => ({
                filler: e.filler,
                recap: e.recap,
                episode_id: e.mal_id, // mal_id is the episode_id in the v4 API very stupid
                title: e.title || e.title_romanji || e.title_japanese,
                aired: e.aired,
            }))
            return arr || []
        } else {
            return res?.data?.map(e => ({
                filler: e.filler,
                recap: e.recap,
                episode_id: e.mal_id, // mal_id is the episode_id in the v4 API very stupid
                title: e.title || e.title_romanji || e.title_japanese,
                aired: e.aired,
            })) || []
        }
    }

    async getSingleEpisode(idMal, episode) {
        if (!idMal) return []
        const res = await this.requestEpisodes(true, idMal, Number(episode || 1) !== 0 ? (episode || 1) : 1)
        const singleEpisode = res?.data?.find(e => (e.mal_id === episode) || (e.mal_id === Number(episode || 1)))
        return singleEpisode ? {
            filler: singleEpisode.filler,
            recap: singleEpisode.recap,
            episode_id: singleEpisode.mal_id, // mal_id is the episode_id in the v4 API very stupid
            title: singleEpisode.title || singleEpisode.title_romanji || singleEpisode.title_japanese,
            aired: singleEpisode.aired
        } : []
    }

    async getKitsuEpisodes(id) {
        const mappings = await getKitsuMappings(id)
        const kitsuId = mappings?.data?.[0]?.relationships?.data?.id || mappings?.included?.[0]?.id
        if (kitsuId) {
            return this.requestEpisodes(false, kitsuId, 1)
        }
        return null
    }

    async getMedia(idMal) {
        if (!idMal) return []
        return this.requestEpisodes(true, idMal, 1, true)
    }

    handleArray(episodes, fileName) {
        const episodeParts = (Array.isArray(episodes) && episodes) || (fileName?.match(/(?<!Part\s)(?<!Cour\s)\b\d+\s*[-~]\s*\d+\b/i)?.map(n => +n.trim())) || (typeof episodes === 'string' && episodes.match(/^\d+\s*~\s*\d+$/) && episodes.split(/~\s*/).map(n => +n.trim()))
        if (episodeParts?.length && ((Number(episodeParts[0]) || episodeParts[0]) < (Number(episodeParts[1]) || episodeParts[1]))) return { first: (Number(episodeParts[0]) || episodeParts[0]), last: (Number(episodeParts[1]) || episodeParts[1]) }
        return null
    }

    async requestEpisodes(jikan, id, episode, root) {
        const page = Math.ceil(episode / 100)
        const cachedEntry = cache.cachedEntry(caches.EPISODES, `${id}:${page}:${root}`, status.value === 'offline')
        if (cachedEntry) return cachedEntry
        else if (status.value === 'offline') return
        if (this.concurrentRequests.has(`${id}:${page}:${root}`)) return this.concurrentRequests.get(`${id}:${page}:${root}`)
        const requestPromise = this.limiter.wrap(async () => {
            await this.rateLimitPromise
            debug(`Fetching Episode ${episode} for ${id} with Page ${page}`)
            let res = {}
            try {
                res = await fetch(jikan ? `https://api.jikan.moe/v4/anime/${id}${!root ? `/episodes?page=${page}` : ``}` : `https://kitsu.app/api/edge/anime/${id}/episodes`)
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
                if (res.ok) this.checkError(error, `${jikan ? 'jikan' : 'kitsu'}`)
            }
            if (!res.ok) {
                if (json) {
                    for (const error of json?.errors || []) {
                        this.checkError(error, `${jikan ? 'jikan' : 'kitsu'}`, true)
                    }
                } else {
                    this.checkError(res, `${jikan ? 'jikan' : 'kitsu'}`)
                }
            }
            return cache.cacheEntry(caches.EPISODES, `${id}:${page}:${root}`, {}, json, Date.now() + getRandomInt(1, 3) * 24 * 60 * 60 * 1000)
        })().catch((error) => {
            if (status.value === 'offline') {
                debug(`Network offline, returning cached episode data if available`, error)
                const cachedEntry = cache.cachedEntry(caches.EPISODES, `${id}:${page}:${root}`, true)
                if (cachedEntry) return cachedEntry
            } else throw new Error(error)
        }).finally(() => {
            this.concurrentRequests.delete(`${id}:${page}:${root}`)
        })
        this.concurrentRequests.set(`${id}:${page}:${root}`, requestPromise)
        return requestPromise
    }

    checkError(error, type, silent) {
        if (!error || error.status === 404 || error.status === 521) {  // api is likely down, we don't need to spam the user with toasts.
            debug(`Error (API Down): ${error.status || 429} - ${error.message || codes[error.status || 429]}`)
            return
        }
        if (!silent) printError('Episode Fetching Failed', `Failed to fetch ${type} anime episodes!`, error)
    }
}

export const episodesList = new Episodes()