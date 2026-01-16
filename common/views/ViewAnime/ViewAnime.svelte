<script>
  import { getContext, onDestroy } from 'svelte'
  import { formatMap, genreIcons, getEpisodeMetadataForMedia, getKitsuMappings, getMediaMaxEp, playMedia } from '@/modules/anime/anime.js'
  import { playAnime } from '@/views/TorrentSearch/TorrentModal.svelte'
  import { copyToClipboard } from '@/modules/clipboard.js'
  import { settings } from '@/modules/settings.js'
  import { mediaCache } from '@/modules/cache.js'
  import { add } from '@/modules/torrent.js'
  import { anilistClient } from '@/modules/anilist.js'
  import { click } from '@/modules/click.js'
  import Details from '@/views/ViewAnime/Details.svelte'
  import EpisodeList from '@/views/ViewAnime/EpisodeList.svelte'
  import ToggleList from '@/views/ViewAnime/ToggleList.svelte'
  import Scoring from '@/views/ViewAnime/Scoring.svelte'
  import ViewTrailer from '@/views/ViewAnime/ViewTrailer.svelte'
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import AudioLabel from '@/views/ViewAnime/AudioLabel.svelte'
  import Following from '@/views/ViewAnime/Following.svelte'
  import IPC from '@/modules/ipc.js'
  import SmallCard from '@/components/cards/SmallCard.svelte'
  import SmallCardSk from '@/components/skeletons/SmallCardSk.svelte'
  import Helper from '@/modules/helper.js'
  import { ArrowLeft, Clapperboard, Users, Heart, Play, Timer, TrendingUp, Tv, Hash, ArrowDown01, ArrowUp10 } from 'lucide-svelte'

  export let overlay
  const view = getContext('view')
  function close () {
    $view = null
    setTimeout(() => {
      if (overlay.includes('viewanime') && !$view) overlay = overlay.filter(item => item !== 'viewanime')
    })
  }

  let modal
  let container = null
  let staticMedia
  $: media = mediaCache.value[$view?.id] || $view
  $: {
    if (media && (!staticMedia || staticMedia?.id !== media?.id)) staticMedia = media
    else if (!media && staticMedia) staticMedia = null
  }
  mediaCache.subscribe((value) => { if (value && (JSON.stringify(value[media?.id]) !== JSON.stringify(media))) media = value[media?.id] })
  $: episodeOrder = !!staticMedia
  $: watched = media?.mediaListEntry?.status === 'COMPLETED'
  $: userProgress =  ['CURRENT', 'REPEATING', 'PAUSED', 'DROPPED'].includes(media?.mediaListEntry?.status) && media?.mediaListEntry?.progress
  $: missingIds = staticMedia && []
  $: recommendations = staticMedia && anilistClient.recommendations({ id: staticMedia.id })
  $: searchIDS = staticMedia && (async () => {
    const searchIDS = [...(staticMedia.relations?.edges?.filter(({ node }) => node.type === 'ANIME').map(({ node }) => node.id) || []), ...((await recommendations)?.data?.Media?.recommendations?.edges?.map(({ node }) => node.mediaRecommendation?.id) || [])]
    if (searchIDS.length === 0) {
      missingIds = searchIDS.filter(id => !mediaCache.value[id])
      return Promise.resolve([])
    }
    const result = await anilistClient.searchAllIDS({ page: 1, perPage: 50, id: searchIDS })
    missingIds = searchIDS.filter(id => !mediaCache.value[id])
    return Promise.resolve({
      ...result,
      data: {
        ...result.data,
        Page: {
          ...result.data.Page,
          media: (result?.data?.Page?.media || []).filter(media => mediaCache.value[media.id])
        }
      }
    })
  })()
  $: staticMedia && (modal?.focus(), setOverlay(), (container && container.scrollTo({top: 0, behavior: 'smooth'})))
  $: staticMedia && (overlay.length === 1 && overlay.includes('viewanime') && modal?.focus())
  $: !staticMedia && close()

  function setOverlay() {
    if (!overlay.includes('viewanime')) overlay = [...overlay, 'viewanime']
  }
  function checkClose ({ keyCode }) {
    if (keyCode === 27) close()
  }
  function play (episode) {
    if (episode || episode === 0) return playAnime(media, episode)
    if (media.status === 'NOT_YET_RELEASED') return
    playMedia(media)
  }
  function getPlayButtonText (media) {
    if (media?.mediaListEntry) {
      const { status, progress } = media.mediaListEntry
      if (progress) {
        if (status === 'COMPLETED') {
          return 'Rewatch Now'
        } else {
          return 'Continue Now'
        }
      }
    }
    return 'Watch Now'
  }
  $: playButtonText = getPlayButtonText(media)
  function toggleFavourite () {
    media.isFavourite = anilistClient.favourite({ id: media.id })
  }
  window.addEventListener('overlay-check', (event) => { if (!event?.detail?.nowPlaying && media) close() })

  function handlePlay(id, episode, torrentOnly) {
    const cachedMedia = mediaCache.value[id]
    const cachedEpisode = episode || cachedMedia?.mediaListEntry?.progress
    const desiredEpisode = (episode ? episode : cachedEpisode && cachedEpisode !== 0 ? cachedEpisode + 1 : cachedEpisode)
    if (torrentOnly) {
      if (desiredEpisode) return playAnime(cachedMedia, desiredEpisode)
      if (cachedMedia?.status === 'NOT_YET_RELEASED') return
      playMedia(cachedMedia)
    } else {
      $view = cachedMedia
      setTimeout(() => {
        play(desiredEpisode)
        IPC.emit('overlay-check')
      }, 500)
    }
  }

  IPC.on('play-anime', (id, episode, torrentOnly) => {
    handlePlay(id, episode, torrentOnly)
  })

  window.addEventListener('play-anime', (event) => {
    const { id, episode, torrentOnly } = event.detail
    handlePlay(id, episode, torrentOnly)
  })

  window.addEventListener('play-torrent', (event) => {
    add(event.detail.magnet)
    IPC.emit('overlay-check')
  })

  IPC.on('play-torrent', magnet => {
    add(magnet)
    IPC.emit('overlay-check')
  })

  let episodeList = []
  let episodeLoad
  $: if (episodeLoad) {
    episodeLoad.then(episodes => {
      episodeList = episodes
    })
  }

  let resizeObserver
  let leftColumn, rightColumn
  function syncHeights() {
    if (leftColumn && rightColumn) {
      const leftHeight = leftColumn.offsetHeight
      if (rightColumn.style.height !== `${leftHeight}px`) {
        rightColumn.style.height = `${leftHeight}px`
      }
    }
  }

  $: {
    resizeObserver?.disconnect()
    if (staticMedia) {
      resizeObserver = new ResizeObserver(syncHeights)
      if (leftColumn) resizeObserver.observe(leftColumn)
    }
  }

  onDestroy(() => resizeObserver?.disconnect())

  // Helper function to convert genre names to CSS variable format
function getGenreColor(genre) {
  const cssName = genre.toLowerCase().replace(/\s+/g, '-');
  return `var(--genre-${cssName})`;
}
</script>

<div class='modal modal-full z-50' class:show={staticMedia} on:keydown={checkClose} tabindex='-1' role='button' bind:this={modal}>
  <div class='h-full modal-content bg-dark p-0 overflow-y-auto position-relative' bind:this={container}>
    {#if staticMedia}
      <button class='close pointer z-30 bg-dark-light top-20 right-0 position-fixed' type='button' use:click={() => close()}> &times; </button>
      <SmartImage class='w-full cover-img anime-details position-absolute' images={[
        staticMedia.bannerImage,
        ...(staticMedia.trailer?.id ? [
          `https://i.ytimg.com/vi/${staticMedia.trailer.id}/maxresdefault.jpg`,
          `https://i.ytimg.com/vi/${staticMedia.trailer.id}/hqdefault.jpg`] : []),
        () => getKitsuMappings(staticMedia).then(metadata =>
          [metadata?.included?.[0]?.attributes?.coverImage?.original,
          metadata?.included?.[0]?.attributes?.coverImage?.large,
          metadata?.included?.[0]?.attributes?.coverImage?.small,
          metadata?.included?.[0]?.attributes?.coverImage?.tiny]),
        () => getEpisodeMetadataForMedia(staticMedia).then(metadata => metadata?.[1]?.image)]}/>
      <div class='row px-20'>
        <div class='col-lg-7 col-12 pb-10'>
          <div bind:this={leftColumn}>
            <div class='d-flex flex-sm-row flex-column align-items-sm-end pb-20 mb-15'>
              <div class='cover d-flex flex-row align-items-sm-end align-items-center justify-content-center mw-full mb-sm-0 mb-20 w-full' style='max-height: 50vh;'>
                <div class='position-relative h-full'>
                  <SmartImage class='rounded cover-img overflow-hidden h-full w-full' color={media.coverImage.color || 'var(--tertiary-color)'} images={[staticMedia.coverImage?.extraLarge, staticMedia.coverImage?.medium, './404_cover.png']}/>
                  <AudioLabel media={staticMedia} viewAnime={true} />
                </div>
              </div>
              <div class='pl-sm-20 ml-sm-20'>
                <h1 class='font-weight-very-bold text-white select-all mb-0 font-scale-40'>{anilistClient.title(staticMedia)}</h1>
                <div class='d-flex flex-row font-size-18 flex-wrap mt-5'>
                  {#if staticMedia.averageScore}
                    <div class='d-flex flex-row mt-10' title='{staticMedia.averageScore / 10} by {anilistClient.reviews(staticMedia)} reviews'>
                      <TrendingUp class='mx-10' size='2.2rem' />
                      <span class='mr-20'>
                        Rating: {staticMedia.averageScore + '%'}
                      </span>
                    </div>
                  {/if}
                  {#if staticMedia.format}
                    <div class='d-flex flex-row mt-10'>
                      <Tv class='mx-10' size='2.2rem' />
                      <span class='mr-20 text-capitalize'>
                        Format: {formatMap[staticMedia.format]}
                      </span>
                    </div>
                  {/if}
                  {#if staticMedia.episodes !== 1}
                    {@const maxEp = getMediaMaxEp(staticMedia)}
                    <div class='d-flex flex-row mt-10'>
                      <Clapperboard class='mx-10' size='2.2rem' />
                      <span class='mr-20'>
                      Episodes: {maxEp && maxEp !== 0 ? maxEp : '?'}
                      </span>
                    </div>
                  {:else if staticMedia.duration}
                    <div class='d-flex flex-row mt-10'>
                      <Timer class='mx-10' size='2.2rem' />
                      <span class='mr-20'>
                        Length: {staticMedia.duration + ' min'}
                      </span>
                    </div>
                  {/if}
                  {#if staticMedia.averageScore && staticMedia.stats?.scoreDistribution}
                    <div class='d-flex flex-row mt-10'>
                      <Users class='mx-10' size='2.2rem' />
                      <span class='mr-20' title='{staticMedia.averageScore / 10} by {anilistClient.reviews(staticMedia)} reviews'>
                        Reviews: {anilistClient.reviews(staticMedia)}
                      </span>
                    </div>
                  {/if}
                </div>
                <div class='d-flex flex-row flex-wrap play'>
                  <button class='btn btn-lg btn-secondary w-250 text-dark font-weight-bold shadow-none border-0 d-flex align-items-center justify-content-center mr-20 mt-20'
                          use:click={() => play()}
                          disabled={staticMedia.status === 'NOT_YET_RELEASED'}>
                    <Play class='mr-10' fill='currentColor' size='1.6rem' />
                    {playButtonText}
                  </button>
                  <div class='mt-20 d-flex'>
                    {#if Helper.isAuthorized()}
                      <Scoring class='mr-10 '{media} viewAnime={true} />
                    {/if}
                    {#if Helper.isAniAuth()}
                      <button class='btn bg-dark-light btn-lg btn-square d-flex align-items-center justify-content-center shadow-none border-0 mr-10' data-toggle='tooltip' data-placement='top' data-target-breakpoint='md' data-title={media.isFavourite ? 'Unfavourite' : 'Favourite'} use:click={toggleFavourite} disabled={!Helper.isAniAuth()}>
                        <div class='favourite d-flex align-items-center justify-content-center' title={media.isFavourite ? 'Unfavourite' : 'Favourite'}>
                          <Heart color={media.isFavourite ? 'var(--tertiary-color)' : 'currentColor'} fill={media.isFavourite ? 'var(--tertiary-color)' : 'transparent'} size='1.7rem' />
                        </div>
                      </button>
                    {/if}
                    <ViewTrailer bind:overlay {staticMedia}/>
                    <button class='btn bg-dark-light btn-lg btn-square d-none align-items-center justify-content-center shadow-none border-0 mr-10' class:d-flex={staticMedia.id} data-toggle='tooltip' data-placement='top' data-target-breakpoint='md' data-title='Share to Clipboard' use:click={() => copyToClipboard(`https://anilist.co/anime/${staticMedia.id}`, 'share URL')} on:contextmenu|preventDefault={() => IPC.emit('open', `https://anilist.co/anime/${staticMedia.id}`)}>
                      <img class='rounded w-20' src='./anilist_icon.png' alt='Anilist'>
                    </button>
                    <button class='btn bg-dark-light btn-lg btn-square d-none align-items-center justify-content-center shadow-none border-0' class:d-flex={staticMedia.idMal} data-toggle='tooltip' data-placement='top' data-target-breakpoint='md' data-title='Share to Clipboard' use:click={() => copyToClipboard(`https://myanimelist.net/anime/${staticMedia.idMal}`, 'share URL')} on:contextmenu|preventDefault={() => IPC.emit('open', `https://myanimelist.net/anime/${staticMedia.idMal}`)}>
                      <img class='rounded w-20' src='./myanimelist_icon.png' alt='MyAnimeList'>
                    </button>
                  </div>
                </div>
                <Following media={staticMedia} />
              </div>
            </div>
            <Details media={staticMedia} alt={recommendations} />
<!-- Tags Section -->
<div class="m-0 pb-0 pt-10 d-flex flex-wrap text-capitalize align-items-start">
  {#each staticMedia.tags.slice(0, 7) as tag}
    <div class="genre-tag mb-10 mr-10">
      <Hash class="mr-5" size="1.4rem" />
      {tag.name}
    </div>
  {/each}
  {#if staticMedia.tags.length > 7}
    <div class="genre-tag mb-10 mr-10 opacity-50" data-toggle="tooltip" data-placement="top" data-title={staticMedia.tags.slice(7).map((t) => t.name).join(", ")}>
      +{staticMedia.tags.length - 7} more...
    </div>
  {/if}
</div>

<!-- Genres Section -->
<div class="m-0 pb-0 pt-10 d-flex flex-wrap text-capitalize align-items-start">
  {#each staticMedia.genres as genre}
    <div class="genre-tag mb-10 mr-10 genre-colored" style="--genre-color: {getGenreColor(genre)};">
      <svelte:component this={genreIcons[genre]} class="mr-5" size="1.4rem" />
      {genre}
    </div>
  {/each}
</div>
            {#if staticMedia.description}
              <div class='w-full d-flex flex-row align-items-center pt-20 mt-10'>
                <hr class='w-full' />
                <div class='font-size-18 font-weight-semi-bold px-20 text-white'>Synopsis</div>
                <hr class='w-full' />
              </div>
              <div class='font-size-16 pre-wrap pt-20 select-all'>
                {staticMedia.description?.replace(/<[^>]*>/g, '')?.replace(/\.\.+(?=\s*$)/gm, '.') || ''}
              </div>
            {/if}
            {#if episodeList?.length}
              <div class='w-full d-flex d-lg-none flex-row align-items-center pt-20 mt-10 pointer' aria-hidden='true' use:click={() => { episodeOrder = !episodeOrder }}>
                <hr class='w-full' />
                <div class='position-absolute font-size-18 font-weight-semi-bold px-20 text-white' style='left: 50%; transform: translateX(-50%);'>Episodes</div>
                <hr class='w-full' />
                <div class='ml-auto pl-20 font-size-12 more text-muted text-nowrap pr-20' use:click={() => { episodeOrder = !episodeOrder }}>Reverse</div>
              </div>
            {/if}
            <div class='col-lg-5 col-12 d-lg-none flex-column mt-20'>
              <EpisodeList bind:episodeList={episodeList} mobileList={true} media={staticMedia} {episodeOrder} bind:userProgress bind:watched episodeCount={getMediaMaxEp(media)} {play} class='h-600' />
            </div>
            <div class='d-lg-block'>
              <ToggleList list={ staticMedia.relations?.edges?.filter(({ node, relationType }) => relationType !== 'CHARACTER' && node.type === 'ANIME' && node.format !== 'MUSIC' && !(settings.value.adult === 'none' && node.isAdult) && !(settings.value.adult !== 'hentai' && node.genres?.includes('Hentai')) && !missingIds.includes(node.id)).sort((a, b) => (a.node.seasonYear || Infinity) - (b.node.seasonYear || Infinity)) } promise={searchIDS} let:item let:promise title='Relations'>
                {#await promise}
                  <div class='small-card'>
                    <SmallCardSk />
                  </div>
                {:then res}
                  {#if res}
                    <div class='small-card'>
                      <SmallCard data={item.node} type={item.relationType.replace(/_/g, ' ').toLowerCase()} />
                    </div>
                  {/if}
                {/await}
              </ToggleList>
              {#await recommendations then res}
                {@const media = res?.data?.Media}
                {#if media}
                  <ToggleList list={ media.recommendations?.edges?.filter(({ node }) => node.mediaRecommendation && !(settings.value.adult === 'none' && node.mediaRecommendation.isAdult) && !(settings.value.adult !== 'hentai' && node.mediaRecommendation.genres?.includes('Hentai')) && !missingIds.includes(node.mediaRecommendation.id)).sort((a, b) => b.node.rating - a.node.rating) } promise={searchIDS} let:item let:promise title='Recommendations'>
                    {#await promise}
                      <div class='small-card'>
                        <SmallCardSk />
                      </div>
                    {:then res}
                      {#if res}
                        <div class='small-card'>
                          <SmallCard data={item.node.mediaRecommendation} type={item.node.rating} />
                        </div>
                      {/if}
                    {/await}
                  </ToggleList>
                {/if}
              {/await}
            </div>
          </div>
        </div>
        <div class='col-lg-5 col-12 d-none d-lg-flex flex-column pl-lg-20' bind:this={rightColumn}>
          <button class='close order pointer z-30 bg-dark-light position-absolute' class:d-none={!episodeList?.length} data-toggle='tooltip' data-placement='top' data-target-breakpoint='md' data-title='Reverse Episodes' use:click={()=> {episodeOrder = !episodeOrder}}>
            <svelte:component this={episodeOrder ? ArrowDown01 : ArrowUp10} size='2rem' />
          </button>
          <EpisodeList bind:episodeLoad={episodeLoad} media={staticMedia} {episodeOrder} bind:userProgress bind:watched episodeCount={getMediaMaxEp(media)} {play} />
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .close {
    top: 5rem !important;
    left: unset !important;
    right: 3rem !important;
  }
  .order {
    top: 7rem !important;
    left: -5rem !important;
  }
  .play {
    justify-content: center;
  }
  @media (min-width: 577px) {
    .cover {
      max-width: 35% !important;
    }
    .play {
      justify-content: left;
    }
  }
  .row {
    padding-top: 12rem !important
  }
  @media (min-width: 769px) {
    .row  {
      padding: 0 10rem;
    }
  }
  .cover {
    aspect-ratio: 7/10;
  }
</style>