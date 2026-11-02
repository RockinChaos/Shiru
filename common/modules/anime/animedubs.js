import { getRandomInt } from '@/modules/util.js'
import { printError,  status } from '@/modules/networking.js'
import { cache, caches } from '@/modules/cache.js'
import { writable } from 'simple-store-svelte'
import Debug from 'debug'
const debug = Debug('ui:animedubs')

/**
 * Dub information is returned as MyAnimeList ids.
 */
class MALDubs {
    /** @type {import('simple-store-svelte').Writable<ReturnType<MALDubs['getDubs']>>} */
    dubLists = writable(Promise.resolve([]))

    constructor() {
        this.dubLists.value = this.getMALDubs()
        //  update dubLists every hour
        setInterval(async () => {
            try {
                const updatedLists = await this.getMALDubs()
                this.dubLists.value = Promise.resolve(updatedLists)
            } catch (error) {
                debug('Failed to update dubbed anime list at the scheduled interval, this is likely a temporary connection issue:', JSON.stringify(error))
            }
        }, 1000 * 60 * 60)
    }

    async isDubMedia(media, alt = undefined) {
        const idMal = media?.idMal || alt?.idMal
        if (idMal) {
            const lists = await this.dubLists.value.catch(() => null)
            if (!lists?.dubbed?.includes(idMal) && !lists?.incomplete?.includes(idMal)) return false
        }
        if (!media?.file_name && !media?.audio_term) return Boolean(media?.idMal)

        const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
        let fileName = String(media.file_name || media.audio_term).split(/[[\](){}]/).map(normalize).join(' | ')
        const titles = Object.values(alt?.title || {}).filter(Boolean)
        if (!titles.length) titles.push(media.anime_title)
        for (const term of new Set(titles.map(normalize).filter(Boolean))) {
            fileName = fileName.replace(new RegExp(`\\b${term.replace(/ /g, '[ |]+')}\\b`), ' ')
        }

        const english = '(?:english|eng|en)'
        const foreign = '(?:japanese|japan|jpn|jap|jp|ja|chinese|mandarin|cantonese|chi|chs|cht|zho|zh|cn|korean|kor|ko|kr|russian|rus|ru|german|deutsch|ger|deu|de|french|fre|fra|fr|spanish|spa|es|italian|ita|it|portuguese|por|pt|brazilian|hindi|hin|hi|tamil|tam|ta|telugu|tel|te|thai|tha|th|vietnamese|vie|vi|indonesian|ind|id|arabic|ara|ar)'
        const languages = `(?:${english}|${foreign})(?:\\s+(?:${english}|${foreign}))*`
        const subtitles = '(?:(?:soft|hard)\\s*)?sub(?:bed|s|titles?)?|(?:closed\\s*)?captions?|cc|sdh|forced|signs(?:\\s*(?:and\\s*)?songs)?'
        const dubbing = '(?:fan\\s*)?dub(?:bed|s|bing)?'
        const audio = `(?:audio|${dubbing})`
        const multiAudio = `(?:dual|multi)\\s*${audio}`
        const foreignSubDub = new RegExp(`\\b${foreign}\\s*(?:${subtitles})\\s*(?:and\\s*|or\\s*)?${dubbing}\\b`).test(fileName)

        // Keep tag boundaries while removing subtitle lists to preserve adjacent audio languages.
        fileName = fileName.replace(new RegExp(`\\b(?:${languages}\\s*(?:${subtitles})|(?:${subtitles})\\s*(?:in\\s+)?${languages})\\b`, 'g'), ' ')
        const foreignAudio = foreignSubDub
          || new RegExp(`\\b(?:${foreign}\\s*(?:${audio}|${multiAudio}|dual)|(?:${audio}|${multiAudio}|dual)\\s*(?:in\\s*)?${foreign})\\b`).test(fileName)
          || new RegExp(`(?:^|\\|)\\s*${foreign}(?:\\s+(?:and\\s+)?${foreign})*\\s*(?=\\||$)`).test(fileName)
        fileName = fileName
          .replace(/\|/g, ' ')
          .replace(new RegExp(`\\b(?:(?:${english}|${foreign})\\s*(?:${subtitles})|(?:${subtitles})\\s*(?:in\\s+)?(?:${english}|${foreign}))\\b`, 'g'), ' ')
          .replace(/\b(?:multi(?:ple)?|dual)\s*(?:sub(?:bed|s|titles?)?|captions?)\b/g, ' ')
          .replace(/\bdual\s*(?:track|mono)\b/g, ' ')

        if (new RegExp(`\\b(?:no|non|not|without)\\s*(?:${english}\\s*)?${audio}\\b|\\b(?:no|non|without)\\s*${english}\\b|\\b${english}\\s*${audio}\\s*(?:not\\s*(?:included|available)|excluded)\\b`).test(fileName)) return false
        if (new RegExp(`(?:^|\\s)(?:${english}\\s*${audio}|${audio}\\s*(?:in\\s*)?${english})(?=\\s|$)`).test(fileName)) return true

        if (new RegExp(`\\b${multiAudio}\\b`).test(fileName)) {
            return !foreignAudio || new RegExp(`(?:^|\\s)${english}(?=\\s|$)`).test(fileName)
        }
        // A parser's release-group guess may include audio tags, only clean it for ambiguous bare labels.
        const group = normalize(media.release_group)
        if (group) fileName = fileName.replace(new RegExp(`\\b${group.replace(/ /g, '[ |]+')}\\b`), ' ')
        return !foreignAudio && new RegExp(`\\b(?:${dubbing}|dual)\\b`).test(fileName)
    }

    async getMALDubs() {
        debug('Getting MyAnimeList Dubs IDs')
        try {
            const cachedEntry = await cache.cachedEntry(caches.QUERY_RSS, 'MALDubs', true)
            if (status.value === 'offline' && cachedEntry) return cachedEntry
            let res = {}
            try {
                res = await fetch(`${atob('aHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tL01BTC1EdWJzL01BTC1EdWJzL21haW4vZGF0YS9kdWJJbmZvLmpzb24=')}?timestamp=${new Date().getTime()}`)
            } catch (error) {
                if (!res || res.status !== 404) throw error
            }
            if (!res.ok && (res.status === 429 || res.status >= 500)) throw res
            let json = null
            try {
                json = await res.json()
            } catch (error) {
                if (res.ok && !cachedEntry) printError('Dub Caching Failed', 'Failed to load dub information!', error)
            }
            if (!res.ok) {
                if (json) {
                    for (const error of json?.errors || []) {
                        if (!cachedEntry) printError('Dub Caching Failed', 'Failed to load dub information!', error)
                    }
                } else if (!cachedEntry) printError('Dub Caching Failed', 'Failed to load dub information!', res)
            } else if (json) return await cache.cacheEntry(caches.QUERY_RSS, 'MALDubs', { mappings: true }, json, Date.now() + getRandomInt(100, 200) * 60 * 1000)
            else throw res
        } catch (error) {
            const cachedEntry = await cache.cachedEntry(caches.QUERY_RSS, 'MALDubs', true)
            if (cachedEntry) {
                debug(`Failed to request MALDubs RSS, this is likely due to an outage... falling back to cached data.`)
                return cachedEntry
            }
            else throw error
        }
    }
}

export const malDubs = new MALDubs()
