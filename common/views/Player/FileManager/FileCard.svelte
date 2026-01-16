<script context='module'>
    import { mediaCache } from '@/modules/cache.js'
    import { click, hoverExit, blurExit } from '@/modules/click.js'
    import { SquarePen, SquareCheckBig, Play } from 'lucide-svelte'
    import { SUPPORTS } from '@/modules/support.js'
    import { createListener, isValidNumber } from '@/modules/util.js'
    import { setHash } from '@/modules/anime/animehash.js'
    import { anilistClient } from '@/modules/anilist.js'
    import Helper from '@/modules/helper.js'
    import Debug from 'debug'
    const debug = Debug('ui:file-editor')
    const { reactive, init } = createListener(['verify-btn', 'edit-btn', 'cnt-button', 'episode-input', 'f-safe-area'])
    init(true)
</script>
<script>
    export let file
    export let files
    export let playing = false
    export let fileEdit
    export let playFile

    $: notWatching = ((!$mediaCache[file?.media?.media?.id]?.mediaListEntry?.progress) || ($mediaCache[file?.media?.media?.id]?.mediaListEntry?.progress === 0 && ($mediaCache[file?.media?.media?.id]?.mediaListEntry?.status !== 'CURRENT' || $mediaCache[file?.media?.media?.id]?.mediaListEntry?.status !== 'REPEATING' && $mediaCache[file?.media?.media?.id]?.mediaListEntry?.status !== 'COMPLETED')))
    $: behind = Helper.isAuthorized() && file?.media?.episode && !Array.isArray(file?.media?.episode) && (file?.media?.episode - 1) >= 1 && ($mediaCache[file?.media?.media?.id]?.mediaListEntry?.status !== 'COMPLETED' && (($mediaCache[file?.media?.media?.id]?.mediaListEntry?.progress || -1) < (file?.media?.episode - 1)))
    $: watched = !notWatching && !behind && file?.media?.episode && ($mediaCache[file?.media?.media?.id]?.mediaListEntry?.status === 'COMPLETED' || ($mediaCache[file?.media?.media?.id]?.mediaListEntry?.progress >= file?.media?.episode))
    $: failed = file?.failed || file?.media?.failed

    let prompt = false

    let editTimer = null
    let updateTimer = null
    $: episode = getEpisode()
    function getEpisode() {
        const currentEpisode = (file?.media?.episodeRange && `${file.media.episodeRange.first}~${file.media.episodeRange.last}`) || (file?.media?.episode && (Array.isArray(file.media.episode) ? `${file.media.episode?.[0]}~${file.media.episode?.[1]}` : (file?.media?.episode || file?.media?.episode === 0) ? `${file?.media?.episode}` : null))
        return /^\d+$/.test(currentEpisode) ? Number(currentEpisode) : currentEpisode
    }
    function updateEpisode(file, event) {
        clearTimeout(editTimer)
        clearTimeout(updateTimer)
        updateTimer = setTimeout(() => {
            const currentEpisode = file.media?.episode
            const currentEpisodeRange = file.media?.episodeRange
            let value = event.target.value.trim().replace(/\s+/g, '').replace(/-+/g, '~')
            if (value.includes('~')) {
                const parts = value.split('~').map(Number).filter(number => isValidNumber(number))
                if (parts[1]) file.media.episodeRange = { first: parts[0], last: parts[1] }
                episode = getEpisode()
            } else {
                const number = Number(value)
                if (file.media?.episodeRange) delete file.media.episodeRange
                file.media.episode = isValidNumber(number) ? number : null
                episode = getEpisode()
            }
            if (file.media?.episodeRange ? `${currentEpisodeRange.first}~${currentEpisodeRange.last}` !== episode : currentEpisode !== episode) {
                file.locked = true
                setHash(file.infoHash, {
                    fileHash: file.fileHash,
                    mediaId: file.media.media?.id,
                    episodeRange: file.media.episodeRange,
                    episode: file.media.episode || file.media.parseObject.episode_number,
                    season: file.media.season || file.media.parseObject.anime_season,
                    parseObject: file.media.parseObject,
                    locked: true,
                    failed: false
                })
            }
            debug(`Updated ${file.media?.media?.id} with Episode ${file.media.episode || file.media.parseObject.episode_number} and file:`, JSON.stringify(file))
            editTimer = setTimeout(() => window.dispatchEvent(new CustomEvent('fileEdit')), 1500)
        }, 200)
    }
    function verifySeries() {
        file.locked = true
        file.media.failed = false
        setHash(file.infoHash, {
            fileHash: file.fileHash,
            mediaId: file.media.media?.id,
            episodeRange: file.media.episodeRange,
            episode: file.media.episode || file.media.parseObject.episode_number,
            season: file.media.season || file.media.parseObject.anime_season,
            parseObject: file.media.parseObject,
            locked: true,
            failed: false
        })
        debug(`Verified ${file.media?.media?.id} with Episode ${file.media.episode || file.media.parseObject.episode_number} and file:`, JSON.stringify(file))
        editTimer = setTimeout(() => window.dispatchEvent(new CustomEvent('fileEdit')), 1500)
    }
</script>

<div class='file-item shadow-lg position-relative d-flex align-items-center mx-20 my-5 p-5 scale {$$restProps.class}' class:pointer={!playing} role='button' tabindex='0' title={file?.name} use:blurExit={ () => { if (prompt) setTimeout(() => { prompt = false }) }} use:hoverExit={() => { if (prompt) setTimeout(() => { prompt = false }) }} use:click={() => { if (!behind || prompt || (!playing && !file?.media?.media)) { prompt = false; if (!playing) { window.dispatchEvent(new Event('overlay-check')); playFile(file) } } else if (!playing) { prompt = true } } } class:not-reactive={!$reactive || playing} class:behind={(behind && !notWatching)} class:current={!behind && !notWatching} class:not-watching={notWatching} class:watched={watched}>
    <div class='position-absolute top-0 left-0 w-full h-full'>
        <img src={file?.media?.media?.bannerImage || ''} alt='bannerImage' class='hero-img img-cover w-full h-full' />
        <div class='position-absolute rounded-5 opacity-transition-hack' style='background: var(--notification-card-gradient)' />
    </div>
    <div class='rounded-5 d-flex justify-content-center align-items-center overflow-hidden mr-10 z-10 file-icon-container'>
        <img src={file?.media?.media?.coverImage?.medium || file?.media?.media?.coverImage?.extraLarge || './404_cover.png'} alt='icon' class='file-icon rounded-5 w-auto' />
    </div>
    <div class='file-content z-10 w-full'>
        <div class='d-flex'>
            <p class='file-title overflow-hidden font-weight-bold my-0 mt-10 mr-10 font-scale-18 {SUPPORTS.isAndroid ? `line-clamp-1` : `line-clamp-2`}'>{#if file?.media?.media}{anilistClient.title(file?.media.media)}{:else}{file?.media?.parseObject?.anime_title || file?.name || 'UNK'}{/if}</p>
            <button type='button' tabindex='-1' class='position-absolute f-safe-area top-0 right-0 h-50 bg-transparent border-0 shadow-none not-reactive z-1 {file?.locked || file?.media?.locked || !episode?.length ? `w-50` : `w-90`}' use:click={() => {}}/>
            <button type='button' class='ml-auto verify-btn btn btn-square d-none align-items-center justify-content-center mr-5 px-5 z-1' class:d-flex={!(file?.locked || file?.media?.locked || (!episode && file?.media?.media?.episodes > 1)) || (failed && (episode || file?.media?.media?.episodes <= 1))} title='Confirm this series as being correct' use:click={() => { prompt = false; verifySeries() } }><SquareCheckBig color='var(--tertiary-color)' size='1.7rem' strokeWidth='3'/></button>
            <button type='button' class='ml-auto edit-btn btn btn-square d-flex align-items-center justify-content-center px-5 z-1' class:ml-auto={!(!(file?.locked || file?.media?.locked || (!episode && file?.media?.media?.episodes > 1)) || (failed && (episode || file?.media?.media?.episodes <= 1)))} title='Opens a prompt to select the correct series' use:click={() => { prompt = false; fileEdit(file, files, file?.media?.media ? anilistClient.title(file?.media.media) : file?.media?.parseObject?.anime_title || '') } }><SquarePen size='1.7rem' strokeWidth='3'/></button>
        </div>
        <p class='font-scale-12 my-5 mr-40 text-muted text-break-word overflow-hidden line-2'>{file?.name || 'UNK'}</p>
        <div class='d-flex align-items-center mt-5'>
            {#if playing}<span class='badge text-dark bg-duodenary' title='The current file'>Now Playing</span>{/if}
            {#if file?.locked || file?.media?.locked}<span class='badge text-dark bg-success' class:ml-5={playing} title='This series was manually set by the user'>Locked</span>{/if}
            {#if failed}<span class='badge text-dark bg-danger-dim ml-auto h-27 mr-5 d-flex align-items-center justify-content-center' title='Failed to resolve the playing media based on the file name.'>Failed</span>{/if}
            {#if file?.media?.media?.format === 'MOVIE' && (file?.media?.media?.episodes ?? 0) <= 1}
                <span class='badge text-dark bg-undenary h-27 mr-5 d-flex align-items-center justify-content-center' class:ml-auto={!failed}>Movie</span>
            {:else if episode || episode === 0 || file?.media?.media?.episodes > 1 || (!file?.media?.media && failed)}
                <span class='badge text-dark bg-undenary mr-5 d-flex align-items-center justify-content-center' class:ml-auto={!failed} title={`Episode ${episode}`}>
                    <span class='mr-5'>Episode</span>
                    <button type='button' tabindex='-1' class='position-absolute f-safe-area bottom-0 right-0 h-40 bg-transparent border-0 shadow-none not-reactive z-1' style='margin-bottom: -.5rem; margin-right: -1rem; width: calc(5.5rem + {((episode || isValidNumber(episode)) && String(episode).length <= 10 ? String(episode).length : 2) * .7}rem) !important' use:click={() => {}}/>
                    <input
                        type='text'
                        inputmode='text'
                        pattern='[0-9 ~\-]*'
                        bind:value={episode}
                        use:click|stopPropagation
                        on:input={(event) => {
                            const targetValue = event.target.value.replace(/[^0-9~\-]/g, '')
                            const value = targetValue?.length ? targetValue : getEpisode()
                            event.target.value = value || null
                        }}
                        on:change={(event) => {
                            const targetValue = event.target.value.replace(/[^0-9~\-]/g, '')
                            const value = targetValue?.length ? targetValue : getEpisode()
                            event.target.value = value || null
                            updateEpisode(file, event)
                        }}
                        class='episode-input input form-control h-20 text-left text-dark text-truncate font-weight-semi-bold font-size-12 justify-content-center z-1'
                        style='background-color: {failed && !episode && episode !== 0 && file?.media?.media?.episodes > 1 ? `var(--danger-color-dim)` : `var(--undenary-color-dim)`}; width: calc(1.8rem + {((episode || isValidNumber(episode)) && String(episode).length <= 10 ? String(episode).length : 2) * .7}rem) !important'
                        title='Episode Number(s)'/>
                </span>
            {/if}
        </div>
      <div class='position-absolute bd-highlight rounded-5 opacity-transition-hack' class:playing={playing} style='left: -.6rem;' />
    </div>
    <div class='prompt position-absolute w-full h-full z-40 d-flex flex-column align-items-center' class:visible={prompt} class:invisible={!prompt}>
        <p class='mx-20 font-scale-20 text-white text-center mt-auto mb-0'>
            {#if !$mediaCache[file?.media?.media?.id]?.mediaListEntry?.progress}
                You Haven't Watched Any Episodes Yet!
            {:else}
                Your Current Progress Is At <b>Episode {$mediaCache[file?.media?.media?.id]?.mediaListEntry?.progress}</b>
            {/if}
        </p>
        <button type='button' class='cnt-button btn btn-lg btn-secondary w-230 h-33 text-dark font-scale-16 font-weight-bold shadow-none border-0 d-flex align-items-center mt-10 mb-auto' use:click={() => { prompt = false; window.dispatchEvent(new Event('overlay-check')); playFile(file) } }>
            <Play class='mr-10' fill='currentColor' size='1.4rem' />
            Continue Anyway?
        </button>
    </div>
</div>

<style>
    .h-27 {
        height: 2.7rem !important
    }
    .h-33 {
        height: 3.3rem !important;
    }
    .scale {
        transition: transform 0.2s ease;
        will-change: transform;
    }
    .scale:hover{
        transform: scale(1.025);
    }
    .playing {
        border: .2rem solid var(--tertiary-color);
    }
    .file-item {
        background-color: var(--dark-color-light);
        border-radius: .75rem;
    }
    .file-item.current {
        border-left: .4rem solid var(--current-color);
    }
    .file-item.watched {
        border-left: .4rem solid var(--watched-color);
    }
    .file-item.behind {
        border-left: .4rem solid var(--dropped-color);
    }
    .file-item.not-watching {
        border-left: .4rem solid var(--gray-color-very-dim);
    }
    .file-title {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        text-overflow: ellipsis;
        word-wrap: break-word;
    }
    .line-clamp-1 {
        line-height: 1.4;
        -webkit-line-clamp: 1;
    }
    .line-clamp-2 {
        line-height: 1.2;
        -webkit-line-clamp: 2;
    }
    .hero-img {
        border-radius: .75rem;
    }
    .file-icon {
        height: 100%;
        object-fit: cover;
        object-position: center;
    }
    .file-icon-container {
        width: 6rem !important;
        height: 8rem !important;
    }
    .rounded-5 {
        border-radius: .5rem;
    }
    .prompt {
        margin-left: -.9rem !important;
        width: 100.6% !important;
        border-radius: .62rem;
        background-color: hsla(var(--black-color-hsl), 0.8) !important;
    }
</style>