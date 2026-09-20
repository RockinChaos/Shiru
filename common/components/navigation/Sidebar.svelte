<script>
  import { goBack, goForward, canGoBack, canGoForward, drawerOpen, page } from '@/modules/navigation.js'
  import NavItem from '@/components/navigation/components/NavItem.svelte'
  import NavLink from '@/components/navigation/components/NavLink.svelte'
  import NavBar from '@/components/navigation/components/NavBar.svelte'
  import { status, previousStatus } from '@/modules/networking.js'
  import { ELECTRON, COMMON } from '@/modules/bridge.js'
  import { fadeIn, fadeOut } from '@/modules/util.js'
  import { MoveLeft, MoveRight } from 'lucide-svelte'
  import { settings } from '@/modules/settings.js'
  import { click } from '@/modules/lib/click.js'
  import { writable } from 'simple-store-svelte'
  import { onDestroy } from 'svelte'

  /** @type {import('simple-store-svelte').Writable<string[]>} */
  const drawerItems = writable([])

  /**
   * Whether a status transition animation is active
   *
   * @type {boolean}
   */
  let statusTransition = false
  /** @type {ReturnType<typeof setTimeout>} */
  let transitionTimeout
  /** @type {() => void} */
  const unsubscribeStatus = status.subscribe(value => {
    if (previousStatus.value !== value) {
      statusTransition = true
      clearTimeout(transitionTimeout)
      transitionTimeout = setTimeout(() => (statusTransition = false), 3_000)
      transitionTimeout.unref?.()
    }
  })

  /** @type {boolean} */
  let fullScreen = false
  ELECTRON.isFullScreen().then(isFullScreen => {
    fullScreen = isFullScreen
    ELECTRON.onFullScreen((isFullScreen) => (fullScreen = isFullScreen))
  })

  /** Closes the overflow drawer */
  function closeDrawer() {
    drawerOpen.set(false)
  }

  onDestroy(() => {
    clearTimeout(transitionTimeout)
    unsubscribeStatus()
  })
</script>

<div class='sidebar z-80 d-md-block' style='height: calc(100% - var(--safe-area-bottom)) !important' class:animated={$settings.expandingSidebar} class:open={$drawerOpen && $settings.expandingSidebar}>
  <div class='z--1 pointer-events-none h-full bg-dark position-absolute' style='width: var(--sidebar-width)'/>
  <div class='sidebar-overlay z--1 pointer-events-none h-full position-absolute' class:animated={$settings.expandingSidebar} />
  <div class='sidebar-menu h-full d-flex flex-column m-0 pb-5 animate' class:br-10={!$settings.expandingSidebar}>
    <div class='w-50 top-0 flex-shrink-0 pointer-events-none {$status !== 'online' ? `h-25` : `${COMMON.getPlatformInfo().platform === `darwin` && !fullScreen ? `h-25` : `h-0`}`}' class:status-transition={statusTransition}/>
    <div class='d-flex justify-content-center z-102' style='width: var(--sidebar-width); margin-top: 1rem !important'>
      <NavLink sidebar={true} center={false} click={goBack} class={`h-auto w-30 ${$canGoBack ? 'active' : ''}`} css='rounded-left-block p-0 m-0'>
        <MoveLeft size='2.5rem' class='flex-shrink-0 rounded m-0' strokeWidth='2.5' />
      </NavLink>
      <NavLink sidebar={true} center={false} click={goForward} class={`h-auto w-30 ${$canGoForward ? 'active' : ''}`} css='rounded-right-block p-0 m-0'>
        <MoveRight size='2.5rem' class='flex-shrink-0 rounded m-0' strokeWidth='2.5' />
      </NavLink>
    </div>
    <div class='d-flex flex-column align-items-center' style='width: var(--sidebar-width)'>
      <img src='./icon_filled.png' tabindex='-1' class='w-50 h-50 m-10 pointer d-sm-h-none p-5' alt='ico' use:click={() => page.navigateTo(page.HOME)} />
    </div>
    <NavBar sidebar={true} {closeDrawer} bind:drawerOpen={$drawerOpen} bind:drawerItems={$drawerItems} class='align-items-start flex-column' />
  </div>
</div>

{#if $drawerOpen}<div class='drawer-backdrop position-fixed inset-0 z-100 pointer-events-none d-none d-md-block' class:z-79={!$settings.expandingSidebar} in:fadeIn={{ y: 0, startScale: 1, duration: 200 }} out:fadeOut={{ y: 0, endScale: 1, duration: 150 }} />{/if}
<div class='drawer position-fixed left-0 bottom-0 mb-navigation-safe-area z-100 bg-very-dark d-none d-md-block' class:open={$drawerOpen} class:expanding={$settings.expandingSidebar} class:z-79={!$settings.expandingSidebar} class:bt-10={!$settings.expandingSidebar} class:br-10={!$settings.expandingSidebar} role='dialog' aria-label='More'>
  <div class='drawer-handle position-absolute pointer' tabindex='-1' class:d-none={$settings.expandingSidebar} use:click={closeDrawer} on:pointerdown={closeDrawer} />
  <div class='overflow-y-auto vh-60'>
    {#each $drawerItems as item (item)}
      <NavItem {item} sidebar={true} size='2.4rem' drawer={true} {closeDrawer} />
    {/each}
  </div>
</div>

<style>
  .sidebar {
    background: none !important;
    overflow-y: unset;
    overflow-x: visible;
    left: unset;
  }
  .sidebar.animated, .sidebar-overlay.animated {
    transition: width .8s cubic-bezier(.25, .8, .25, 1), left .8s cubic-bezier(.25, .8, .25, 1) !important;
  }
  .sidebar.animated:not(.open):hover {
    width: 22rem;
  }
  .sidebar-overlay {
    width: var(--sidebar-width);
    background: var(--sidebar-gradient);
    backdrop-filter: blur(2px);
  }
  .sidebar.animated:hover .sidebar-overlay,
  .sidebar.animated.open .sidebar-overlay {
    width: 63rem
  }

  .drawer {
    border-radius: 0 1rem 0 0;
    transform: translateX(-200%);
    transition: transform .38s cubic-bezier(.32, .72, 0, 1);
    padding: .5rem 3rem .5rem calc(var(--safe-area-left) + var(--sidebar-width) + 1rem);
  }
  .drawer.expanding {
    transform: translateY(200%);
    padding: .5rem 3rem 1rem 1rem;
    background: transparent !important;
    left: calc(var(--safe-area-left) + var(--sidebar-width)) !important;
  }
  .drawer-handle {
    width: .4rem;
    height: 3.6rem;
    border-radius: .2rem;
    right: 1rem;
    top: 50%;
    transform: translateY(-50%);
    background: var(--gray-color-very-dim);
  }
  .drawer-backdrop { background: hsla(var(--black-color-hsl), .45); }
  .drawer.expanding.open { transform: translateY(0); }
  .drawer.open { transform: translateX(0); }

  @media (min-width: 769px) {
    .sidebar::after {
      content: '';
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: var(--safe-area-left);
      background: var(--dark-color);
    }
  }
</style>
