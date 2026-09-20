<script>
  import NavItem from '@/components/navigation/components/NavItem.svelte'
  import NavBar from '@/components/navigation/components/NavBar.svelte'
  import { drawerOpen } from '@/modules/navigation.js'
  import { fadeIn, fadeOut } from '@/modules/util.js'
  import { click } from '@/modules/lib/click.js'
  import { writable } from 'simple-store-svelte'

  /** @type {import('simple-store-svelte').Writable<string[]>} */
  const drawerItems = writable([])

  /** Closes the overflow drawer */
  function closeDrawer() {
    drawerOpen.set(false)
  }
</script>

<nav class='navbar navbar-fixed-bottom d-block d-md-none border-bottom-0 border-left-0 border-right-0 bg-dark z-80 bt-10 mb-navigation-safe-area'>
  <div class='navbar-menu h-full d-flex flex-row justify-content-center align-items-center m-0 pb-5 animate'>
    <NavBar {closeDrawer} bind:drawerOpen={$drawerOpen} bind:drawerItems={$drawerItems} class='flex-row' />
  </div>
</nav>

{#if $drawerOpen}<div class='drawer-backdrop position-fixed inset-0 z-79 pointer-events-none d-md-none' in:fadeIn={{ y: 0, startScale: 1, duration: 200 }} out:fadeOut={{ y: 0, endScale: 1, duration: 150 }} />{/if}
<div class='drawer position-fixed right-0 bottom-0 z-79 bg-very-dark bt-10 bl-10 d-md-none' class:open={$drawerOpen} role='dialog' aria-label='More'>
  <div class='drawer-handle pointer' tabindex='-1' use:click={closeDrawer} on:pointerdown={closeDrawer} />
  <div class='overflow-y-auto vh-60 mx-15 pb-5'>
    {#each $drawerItems as item (item)}
      <NavItem {item} size='2.4rem' drawer={true} {closeDrawer} />
    {/each}
  </div>
</div>

<style>
  .navbar {
    --navbar-fixed-bottom-height: var(--bottombar-height) !important;
  }

  .drawer {
    border-radius: 1rem 0 0 0;
    transform: translateY(100%);
    transition: transform .38s cubic-bezier(.32, .72, 0, 1);
    padding: 0 .8rem calc(var(--safe-area-navigation-bottom) + 7.5rem);
  }
  .drawer-handle {
    width: 3.6rem;
    height: .4rem;
    border-radius: .2rem;
    margin: 1rem auto 1.2rem;
    background: var(--gray-color-very-dim);
  }
  .drawer-backdrop { background: hsla(var(--black-color-hsl), .45); }
  .drawer.open { transform: translateY(0); }

  @media (max-width: 768px) {
    .navbar::after {
      content: '';
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      height: var(--safe-area-navigation-bottom);
      background: var(--dark-color);
    }
  }
</style>
