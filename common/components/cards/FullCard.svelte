<script>
  import { onMount, onDestroy } from 'svelte'
  import { airingAt, getAiringInfo, formatMap, getMediaMaxEp, statusColorMap } from '@/modules/anime/anime.js'
  import { click } from '@/modules/lib/click.js'
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import AudioLabel from '@/components/AudioLabel.svelte'
  import { anilistClient, currentYear } from '@/modules/providers/anilist/anilist.js'
  import { baseFontSize, resizeObserver } from '@/modules/util.js'
  import { mediaCache, fromCache } from '@/modules/cache.js'
  import { settings } from '@/modules/settings.js'
  import { modal } from '@/modules/navigation.js'
  import { writable } from 'simple-store-svelte'

  /** @type {import('@/modules/providers/anilist/al.d.ts').Media} */
  export let data
  export let variables = null
  const _variables = variables

  let media
  $: media = fromCache($mediaCache, media ?? mediaCache.value[data?.id])
  $: maxEp = getMediaMaxEp(media)
  $: hasSpoiler = $settings.spoilerStatus.includes(media?.mediaListEntry?.status ?? 'NOTONLIST')

  function viewMedia () {
    if (_variables?.fileEdit) _variables.fileEdit(media)
    else modal.open(modal.ANIME_DETAILS, media)
  }

  let baseWidth
  let imageWidth
  $: baseWidth = 19 * $baseFontSize
  $: scale = Math.max(imageWidth && baseWidth ? Math.min(imageWidth / baseWidth, .9) : .9, .75)
  const trackWidth = resizeObserver((_, entry) => {
    const width = entry.contentRect.width
    if (Math.abs(width - imageWidth) < 1) return
    imageWidth = width
  })

  let airingInterval
  const airingInfo = writable(null)
  onMount(() => {
    const _airingAt = media && _variables?.scheduleList && airingAt(media, _variables)
    if (_airingAt) {
      airingInfo.set(getAiringInfo(_airingAt))
      airingInterval = setInterval(() => (airingInfo.set(getAiringInfo(_airingAt))), 60_000)
      airingInterval.unref?.()
    }
  })
  onDestroy(() => clearTimeout(airingInterval))
</script>

<div class='d-flex px-md-20 px-sm-10 px-5 py-10 position-relative justify-content-center full-card-ct' use:click={viewMedia}>
  <div class='card load-in m-0 p-0 pointer full-card rounded' class:airing={$airingInfo?.episode?.match(/out for/i)} style:--color={media.coverImage?.color || 'var(--tertiary-color)'}>
    <div class='row h-full'>
      <div use:trackWidth class='img-col d-inline-block position-relative col-3 col-md-4'>
        <span class='airing-badge rounded-10 font-weight-semi-bold text-light bg-success' class:d-none={!$airingInfo?.episode?.match(/out for/i)}>AIRING</span>
        <SmartImage class='cover-img w-full h-270' color={media.coverImage?.color || 'var(--tertiary-color)'} images={[media.coverImage.extraLarge, media.coverImage?.medium, './no_image_cover.jpg']}/>
        {#if !_variables?.scheduleList}
          <AudioLabel {media} style='transform: scaleY(-1) scale({scale}) !important; transform-origin: right !important; width: {100 / scale}% !important; bottom: {.4 * scale}rem !important;' />
        {/if}
      </div>
      <div class='col h-full card-grid'>
        <div class='px-15 py-10 bg-very-dark'>
          <h5 class='m-0 text-white text-capitalize font-weight-bold title'>
            {#if media.mediaListEntry?.status}
              <div style:--statusColor={statusColorMap[media.mediaListEntry.status]} class='list-status-circle d-inline-flex overflow-hidden mr-5' title={media.mediaListEntry.status} />
            {/if}
            {anilistClient.title(media)}
          </h5>
          <div class='details text-muted m-0 pt-5 text-capitalize d-flex flex-wrap'>
              <span class='badge pl-5 pr-5'>
                {#if media.format}
                  {formatMap[media.format]}
                {/if}
              </span>
            {#if maxEp > 1 || (maxEp !== 1 && ['CURRENT', 'REPEATING', 'PAUSED', 'DROPPED'].includes(media.mediaListEntry?.status) && media.mediaListEntry?.progress)}
                <span class='badge pl-5 pr-5'>
                  {['CURRENT', 'REPEATING', 'PAUSED', 'DROPPED'].includes(media.mediaListEntry?.status) && media.mediaListEntry?.progress ? media.mediaListEntry.progress + ' / ' : ''}{maxEp && maxEp !== 0 && !(media.mediaListEntry?.progress > maxEp) ? maxEp : '?'} Episodes
                </span>
            {:else if media.duration && (!hasSpoiler || !['hermit'].includes($settings.spoilers))}
                <span class='badge pl-5 pr-5'>
                  {media.duration + ' Minutes'}
                </span>
            {/if}
            {#if media.isAdult}
                <span class='badge pl-5 pr-5'>
                  Rated 18+
                </span>
            {/if}
            {#if media.season || media.seasonYear || media.startDate?.year || media.status === 'RELEASING'}
              <span class='badge pl-5 pr-5 font-scale-14'>
                {[media.season?.toLowerCase(), (media.seasonYear || media.startDate?.year || currentYear)].filter(s => s).join(' ')}
              </span>
            {:else if media.status === 'NOT_YET_RELEASED'}
              <span class='badge pl-5 pr-5 font-scale-14'>
                Not Released
              </span>
            {/if}
            {#if media.averageScore}
              {#if (!hasSpoiler || !['strict', 'hermit'].includes($settings.spoilers))}
                <span class='badge pl-5 pr-5'>{media.averageScore + '%'} Rating</span>
              {/if}
              {#if media.stats?.scoreDistribution && (!hasSpoiler || !['moderate', 'strict', 'hermit'].includes($settings.spoilers))}
                <span class='badge pl-5 pr-5'>{anilistClient.reviews(media)} Reviews</span>
              {/if}
            {/if}
          </div>
          {#if $airingInfo}
            <div class='d-flex align-items-center pt-5 text-white'>
              {$airingInfo.episode}&nbsp;
              <span class='font-weight-bold {$airingInfo.episode.match(/out for/i) ? `text-success` : `text-light`} d-inline'>
                  {$airingInfo.time}
              </span>
            </div>
          {/if}
        </div>
        {#if media.description}
          <div class='overflow-y-auto ml-15 pr-15 pb-5 bg-very-dark card-desc pre-wrap' class:text-spoiler={hasSpoiler && ['strict', 'hermit'].includes($settings.spoilers)}>
            {media.description.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()}
          </div>
        {/if}
        {#if media.genres.length}
          <div class='px-15 pb-5 genres bg-very-dark'>
            {#each media.genres.slice(0, 3) as genre, genreIndex (genreIndex)}
              <span class='badge badge-color text-dark mt-5 mr-5 font-weight-bold'>{genre}</span>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .airing::before {
    content: '';
    position: absolute;
    inset: -0.4rem -1rem;
    border-radius: .4rem;
    pointer-events: none;
    animation: airing-pulse 7.5s infinite;
    will-change: box-shadow, opacity;
  }
  @keyframes airing-pulse {
    0%   { box-shadow: 0 0 0 0 var(--success-color); opacity: 0.9; }
    25%  { box-shadow: 0 0 0 .7rem var(--dark-color); opacity: 0.6; }
    40% { box-shadow: 0 0 0 0 var(--dark-color); opacity: 0.4; }
    100% { box-shadow: 0 0 0 0 var(--dark-color); opacity: 0; }
  }
  .airing-badge {
    position: absolute;
    top: -.3rem;
    left: -.6rem;
    font-size: 1rem;
    padding: .35rem .9rem;
    box-shadow: 0 .2rem .5rem hsla(var(--black-color-hsl), 0.2);
  }
  .title {
    display: -webkit-box !important;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.2;
    overflow: hidden
  }
  .details {
    font-size: 1.3rem;
  }
  .details > span:not(:last-child) {
    margin-right: .2rem;
    margin-bottom: .1rem;
  }
  .card {
    width: min(52rem, 88vw) !important;
    height: 27rem !important;
    box-shadow: hsla(var(--dark-color-very-light-hsl), 0.3) 0 7px 15px, hsla(var(--dark-color-very-light-hsl), 0.05) 0 4px 4px;
    contain-intrinsic-height: 27rem;
    transition: transform 0.2s ease;
  }
  .card:hover{
    transform: scale(1.03);
  }
  .card-grid {
    display: grid;
    grid-template-rows: auto 1fr auto;
  }
  .badge-color {
    background-color: var(--color) !important;
    border-color: var(--color) !important;
  }
  .list-status-circle {
    background: var(--statusColor);
    height: 1.1rem;
    width: 1.1rem;
    border-radius: 50%;
  }
</style>
