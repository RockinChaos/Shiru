<script context='module'>
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import AudioLabel from '@/components/AudioLabel.svelte'
  import TorrentButton from '@/components/TorrentButton.svelte'
  import { CalendarDays, Play, Tv, RefreshCwOff } from 'lucide-svelte'
</script>
<script>
  import { since, fadeIn, fadeOut, isValidNumber, clampToViewport } from '@/modules/util.js'
  import { statusColorMap, formatMap } from '@/modules/anime/anime.js'
  import { episodesList } from '@/modules/episodes.js'
  import { click } from '@/modules/lib/click.js'
  import { getHash } from '@/modules/anime/animehash.js'
  import { liveAnimeEpisodeProgress } from '@/modules/anime/animeprogress.js'
  import { anilistClient } from '@/modules/providers/anilist/anilist.js'
  import { settings } from '@/modules/settings.js'
  import { mediaCache } from '@/modules/cache.js'
  import { modal } from '@/modules/navigation.js'

  export let data
  export let prompt
  export let element
  export let zeroEpisode = false
  /** @type {import('@/modules/providers/anilist/al.d.ts').Media | null} */
  const media = data.media && mediaCache.value[data.media.id]
  const episodeRange = episodesList.handleArray(data?.episode, data?.parseObject?.file_name)
  const lastEpisode = (data?.episodeRange || data?.parseObject?.episodeRange)?.last || episodeRange?.last || (isValidNumber(data?.episode) && (data?.episode + (zeroEpisode ? 1 : 0))) || (media?.episodes === 1 && media?.episodes)
  const hasSpoiler = $settings.spoilerStatus.includes(media?.mediaListEntry?.status ?? 'NOTONLIST')
  const isSpoiler = hasSpoiler && (media?.mediaListEntry?.progress ?? 0) < lastEpisode
  const episodeThumbnail = ((data.similarity || ((!hasSpoiler || (media?.mediaListEntry?.progress >= lastEpisode || !['minimal', 'moderate', 'strict', 'hermit'].includes($settings.spoilers))))) && data.episodeData?.image) || media?.bannerImage || media?.coverImage.extraLarge || ' '
  const watched = media?.mediaListEntry?.status === 'COMPLETED'
  const completed = !watched && media?.mediaListEntry?.progress >= lastEpisode
  const progress = liveAnimeEpisodeProgress(media?.id, data?.episode, completed)
  let hide = true
  let animating = true

  $: resolvedHash = media?.id && !data.failed && getHash(media.id, { episode: data?.episode, client: true, batchGuess: true }, false, true)
</script>

<div class='position-absolute w-400 mw-full mh-400 absolute-container top-0 m-auto bg-dark-light z-30 rounded overflow-hidden pointer d-flex flex-column fade-change' use:clampToViewport in:fadeIn out:fadeOut on:introend={() => animating = false} on:outrostart={() => animating = true} bind:this={element}>
  <div class='image h-200 w-full position-relative d-flex justify-content-between align-items-end text-white'>
    <SmartImage class='img-cover w-full h-full position-absolute rounded p-0 m-0 {!(data.episodeData?.image || media?.bannerImage) && media?.genres?.includes(`Hentai`) ? `cover-rotated cr-400` : ``}' color={media?.coverImage?.color || 'var(--tertiary-color)'} images={[episodeThumbnail, (!media ? './404_episode.jpg' : './no_image_episode.jpg')]}/>
    {#if data.episodeData?.video && !animating}
      <video src={data.episodeData.video}
        class='img-cover w-full h-full position-absolute'
        style='opacity: {hide ? 0 : 1}; transition: opacity .3s ease'
        playsinline
        preload='none'
        loop
        muted
        on:loadeddata={() => { hide = false }}
        autoplay />
    {/if}
    {#if data.failed}
      <div class='pl-10 pt-10 z-10 position-absolute top-0 left-0 text-danger icon-shadow' title='Failed to resolve media'>
        <RefreshCwOff size='3rem' />
      </div>
    {/if}
    {#if data.hash || resolvedHash}
      <div class='pr-5 pt-5 z-10 position-absolute top-0 right-0 text-danger icon-shadow'>
        <button type='button' tabindex='-1' class='position-absolute episode-safe-area top-0 right-0 h-50 w-50 bg-transparent border-0 shadow-none not-reactive' use:click={() => {}}/>
        <TorrentButton class='btn btn-square btn-highlight shadow-none bg-transparent bd-highlight h-40 w-40 z-1 position-relative' hash={[...(data.hash && data.hash !== resolvedHash ? [data.hash] : []), ...(resolvedHash ? [resolvedHash] : [])]} torrentID={data.link} search={{ media, episode: data.episode, episodeRange: episodeRange }} size={'3rem'} strokeWidth={'2.3'}/>
      </div>
    {/if}
    <Play class='mb-5 ml-5 pl-10 pb-10 z-10' fill='currentColor' size='3rem' />
    <div class='pr-20 pb-10 font-size-16 font-weight-medium z-10' class:hidden={isSpoiler && ['hermit'].includes($settings.spoilers)}>
      {#if media?.duration}
        {#if (data.episodeRange || data.parseObject?.episodeRange)}
          {media.duration * (((data.episodeRange || data.parseObject?.episodeRange).last - (data.episodeRange || data.parseObject?.episodeRange).first) + 1)}m
        {:else if episodeRange && isValidNumber(episodeRange.first) && isValidNumber(episodeRange.last)}
          {media.duration * ((episodeRange.first - episodeRange.last) + 1)}m
        {:else}
          {media.duration}m
        {/if}
      {/if}
    </div>
    {#if completed}
      <div class='progress container-fluid position-absolute z-10' style='height: 2px; min-height: 2px;'>
        <div class='progress-bar w-full' />
      </div>
    {:else if $progress > 0}
      <div class='progress container-fluid position-absolute z-10' style='height: 2px; min-height: 2px;'>
        <div class='progress-bar' style='width: {$progress}%' />
      </div>
    {/if}
  </div>
  <div class='w-full d-flex flex-column flex-grow-1 px-20 pb-15'>
    <div class='row pt-15'>
      <div class='col pr-10'>
        <div class='text-white font-weight-very-bold font-size-16 title overflow-hidden' title={anilistClient.title(media) || data.parseObject.anime_title}>
          {#if media?.mediaListEntry?.status}
            <div style:--statusColor={statusColorMap[media.mediaListEntry.status]} class='list-status-circle d-inline-flex overflow-hidden mr-5' title={media.mediaListEntry.status} />
          {/if}
          {anilistClient.title(media) || data.parseObject.anime_title}
        </div>
        {#if data.episodeData?.title?.en || data.episodeData?.title?.['x-jat'] || data.episodeData?.title?.ja || data.episodeData?.title?.jp}
          {@const ep_title = data.episodeData?.title?.en || data.episodeData?.title?.['x-jat'] || data.episodeData?.title?.ja || data.episodeData?.title?.jp}
          <div class='font-size-12 title overflow-hidden' title={ep_title} class:text-muted={!isSpoiler || !['strict', 'hermit'].includes($settings.spoilers)} class:text-spoiler={isSpoiler && ['strict', 'hermit'].includes($settings.spoilers)}>
            {ep_title}
          </div>
        {/if}
      </div>
      <div class='col-auto d-flex flex-column align-items-end text-right mt-3' title={data.parseObject?.file_name} >
        <div class='text-white font-weight-bold font-weight-very-bold'>
          {#if data.episodeRange || data.parseObject?.episodeRange}
            {`Episodes ${(data.episodeRange || data.parseObject.episodeRange).first} ~ ${(data.episodeRange || data.parseObject.episodeRange).last}`}
          {:else if data.episode != null}
            {#if episodeRange}
              Episodes {episodeRange.first} ~ {episodeRange.last}
            {:else if !Array.isArray(data.episode)}
              Episode {isValidNumber(data.episode) ? Number(data.episode) : data.episode?.replace(/\D/g, '')}
            {/if}
          {:else if media?.format === 'MOVIE'}
            Movie
          {:else if data.parseObject?.anime_title?.match(/S(\d{2})/)}
            Season {parseInt(data.parseObject.anime_title.match(/S(\d{2})/)[1], 10)}
          {:else if (!data.similarity)}
            Batch
          {/if}
        </div>
        <div class='d-flex align-items-center'>
          <div class='text-nowrap font-size-12 title text-muted d-flex align-items-center'>
            <AudioLabel {media} {data} banner={true} episode={true} />
          </div>
          {#if data.date}
            {#if settings.value.cardAudio}
              <div class='text-muted font-size-12 title ml-5 mr-5 overflow-hidden'>
                •
              </div>
            {/if}
            <div class='text-muted font-size-12 title overflow-hidden'>
              {since(data.date)}
            </div>
          {:else if data.similarity}
            {#if settings.value.cardAudio}
              <div class='text-muted font-size-12 title ml-5 mr-5 overflow-hidden'>
                •
              </div>
            {/if}
            <div class='text-muted font-size-12 title overflow-hidden'>
              Confidence: {Math.round(data.similarity * 100)}%
            </div>
          {/if}
        </div>
      </div>
    </div>
    <div class='w-full description overflow-hidden pt-15' class:text-muted={!isSpoiler || !['moderate', 'strict', 'hermit'].includes($settings.spoilers)} class:text-spoiler={isSpoiler && ['strict', 'hermit'].includes($settings.spoilers)}>
      {#if data.episodeData?.summary || data.episodeData?.overview}
        {(data.episodeData?.summary || data.episodeData?.overview).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()}
      {:else}
        {(media?.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()}
      {/if}
    </div>
    {#if media}
      <div class='d-flex flex-row pt-15 font-weight-medium justify-content-between w-full text-muted'>
        <div class='d-flex align-items-center' style='margin-left: -2px'>
          <CalendarDays class='pr-5' size='2.6rem' />
          <span class='line-height-1'>{media.seasonYear || 'N/A'}</span>
        </div>
        <div class='d-flex align-items-center'>
          <span class='line-height-1'>{formatMap[media.format]}</span>
          <Tv class='pl-5' size='2.6rem' />
        </div>
      </div>
    {/if}
  </div>
  <div class='overlay position-absolute w-full h-200 z-40 d-flex flex-column justify-content-center align-items-center transition-opacity' class:transparent={!prompt}>
    <p class='ml-20 mr-20 font-size-24 text-white text-center'>
      {#if !media?.mediaListEntry?.progress}
        You Haven't Watched Any Episodes Yet!
      {:else}
        Your Current Progress Is At <b>Episode {media?.mediaListEntry?.progress - (zeroEpisode ? 1 : 0)}</b>
      {/if}
    </p>
    <button class='cont-button btn btn-lg btn-secondary w-250 text-dark font-weight-bold shadow-none border-0 d-flex align-items-center justify-content-center mt-10' tabindex={!prompt ? '-1' : '0'} use:click={() => { data.onclick() || modal.open(modal.ANIME_DETAILS, media) }}>
      <Play class='mr-10' fill='currentColor' size='1.6rem' />
      Continue Anyway?
    </button>
   </div>
</div>

<style>
  .overlay {
    background-color: hsla(var(--black-color-hsl), 0.9);
  }
  .description {
    display: -webkit-box !important;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  .absolute-container {
    will-change: transform, opacity, bottom;
    left: -100%;
    right: -100%;
    max-width: calc(100vw - 2rem) !important;
  }
  .title {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    word-break: break-all;
  }
  .image:after {
    content: '';
    position: absolute;
    left: 0;
    width: 100%;
    bottom: -1px; /* Extend 1px below to cover gap */
    height: calc(100% + 1px); /* Slightly taller */
    background: var(--episode-preview-card-gradient);
  }
  .list-status-circle {
    background: var(--statusColor);
    height: 1.1rem;
    width: 1.1rem;
    border-radius: 50%;
  }
</style>