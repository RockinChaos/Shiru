<script>
  import SearchBar, { searchCleanup } from '@/routes/search/components/SearchBar.svelte'
  import { debounce, resizeObserver, mutationObserver } from '@/modules/util.js'
  import Card from '@/components/cards/Card.svelte'
  import { hasNextPage } from '@/modules/sections.js'
  import { status } from '@/modules/networking.js'
  import { onDestroy, onMount, tick } from 'svelte'
  import { writable } from 'simple-store-svelte'
  import SectionsManager from '@/modules/sections.js'
  import ErrorCard from '@/components/cards/ErrorCard.svelte'

  /** @type {any} Reactive key, changing this triggers a fresh search */
  export let key
  /** @type {import('simple-store-svelte').Writable} Search state including filters, load function, and flags */
  export let search
  /** @type {import('simple-store-svelte').Writable<boolean>} Whether to clear the search */
  export let clearNow = writable(false)

  /** @type {number} Current page index for pagination */
  let page = 0
  /** @type {boolean} Whether scroll-triggered loading is allowed */
  let canScroll = true
  /** @type {HTMLElement} The scrollable container element */
  let container = null
  /** @type {HTMLElement} The key container element */
  let keyContainer = null
  /** @type {boolean} Skips the initial resize observer fire */
  let initialResize = true
  /** @type {import('simple-store-svelte').Writable<Array>} List of loaded card data items */
  const items = writable([])
  /** @type {number} Distance from bottom (px) at which the next page load is triggered */
  const scrollThreshold = 500

  $: if ($key) $items = []
  $: $clearNow = $search.clearNow
  $: loadTillFull($key)

  /** Recalculates and applies first-in-row / last-in-row classes to all loaded cards */
  function updateRowMarkers() {
    if (!container || !keyContainer) return
    const cards = [...container.querySelectorAll('.small-card, .large-card, .episode-card')]
    const containerRect = container.getBoundingClientRect()
    const isGrid = getComputedStyle(keyContainer).display === 'grid'
    const cardPositions = cards.map(card => ({ card, top: card.getBoundingClientRect().top - containerRect.top + container.scrollTop }))
    const firstInRow = new Set()
    const lastInRow = new Set()
    let currentRow = []
    let prevTop = null
    cardPositions.forEach(({ card, top }, index) => {
      if (prevTop !== null && !sameRow(top, prevTop) && currentRow.length > 0) {
        lastInRow.add(currentRow[currentRow.length - 1])
        currentRow = []
      }
      if (prevTop === null || !sameRow(top, prevTop)) {
        firstInRow.add(card)
        currentRow.push(card)
      } else currentRow.push(card)
      prevTop = top
      if (index === cardPositions.length - 1 && currentRow.length > 0 && !(isGrid && currentRow.length === 1)) lastInRow.add(currentRow[currentRow.length - 1])
    })
    cards.forEach(card => {
      card.classList.toggle('first-in-row', firstInRow.has(card))
      card.classList.toggle('last-in-row', lastInRow.has(card))
    })
  }
  /**
   * @param {number} a First vertical position
   * @param {number} b Second vertical position
   * @returns {boolean} Whether the two positions are within 25px of each other (same row)
   */
  const sameRow = (a, b) => Math.abs(a - b) < 25
  /** Debounced updateRowMarkers for mutation observer (short delay) */
  const updateRows = debounce(updateRowMarkers, 5)
  /** Debounced updateRowMarkers for resize observer (long delay) */
  const resizeRows = debounce(updateRowMarkers, 150)

  /**
   * Loads the next page of results and appends them to items.
   * @returns {Promise|null} The last item's data promise, or null if no more pages
   */
  function loadSearchData() {
    if (!$hasNextPage) return null
    const load = $search.load || SectionsManager.createFallbackLoad()
    const nextData = load(++page, undefined, searchCleanup($search))
    $items = [...$items, ...nextData]
    return nextData[nextData.length - 1].data
  }
  /** Debounced handler for search input, triggers a fresh load by resetting the key */
  const update = debounce((event) => {
    if (!event.target.classList.contains('no-bubbles')) {
      $key = {}
    }
  }, 500)

  /**
   * Resets state and loads pages until the viewport is full.
   * @param {any} _key Current search key, used to bail out if search changes mid-load
   */
  async function fillViewport(_key) {
    if (!container) return
    const cachedKey = $key
    page = 0
    $items = []
    canScroll = false
    hasNextPage.value = true
    try {
      await loadSearchData()
      await tick()
      while ($hasNextPage && container && cachedKey === $key && container.scrollTop + container.clientHeight > container.scrollHeight - scrollThreshold) {
        await loadSearchData()
        await tick()
      }
    } finally {
      canScroll = true
    }
  }
  /** Debounced fillViewport, collapses duplicate calls from the reactive statement and onMount */
  const loadTillFull = debounce(fillViewport)

  /**
   * Scroll event handler to loads more pages when the user nears the bottom.
   * @param {any} _container Scroll event or container element
   */
  async function handleScroll(_container) {
    const cachedKey = $key
    const scrollContainer = _container?.currentTarget || _container
    if (scrollContainer && canScroll && $hasNextPage && scrollContainer.scrollTop + scrollContainer.clientHeight > scrollContainer.scrollHeight - scrollThreshold) {
      canScroll = false
      try {
        await loadSearchData()
        await tick()
        while ($hasNextPage && scrollContainer && cachedKey === $key && scrollContainer.scrollTop + scrollContainer.clientHeight > scrollContainer.scrollHeight - scrollThreshold) {
          await loadSearchData()
          await tick()
        }
      } finally {
        canScroll = true
      }
    }
  }

  /** Debounced row marker update on container resize, skipping the initial observer fire. */
  const trackResize = resizeObserver(() => {
    if (initialResize) initialResize = false
    else resizeRows()
  })

  /** Updates row markers whenever card elements are added to the container. */
  const trackMutations = mutationObserver((mutations) => {
    if (mutations.some(mutation => [...mutation.addedNodes].some(node => node.classList?.contains('small-card') || node.classList?.contains('large-card') || node.classList?.contains('episode-card')))) updateRows()
  }, { subtree: true, childList: true })

  /** Triggers initial load */
  onMount(() => loadTillFull($key))

  /** Resets search state if search was file-edit mode */
  onDestroy(() => {
    if ($search.disableSearch) $search = { format: [], format_not: [], status: [], status_not: [] }
  })
</script>

<div bind:this={container} class='bg-dark h-full w-full overflow-y-scroll d-flex flex-wrap flex-row root overflow-x-hidden justify-content-center align-content-start' class:mt-safe-area={!$search.fileEdit && $status === 'online'} class:bg-very-dark={$search.fileEdit} use:trackResize use:trackMutations on:scroll={handleScroll}>
  <SearchBar bind:search={$search} clearNow={$clearNow} on:input={update} />
  <div bind:this={keyContainer} class='w-full d-grid d-md-flex flex-wrap flex-row px-20 px-md-40 justify-content-center align-content-start pt-10'>
    {#key $key}
      {#each $items as card}
        <Card {card} variables={{...$search}} />
      {/each}
      {#if $items?.length}
        <ErrorCard promise={$items[0].data} />
      {/if}
    {/key}
  </div>
</div>

<style>
  .d-grid:has(.item.small-card) {
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)) !important;
  }
  .d-grid:has(.card.full-card) :global(.full-card) {
    width: min(52rem, 95vw) !important;
  }
  .d-grid:has(.card.full-card) {
    grid-template-columns: repeat(auto-fill, minmax(min(52rem, 95vw), 1fr)) !important;
  }
  .d-grid {
    grid-template-columns: repeat(auto-fill, minmax(36rem, 1fr));
  }
  .d-grid :global(.small-card-ct:has(.first-in-row) .absolute-container) {
    left: -50% !important;
  }
  .d-grid :global(.small-card-ct:has(.last-in-row) .absolute-container) {
    right: -50% !important;
  }
  .d-grid :global(.item.small-card) {
    max-width: 19rem !important;
  }
  @media (min-width: 769px) {
    .d-grid :global(.item.small-card) {
      width: 19rem !important;
    }
  }
  @media (max-width: 768px) {
    .d-grid :global(.small-card-ct) {
      container-type: inline-size;
    }
    .d-grid :global(.small-card-ct .absolute-container) {
      width: min(35rem, 175cqi) !important;
    }
  }
</style>