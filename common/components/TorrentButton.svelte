<script context='module'>
    import { Download, CloudUpload, CloudDownload, FolderX, FolderCheck, TvMinimalPlay } from 'lucide-svelte'
    import { settings } from '@/modules/settings.js'
    import { add, stage, loadedTorrent, stagingTorrents, seedingTorrents, completedTorrents } from '@/modules/torrent.js'
    import { getHash } from '@/modules/anime/animehash.js'
    import { handlePlay, handleAnime } from '@/modules/anime/anime.js'
    import { equalsIgnoreCase } from '@/modules/util.js'
    import { writable } from 'simple-store-svelte'
    import { click } from '@/modules/lib/click.js'
    import { toast } from '@/modules/lib/toast.js'

    /** @type {import('simple-store-svelte').Writable<Map<string, { toastId: string, timeoutId: ReturnType<typeof setTimeout> }>>} */
    const pendingToasts = writable(new Map())

    /**
     * Resolves the best action for an anime episode: resume a cached/active torrent, request one from
     * a magnet link, prompt the user to locate one, or fall back to showing the anime's details.
     *
     * @param {string|string[]} hash Known info hash(es) for this episode.
     * @param {{ media?: { id: string|number }, episode?: number }} search Media/episode context used for hash resolution and torrent lookup.
     * @param {string} [magnet] Magnet link to fall back to when no cached hash is active.
     * @param {boolean} [prompt=true] Whether to prompt the user when nothing can be resolved automatically.
     */
    export function playActive(hash, search, magnet, prompt = true) {
        const autoFile = settings.value.rssAutofile
        const resolvedHash = getHash(search?.media?.id, { episode: search?.episode, client: true, batchGuess: true }, false, true)
        const activeHash = autoFile && getActiveHash([...(hash && !equalsIgnoreCase(hash, resolvedHash) ? [hash] : []), ...(resolvedHash ? [resolvedHash] : [])], false)
        if (activeHash && !equalsIgnoreCase(loadedTorrent.value?.infoHash, activeHash) && !equalsIgnoreCase(loadedTorrent.value?.fileHash, activeHash)) { // We have a cached and active hash with the requested media and episode, its predicted we should use this.
            add(activeHash, search, activeHash)
        } else if ((autoFile || !prompt) && magnet && (!hash || (!equalsIgnoreCase(hash, loadedTorrent.value?.infoHash) && !equalsIgnoreCase(hash, loadedTorrent.value?.fileHash)))) { // Nothing found, request download from magnet.
            add(magnet, null, null, null)
        } else if (prompt) { // Nothing found and no magnet, prompt user to locate torrent.
            handlePlay(search?.media?.id, search?.episode, true)
        } else { // Nothing found, no magnet, and cannot prompt, show the anime details.
            handleAnime({ id: search?.media?.id })
        }
    }

    /**
     * Picks the highest-priority hash that's already loaded, seeding, completed, or staging.
     *
     * @param {string[]} hash Candidate info hashes, in priority order.
     * @param {boolean} [ignoreCached=true] When true, falls back to the first hash if none are cached.
     * @returns {string|null}
     */
    function getActiveHash(hash, ignoreCached = true) {
        for (const _hash of hash) {
            if (equalsIgnoreCase(loadedTorrent.value?.infoHash, _hash)) return _hash
        }
        for (const _hash of hash) {
            if (seedingTorrents.value.some(torrent => equalsIgnoreCase(torrent.infoHash, _hash))) return _hash
        }
        for (const _hash of hash) {
            if (completedTorrents.value.some(torrent => equalsIgnoreCase(torrent.infoHash, _hash))) return _hash
        }
        for (const _hash of hash) {
            if (stagingTorrents.value.some(torrent => equalsIgnoreCase(torrent.infoHash, _hash))) return _hash
        }
        return ignoreCached ? hash[0] : null
    }

    /**
     * Stages a torrent for background download. Shows a loading toast that resolves once the hash
     * appears in the loaded/staging/seeding/completed torrents, or errors out after 45 seconds.
     *
     * @param {string} torrentID
     * @param {object} search
     * @param {string|null} activeHash
     */
    export function queueTorrent(torrentID, search, activeHash) {
        if (activeHash) {
            const hashKey = activeHash.toLowerCase()
            if (pendingToasts.value.has(hashKey)) return
            const toastId = toast.loading('Queuing Torrent', { description: 'Requesting torrent for background download, this may take a moment...', duration: Infinity })
            const timeoutId = setTimeout(() => {
                const map = pendingToasts.value
                if (!map.has(hashKey)) return
                toast.update(toastId, { type: 'error', title: 'Failed to Queue Torrent', description: 'Torrent was not received after 45 seconds. Please try again.', duration: 6_000 })
                const next = new Map(map)
                next.delete(hashKey)
                pendingToasts.set(next)
            }, 45_000)
            timeoutId.unref?.()
            const next = new Map(pendingToasts.value)
            next.set(hashKey, { toastId, timeoutId })
            pendingToasts.set(next)
        } else toast.info('Queued Torrent', { description: 'Torrent has been queued for background download. Check the management page for progress...', duration: 6_000 })
        stage(torrentID, search, activeHash)
    }

    /**
     * Resolves a pending toast into a success state and removes it from the pending map.
     *
     * @param {string} hashKey Lowercased info hash to resolve.
     */
    function resolvePending(hashKey) {
        const map = pendingToasts.value
        const entry = map.get(hashKey)
        if (!entry) return
        clearTimeout(entry.timeoutId)
        toast.update(entry.toastId, { type: 'success', title: 'Queued Torrent', description: 'Torrent has been queued for background download. Check the management page for progress...', duration: 6_000 })
        const next = new Map(map)
        next.delete(hashKey)
        pendingToasts.set(next)
    }

    /**
     * Checks pending toasts against a store's new value, resolving any whose hash is now present.
     *
     * @param {object|object[]|null} value The updated store value (single torrent or list of torrents).
     */
    function checkPending(value) {
        const list = Array.isArray(value) ? value : (value ? [value] : [])
        if (list.length === 0) return
        for (const hashKey of pendingToasts.value.keys()) {
            if (list.some(torrent => equalsIgnoreCase(torrent.infoHash, hashKey))) resolvePending(hashKey)
        }
    }

    loadedTorrent.subscribe(checkPending)
    stagingTorrents.subscribe(checkPending)
    seedingTorrents.subscribe(checkPending)
    completedTorrents.subscribe(checkPending)
</script>
<script>
    export let hash
    export let search
    export let torrentID = null
    export let size = '1.7rem'
    export let strokeWidth = '3'
    $: disabled = ($seedingTorrents?.length + $stagingTorrents?.length + 1) >= settings.value.seedingLimit && !settings.value.torrentPersist
    $: activeHash = $loadedTorrent && $stagingTorrents && $seedingTorrents && $completedTorrents && (Array.isArray(hash) ? getActiveHash(hash) : hash)
    $: downloaded = ($completedTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) && !$completedTorrents.find(torrent => equalsIgnoreCase(torrent.infoHash, activeHash))?.incomplete) || $seedingTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) || $stagingTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) || equalsIgnoreCase($loadedTorrent.infoHash, activeHash)
    $: pending = $pendingToasts.has(activeHash?.toLowerCase())
</script>
<button type='button' class='torrent-button d-flex align-items-center justify-content-center {$$restProps.class}' class:not-allowed={downloaded || disabled || pending} class:not-reactive={downloaded || disabled} class:cursor-wait={pending} disabled={(disabled && !downloaded) || pending} title='' data-toggle='tooltip' data-placement='left' data-title={pending ? 'Adding...' : $completedTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) ? ($completedTorrents.find(torrent => equalsIgnoreCase(torrent.infoHash, activeHash))?.incomplete ? 'Download Incomplete' : 'Download Completed') : $seedingTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) ? 'Seeding...' : $stagingTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) ? 'Downloading...' : equalsIgnoreCase($loadedTorrent.infoHash, activeHash) ? 'Now Playing' : (!disabled ? 'Queue for Download' : 'Enable Persist Files or Increase Seeding Limit')} use:click={() => { if (!disabled && !downloaded && torrentID) queueTorrent(torrentID, search, activeHash) }}>
    <svelte:component this={$completedTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) ? ($completedTorrents.find(torrent => equalsIgnoreCase(torrent.infoHash, activeHash))?.incomplete ? FolderX : FolderCheck) : $seedingTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) ? CloudUpload : $stagingTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) ? CloudDownload : equalsIgnoreCase($loadedTorrent.infoHash, activeHash) ? TvMinimalPlay : Download} {size} {strokeWidth} style={downloaded ? (`color: ${$completedTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) ? 'var(--slateblue-color)' : $seedingTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) ? 'var(--success-color)' : $stagingTorrents.some(torrent => equalsIgnoreCase(torrent.infoHash, activeHash)) ? 'var(--warning-color)' : 'var(--tertiary-color)'}`) : (($completedTorrents.find(torrent => equalsIgnoreCase(torrent.infoHash, activeHash))?.incomplete ? 'color: var(--error-color-light)' : ''))} />
</button>