<script>
  import { getContext } from 'svelte'
  import { onMount, onDestroy } from 'svelte'
  import PreviewCard from '@/components/cards/PreviewCard.svelte'
  import { airingAt, getAiringInfo, getKitsuMappings, formatMap, statusColorMap } from '@/modules/anime/anime.js'
  import { createListener } from '@/modules/util.js'
  import { hoverClick } from '@/modules/click.js'
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import AudioLabel from '@/views/ViewAnime/AudioLabel.svelte'
  import { anilistClient, currentYear } from '@/modules/anilist.js'
  import { settings } from '@/modules/settings.js'
  import { mediaCache } from '@/modules/cache.js'
  import { CalendarDays, Tv, ThumbsUp, ThumbsDown } from 'lucide-svelte'

  /** @type {import('@/modules/al.d.ts').Media} */
  export let data
  export let type = null
  export let variables = null
  let _variables = variables

  let media
  $: if (data && !media) media = mediaCache.value[data?.id]
  mediaCache.subscribe((value) => { if (value && (JSON.stringify(value[media?.id]) !== JSON.stringify(media))) media = value[media?.id] })
  const view = getContext('view')
  function viewMedia() {
    if (_variables?.fileEdit) _variables.fileEdit(media)
    else $view = media
  }

  let preview = false
  let ignoreFocus = false
  function setHoverState(state) {
    const focused = document.activeElement
    if (container && focused?.offsetParent != null && (container.contains(focused)) && (!previewCard || !previewCard.contains(focused))) ignoreFocus = true
    if (settings.value.cardPreview) preview = state
    else if (state) viewMedia()
  }

  let container
  let previewCard
  let focusTimeout
  let blurTimeout
  function handleFocus() {
    if (ignoreFocus || preview) return
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
      const lostFocus = container && focused?.offsetParent != null && !container.contains(focused)
      const lostPreviewFocus = previewCard && !previewCard.contains(focused)
      if (lostFocus && lostPreviewFocus) {
        preview = false
        ignoreFocus = false
        document.removeEventListener('pointerup', handleOutsideClick)
      } else if (lostFocus || (previewCard && previewCard.contains(focused))) ignoreFocus = false
    })
    blurTimeout.unref?.()
  }
  function handleOutsideClick(event) {
    if (container && previewCard && !container.contains(event.target) && !previewCard.contains(event.target)) {
      preview = false
      ignoreFocus = false
      document.removeEventListener('pointerup', handleOutsideClick)
    }
  }
  function clearTimeouts() {
    clearTimeout(focusTimeout)
    clearTimeout(blurTimeout)
  }

  let airingInterval
  let _airingAt = null
  $: airingInfo = getAiringInfo(_airingAt)
  onMount(() => {
    container.addEventListener('focusout', handleBlur)
    _airingAt = media && _variables?.scheduleList && airingAt(media, _variables)
    if (_airingAt) {
      airingInterval = setInterval(() => airingInfo = getAiringInfo(_airingAt), 60_000)
      airingInterval.unref?.()
    }
  })
  onDestroy(() => {
    document.removeEventListener('pointerup', handleOutsideClick)
    container?.removeEventListener?.('focusout', handleBlur)
    clearTimeouts()
    clearTimeout(airingInterval)
  })

  const { reactive, init } = createListener(['btn', 'scoring', 'mute', 'preview-safe-area'])
  $: init(preview)
  $: if (preview) clearTimeout(focusTimeout)
</script>

<div bind:this={container} class='d-flex p-md-20 p-15 position-relative small-card-ct {$reactive ? `` : `not-reactive`}' use:hoverClick={[viewMedia, setHoverState, viewMedia]} on:focus={handleFocus}>
  {#if preview}
    <PreviewCard {media} {type} {_variables} bind:element={previewCard}/>
  {/if}
  <div class='item load-in small-card d-flex flex-column pointer {airingInfo?.episode.match(/out for/i) ? `airing` : ``}'>
    {#if airingInfo}
      <div class='w-full text-center pb-10'>
        {airingInfo.episode}&nbsp;
        <span class='font-weight-bold {airingInfo.episode.match(/out for/i) ? `text-success` : `text-light`}'>
            {airingInfo.time}
        </span>
      </div>
    {/if}
    <div class='d-inline-block position-relative'>
      <span class='airing-badge rounded-10 font-weight-semi-bold text-light bg-success' class:d-none={!airingInfo?.episode?.match(/out for/i)}>AIRING</span>
      <SmartImage class='cover-img cover-color cover-ratio w-full rounded' color={media.coverImage.color || 'var(--tertiary-color)'} images={[media.coverImage.extraLarge, media.coverImage?.medium, './404_cover.png']}/>
      {#if !_variables?.scheduleList}
        <AudioLabel {media} />
      {/if}
    </div>
    {#if type || type === 0}
      <div class='context-type d-flex align-items-center'>
        {#if Number.isInteger(type) && type >= 0}
          <ThumbsUp fill='currentColor' class='pr-5 pb-5 {type === 0 ? `text-muted` : `text-success`}' size='2rem' />
        {:else if Number.isInteger(type) && type < 0}
          <ThumbsDown fill='currentColor' class='text-danger pr-5 pb-5' size='2rem' />
        {/if}
        {(Number.isInteger(type) ? Math.abs(type).toLocaleString() + (type >= 0 ? ' like' : ' dislike') + ((type !== 1 && type !== -1) ? 's' : '') : type)}
      </div>
    {/if}
    <div class='text-white font-weight-very-bold font-size-16 title overflow-hidden' class:mb-10={type || type === 0}>
      {#if media.mediaListEntry?.status}
        <div style:--statusColor={statusColorMap[media.mediaListEntry.status]} class='list-status-circle d-inline-flex overflow-hidden mr-5' title={media.mediaListEntry.status} />
      {/if}
      {anilistClient.title(media)}
    </div>
    <div class='d-flex flex-row mt-auto font-weight-medium justify-content-between w-full text-muted'>
      <div class='d-flex align-items-center pr-5'>
        <CalendarDays class='pr-5' size='2.6rem' />
        {#await ((media.seasonYear || (media.status === 'NOT_YET_RELEASED')) && media) || getKitsuMappings(media.id) then details}
          {@const attributes = details?.included?.[0]?.attributes}
          <span class='line-height-1'>{details.seasonYear || ((media.status === 'NOT_YET_RELEASED') && 'TBA') || (attributes?.startDate && new Date(attributes?.startDate).getFullYear()) || (attributes?.createdAt && new Date(attributes?.createdAt).getFullYear()) || (media.status === 'RELEASING' && currentYear) || 'N/A'}</span>
        {/await}
      </div>
      <div class='d-flex align-items-center text-nowrap text-right'>
        <span class='line-height-1'>{formatMap[media.format]}</span>
        <Tv class='pl-5' size='2.6rem' />
      </div>
    </div>
  </div>
</div>

<style>
  .airing::before {
    content: '';
    position: absolute;
    inset: -1.3rem;
    border-radius: .4rem;
    pointer-events: none;
    animation: airing-pulse 3.5s infinite;
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
    top: -1rem;
    right: -1rem;
    font-size: 1rem;
    padding: .35rem .9rem;
    box-shadow: 0 .2rem .5rem hsla(var(--black-color-hsl), 0.2);
  }
  .small-card-ct:hover {
    z-index: 30;
    /* fixes transform scaling on click causing z-index issues */
  }
  .title {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.2;
  }
  .item {
    width: 100%;
    aspect-ratio: 152/296;
  }
  .list-status-circle {
    background: var(--statusColor);
    height: 1.1rem;
    width: 1.1rem;
    border-radius: 50%;
  }
</style>