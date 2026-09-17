<script>
  import NavLink from '@/components/navigation/components/NavLink.svelte'
  import NavItem from '@/components/navigation/components/NavItem.svelte'
  import { page, modal, playPage } from '@/modules/navigation.js'
  import { nowPlaying } from '@/components/MediaHandler.svelte'
  import { updateState } from '@/modals/UpdateModal.svelte'
  import { resizeObserver } from '@/modules/util.js'
  import { settings } from '@/modules/settings.js'
  import { COMMON } from '@/modules/bridge.js'
  import { onMount, onDestroy } from 'svelte'

  /** @type {boolean} */
  export let sidebar = false
  /** @type {string[]} */
  export let drawerItems = []
  /** @type {boolean} */
  export let drawerOpen = false
  /** @type {() => void} */
  export let closeDrawer = () => {}

  /**
   * Items that belong to the bottom group of the sidebar
   *
   * @type {string[]}
   */
  const bottomGroup = ['DONATE', modal.NOTIFICATIONS, page.SETTINGS, modal.PROFILE]
  /**
   * Priority map for determining which items get pushed to the drawer first
   *
   * @type {Record<string, number>}
   */
  const PRIORITY = { [page.HOME]: 1, [page.SEARCH]: 2, [page.SCHEDULE]: 3, [modal.ANIME_DETAILS]: 4, [modal.NOTIFICATIONS]: 5, [page.TORRENT_MANAGER]: 6, [page.WATCH_TOGETHER]: 7, UPDATE_DOWNLOADING: 8, UPDATE_READY: 9, DONATE: 10, [modal.PROFILE]: 11, [page.SETTINGS]: 12 }

  /** @type {number} */
  let navbarSize = 768
  /** @type {number} */
  let itemMinSize = 56

  /**
   * All nav items in display order
   *
   * @type {string[]}
   */
  $: items = (() => {
    const base = [
      page.HOME,
      page.SEARCH,
      page.SCHEDULE,
      ...($nowPlaying?.media || ($playPage && Object.keys($nowPlaying).length > 0)) ? [modal.ANIME_DETAILS] : [],
      ...($settings.w2g || COMMON.getPlatformInfo().development) ? [page.WATCH_TOGETHER] : [],
      page.TORRENT_MANAGER,
    ]
    const append = [
      ...($updateState === 'downloading' ? ['UPDATE_DOWNLOADING'] : []),
      ...($updateState === 'ready' || $updateState === 'ignored' || $updateState === 'aborted' ? ['UPDATE_READY'] : []),
    ]
    const tail = sidebar
      ? [...($settings.donate ? ['DONATE'] : []), modal.NOTIFICATIONS, ...append, page.SETTINGS, modal.PROFILE]
      : [modal.NOTIFICATIONS, ...append, page.SETTINGS, modal.PROFILE, ...($settings.donate ? ['DONATE'] : [])]
    return [...base, ...tail]
  })()
  /**
   * Items visible in the nav bar (not overflowed to drawer)
   *
   * @type {string[]}
   */
  $: barItems = (() => {
    const prioritized = [...items].sort((a, b) => PRIORITY[a] - PRIORITY[b])
    let pad = !sidebar ? 48 : 0
    let remaining = navbarSize - pad
    if (!prioritized.some(() => { remaining -= itemMinSize; return remaining < 0 })) return items
    remaining = navbarSize - pad - itemMinSize
    const visible = new Set()
    for (const item of prioritized) {
      if (remaining >= itemMinSize) { visible.add(item); remaining -= itemMinSize }
      else break
    }
    return items.filter(item => visible.has(item))
  })()
  /** @type {string | undefined} */
  $: firstBottom = barItems.find(item => bottomGroup.includes(item))
  /** @type {string[]} */
  $: drawerItems = items.filter(item => !barItems.includes(item)).sort((a, b) => PRIORITY[b] - PRIORITY[a])
  /** @type {boolean} */
  $: drawerActive = drawerOpen || drawerItems?.some(item => Object.values(page).includes(item) ? $page === item : $modal && item === modal.focused)
  $: if (!drawerItems.length) closeDrawer()

  /**
   * Closes the drawer when clicking outside of it
   *
   * @param {PointerEvent} event
   * @returns {void}
   */
  function onPointerDown(event) {
    if (!drawerOpen) return
    if ((sidebar ? event.target.closest('.sidebar') : event.target.closest('.navbar')) || event.target.closest('.drawer')) return
    if (event.target.closest('.more-button')) return
    closeDrawer()
  }

  /**
   * Tracks the nav container size and updates the item dimensions.
   * Closes the drawer when the viewport crosses the mobile breakpoint.
   */
  const trackNavSize = resizeObserver((node, entry) => {
    navbarSize = sidebar ? entry.contentRect.height : entry.contentRect.width
    const item = node.querySelector('.navbar-button')
    if (item) itemMinSize = sidebar ? item.getBoundingClientRect().height : item.getBoundingClientRect().width
    if (!sidebar && window.innerWidth > 768) closeDrawer()
    if (sidebar && window.innerWidth < 769) closeDrawer()
  })

  onMount(() => {
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('orientationchange', closeDrawer)
  })
  onDestroy(() => {
    document.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('orientationchange', closeDrawer)
  })
</script>

<div use:trackNavSize={sidebar && !$settings.expandingSidebar && $settings.showLabels !== undefined} class='nav-items h-full w-full overflow-hidden d-flex {$$restProps.class}'>
  {#each barItems as item (item)}
    {#if sidebar && item === firstBottom}
      <div class='mt-md-h-auto' />
    {/if}
    <NavItem {item} {sidebar} size='var(--nav-button-size)' class={sidebar ? `my-sm-h-auto ${item === page.HOME ? 'mt-md-h-auto' : ''}` : ''} {closeDrawer} />
  {/each}
  {#if drawerItems.length}
    {#if sidebar && !firstBottom}
      <div class='mt-md-h-auto' />
    {/if}
    <NavLink {sidebar} click={() => drawerOpen = !drawerOpen} text='More' class={`more-button ${drawerActive ? 'active' : ''} ${sidebar ? 'my-sm-h-auto' : ''}`}>
      <div class='more-icon d-flex flex-column align-items-center justify-content-center flex-shrink-0 m-5' class:open={drawerOpen} class:active={drawerActive}>
        <span /><span /><span />
      </div>
    </NavLink>
  {/if}
</div>

<style>
  .more-icon {
    --line-width: calc(var(--nav-button-size) * .6);
    --line-height: .25rem;
    --line-gap: calc(var(--nav-button-size) * .13);
    gap: var(--line-gap);
    width: var(--nav-button-size);
    height: var(--nav-button-size);
  }
  .more-icon span {
    display: block;
    width: var(--line-width);
    height: var(--line-height);
    border-radius: .25rem;
    transform-origin: center;
    background: var(--gray-color-very-dim);
    transition: transform .25s ease, opacity .2s ease, width .2s ease;
  }
  .more-icon.open span:nth-child(1) {
    background: currentColor;
    transform: translateY(calc(var(--line-gap) + var(--line-height))) rotate(45deg);
  }
  .more-icon.open span:nth-child(2) {
    width: 0;
    opacity: 0;
  }
  .more-icon.open span:nth-child(3) {
    background: currentColor;
    transform: translateY(calc(-1 * (var(--line-gap) + var(--line-height)))) rotate(-45deg);
  }
  .more-icon.active span {
    background: var(--highlight-color);
  }
</style>