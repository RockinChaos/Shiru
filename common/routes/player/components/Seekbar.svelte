<script>
  import { toTS, clamp } from '@/modules/util.js'
  import { createEventDispatcher } from 'svelte'

  /** @type {HTMLDivElement} */
  let seekbar = null
  /** @type {boolean} Whether a seek interaction is currently in progress. */
  let seeking = false
  /** @type {{ size: number, text: string }[]} Array of chapter objects with `size` (percentage width 0–100) and `text`. */
  export let chapters = []
  /** @type {number} Current playback progress as a percentage (0–100). */
  export let progress = 0
  /** @type {number} Buffered amount as a percentage (0–100). */
  export let buffer = 0
  /** @type {number} Hover/seek-preview position as a percentage (0–100). */
  export let seek = 0
  /** @type {number} Total media length in seconds. Used for timestamp preview. */
  export let length = 0
  /** @type {string} CSS color value used as the accent/progress-bar color. */
  export let accentColor = 'var(--accent-color)'
  /**
   * Optional async function for fetching seek-preview thumbnails.
   *
   * @type {((seekPercent: number) => Promise<string|null|undefined>) | null}
   * @param {number} seekPercent The hover position as a percentage (0–100).
   * @returns {Promise<string|null|undefined>} A thumbnail URL, or null/undefined if unavailable.
   */
  export let getThumbnail = null

  /** @type {string} URL of the currently displayed preview thumbnail. */
  let thumbnail = ''
  /** @type {number} Monotonically incrementing counter used to invalidate stale thumbnail fetch requests. */
  let thumbnailRequestId = 1
  /** @type {boolean} Whether a thumbnail fetch is in flight. */
  let thumbnailPending = false
  /** @type {import('svelte').EventDispatcher<{ seeking: number, seeked: number }>} */
  const dispatch = createEventDispatcher()

  $: if (getThumbnail) fetchThumbnail(seek)
  $: processedChapters = getAndProcessChapters(chapters, length)

  /**
   * Filters out negligibly small chapters, then normalizes sizes to sum to 100 %
   * and annotates each chapter with a cumulative `offset` and `scale` factor.
   *
   * @param {{ size: number, text: string }[]} chapters
   * @param {number} length Total media length in seconds (0 = unknown).
   * @returns {{ size: number, text: string, offset: number, scale: number }[]}
   */
  function getAndProcessChapters(chapters, length) {
    if (!chapters?.length) return []
    const filtered = length ? chapters.filter(chapter => (chapter.size / 100) * length >= 1) : chapters.filter((chapter, i, arr) => !(i === arr.length - 1 && chapter.size < .1))
    const total = filtered.reduce((acc, { size }) => acc + size, 0)
    if (total <= 0) return []
    let offset = 0
    return filtered.map(({ size, text }) => {
      const normalizedSize = (size / total) * 100
      const chapter = { size: normalizedSize, text, offset, scale: 100 / normalizedSize }
      offset += normalizedSize
      return chapter
    })
  }

  /**
   * Fetches a preview thumbnail for the given seek position.
   * Updates `thumbnail` only if the seek position has not changed by the time the async call resolves, preventing stale thumbnail flashes.
   *
   * @param {number} seekAtRequest The seek percentage at the time the request was made.
   */
  async function fetchThumbnail(seekAtRequest) {
    const requestId = ++thumbnailRequestId
    thumbnail = ''
    thumbnailPending = true
    try {
      const result = await getThumbnail(seekAtRequest)
      if (requestId === thumbnailRequestId) thumbnail = result || ''
    } catch (_) {
      if (requestId === thumbnailRequestId) thumbnail = ''
    } finally {
      if (requestId === thumbnailRequestId) thumbnailPending = false
    }
  }

  /**
   * Captures the pointer so drag continues outside the element and immediately updates the seek position.
   *
   * @param {PointerEvent} event The pointerdown event.
   */
  function startSeeking(event) {
    seeking = true
    updateSeekPosition(event)
    seekbar?.setPointerCapture(event.pointerId)
  }

  /**
   * Releases pointer capture and dispatches a `seeked` event with the final progress value.
   *
   * @param {PointerEvent} event The pointerup event.
   */
  function stopSeeking(event) {
    seeking = false
    seekbar?.releasePointerCapture(event.pointerId)
    dispatch('seeked', progress)
  }

  /**
   * Calculates the seek position from a pointer event and updates `seek`.
   * When `seeking` is active it also updates `progress` and dispatches a `seeking` event with the new percentage.
   *
   * @param {PointerEvent} event
   */
  function updateSeekPosition(event) {
    if (!seekbar) return
    const rect = seekbar.getBoundingClientRect()
    const percent = clamp((event.pageX - rect.left) / rect.width * 100)
    seek = percent
    if (seeking) {
      progress = percent
      dispatch('seeking', percent)
    }
  }

  /**
   * Returns `true` when the playback thumb should render in its active state (the hover position falls within the same chapter segment as the current playback position).
   *
   * @param {number} progress Current playback position as a percentage (0–100).
   * @param {number} seek Current hover position as a percentage (0–100).
   * @returns {boolean}
   */
  function isThumbActive(progress, seek) {
    for (const { offset, size } of processedChapters) {
      if (offset + size >= progress) return offset + size >= seek && offset <= seek
    }
    return false
  }

  /**
   * Returns the title of the chapter that contains the given position, or an empty string if no matching chapter is found.
   *
   * @param {number} seek Position as a percentage (0–100).
   * @returns {string} The chapter title or empty string if no title is available.
   */
  function getChapterTitleAtPosition(seek) {
    for (const { offset, size, text } of processedChapters) {
      if (offset + size >= seek && offset <= seek) return text || ''
    }
    return ''
  }
</script>

<div
    role='slider'
    tabindex='0'
    aria-label='Seek'
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(progress)}
    aria-valuetext={length ? toTS(length * (progress / 100)) : `${Math.round(progress)}%`}
    class='seekbar position-relative d-flex flex-row align-items-end h-25px w-full pointer font-size-14 text-white {$$restProps.class}'
    class:chapters={processedChapters?.length}
    bind:this={seekbar}
    on:pointerdown={startSeeking}
    on:pointerup={stopSeeking}
    on:pointermove={updateSeekPosition}
    on:pointerleave={() => { if (!seeking) seek = 0 }}
    style:--accent={accentColor}>
  {#each processedChapters as { size, offset, scale }, index (offset)}
    {@const seekPercent = clamp((seek - offset) * scale)}
    {@const isFirst = index === 0}
    {@const isLast = index === processedChapters.length - 1}
    <div style:width='{size}%' class='chapter-wrapper position-relative d-flex align-items-end overflow-hidden h-25px'>
      <div class='chapter position-absolute d-flex align-items-center w-full left-0 overflow-hidden' class:active={seekPercent > 0 && seekPercent < 100}>
        <div class='base-bar w-full' class:rounded-left={isFirst} class:rounded-right={isLast} />
        <div class='base-bar buffered' class:rounded-left={isFirst} class:rounded-right={isLast} style:width='{clamp((buffer - offset) * scale)}%' />
        <div class='base-bar hovered' class:rounded-left={isFirst} class:rounded-right={isLast} style:width='{seekPercent}%' />
        <div class='progress-bar' class:rounded-left={isFirst} class:rounded-right={isLast} style:width='{clamp((progress - offset) * scale)}%' />
      </div>
    </div>
  {:else}
    <div class='chapter-wrapper position-relative d-flex align-items-end overflow-hidden h-25px w-full'>
      <div class='chapter position-absolute d-flex align-items-center w-full left-0 overflow-hidden'>
        <div class='base-bar w-full rounded-left rounded-right' />
        <div class='base-bar buffered rounded-left rounded-right' style:width='{clamp(buffer)}%' />
        <div class='base-bar hovered rounded-left rounded-right' style:width='{clamp(seek)}%' />
        <div class='progress-bar rounded-left rounded-right' style:width='{clamp(progress)}%' />
      </div>
    </div>
  {/each}
  <div class='thumb-container position-absolute d-flex justify-content-center align-items-center pointer-events-none' style:left='{progress}%'>
    <div class='thumb position-absolute w-0 h-0 rounded-circle' class:active={isThumbActive(progress, seek)} />
  </div>
  <div class='hover-container position-absolute d-none justify-content-center align-items-center pointer-events-none text-nowrap' style:--progress='{seek}%' style:--padding={getThumbnail && thumbnail ? '11rem' : '3rem'} aria-hidden='true'>
    <div class='tooltip-inner position-absolute d-flex flex-column align-items-center'>
      <div class='font-size-16 text-break-word wm-250 text-truncate'>{getChapterTitleAtPosition(seek) || ''}</div>
      {#if getThumbnail && thumbnail}
        <img class='thumbnail w-250' src={thumbnail} alt='Preview thumbnail'/>
      {/if}
      {#if length}
        <div class='font-size-18 text-break-word wm-250 text-truncate'>{toTS(length * (seek / 100))}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .h-25px {
    height: 25px;
  }
  .seekbar {
    user-select: none;
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    gap: 2px;
  }
  .seekbar:active {
    cursor: grabbing;
  }
  .base-bar {
    background: hsla(var(--gray-color-hsl), .2);
  }
  .progress-bar {
    background-color: var(--accent);
  }

  .chapter {
    height: 10px;
  }
  .chapter div {
    height: 3px;
    position: absolute;
    transition: height .08s linear, filter .08s linear;
  }

  .seekbar:not(.chapters):hover .chapter div,
  .seekbar:not(.chapters):focus-visible .chapter div {
    height: 7px;
    filter: brightness(120%);
  }
  .chapter.active div {
    height: 7px;
    filter: brightness(120%);
  }
  .seekbar:active .chapter div {
    filter: brightness(80%);
  }

  .thumb-container {
    bottom: 5px;
  }
  .thumb {
    background: var(--accent);
    transition: width .08s linear, height .08s linear, filter .08s linear;
  }
  .seekbar:hover .thumb,
  .seekbar:active .thumb,
  .seekbar:focus-visible .thumb {
    width: 12px;
    height: 12px;
  }
  .seekbar:hover .thumb.active,
  .seekbar:active .thumb.active,
  .seekbar:focus-visible .thumb.active,
  .seekbar:not(.chapters):hover .thumb,
  .seekbar:not(.chapters):active .thumb,
  .seekbar:not(.chapters):focus-visible .thumb {
    width: 17px;
    height: 17px;
    filter: brightness(120%);
  }

  .hover-container {
    left: clamp(var(--padding), var(--progress), calc(100% - var(--padding))) !important;
    text-shadow: 0 0 4px hsla(var(--black-color-hsl), .75);
  }
  @media (pointer: fine) {
    .seekbar:hover .hover-container {
      display: flex !important;
    }
  }
  .tooltip-inner {
    gap: 3px;
    bottom: 25px;
  }
  .tooltip-inner div {
    background: hsla(var(--black-color-hsl), .45);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    padding: 0 6px;
    border-radius: 6px;
  }
  .tooltip-inner div::before {
    content: '';
    position: absolute;
    border-radius: inherit;
    background: linear-gradient(to bottom, hsla(var(--gray-color-hsl), .08), hsla(var(--gray-color-hsl), .02));
    pointer-events: none;
    inset: 0;
  }
  .tooltip-inner div:first-child {
    border-left: 2px solid var(--accent);
    padding-left: 6px;
    border-radius: 0 6px 6px 0;
  }
  .thumbnail {
    border-radius: 8px;
    border-top: 1px solid hsla(var(--gray-color-hsl), .4);
    border-left: 1px solid hsla(var(--gray-color-hsl), .15);
    border-right: 1px solid hsla(var(--gray-color-hsl), .05);
    border-bottom: 1px solid hsla(var(--black-color-hsl), .2);
    box-shadow: 0 4px 24px hsla(var(--black-color-hsl), .4);
  }
</style>