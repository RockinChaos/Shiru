<script>
  import { page as _page, modal as _modal } from '@/modules/navigation.js'
  import { nowPlaying } from '@/components/MediaHandler.svelte'
  import { click as _click } from '@/modules/lib/click.js'
  import { settings } from '@/modules/settings.js'
  import { onMount } from 'svelte'

  /** @type {string} */
  export let css = ''
  /** @type {string} */
  export let text = ''
  /** @type {string | null} */
  export let page = null
  /** @type {string | null} */
  export let modal = null
  /** @type {boolean} */
  export let drawer = false
  /** @type {boolean} */
  export let sidebar = false
  /** @type {boolean} */
  export let center = sidebar
  /** @type {() => void} */
  export let click = () => {}
  /** @type {() => void} */
  export let altClick = () => {}

  /** @type {boolean} */
  let hovering = false
  /** @type {boolean} */
  let useHover = false

  /** @type {boolean} */
  $: expandableSidebar = sidebar && $settings.expandingSidebar
  /** @type {boolean} */
  $: active = (!modal ? ((!$_modal || !_modal.length) && $_page === page) : modal === _modal.focused && (modal !== _modal.ANIME_DETAILS || ($_modal[_modal.ANIME_DETAILS]?.data?.id === $nowPlaying?.media?.id))) || $$restProps.class?.match('active')

  onMount(() => (useHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches))
</script>

<div
    class='{$$restProps.class} d-flex flex-column align-items-center flex-shrink-0 navbar-button'
    class:mx-auto={!drawer && !sidebar}
    class:w-full={drawer || expandableSidebar}
    class:sidebar-center={!drawer && sidebar && center}>
  <div
      role='button'
      tabindex='0'
      class='nav-link nav-link-with-icon pointer flex-shrink-0 h-auto align-items-center rounded {css}'
      class:d-flex={drawer || expandableSidebar}
      class:my-5={drawer}
      class:drawer={drawer}
      class:flex-row-reverse={drawer}
      class:p-10={drawer && !$settings.showLabels}
      class:pb-0={!drawer && $settings.showLabels && !expandableSidebar}
      class:w-full={drawer || (expandableSidebar && center)}
      title={text}
      on:mouseenter={() => { if (useHover) hovering = true }}
      on:mouseleave={() => { if (useHover) hovering = false }}
      on:focus={(e) => { if (useHover && e.relatedTarget != null) hovering = true }}
      on:blur={() => { hovering = false }}
      on:pointerdown={() => { if (!useHover) hovering = false }}
      use:_click={click}
      on:contextmenu|preventDefault={altClick}>
    <span class='rounded d-flex {css}' class:inactive={!active}>
      <slot {active} {hovering}/>
    </span>
    {#if text && ((drawer && $settings.showLabels) || expandableSidebar)}
      <span class='nav-link-text d-block font-size-14 text-nowrap text-right' class:ml-20={!drawer && expandableSidebar} class:active={active}>{text}</span>
    {/if}
  </div>
  {#if text && !drawer && !expandableSidebar && $settings.showLabels}
    <span class='nav-link-text d-block font-size-12 text-nowrap' class:active={active}>{text}</span>
  {/if}
</div>

<style>
  .nav-link > span:not(.nav-link-text) {
    color: var(--highlight-color);
  }
  .nav-link:not(.drawer):active > span:not(.nav-link-text),
  .nav-link.drawer:active{
    background: var(--highlight-color);
    color: var(--dark-color);
  }
  .nav-link-text {
    color: var(--gray-color-very-dim);
  }
  .nav-link-text.active {
    color: var(--highlight-color);
  }
  @media (hover: hover) and (pointer: fine) {
    .nav-link:hover:not(.drawer) > span:not(.nav-link-text),
    .nav-link.drawer:hover {
      background: var(--highlight-color);
      color: var(--dark-color);
    }
    .nav-link.drawer:hover > span {
      color: var(--dark-color);
    }
  }
  .nav-link:focus-visible:not(.drawer) > span:not(.nav-link-text),
  .nav-link.drawer:focus-visible {
    background: var(--highlight-color);
    color: var(--dark-color);
  }
  .nav-link.drawer:focus-visible > span {
    color: var(--dark-color);
  }
  .nav-link:focus-visible:not(.nav-link-text) {
    outline: none !important;
    box-shadow: none !important;
  }
  .inactive {
    color: var(--gray-color-very-dim) !important;
  }

  .nav-link {
    font-size: 1.4rem;
    padding: .75rem;
    height: 5.5rem;
  }
  .nav-link.drawer {
    gap: 1.2rem;
    padding: 1rem;
  }
  .nav-link.drawer,
  .nav-link > span,
  .nav-link-text {
    transition: background .8s cubic-bezier(.25, .8, .25, 1), color .8s cubic-bezier(.25, .8, .25, 1), opacity .8s cubic-bezier(.25, .8, .25, 1) !important;
  }

  .sidebar-center {
    margin-left: calc((var(--sidebar-width) - 2.4rem - var(--nav-button-size)) / 2);
  }
</style>