<script>
    import { settings } from '@/modules/settings.js'
    import { malDubs } from '@/modules/anime/animedubs.js'
    import { animeSchedule } from '@/modules/anime/animeschedule.js'
    import { getMediaMaxEp } from '@/modules/anime/anime.js'
    import { matchPhrase, resizeObserver } from '@/modules/util.js'
    import { writable } from 'simple-store-svelte'
    import { Mic, MicOff, Captions, Adult, ClockFading } from 'lucide-svelte'

    /** @type {import('@/modules/providers/anilist/al.d.ts').Media} */
    export let media = null
    export let data = null

    export let style = ''
    export let banner = false
    export let viewAnime = false
    export let episode = false
    export let episodeList = false

    export let dubbed = false
    export let subbed = false

    const { dubLists } = malDubs
    const { dubAiredLists, dubAiring } = animeSchedule

    const isDubbed = writable(false)
    const isPartial = writable(false)

    let dubEpisodes = null
    $: getDubEpisodes($dubAiredLists, media?.id)
    async function getDubEpisodes(dubAiredLists, _) {
        if (banner) return
        const aired = await dubAiredLists
        const airing = dubAiring.value?.find(entry => entry.unaired && entry.media?.media?.id === media.id)
        const airedEpisodes = aired?.filter(ep => ep.id === media.id)?.map(ep => ep.episode.aired) || []
        const episodes = String((($isDubbed || $isPartial) && airedEpisodes.length > 0 && airedEpisodes.length) || (aired?.find(entry => entry.media?.media?.id === media.id)?.episodeNumber && '0') || (!$isPartial && media.status !== 'RELEASING' && media.status !== 'NOT_YET_RELEASED' && Number(media.seasonYear || 0) < 2025 && !airing && getMediaMaxEp(media)) || '')
        if (dubEpisodes !== episodes) dubEpisodes = episodes
    }

    $: setLabel($dubLists, media?.id)
    async function setLabel(dubLists, _) {
        const _dubLists = await dubLists
        if (media?.idMal && _dubLists?.dubbed) {
            const episodeOrMedia = !episode || await malDubs.isDubMedia(data?.parseObject)
            isDubbed.set(episodeOrMedia && _dubLists.dubbed.includes(media.idMal))
            isPartial.set(episodeOrMedia && _dubLists.incomplete.includes(media.idMal))
            getDubEpisodes(await dubAiredLists.value)
        }
    }

    const markFirstInRow = resizeObserver((node) => {
        const items = Array.from(node.querySelectorAll('.audio-label'))
        if (!items.length) return
        items.forEach(i => i.classList.remove('first-audio'))
        const rows = {}
        items.forEach(item => {
            const top = item.offsetTop
            if (!rows[top]) rows[top] = []
            rows[top].push(item)
        })
        Object.values(rows).forEach(rowItems => rowItems[0]?.classList.add('first-audio'))
    })
</script>
{#if settings.value.cardAudio}
    {#if !banner && !episodeList}
        {@const subEpisodes = String(media.status !== 'NOT_YET_RELEASED' && media.status !== 'CANCELLED' && getMediaMaxEp(media, (media.status !== 'FINISHED')) || dubEpisodes || '')}
        <div use:markFirstInRow class='position-absolute bottom-0 right-0 w-full d-flex flex-row-reverse flex-wrap align-items-end justify-content-start h-20 vertical-flip z-1' {style} class:mb--7={!viewAnime} class:mb--3={viewAnime}>
            <div class='audio-label px-10 text-dark rounded-right font-weight-bold d-flex align-items-center vertical-flip h-full bg-septenary slant mrl-1 z-5'>
                <Captions size='2rem' strokeWidth='1.5' />
                <span class='d-flex align-items-center line-height-1' class:ml-3={(subEpisodes && subEpisodes.length > 0) || (dubEpisodes && Number(dubEpisodes) > 0)}><div class='line-height-1 mt-2'>{#if subEpisodes && (!dubEpisodes || (Number(subEpisodes) >= Number(dubEpisodes)))}{Number(subEpisodes)}{:else if dubEpisodes && (Number(dubEpisodes) > 0)}{Number(dubEpisodes)}{/if}</div></span>
            </div>
            {#if $isDubbed || ($isPartial && dubEpisodes && Number(dubEpisodes) > 0)}
                <div class='audio-label pl-10 pr-20 text-dark rounded-right font-weight-bold d-flex align-items-center vertical-flip h-full slant z-4 bg-senary' class:bg-octonary={$isPartial} class:w-icon={!dubEpisodes || dubEpisodes.length === 0 || Number(dubEpisodes) === 0} class:w-text={dubEpisodes && dubEpisodes.length > 0 && Number(dubEpisodes) > 0}>
                    <svelte:component this={$isDubbed ? Mic : MicOff} size='1.8rem' strokeWidth='2' />
                    <span class='d-flex align-items-center line-height-1 ml-2'><div class='line-height-1 mt-2'>{#if Number(dubEpisodes) > 0}{Number(dubEpisodes)}{/if}</div></span>
                </div>
            {/if}
            {#if media.mediaListEntry?.progress}
                <div class='audio-label pl-10 pr-20 text-dark rounded-right font-weight-bold d-flex align-items-center vertical-flip h-full slant w-icon w-text bg-current z-3'>
                    <ClockFading size='1.8rem' strokeWidth='2' />
                    <span class='d-flex align-items-center line-height-1 ml-2'><div class='line-height-1 mt-2'>{Number(media.mediaListEntry?.progress)}</div></span>
                </div>
            {/if}
            {#if $isPartial && (!dubEpisodes || Number(dubEpisodes) <= 0)}
                <div class='audio-label pl-10 pr-20 text-dark rounded-right font-weight-bold d-flex align-items-center vertical-flip h-full slant z-2 bg-octonary' class:w-icon={!dubEpisodes || dubEpisodes.length === 0 || Number(dubEpisodes) === 0} class:w-text={dubEpisodes && dubEpisodes.length > 0 && Number(dubEpisodes) > 0}>
                    <MicOff size='1.8rem' strokeWidth='2' />
                    <span class='d-flex align-items-center line-height-1 ml-2'><div class='line-height-1 mt-2'>{#if Number(dubEpisodes) > 0}{Number(dubEpisodes)}{/if}</div></span>
                </div>
            {/if}
            {#if media.isAdult}
                <div class='audio-label pl-10 pr-15 text-dark rounded-right font-weight-bold d-flex align-items-center vertical-flip h-full lg-slant bg-quinary mrl-2 z-1'>
                    <Adult size='2rem' strokeWidth='1.8' />
                </div>
            {/if}
        </div>
    {:else if episodeList}
        <div class='position-absolute bottom-0 right-0 d-flex h-2'>
            {#if dubbed}
                <div class='pl-10 pr-20 text-dark font-weight-bold d-flex align-items-center h-full bg-senary slant w-icon'>
                    <Mic size='1.8rem' strokeWidth='2' />
                </div>
            {/if}
            {#if subbed}
                <div class='px-10 z-10 text-dark rounded-right font-weight-bold d-flex align-items-center h-full bg-septenary slant mrl-1'>
                    <Captions size='2rem' strokeWidth='1.5' />
                </div>
            {/if}
        </div>
    {:else if !viewAnime}
        {@const multiAudio = (matchPhrase(data?.parseObject?.file_name, ['Multi Audio', 'Dual Audio'], 3) || matchPhrase(data?.parseObject?.file_name, ['Dual'], 1)) || (banner && !episode && ($isDubbed || $isPartial)) }
        {$isDubbed ? `Dub${ multiAudio ? ' | Sub' : ''}` : $isPartial ? `Partial Dub${ multiAudio ? ' | Sub' : ''}` : 'Sub'}
    {/if}
{/if}

<style>
    .w-icon {
        margin-right: -2rem;
    }
    .w-text {
        margin-right: -1.3rem;
    }
    .ml-2 {
        margin-left: 0.2rem;
    }
    .ml-3 {
        margin-left: 0.3rem;
    }
    .mrl-1 {
        margin-right: -.3rem;
    }
    .mrl-2 {
        margin-right: -1.3rem;
    }
    .slant {
        clip-path: polygon(15% -1px, 100% 0, 100% 100%, 0% calc(100% + 1px));
    }
    .lg-slant {
        clip-path: polygon(21% -1px, 100% 0, 100% 100%, 0% calc(100% + 1px));
    }
</style>
