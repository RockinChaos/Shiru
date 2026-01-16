import { toast } from 'svelte-sonner'
import { writable } from 'simple-store-svelte'
import { anilistClient } from '@/modules/anilist.js'
import { malDubs } from '@/modules/anime/animedubs.js'
import { settings } from '@/modules/settings.js'
import { cache, caches } from '@/modules/cache.js'
import { getEpisodeMetadataForMedia, isSubbedProgress } from '@/modules/anime/anime.js'
import { hasNextPage } from '@/modules/sections.js'
import { printError } from '@/modules/networking.js'
import Helper from '@/modules/helper.js'
import equal from 'fast-deep-equal/es6'
import WPC from '@/modules/wpc.js'
import Debug from 'debug'
const debug = Debug('ui:animeschedule')

/**
 * AnimeSchedule.net (Dub Schedule) and AniChart (Sub/Hentai Schedule)
 * Handles periodic fetching of the dub airing schedule which is based on timetables from animeschedule.net tokenized api access and the sub/hentai schedule from AniChart.
 */
class AnimeSchedule {
    jitter = 27_000 + Math.random() * (60_000 - 27_000)
    lastUpdated = writable()
    subAiring = writable([])
    dubAiring = writable([])
    subAiringLists = writable(Promise.resolve([]))
    dubAiringLists = writable(Promise.resolve([]))
    subAiredLists = writable()
    dubAiredLists = writable()
    hentaiAiredLists = writable()
    subAiredListsCache = writable({})
    dubAiredListsCache = writable({})
    hentaiAiredListsCache = writable({})

    constructor() {
        this.lastUpdated.value = cache.cachedEntry(caches.RSS, 'anischedule-manifest', true)?.then(value => value || {}) || {}
        this.lastUpdated.subscribe(lastUpdated => cache.cacheEntry(caches.RSS, 'anischedule-manifest', { mappings: true }, lastUpdated, Date.now() + 315_000))

        this.subAiringLists.value = this.feedFromManifest('sub', true)
        this.dubAiringLists.value = this.feedFromManifest('dub', true)
        this.subAiredLists.value = this.feedFromManifest('sub')
        this.dubAiredLists.value = this.feedFromManifest('dub')
        this.hentaiAiredLists.value = this.feedFromManifest('hentai')

        setTimeout(() => {
            this.findNewNotifications()
            this.findNewDelayedEpisodes()
        }, 3_000).unref?.()

        /**
         * Schedule the next manifest and feed update check.
         *
         * Calculates the next 5-minute mark and sets a timeout to run {@link checkManifestAndFeeds}
         * shortly after, using a small jitter. This ensures checks run regularly without all requests hitting at the exact same time across all users of the app.
         */
        const scheduleNextCheck = () => {
            const now = new Date()
            const nextFiveMinute = new Date(now.getTime())
            nextFiveMinute.setSeconds(0, 0)
            nextFiveMinute.setMinutes(Math.floor(now.getMinutes() / 5) * 5 + 5)
            setTimeout(checkManifestAndFeeds, (nextFiveMinute.getTime() - now.getTime()) + this.jitter).unref?.()
        }

        /**
         * Check update manifest for schedule/feed changes.
         * TTL for GitHub raw cache is usually 300s (5 minutes), so have to set a threshold above it with some jitter.
         */
        const checkManifestAndFeeds = async () => {
            try {
                debug(`Checking for changes to manifest`)
                const manifest = await this.manifestChanged()
                if (!manifest.changed) return
                debug(`Manifest changes detected, updating feeds that have changed.`)
                const feedTypes = [
                    { key: 'subbed', route: 'sub', title: 'Subbed Releases' },
                    { key: 'dubbed', route: 'dub', title: 'Dubbed Releases' },
                    { key: 'hentai', route: 'hentai', title: 'Hentai Releases' }
                ]
                for (const feed of feedTypes.filter(feed => feed.key !== 'hentai')) {
                    if (manifest.force || manifest.previousManifest?.[feed.key]?.schedule !== manifest.currentManifest?.[feed.key]?.schedule) {
                        try {
                            const newFeed = await this.feedChanged(feed.route, true, true, manifest)
                            const airingLists = this[`${feed.route}AiringLists`]
                            if (newFeed && !equal(await airingLists.value, newFeed)) airingLists.value = Promise.resolve(newFeed)
                        } catch (error) {
                            debug(`Failed to update ${feed.key} schedule at the scheduled interval, this is likely a temporary connection issue.`, error)
                        }
                    }
                }
                if (manifest.force || feedTypes.filter(feed => feed.key !== 'hentai').some(feed => manifest.previousManifest?.[feed.key]?.schedule !== manifest.currentManifest?.[feed.key]?.schedule)) {
                    this.findNewNotifications()
                    this.findNewDelayedEpisodes()
                }
                const updateFeeds = feedTypes.filter(feed => manifest.force || manifest.previousManifest?.[feed.key]?.episodes !== manifest.currentManifest?.[feed.key]?.episodes).map(feed => feed.title)
                if (updateFeeds.length) WPC.send('feedChanged', { updateFeeds, manifest })
            } catch (error) {
                debug(`Failed to check update manifest for changes, will try again later...`, error)
            } finally {
                scheduleNextCheck()
            }
        }

        scheduleNextCheck()
        this.dubAiringLists.subscribe(async value  => this.dubAiring.value = await value)
        this.subAiringLists.subscribe(async value  => this.subAiring.value = await value)
    }

    async findNewDelayedEpisodes() { // currently only dubs are handled as they typically get delayed...
        debug('Checking for delayed dub episodes...')
        const delayedEpisodes = (await this.dubAiringLists.value)?.filter(entry => new Date(entry.delayedFrom) <= new Date() && new Date(entry.delayedUntil) > new Date()).flatMap(entry => Array.from({ length: entry.episodeNumber - (entry.subtractedEpisodeNumber || entry.episodeNumber) + 1 }, (_, i) => (entry.subtractedEpisodeNumber || entry.episodeNumber) + i)?.filter(episode => !cache.getEntry(caches.NOTIFICATIONS, 'delayedDubs').includes(`${entry?.media?.media?.id}:${episode}:${entry.delayedUntil}`))?.map(episode => ({ ...entry, episodeNumber: episode, subtractedEpisodeNumber: undefined })))
        debug(`Found ${delayedEpisodes?.length} new delayed episodes${delayedEpisodes?.length ? '.. notifying!' : ''}`)
        if (!delayedEpisodes?.length) return
        await anilistClient.searchAllIDS({ id: delayedEpisodes.map(entry => entry?.media?.media.id).filter(Boolean) })
        for (const entry of delayedEpisodes) {
            const media = entry?.media?.media
            const cachedMedia = await cache.requestMedia(media?.id)
            const notify = (cache.getEntry(caches.NOTIFICATIONS, `lastDub`) > 0) && ((!cachedMedia?.mediaListEntry && settings.value.releasesNotify?.includes('NOTONLIST')) || (cachedMedia?.mediaListEntry && settings.value.releasesNotify?.includes(cachedMedia?.mediaListEntry?.status)))
            if (notify && media.format !== 'MUSIC') {
                window.dispatchEvent(new CustomEvent('notification-app', {
                    detail: {
                        id: media?.id,
                        title: anilistClient.title(media),
                        message: `Episode ${entry.episodeNumber} has been delayed until ` + (entry?.delayedIndefinitely && !entry.status?.toUpperCase()?.includes('FINISHED') ? 'further notice, production has been suspended' : entry.delayedIndefinitely ? 'further notice, this is determined to be a partial dub so this episode will likely not be dubbed' : (new Date(entry?.delayedUntil).toLocaleString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'short',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true
                        }))) + '!',
                        icon: media?.coverImage?.medium,
                        iconXL: media?.coverImage?.extraLarge,
                        heroImg: media?.bannerImage || (media?.trailer?.id && `https://i.ytimg.com/vi/${media?.trailer?.id}/hqdefault.jpg`),
                        episode: entry?.episodeNumber,
                        timestamp: Math.floor(new Date().getTime() / 1000) - 5,
                        format: media?.format,
                        delayed: true,
                        dub: true,
                        click_action: 'VIEW',
                        button: [{ text: 'View Anime', activation: `shiru://anime/${media?.id}` }],
                        activation: {
                          type: 'protocol',
                          launch: `shiru://anime/${media?.id}`
                        }
                    }
                }))
            }
            cache.setEntry(caches.NOTIFICATIONS, 'delayedDubs', (current) => [...current, `${media?.id}:${entry.episodeNumber}:${entry.delayedUntil}`])
        }
    }

    async findNewNotifications() {
        for (const type of ['Dub', 'Sub', 'Hentai']) {
            if (type === 'Hentai' && settings.value.adult !== 'hentai') return
            const key = `${type.toLowerCase()}Announce`
            const notifyKey = `announced${type}s`
            const airingListKey = `${type === 'Hentai' ? 'sub' : type.toLowerCase()}AiringLists`

            debug(`Checking for new ${type} Schedule notifications`)
            const newNotifications = (await this[airingListKey].value)?.filter(entry => (entry?.unaired && ((type !== 'Hentai' && !(entry?.media?.media?.genres || entry?.genres)?.includes('Hentai')) || (type === 'Hentai' && (entry?.media?.media?.genres || entry?.genres)?.includes('Hentai'))) && !cache.getEntry(caches.NOTIFICATIONS, notifyKey).includes(entry?.media?.media?.id || entry?.id))).map(entry => entry?.media?.media || entry)
            debug(`Found ${newNotifications?.length} new ${type} notifications`)
            if (!newNotifications?.length) return
            await anilistClient.searchAllIDS({ id: newNotifications.map(media => media.id).filter(Boolean) })
            for (const media of newNotifications) {
                const cachedMedia = await cache.requestMedia(media?.id)
                if (settings.value[key] !== 'none' && media?.id) {
                    const res = await Helper.getClient().userLists.value
                    const isFollowing = () => {
                        if (!res?.data && res?.errors) throw res.errors[0]
                        if (!Helper.isAuthorized()) return false
                        const mediaList = Helper.isAniAuth()
                            ? res.data.MediaListCollection.lists.find(({ status }) => status === 'CURRENT' || status === 'REPEATING' || status === 'COMPLETED' || status === 'PAUSED' || status === 'PLANNING')?.entries
                            : res.data.MediaList.filter(({ node }) => node.my_list_status.status === Helper.statusMap('CURRENT') || node.my_list_status.is_rewatching || node.my_list_status.status === Helper.statusMap('COMPLETED') || node.my_list_status.status === Helper.statusMap('PAUSED') || node.my_list_status.status === Helper.statusMap('PLANNING'))
                        if (!mediaList) return false
                        return (cachedMedia?.relations?.edges?.map(edge => edge.node.id) || []).some(id => (Helper.isAniAuth() ? mediaList.map(({ media }) => media.id) : mediaList.map(({ node }) => node.id)).includes(id))
                    }
                    const notify = (cache.getEntry(caches.NOTIFICATIONS, `last${type}`) > 0) && (settings.value[key] === 'all' || isFollowing())
                    if (notify && media.format !== 'MUSIC') {
                        window.dispatchEvent(new CustomEvent('notification-app', {
                            detail: {
                                id: media?.id,
                                title: anilistClient.title(media),
                                message: `${type === 'Dub' ? 'A dub has just been' : 'Was recently'} announced for ` + (new Date(type === 'Dub' ? media?.airingSchedule?.nodes?.[0]?.airingAt : media?.airingSchedule?.nodes?.[0]?.airingAt * 1000).toLocaleString('en-US', {
                                  weekday: 'long',
                                  year: 'numeric',
                                  month: 'short',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: true
                                })) + '!',
                                icon: media?.coverImage?.medium,
                                iconXL: media?.coverImage?.extraLarge,
                                heroImg: media?.bannerImage || (media?.trailer?.id && `https://i.ytimg.com/vi/${media?.trailer?.id}/hqdefault.jpg`),
                                timestamp: Math.floor(new Date().getTime() / 1000) - 5,
                                format: media?.format,
                                dub: type === 'Dub',
                                click_action: 'VIEW',
                                button: [{ text: 'View Anime', activation: `shiru://anime/${media?.id}` }],
                                activation: {
                                  type: 'protocol',
                                  launch: `shiru://anime/${media?.id}`
                                }
                            }
                        }))
                    }
                    cache.setEntry(caches.NOTIFICATIONS, notifyKey, (current) => [...current, media?.id])
                }
            }
        }
    }

    async getFeed(feed) {
        let res = {}
        try {
            res = await fetch(`${atob('aHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tL1JvY2tpbkNoYW9zL0FuaVNjaGVkdWxlL21hc3Rlci9yYXc=')}/${feed}.json?timestamp=${new Date().getTime()}`, { method: 'GET' })
        } catch (e) {
            if (!res || res.status !== 404) throw e
        }
        if (!res.ok && (res.status === 429 || res.status === 500)) throw res
        let json = null
        try {
            json = await res.json()
        } catch (error) {
            if (res.ok) printError('Search Failed', 'Failed to fetch the anime schedule(s)!', error)
        }
        if (!res.ok) {
            if (json) {
                for (const error of json?.errors || []) printError('Search Failed', 'Failed to fetch the anime schedule(s)!', error)
            } else printError('Search Failed', 'Failed to fetch the anime schedule(s)!', res)
        }
        if (!json) throw res
        return json
    }

    async feedFromManifest(type, schedule = false) {
      const manifest = await this.manifestChanged()
      const feed = `${type.toLowerCase()}${!schedule ? '-episode-feed' : '-schedule'}`
      const cachedSchedule = await cache.cachedEntry(caches.RSS, `${feed}`, true)
      if (!cachedSchedule || manifest.force || (manifest.changed && (manifest.previousManifest?.[type === 'sub' ? 'subbed' : type === 'dub' ? 'dubbed' : 'hentai']?.[schedule ? 'schedule' : 'episodes'] !== manifest.currentManifest?.[type === 'sub' ? 'subbed' : type === 'dub' ? 'dubbed' : 'hentai']?.[schedule ? 'schedule' : 'episodes']))) {
        return this.feedChanged(type, schedule, false, manifest)
      }
      return cachedSchedule
    }

    manifestCache = null
    manifestChanged() {
        const now = Date.now()
        if (this.manifestCache && this.manifestCache.expiry > now) return this.manifestCache.promise
        const promise = (async () => {
          const previousManifest = structuredClone(await this.lastUpdated.value)
          let lastUpdated
            try {
                lastUpdated = await this.getFeed('last-updated')
            } catch (error) {
                if (previousManifest) {
                    debug(`Failed to request last updated manifest, this is likely due to an outage... falling back to cached data.`)
                    return { changed: false }
                } else {
                    debug(`Failed to request last updated manifest, this is likely due to an outage and no cached data was found... allowing attempts to fetch direct from source.`)
                    return { changed: true, force: true }
                }
            }
            if (!equal(previousManifest, lastUpdated)) {
                return { changed: true, previousManifest, currentManifest: lastUpdated  }
            }
            return { changed: false }
        })().catch((error) => {
            this.manifestCache.promise = { changed: true, force: true }
            debug(`Failed to request last updated manifest, this is likely due to an outage and no cached data was found... allowing attempts to fetch direct from source.`, error)
        })
        this.manifestCache = { promise, expiry: now + 60_000 }
        return promise
    }

    _lastUpdatedLock = Promise.resolve()
    async feedChanged(type, schedule = false, updateStore = true, manifest = null) {
        const feed = `${type.toLowerCase()}${!schedule ? '-episode-feed' : '-schedule'}`
        let content
        try {
            content = await this.getFeed(`${feed}`)
        } catch (error) {
            const cachedEntry = await cache.cachedEntry(caches.RSS, `${feed}`, true)
            if (cachedEntry) {
                debug(`Failed to request RSS schedule for ${feed}, this is likely due to an outage... falling back to cached data.`)
                content = cachedEntry
            }
            else throw error
        }
        const res = !schedule && updateStore ? await this[`${type.toLowerCase()}AiredLists`].value : null
        if (!res || JSON.stringify(content) !== JSON.stringify(res)) {
            if (!schedule && updateStore) this[`${type.toLowerCase()}AiredLists`].value = content
            cache.cacheEntry(caches.RSS, `${feed}`, { mappings: true }, content, Date.now() + 315_000)
            if (manifest?.currentManifest) {
                const feedKey = type === 'sub' ? 'subbed' : type === 'dub' ? 'dubbed' : 'hentai'
                const dataKey = schedule ? 'schedule' : 'episodes'
                this._lastUpdatedLock = this._lastUpdatedLock.then(async () => {
                    const previousManifest = (await this.lastUpdated.value) || {}
                    if (!previousManifest[feedKey]) previousManifest[feedKey] = {}
                    previousManifest[feedKey][dataKey] = manifest.currentManifest[feedKey]?.[dataKey] || previousManifest[feedKey][dataKey]
                    this.lastUpdated.value = Promise.resolve(previousManifest)
                })
                await this._lastUpdatedLock
            }
            return content
        }
        return null
    }

    getMediaForRSS(page, perPage, type) {
        const res = this._getMediaForRSS(page, perPage, type)
        res.catch(error => {
            if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Errors')) {
                toast.error('Search Failed', {
                    description: `Failed to load media for home feed for ${type}!\n` + error.message
                })
            }
            debug(`Failed to load media for home feed for ${type}`, error.stack)
        })
        return Array.from({ length: perPage }, (_, i) => ({ type: 'episode', data: this.fromPending(res, i) }))
    }

    async _getMediaForRSS(page, perPage, type) {
        debug(`Getting media for schedule feed (${type}) page ${page} perPage ${perPage}`)
        const currentTime = Math.floor(Date.now() / 1000)
        let res = (await this[`${type.toLowerCase()}AiredLists`].value) || []
        const section = settings.value.homeSections.find(s => s[0] === `${type}${type === `Hentai` ? `` : `bed`} Releases`)
        if (section && section[2].length > 0) res = res.filter(episode => section[2].includes(episode.format) && (section[2].includes('TV_SHORT') || !episode.duration || (episode.duration >= 12)))
        const filteredRes = await Promise.all(res.map(async episode => !settings.value.preferDubs || ((await cache.requestMedia(episode.id))?.status === 'FINISHED' && !['CURRENT', 'REPEATING']?.includes((await cache.requestMedia(episode.id))?.mediaListEntry?.status)) || !(await malDubs.isDubMedia(episode)) || !(await cache.requestMedia(episode.id))?.length || (type === 'Dub' ? !(await isSubbedProgress(await cache.requestMedia(episode.id))) : (await isSubbedProgress(await cache.requestMedia(episode.id))))))
        res = res.filter((_, index) => filteredRes[index])
        const cachedAiredLists = this[`${type.toLowerCase()}AiredListsCache`].value[`${page}-${perPage}`]
        const paginatedLists = res.slice((page - 1) * perPage, page * perPage) || []
        const ids = paginatedLists.map(({ id }) => id).filter(Boolean)

        hasNextPage.value = ids?.length === perPage
        if (!ids.length) return {}

        if (cachedAiredLists && JSON.stringify(cachedAiredLists.airedLists) === JSON.stringify(res)) return cachedAiredLists.results
        debug(`Episode Feed (${type}) has changed, updating`)

        const missedIDS = res.filter(media => cache.getEntry(caches.NOTIFICATIONS, `last${type}`) > 0 && ((Math.floor(new Date(media.episode.airedAt).getTime() / 1000) >= cache.getEntry(caches.NOTIFICATIONS, `last${type}`)) || (Math.floor(new Date(media.episode.addedAt).getTime() / 1000) >= cache.getEntry(caches.NOTIFICATIONS, `last${type}`)))).filter(media => !ids.includes(media.id)).sort((a, b) => new Date(b.episode.addedAt) - new Date(a.episode.addedAt)).slice(0, 300).map(media => media.id).filter(Boolean)
        const medias = await anilistClient.searchAllIDS({ id: Array.from(new Set([...ids, ...missedIDS])) })
        if (!medias?.data && medias?.errors) throw medias.errors[0]

        const items = {
            ...medias,
            data: {
                ...medias.data,
                Page: {
                    ...medias.data.Page,
                    media: paginatedLists.map(({ id, episode }) => {
                        return {
                            ...Object.fromEntries(medias?.data?.Page?.media.map(media => [media.id, media]))[id],
                            episode: episode
                        }
                    })
                }
            }
        }
        const combinedItems = {
            ...medias,
            data: {
                ...medias.data,
                Page: {
                    ...medias.data.Page,
                    media: [
                        ...items.data.Page.media,
                        ...res.filter(({id}) => missedIDS.includes(id)).filter(({ id, episode }) => !paginatedLists.some(item => item.id === id && item.episode === episode)).map(({id, episode}) => {
                        return {
                            ...Object.fromEntries(medias?.data?.Page?.media.map(media => [media.id, media]))[id],
                            episode: episode
                        }
                    })]
                }
            }
        }

        // Filter out undefined media, this will only ever occur if the media isAdult or is Genre Hentai and the user doesn't have the adult or hentai setting enabled.
        items.data.Page.media = items.data.Page.media.filter(entry => entry && entry.id)
        combinedItems.data.Page.media = combinedItems.data.Page.media.filter(entry => entry && entry.id)

        const results = this.structureResolveResults(items, type)
        if (type === 'Dub' || type === 'Sub' || type === 'Hentai') {
            if (type === 'Hentai' && settings.value.adult !== 'hentai') return
            const lastNotified = cache.getEntry(caches.NOTIFICATIONS, `last${type}`)
            const newReleases = combinedItems?.data?.Page?.media?.filter(media => (Math.floor(new Date(media.episode.airedAt).getTime() / 1000) >= lastNotified) || (Math.floor(new Date(media.episode.addedAt).getTime() / 1000) >= lastNotified))
            debug(`Found ${newReleases?.length} new ${type} releases, notifying...`)
            if (newReleases && settings.value.releasesNotify?.length > 0 && lastNotified > 0) {
                for (const media of newReleases) {
                    const addedAt = Math.floor(new Date(media.episode.addedAt).getTime() / 1000)
                    const notify = (!media?.mediaListEntry && settings.value.releasesNotify?.includes('NOTONLIST')) || (media?.mediaListEntry && settings.value.releasesNotify?.includes(media?.mediaListEntry?.status))
                    debug(`Attempting to notify for ${media?.id}:${media?.title?.userPreferred}...`)
                    if (notify && (type === 'Dub' || !settings.value.preferDubs || (media?.status === 'FINISHED' && !['CURRENT', 'REPEATING']?.includes(media?.mediaListEntry?.status)) || !(await malDubs.isDubMedia(media)) || await isSubbedProgress(media)) && media.format !== 'MUSIC') {
                        window.dispatchEvent(new CustomEvent('notification-app', {
                            detail: {
                                id: media?.id,
                                title: anilistClient.title(media),
                                message: `${media.format !== 'MOVIE' ? ` ${media?.episodes === media?.episode?.aired ? `The wait is over! ` : ''}Episode ${media?.episode?.aired}` : `The Movie`} (${type}) is out in ${type === 'Dub' ? 'the United States' : 'Japan'}, ${media.format !== 'MOVIE' && media?.episodes === media?.episode?.aired ? `this season should be available to binge soon!` : media.format !== 'MOVIE' ? `it should be available soon.` : `, if this is a theatrical release it will likely a few months before it is available for streaming.`}`,
                                icon: media?.coverImage?.medium,
                                iconXL: media?.coverImage?.extraLarge,
                                heroImg: media?.bannerImage || (media?.trailer?.id && `https://i.ytimg.com/vi/${media?.trailer?.id}/hqdefault.jpg`),
                                episode: media?.episode?.aired,
                                timestamp: addedAt,
                                format: media?.format,
                                dub: type === 'Dub',
                                click_action: 'PLAY',
                                button: [{ text: 'View Anime', activation: `shiru://anime/${media?.id}` }],
                                activation: {
                                  type: 'protocol',
                                  launch: `shiru://anime/${media?.id}`
                                }
                            }
                        }))
                        debug(`Successfully notified for ${media?.id}:${media?.title?.userPreferred}!`)
                    } else {
                        debug(`Failed to notify for ${media?.id}:${media?.title?.userPreferred}:${notify}:${(type === 'Dub' || !settings.value.preferDubs || (media?.status === 'FINISHED' && !['CURRENT', 'REPEATING']?.includes(media?.mediaListEntry?.status)) || !(await malDubs.isDubMedia(media)) || await isSubbedProgress(media))}:${(media.format !== 'MUSIC')}`)
                    }
                }
            }
            if ((newReleases?.length > 0) || (lastNotified <= 1)) cache.setEntry(caches.NOTIFICATIONS, `last${type}`, currentTime)
        }

        this[`${type.toLowerCase()}AiredListsCache`].value[`${page}-${perPage}`] = {
            airedLists: res,
            results
        }

        return results
    }

    async structureResolveResults (items, type) {
        const results = items?.data?.Page?.media?.map((media) => ({ media, episode: media.episode.aired, date: new Date(media.episode.airedAt) }))
        return results.filter(result => result.media && result.media.id).map(async (result) => {
            const res = {
                ...result,
                parseObject: {
                    language: (type === 'Dub' ? 'English' : 'Japanese')
                },
                episodeData: undefined,
                onclick: undefined
            }
            try {
                res.episodeData = (await getEpisodeMetadataForMedia(res.media))?.[res.episode]
            } catch (error) {
                debug(`Warn: failed fetching episode metadata for ${res.media.title?.userPreferred} episode ${res.episode}: ${error.stack} on feed (${type})`, error)
            }
            res.onclick = () => {
                window.dispatchEvent(new CustomEvent('play-anime', {
                    detail: {
                        id: res.media?.id,
                        episode: res.episode,
                        torrentOnly: true
                    }
                }))
                return true
            }
            if (res.media?.format === 'MOVIE' && (res.media?.episodes ?? 0) <= 1) delete res.episode
            return res
        })
    }

    async fromPending (result, i) {
        const array = await result
        return array[i]
    }
}

export const animeSchedule = new AnimeSchedule()
