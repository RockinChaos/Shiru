<script>
  import { resizeObserver } from '@/modules/util.js'
  import { settings } from '@/modules/settings.js'
  import { click } from '@/modules/lib/click.js'
  import ToggleTitle from '@/modals/details/components/ToggleTitle.svelte'
  import ToggleFooter from '@/modals/details/components/ToggleFooter.svelte'

  export let title
  export let promise
  export let list

  let showMore = false
  function toggleList() {
    showMore = !showMore
  }

  let previewLength = 4
  function updateRowLength(node) {
    if (!settings.value.toggleList) return
    const firstItem = node.querySelector('.small-card')
    if (firstItem) previewLength = Math.floor(node.offsetWidth / firstItem.offsetWidth) || 1
  }

  function updateRowMarkers(node) {
    const cards = Array.from(node.querySelectorAll('.small-card'))
    cards.forEach(card => card.classList.remove('first-in-row', 'last-in-row'))
    if (!settings.value.toggleList) {
      if (cards.length > 0) {
        cards[0].classList.add('first-in-row')
        cards[cards.length > 1 ? cards.length - 2 : 0].classList.add('last-in-row')
      }
    } else {
      const rows = new Map()
      cards.forEach(card => {
        const top = Math.round(card.getBoundingClientRect().top)
        if (!rows.has(top)) rows.set(top, [])
        rows.get(top).push(card)
      })
      rows.forEach(cardsInRow => {
        if (cardsInRow.length > 0) {
          cardsInRow[0].classList.add('first-in-row')
          cardsInRow[cardsInRow.length - 1].classList.add('last-in-row')
        }
      })
    }
  }

  const trackLayout = resizeObserver((node) => {
    updateRowLength(node)
    updateRowMarkers(node)
  })
</script>

{#if list?.length}
  {@const canToggle = settings.value.toggleList && list.length > previewLength}
  {@const isScrollable = !settings.value.toggleList && list.length > 2}
  <span class='d-flex align-items-end mt-20' aria-hidden='true' tabindex='-1' class:pointer={canToggle} class:not-reactive={!canToggle} use:click={toggleList}>
    <ToggleTitle title={title} class={canToggle ? `more` : ``}/>
  </span>
  <div class:position-relative={isScrollable} class:scrollable={isScrollable}>
    <div class='pt-10 text-capitalize d-flex gallery'
         class:justify-content-center={list.length <= 2 || settings.value.toggleList}
         class:justify-content-start={isScrollable}
         class:scroll={isScrollable}
         class:flex-row={!settings.value.toggleList}
         class:flex-wrap={settings.value.toggleList}
         use:trackLayout>
      {#each !settings.value.toggleList ? list : (showMore ? list : list.slice(0, previewLength)) as item}
        <slot {item} {promise} />
      {/each}
    </div>
  </div>
  <ToggleFooter {showMore} {toggleList} size={settings.value.toggleList && list.length} rowSize={previewLength} />
{/if}

<style>
  .scrollable::before,
  .scrollable::after {
    content: '';
    position: absolute;
    right: 0;
    height: 100%;
    width: 2rem;
    z-index: 32;
    background: var(--details-section-end-gradient);
    pointer-events: none;
  }
  .scrollable::before {
    left: -1px;
    transform: scaleX(-1);
  }
  .scroll {
    overflow-x: scroll;
    flex-shrink: 0;
    scroll-behavior: smooth;
  }
  .scroll::-webkit-scrollbar {
    display: none;
  }

  .gallery :global(.first-in-row .small-card-ct .absolute-container) {
    left: -48% !important;
  }
  .gallery :global(.last-in-row .small-card-ct .absolute-container) {
    right: -48% !important;
  }
  .gallery :global(.item.small-card) {
    width: 19rem !important;
  }
  .gallery :global(.small-card-ct) {
    height: 100% !important;
  }
</style>