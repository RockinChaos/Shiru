<script>
  import { onMount } from 'svelte'
  import { click } from '@/modules/click.js'

  let _click = () => {}
  export { _click as click }
  export let rbClick = null
  export let page
  export let _page = ''
  export let css = ''
  export let text = ''
  export let icon = ''
  export let nowPlaying = false
  export let overlay = ''
  function handleOverlays() {
    if ((!icon.includes("login") && !icon.includes("bell") && !icon.includes("favorite")) || (!overlay && !icon.includes("favorite"))) { window.dispatchEvent(new CustomEvent('overlay-check', { detail: { nowPlaying: !overlay && nowPlaying } })) }
  }

  let hovering = false
  let supportsHover = false
  onMount(() => supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches)
</script>

<div role='button' tabindex='0' class='navbar-link navbar-link-with-icon pointer overflow-hidden mx-auto flex-shrink-0 {css}' title={text}
     on:mouseenter={() => { if (supportsHover) hovering = true }}
     on:mouseleave={() => { if (supportsHover) hovering = false }}
     on:focus={(e) => { if (e.relatedTarget != null) hovering = true }}
     on:blur={() => { hovering = false }}
     on:pointerdown={() => { if (!supportsHover) hovering = false }}
     use:click={() => { handleOverlays(); _click() } }
     on:contextmenu|preventDefault={() => { if (rbClick) { handleOverlays(); rbClick() } } }>
  <span class='rounded d-flex'>
    <slot active={(page === _page && overlay !== 'active') || (overlay === 'active' && nowPlaying)} {hovering}>{icon}</slot>
  </span>
</div>

<style>
  .navbar-link > span {
    color: var(--highlight-color);
    border-radius: 0.3rem;
  }

  .navbar-link > span {
    color: var(--highlight-color);
    transition: background .8s cubic-bezier(0.25, 0.8, 0.25, 1), color .8s cubic-bezier(0.25, 0.8, 0.25, 1);
  }

  .navbar-link:active > span {
    background: var(--highlight-color);
    color: var(--dark-color);
  }

  @media (hover: hover) and (pointer: fine) {
    .navbar-link:hover > span {
      background: var(--highlight-color);
      color: var(--dark-color);
    }
  }

  .navbar-link:focus-visible > span {
    background: var(--highlight-color);
    color: var(--dark-color);
  }

  .navbar-link:focus-visible {
    outline: none !important;
    box-shadow: none !important;
  }

  .navbar-link {
    font-size: 1.4rem;
    padding: 0.75rem;
    height: 5.5rem;
  }
</style>
