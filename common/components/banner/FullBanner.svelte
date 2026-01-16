<script>
  import { formatMap, playMedia } from '@/modules/anime/anime.js'
  import { anilistClient } from '@/modules/anilist.js'
  import { settings } from '@/modules/settings.js'
  import { mediaCache } from '@/modules/cache.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { click, drag } from '@/modules/click.js'
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import AudioLabel from '@/views/ViewAnime/AudioLabel.svelte'
  import Scoring from '@/views/ViewAnime/Scoring.svelte'
  import { VERSION } from '@/modules/bridge.js'
  import Helper from '@/modules/helper.js'
  import { Play, Heart } from 'lucide-svelte'
  import { getContext } from 'svelte'

  export let mediaList

  let currentStatic = mediaList[0]
  $: current = mediaList[0]
  mediaCache.subscribe((value) => { if (current?.id && value && value[current?.id]?.id && (JSON.stringify(value[current?.id]) !== JSON.stringify(current))) { current = value[current?.id]; currentStatic = current } })

  const view = getContext('view')
  function viewMedia () {
    $view = current
  }

  function toggleFavourite () {
    current.isFavourite = anilistClient.favourite({ id: current.id })
  }

  function currentIndex () {
    return mediaList.findIndex(media => media?.id === currentStatic?.id)
  }

  let timeout = schedule(currentIndex() + 1)
  function schedule (index) {
    return setTimeout(() => {
      current = mediaCache.value[mediaList[index % mediaList.length]?.id] || mediaList[index % mediaList.length]
      currentStatic = current
      timeout = schedule(index + 1)
    }, 15000)
  }

  function setCurrent (media) {
    if (current?.id === media?.id) return
    clearTimeout(timeout)
    current = mediaCache.value[media?.id] || media
    currentStatic = current
    timeout = schedule(currentIndex() + 1)
  }

  function swipeMedia(deltaX) {
    if (deltaX < 0) setCurrent(mediaList[(currentIndex() + 1) % mediaList.length])
    else setCurrent(mediaList[(currentIndex() - 1 + mediaList.length) % mediaList.length])
  }
</script>

{#key currentStatic}
  <div class='position-absolute h-full w-full overflow-hidden z--1'>
    <SmartImage class={`img-cover position-absolute h-full w-full ${(!(currentStatic.bannerImage || currentStatic.trailer?.id) && settings.value.adult === 'hentai' && settings.value.hentaiBanner) ? 'banner-rotated' : ''}`} images={[currentStatic.bannerImage, ...(currentStatic.trailer?.id ? [`https://i.ytimg.com/vi/${currentStatic.trailer.id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${currentStatic.trailer.id}/hqdefault.jpg`] : []), currentStatic.coverImage?.extraLarge, './404_banner.png']}/>
  </div>
{/key}
<div class='gradient-bottom z--1 h-full position-absolute top-0 w-full' />
<div class='gradient-left z--1 h-full position-absolute top-0 w-800' />
<img src='./icon_filled.png' class='position-absolute z--1 m-10 p-0 {SUPPORTS.isAndroid || VERSION.platform === `darwin` ? `right-0 mr-20 ${!SUPPORTS.isAndroid ? `d-md-none d-sm-h-block` : ``}` : `left-0 ml-20 d-md-none d-sm-h-block`}' style='width: 4rem; height: 4rem' alt='ico' />
<div class='pl-20 pb-20 justify-content-end d-flex flex-column h-full banner mw-full grab' use:drag={swipeMedia}>
  <div class='text-white font-weight-bold font-scale-40'>
    <span class='default-cursor title overflow-hidden d-inline-block pr-5'>{anilistClient.title(currentStatic)}</span>
  </div>
  <div class='details text-white text-capitalize pt-10 pb-10 d-flex w-600 mw-full default-cursor'>
    <span class='text-nowrap d-flex align-items-center'>
      {#if currentStatic.format}
        {formatMap[currentStatic.format]}
      {/if}
    </span>
    {#if currentStatic.episodes && currentStatic.episodes !== 1}
      <span class='text-nowrap d-flex align-items-center'>
        {#if current.mediaListEntry?.status === 'CURRENT' && current.mediaListEntry?.progress }
          {current.mediaListEntry.progress} / {currentStatic.episodes} Episodes
        {:else}
          {currentStatic.episodes} Episodes
        {/if}
      </span>
    {:else if currentStatic.duration}
      <span class='text-nowrap d-flex align-items-center'>
        {currentStatic.duration + ' Minutes'}
      </span>
    {/if}
    {#if settings.value.cardAudio}
      <span class='text-nowrap d-flex align-items-center'>
        <AudioLabel bind:media={currentStatic} banner={true} />
      </span>
    {/if}
    {#if currentStatic.isAdult}
      <span class='text-nowrap d-flex align-items-center'>
        Rated 18+
      </span>
    {/if}
    {#if currentStatic.season || currentStatic.seasonYear}
      <span class='text-nowrap d-flex align-items-center'>
        {[currentStatic.season?.toLowerCase(), currentStatic.seasonYear].filter(s => s).join(' ')}
      </span>
    {/if}
  </div>
  <div class='h-100'>
    <div class='text-muted line-4 overflow-hidden w-600 mw-full default-cursor'>
      {currentStatic.description?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || ''}
    </div>
  </div>
  <div class='details text-white text-capitalize pt-15 pb-10 d-flex w-600 mw-full default-cursor'>
    {#each currentStatic.genres as genre}
      <span class='text-nowrap d-flex align-items-center'>
        {genre}
      </span>
    {/each}
  </div>
  <div class='d-flex flex-row pb-10 w-600 mw-full default-cursor'>
    <button class='btn bg-dark-light px-20 shadow-none border-0 d-flex align-items-center justify-content-center' title='Watch' use:click={() => playMedia(currentStatic)}>
      <Play class='mr-10' size='1.7rem' />
      <span>{current.mediaListEntry?.progress ? current.mediaListEntry?.status === 'COMPLETED' ? 'Rewatch Now' : 'Continue Now' : 'Watch Now'}</span>
    </button>
    <button class='btn bg-dark-light ml-10 px-20 shadow-none border-0 d-flex align-items-center justify-content-center' title='View Details' use:click={viewMedia}>
      <span>View Details</span>
    </button>
    {#if Helper.isAuthorized()}
      <Scoring media={current} />
    {/if}
    {#if Helper.isAniAuth()}
      <button class='btn bg-dark-light btn-square ml-10 d-flex align-items-center justify-content-center shadow-none border-0' data-toggle='tooltip' data-placement='top' data-target-breakpoint='md' data-title={current.isFavourite ? 'Unfavourite' : 'Favourite'} use:click={toggleFavourite} disabled={!Helper.isAniAuth()}>
        <div class='favourite d-flex align-items-center justify-content-center'>
          <Heart color={current.isFavourite ? 'var(--tertiary-color)' : 'currentColor'} fill={current.isFavourite ? 'var(--tertiary-color)' : 'transparent'} size='1.7rem' />
        </div>
      </button>
    {/if}
  </div>
  <div class='d-flex'>
    {#each mediaList as media}
      {@const active = (currentStatic?.id === media?.id)}
      {@const disabled = active || null}
      <div class='pt-10 pb-10 badge-wrapper' aria-hidden='true' {disabled} class:pointer={!active} class:default-cursor={active} use:click={() => setCurrent(media)}>
        <div class='rounded bg-dark-light mr-10 progress-badge overflow-hidden progressive' {disabled} class:active style='height: 3px;' style:width={active ? '5rem' : '2.7rem'}>
          <div class='progress-content h-full' class:bg-white={active} />
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .gradient-bottom {
    background: var(--banner-gradient-bottom);
  }
  .gradient-left {
    background: var(--banner-gradient-left);
  }
  .progress-badge {
    transition: width .8s ease;
  }
  .progress-badge.active .progress-content {
    animation: fill 15s linear;
    will-change: width;
  }

  @keyframes fill {
    from {
      width: 0;
    }
    to {
      width: 100%;
    }
  }
  .details span + span::before {
    content: '•';
    padding: 0 .5rem;
    font-size: .6rem;
    align-self: center;
    white-space: normal;
    color: var(--dm-muted-text-color) !important;
  }
  .title {
    display: inline-block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-shadow: 2px 2px 4px hsla(var(--black-color-hsl), 1);
  }
  .banner, img {
    animation: fadeIn ease .8s;
    will-change: opacity;
  }
  .default-cursor {
    cursor: default;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
