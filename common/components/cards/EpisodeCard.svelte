<script context='module'>
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import AudioLabel from '@/components/AudioLabel.svelte'
  import EpisodePreviewCard from '@/components/cards/EpisodePreviewCard.svelte'
  import { Play, RefreshCwOff } from 'lucide-svelte'
  import { onDestroy, onMount } from 'svelte'
  import { writable } from 'simple-store-svelte'
  import { playActive } from '@/components/TorrentButton.svelte'
  import { createListener, since, isValidNumber } from '@/modules/util.js'
  const { reactive, init } = createListener(['torrent-button', 'cont-button', 'episode-safe-area'])
  init(true)
</script>
<script>
  import { statusColorMap } from '@/modules/anime/anime.js'
  import { episodesList } from '@/modules/episodes.js'
  import { hoverClick, getInteractionMethod } from '@/modules/lib/click.js'
  import { liveAnimeEpisodeProgress } from '@/modules/anime/animeprogress.js'
  import { anilistClient } from '@/modules/providers/anilist/anilist.js'
  import { settings } from '@/modules/settings.js'
  import { mediaCache, fromCache } from '@/modules/cache.js'
  import { checkForZero } from '@/components/MediaHandler.svelte'
  import { modal } from '@/modules/navigation.js'
  export let data
  export let section = false

  let preview = false
  let ignoreFocus = false
  const prompt = writable(false)
  const clicked = writable(false)

  /** @type {import('@/modules/providers/anilist/al.d.ts').Media | null} */
  let media
  $: media = fromCache($mediaCache, media ?? mediaCache.value[data.media?.id])
  let zeroEpisode = checkForZero(media).then(_zeroEpisode => (zeroEpisode = _zeroEpisode))
  $: episodeRange = episodesList.handleArray(data?.episode, data?.parseObject?.file_name)
  $: lastEpisode = (data?.episodeRange || data?.parseObject?.episodeRange)?.last || episodeRange?.last || (isValidNumber(data?.episode) && (data?.episode + (zeroEpisode ? 1 : 0))) || (media?.episodes === 1 && media?.episodes)
  $: hasSpoiler = $settings.spoilerStatus.includes(media?.mediaListEntry?.status ?? 'NOTONLIST')
  $: isSpoiler = hasSpoiler && (media?.mediaListEntry?.progress ?? 0) < lastEpisode
  $: episodeThumbnail = ((data.similarity || ((!hasSpoiler || (media?.mediaListEntry?.progress >= lastEpisode || !['minimal', 'moderate', 'strict', 'hermit'].includes($settings.spoilers))))) && data.episodeData?.image) || media?.bannerImage || media?.coverImage.extraLarge || ' '
  $: watched = media?.mediaListEntry?.status === 'COMPLETED'
  $: completed = !watched && media?.mediaListEntry?.progress >= lastEpisode
  $: progress = liveAnimeEpisodeProgress(media?.id, data?.episode, completed)

  function viewMedia () {
    modal.open(modal.ANIME_DETAILS, media)
  }
  function setClickState() {
    const episode = isValidNumber(data.episode) ? data.episode : ((media?.episodes === 1 && media?.episodes) || (!media?.episodes && (media?.format === 'MOVIE' || media?.format === 'OVA' || media?.format === 'SPECIAL') && 1))
    if (!$prompt && !data.similarity && isValidNumber(episode) && !Array.isArray(episode) && (episode - 1) >= 1 && media?.mediaListEntry?.status !== 'COMPLETED' && (media?.mediaListEntry?.progress || -1) < (episode - 1)) prompt.set(true)
    else {
      prompt.set(false)
      isValidNumber(episode) ? (media ? playActive(data.hash, { media, episode: episode }, data.link, !data.link) : data.onclick()) : viewMedia()
    }
    clicked.set(true)
    setTimeout(() => clicked.set(false)).unref?.()
  }
  function setHoverState (state, tapped) {
    const focused = document.activeElement
    if (container && focused?.offsetParent != null && (container.contains(focused)) && (!previewCard || !previewCard.contains(focused))) ignoreFocus = true
    const episode = isValidNumber(data.episode) ? data.episode : ((media?.episodes === 1 && media?.episodes) || (!media?.episodes && (media?.format === 'MOVIE' || media?.format === 'OVA' || media?.format === 'SPECIAL') && 1))
    if (!$prompt && !data.similarity && isValidNumber(episode) && !Array.isArray(episode) && (episode - 1) >= 1 && media?.mediaListEntry?.status !== 'COMPLETED' && (media?.mediaListEntry?.progress || -1) < (episode - 1)) prompt.set(!!tapped)
    if (!$prompt || !$clicked) {
      preview = state
      setTimeout(() => {
        if (!preview) prompt.set(false)
      }).unref?.()
    }
  }

  let container
  let previewCard
  let focusTimeout
  let blurTimeout
  function handleFocus() {
    if (ignoreFocus || preview || !['keyboard', 'dpad'].includes(getInteractionMethod())) return
    clearTimeouts()
    focusTimeout = setTimeout(() => {
      if (settings.value.cardPreview) {
        preview = true
        ignoreFocus = true
        document.addEventListener('pointerup', handleOutsideClick)
      }
    }, 800)
    focusTimeout.unref?.()
  }
  function handleBlur() {
    clearTimeouts()
    blurTimeout = setTimeout(() => {
      const focused = document.activeElement
      const stillFocused = focused?.offsetParent != null
      const lostFocus = container && (!stillFocused || !container.contains(focused))
      const lostPreviewFocus = previewCard && (!stillFocused || !previewCard.contains(focused))
      if (lostFocus && lostPreviewFocus) {
        preview = false
        ignoreFocus = false
        setTimeout(() => {
          if (!preview) prompt.set(false)
        }).unref?.()
        document.removeEventListener('pointerup', handleOutsideClick)
      } else if (lostFocus || (previewCard && previewCard.contains(focused))) ignoreFocus = false
    })
    blurTimeout.unref?.()
  }
  function handleOutsideClick(event) {
    if (container && previewCard && !container.contains(event.target) && !previewCard.contains(event.target)) {
      preview = false
      setTimeout(() => {
        if (!preview) prompt.set(false)
      }).unref?.()
      document.removeEventListener('pointerup', handleOutsideClick)
    }
  }
  function clearTimeouts() {
    clearTimeout(focusTimeout)
    clearTimeout(blurTimeout)
  }

  let sinceInterval
  const timeSince = writable(null)
  onMount(() => {
    container.addEventListener('focusout', handleBlur)
    timeSince.set(data?.date && since(data?.date))
    sinceInterval = setInterval(() => (timeSince.set(data?.date && since(data?.date))), 60_000)
    sinceInterval.unref?.()
  })
  onDestroy(() => {
    document.removeEventListener('pointerup', handleOutsideClick)
    container?.removeEventListener?.('focusout', handleBlur)
    clearTimeouts()
    clearInterval(sinceInterval)
  })
  $: if (preview) clearTimeout(focusTimeout)
  $: if (!preview) document.removeEventListener('pointerup', handleOutsideClick)
</script>

<div bind:this={container} class='d-flex p-20 pb-10 position-relative episode-card' class:mb-100={section} class:not-reactive={!$reactive} use:hoverClick={[setClickState, setHoverState, viewMedia]} on:focus={handleFocus}>
  {#if preview}
    <EpisodePreviewCard {data} {zeroEpisode} bind:prompt={$prompt} bind:element={previewCard} />
  {/if}
  <div class='item load-in d-flex flex-column h-full pointer content-visibility-auto' class:opacity-half={completed}>
    <div class='image h-200 w-full position-relative rounded overflow-hidden d-flex justify-content-between align-items-end text-white'>
      <SmartImage class='cover-img w-full h-full position-absolute {!(data.episodeData?.image || media?.bannerImage) && media?.genres?.includes(`Hentai`) ? `cover-rotated cr-380` : ``}' color={media?.coverImage?.color || 'var(--tertiary-color)'} images={[episodeThumbnail, (!media ? './404_episode.jpg' : './no_image_episode.jpg')]}/>
      {#if data.failed}
        <div class='pl-10 pt-10 z-10 position-absolute top-0 left-0 text-danger icon-shadow' title='Failed to resolve media'>
          <RefreshCwOff size='3rem' />
        </div>
      {/if}
      <Play class='mb-5 ml-5 pl-10 pb-10 z-10' fill='currentColor' size='3rem' />
      <div class='pr-15 pb-10 font-size-16 font-weight-medium z-10' class:hidden={isSpoiler && ['hermit'].includes($settings.spoilers)}>
        {#if media?.duration}
          {#if (data.episodeRange || data.parseObject?.episodeRange)}
            {media.duration * (((data.episodeRange || data.parseObject?.episodeRange)?.last - (data.episodeRange || data.parseObject?.episodeRange)?.first) + 1)}m
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
    <div class='row pt-15'>
      <div class='col pr-10'>
        <div class='text-white font-weight-very-bold font-size-16 title overflow-hidden'>
          {#if media?.mediaListEntry?.status}
            <div style:--statusColor={statusColorMap[media.mediaListEntry.status]} class='list-status-circle d-inline-flex overflow-hidden mr-5' title={media.mediaListEntry.status} />
          {/if}
          {anilistClient.title(media) || data.parseObject?.anime_title}
        </div>
        <div class='font-size-12 title overflow-hidden' class:text-muted={!isSpoiler || !['strict', 'hermit'].includes($settings.spoilers)} class:text-spoiler={isSpoiler && ['strict', 'hermit'].includes($settings.spoilers)}>
          {#if data.episodeData?.title?.en || data.episodeData?.title?.['x-jat'] || data.episodeData?.title?.ja || data.episodeData?.title?.jp}
            {data.episodeData?.title?.en || data.episodeData?.title?.['x-jat'] || data.episodeData?.title?.ja || data.episodeData?.title?.jp}
          {/if}
        </div>
      </div>
      <div class='col-auto d-flex flex-column align-items-end text-right mt-3'>
        <div class='text-white font-weight-bold'>
          {#if data.episodeRange || data.parseObject?.episodeRange}
            {`Episodes ${(data.episodeRange || data.parseObject.episodeRange).first} ~ ${(data.episodeRange || data.parseObject.episodeRange).last}`}
          {:else if data.episode != null}
            {#if episodeRange}
              Episodes {episodeRange.first} ~ {episodeRange.last}
            {:else if (!Array.isArray(data.episode))}
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
              {$timeSince}
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
  </div>
</div>

<style>
  .episode-card:hover {
    z-index: 30 !important;
    /* fixes transform scaling on click causing z-index issues */
  }
  .mt-3 {
    margin-top: 0.3rem;
  }
  .mb-100 {
    margin-bottom: 10rem !important;
  }
  .opacity-half {
    opacity: 30%;
  }
  .title {
    display: -webkit-box;
    line-clamp: 1;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    word-break: break-all;
  }
  .image:after {
    background: var(--episode-card-gradient);
    content:'';
    position:absolute;
    left:0; top:0;
    width:100%; height:100%;
  }
  .item {
    width: 36rem;
    max-width: 100%;
    margin: 0 auto;
    contain-intrinsic-height: 25.7rem;
  }
  .list-status-circle {
    background: var(--statusColor);
    height: 1.1rem;
    width: 1.1rem;
    border-radius: 50%;
  }
</style>
