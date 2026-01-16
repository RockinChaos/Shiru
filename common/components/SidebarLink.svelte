<script>
  import { onMount } from 'svelte'
  import { click } from '@/modules/click.js'
  import { SUPPORTS } from '@/modules/support.js'

  let _click = () => {}
  export { _click as click }
  export let rbClick = null
  export let image = ''
  export let page
  export let _page = ''
  export let css = ''
  export let innerCss = ''
  export let text = ''
  export let icon = ''
  export let nowPlaying = false
  export let overlay = ''

  const btnSize = !SUPPORTS.isAndroid ? '3.1rem' : '3.6rem'
  function handleOverlays() {
    if (!icon.includes('moveleft') && !icon.includes('moveright') && ((!icon.includes("login") && !icon.includes("bell") && !icon.includes("favorite")) || (!overlay && !icon.includes("favorite")))) { window.dispatchEvent(new CustomEvent('overlay-check', { detail: { nowPlaying: !overlay && nowPlaying } })) }
  }

  let hovering = false
  let supportsHover = false
  onMount(() => supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches)
</script>

<div role='button' tabindex='0' class='sidebar-link sidebar-link-with-icon pointer overflow-hidden flex-shrink-0 {css} {SUPPORTS.isAndroid ? `my-auto pl-12` : `my-sm-h-auto pl-14`}' title={text}
     on:mouseenter={() => { if (supportsHover) hovering = true }}
     on:mouseleave={() => { if (supportsHover) hovering = false }}
     on:focus={(e) => { if (e.relatedTarget != null) hovering = true }}
     on:blur={() => { hovering = false }}
     on:pointerdown={() => { if (!supportsHover) hovering = false }}
     use:click={() => { handleOverlays(); _click() } }
     on:contextmenu|preventDefault={() => { if (rbClick) { handleOverlays(); rbClick() } } }>
  <span class='text-nowrap d-flex align-items-center w-full h-full'>
    {#if image}
      <span class='rounded d-flex {innerCss}'>
        <img src={image} class='h-30 w-30 rounded' class:img-noselect={(overlay !== 'profile')} style='height: {btnSize} !important; width: {btnSize} !important' alt='logo' />
      </span>
      <span class='text ml-20' class:font-weight-bolder={overlay === 'profile'} class:font-size-16={overlay === 'profile'}>{text}</span>
    {:else}
      {@const active = (page === _page && overlay !== 'active') || overlay === 'notify' || (overlay === 'active' && nowPlaying)}
      <span class='rounded d-flex {innerCss}'>
        <slot {active} {hovering}>{icon}</slot>
      </span>
      <span class='text ml-20' class:font-weight-bolder={active} class:font-size-16={active}>{text}</span>
    {/if}
  </span>
</div>

<style>
  .img-noselect {
    opacity: 0.6;
  }

  .text {
    opacity: 1;
    transition: opacity 0.8s cubic-bezier(0.25, 0.8, 0.25, 1);
    display: inline-flex;
    justify-content: center;
    align-items: center;
  }

  .sidebar-link > span {
    color: var(--highlight-color);
    border-radius: 0.3rem;
  }

  .sidebar-link > span > span:nth-child(1) {
    color: var(--highlight-color);
    transition: background .8s cubic-bezier(0.25, 0.8, 0.25, 1), color .8s cubic-bezier(0.25, 0.8, 0.25, 1);
  }

  @media (hover: hover) and (pointer: fine) {
    .sidebar-link:hover > span > span:nth-child(1) {
      background: var(--highlight-color);
      color: var(--dark-color);
    }
  }

  .sidebar-link:active > span > span:nth-child(1) {
    background: var(--highlight-color);
    color: var(--dark-color);
  }

  .sidebar-link:focus-visible > span > span:nth-child(1) {
    background: var(--highlight-color);
    color: var(--dark-color);
  }

  .sidebar-link:focus-visible {
    outline: none !important;
    box-shadow: none !important;
  }

  .sidebar-link {
    width: 100%;
    font-size: 1.4rem;
    padding: 0.75rem;
    height: 5.5rem;
  }

  .pl-14 {
    padding-left: 1.4rem;
  }

  .pl-12 {
    padding-left: 1.2rem;
  }

  .sidebar-link img {
    font-size: 2.2rem;
    width: 3rem;
    height: 3rem;
    margin: 0.5rem;
    display: inline-flex;
    justify-content: center;
    align-items: center;
  }

  img {
    margin-right: var(--sidebar-brand-image-margin-right);
  }
</style>
