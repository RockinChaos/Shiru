<script context='module'>
  const defaultLength = 15
  const overflowLength = 1
  const loadableLength = 50
  const fakecards = Array.from({ length: loadableLength }, () => ({ data: new Promise(() => {}) }))
</script>

<script>
  import Card from '@/components/cards/Card.svelte'
  import ErrorCard from '@/components/cards/ErrorCard.svelte'
  import { page } from '@/modules/navigation.js'
  import { search } from '@/modules/sections.js'
  import { click, dragScroll } from '@/modules/lib/click.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { settings } from '@/modules/settings.js'
  import { resizeObserver, baseFontSize } from '@/modules/util.js'
  import { onMount, onDestroy } from 'svelte'
  import { ChevronLeft, ChevronRight } from 'lucide-svelte'

  export let lastEpisode = false
  export let index = 0
  export let opts

  const preview = opts.preview
  const containerWidth = window.innerWidth / baseFontSize.value
  const cardWidthMap = {
    small: 19 + 5,
    full: Math.min(52, containerWidth * .88) + 5,
    episode: 36 + 5
  }
  const cardWidth = cardWidthMap[opts.isRSS ? 'episode' : ($settings.cards || 'small')] || cardWidthMap.small
  let previewLength = Math.floor(containerWidth / cardWidth) + overflowLength || defaultLength
  let sectionVisible = index < 5
  let visibleLength = 0

  function deferredLoad (element) {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        sectionVisible = true
        if (!opts.preview.value) opts.preview.value = opts.load(1, loadableLength, { ...opts.variables }, true)
        observer.unobserve(element)
      }
    }, { threshold: 0, rootMargin: '200px' })
    observer.observe(element)
    return { destroy () { observer.unobserve(element) } }
  }

  function _click () {
    $search = { ...opts.variables, load: opts.load, title: opts.title, clearNext: true }
    page.navigateTo(page.SEARCH)
  }

  let activeScroll = false
  function scrolling(duration = 1000) {
    activeScroll = true
    setTimeout(() => activeScroll = false, duration)
  }

  let scrollContainer
  function scrollCarousel(direction) {
    if (activeScroll) return
    if (direction === 'right' && (scrollContainer.scrollLeft + 2) >= (scrollContainer.scrollWidth - scrollContainer.clientWidth)) {
      scrolling()
      scrollContainer.scrollTo({ left: 0, behavior: 'smooth' })
    } else if (direction === 'left' && scrollContainer.scrollLeft <= 0) {
      visibleLength = loadableLength
      setTimeout(() => {
        scrolling()
        scrollContainer.scrollTo({ left: (scrollContainer.scrollWidth - scrollContainer.clientWidth), behavior: 'smooth' })
      })
    } else {
      visibleLength = Math.min((visibleLength || previewLength) + previewLength, loadableLength)
      setTimeout(() => {
        scrolling(500)
        const scrollAmount = scrollContainer.offsetWidth
        scrollContainer.scrollBy({ left: direction === 'right' ? scrollAmount : -scrollAmount, behavior: 'smooth' })
      })
    }
  }

  function handleScroll() {
    if (scrollContainer && ((scrollContainer.scrollWidth - scrollContainer.clientWidth) - scrollContainer.scrollLeft < 100)) {
      visibleLength = Math.min((visibleLength || previewLength) + overflowLength, loadableLength)
    }
  }

  let timeout
  const trackSectionWidth = resizeObserver((node) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      const cardItem = node.querySelectorAll('.small-card-ct, .full-card-ct, .episode-card')
      if (cardItem) previewLength = (Math.floor(node.offsetWidth / cardItem.offsetWidth) || defaultLength) + overflowLength
    }, 15)
  })

  onMount(() => {
    scrollContainer.addEventListener('scroll', handleScroll)
  })
  onDestroy(() => {
    scrollContainer.removeEventListener('scroll', handleScroll)
  })
</script>

<span class='section-header position-relative d-flex px-20 align-items-end text-decoration-none' class:mv-10={lastEpisode} use:deferredLoad>
  <div class='font-scale-24 font-weight-semi-bold glow text-muted pointer' aria-hidden='true' use:click={_click}>{opts.title}</div>
  <div class='ml-auto pr-5 pl-5 font-size-12 glow text-muted pointer btn d-none align-items-center justify-content-center' class:d-flex={!SUPPORTS.isAndroid} aria-hidden='true' use:click={() => scrollCarousel('left')}><ChevronLeft strokeWidth='3' size='2rem' /></div>
  <div class='pr-5 pl-5 ml-10 font-size-12 glow text-muted pointer btn d-none align-items-center justify-content-center' class:d-flex={!SUPPORTS.isAndroid} aria-hidden='true' use:click={() => scrollCarousel('right')}><ChevronRight strokeWidth='3' size='2rem' /></div>
</span>
<div class='position-relative' class:isRSS={opts.isRSS}>
  <div class='pb-10 w-full d-flex flex-row justify-content-start gallery {!opts.isRSS ? `pl-15 pl-sm-10 pl-md-0` : ``}' class:pt-10={!opts.isRSS && $settings.cards === `full`} use:dragScroll use:trackSectionWidth bind:this={scrollContainer}>
    <Card card={($preview || fakecards)[0]} variables={{...opts.variables, section: true}} />
    {#if sectionVisible}
      {#each ($preview || fakecards).slice(1, visibleLength || previewLength) as card}
        <Card {card} variables={{...opts.variables, section: true}} />
      {/each}
    {/if}
    {#if $preview?.length}
      <ErrorCard promise={$preview[0].data} class='{opts.isRSS ? `mb-90` : ``}' />
    {/if}
  </div>
</div>

<style>
  .btn {
    border-radius: 2rem;
  }
  .gallery :global(.small-card-ct:first-child) :global(.absolute-container) {
    left: -45% !important;
  }
  .gallery :global(.small-card-ct:last-child):not(:only-child) :global(.absolute-container) {
    right: -45% !important;
  }

  @media (max-width: 768px) {
    .gallery :global(.small-card-ct:first-child) :global(.absolute-container) {
      left: -35% !important;
    }
    .gallery :global(.small-card-ct:last-child:not(:only-child)) :global(.absolute-container) {
      right: -35% !important;
    }
  }
  @media (hover: hover) and (pointer: fine) {
    .glow:hover {
      color: var(--dm-link-text-color-hover) !important;
    }
  }
  .position-relative.isRSS .gallery::before,
  .position-relative.isRSS .gallery::after {
    height: calc(100% - 10rem) !important;
  }
  .gallery::before,
  .gallery::after {
    content: '';
    position: absolute;
    right: 0;
    height: 100%;
    width: 2rem;
    z-index: 32;
    background: var(--section-end-gradient);
    pointer-events: none;
  }
  .gallery::before {
    left: -1px;
    transform: scaleX(-1);
  }
  .section-header::before,
  .section-header::after {
    content: '';
    position: absolute;
    right: 0;
    height: 100%;
    width: 2rem;
    z-index: 32;
    background: var(--section-end-gradient);
    pointer-events: none;
  }
  .section-header::before {
    left: -1px;
    transform: scaleX(-1);
  }
  .gallery {
    overflow-x: scroll;
    flex-shrink: 0;
    min-height: 25rem;
    cursor: grab;
  }
  .gallery :global(.item.small-card) {
    width: 19rem !important;
  }
  .gallery::-webkit-scrollbar {
    display: none;
  }
  .mv-10 {
    margin-top: -10rem !important;
  }
</style>