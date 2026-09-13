<script>
  import { ELECTRON, COMMON } from '@/modules/bridge.js'
  import { persisted } from 'svelte-persisted-store'
  import { SUPPORTS } from '@/modules/support.js'
  import { onMount } from 'svelte'

  export let primary = true

  const debug = persisted('debug', '', { serializer: { parse: e => e, stringify: e => e } })
  let fullScreen = false
  let scrollbarUpdateFrame
  let pendingScrollbarElements = new Set()
  let pendingScrollbarRoots = new Set()
  const scrollableSelector = '[class*="overflow"], [style*="overflow"]'
  const maxScrollbarOffsetsPerFrame = 25

  function tagScrollbarOffset(el) {
    if (!(el instanceof HTMLElement)) return
    if (el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible') {
      const offset = Math.max(0, 28 - el.getBoundingClientRect().top)
      const value = offset ? `${offset}px` : '0px'
      if (el.style.getPropertyValue('--scrollbar-title-offset') !== value) {
        el.style.setProperty('--scrollbar-title-offset', value)
      }
    }
  }

  function tagScrollbarOffsets(root = document.body) {
    tagScrollbarOffset(root)
    root.querySelectorAll('*').forEach(tagScrollbarOffset)
  }

  function collectAddedScrollbarOffsets(root, elements) {
    if (root.matches(scrollableSelector)) elements.add(root)
    root.querySelectorAll(scrollableSelector).forEach(el => elements.add(el))
  }

  function scheduleScrollbarOffsets() {
    if (scrollbarUpdateFrame) return
    scrollbarUpdateFrame = requestAnimationFrame(() => {
      scrollbarUpdateFrame = undefined
      const elements = pendingScrollbarElements
      const pendingRoots = pendingScrollbarRoots
      pendingScrollbarElements = new Set()
      pendingScrollbarRoots = new Set()
      const roots = [...pendingRoots].filter(root => {
        for (let parent = root.parentElement; parent; parent = parent.parentElement) {
          if (pendingRoots.has(parent)) return false
        }
        return root.isConnected
      })
      roots.forEach(root => collectAddedScrollbarOffsets(root, elements))

      const updates = []
      let checked = 0
      elements.forEach(el => {
        if (!el.isConnected) return
        if (checked++ >= maxScrollbarOffsetsPerFrame) {
          pendingScrollbarElements.add(el)
          return
        }
        if (!(el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible')) return
        const offset = Math.max(0, 28 - el.getBoundingClientRect().top)
        const value = offset ? `${offset}px` : '0px'
        if (el.style.getPropertyValue('--scrollbar-title-offset') !== value) updates.push([el, value])
      })
      updates.forEach(([el, value]) => el.style.setProperty('--scrollbar-title-offset', value))
      if (pendingScrollbarElements.size || pendingScrollbarRoots.size) scheduleScrollbarOffsets()
    })
  }

  function scheduleDocumentScrollbarOffsets() {
    pendingScrollbarRoots.add(document.body)
    scheduleScrollbarOffsets()
  }

  function collectScrollbarRoots(records) {
    records.forEach(({ target, addedNodes }) => {
      for (let el = target; el instanceof HTMLElement; el = el.parentElement) {
        pendingScrollbarElements.add(el)
      }
      addedNodes.forEach(node => {
        if (node instanceof HTMLElement) pendingScrollbarRoots.add(node)
      })
    })
    scheduleScrollbarOffsets()
  }

  onMount(() => {
    ELECTRON.isFullScreen().then(isFullScreen => {
      fullScreen = isFullScreen
      ELECTRON.onFullScreen((isFullScreen) => fullScreen = isFullScreen)
    })
    if (!SUPPORTS.isAndroid) {
      tagScrollbarOffsets()
      const observer = new MutationObserver(collectScrollbarRoots)
      observer.observe(document.body, { childList: true, subtree: true })
      window.addEventListener('resize', scheduleDocumentScrollbarOffsets)
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', scheduleDocumentScrollbarOffsets)
        if (scrollbarUpdateFrame) cancelAnimationFrame(scrollbarUpdateFrame)
      }
    }
  })
</script>

<div class='w-full z-101 navbar bg-transparent border-0 p-0 d-none draggable' class:d-flex={!SUPPORTS.isAndroid && !fullScreen} class:position-absolute={!primary} class:ml-sb={!SUPPORTS.isAndroid && primary && (COMMON.getPlatformInfo().platform !== 'darwin' || fullScreen)}>
  <div class='controls-container d-none position-absolute top-0 {COMMON.getPlatformInfo().platform !== `darwin` ? `right-0 ${COMMON.getPlatformInfo().platform === `win32` ? `right-width-win` : `right-width-linux`}` : `left-0 left-width`} h-full' class:mr-sb={!SUPPORTS.isAndroid && primary && COMMON.getPlatformInfo().platform !== 'darwin'} class:d-flex={!SUPPORTS.isAndroid && !fullScreen}/>
</div>
<div class='z-100 position-absolute pointer-events-none' style="inset: 0 var(--safe-area-navigation-right) auto auto; overflow: hidden; width: 18rem; height: 18rem;">
  <div class='ribbon text-center font-size-16 font-weight-bold' class:d-none={!$debug}>DEBUG</div>
</div>

<style>
  .ribbon {
    transform: translate(29.3%) rotate(45deg);
    background: var(--accent-color);
    box-shadow: 0 0 0 10rem var(--accent-color);
    clip-path: inset(0 -100%);
    opacity: 0.7;
    transform-origin: 0 0;
  }
  .draggable {
    -webkit-app-region: drag;
    color: var(--dm-text-muted-color);
    font-size: 11.2px;
    width: calc(env(titlebar-area-width, 100%) - 1px);
  }
  .navbar {
    left: unset !important;
    --navbar-height: 28px !important;
  }
  @media (pointer: none), (pointer: coarse) {
    .navbar {
      display: none !important;
      height: 0;
    }
  }
  .controls-container {
    -webkit-app-region: no-drag;
    backdrop-filter: blur(8px);
    background: rgba(24, 24, 24, 0.2);
  }
  .ml-sb {
    margin-left: var(--sidebar-width);
  }
  .mr-sb {
    margin-right: var(--sidebar-width);
  }
  .right-width-win {
    width: 137px;
  }
  .right-width-linux {
    width: 97px;
  }
  .left-width {
    width: 67px;
    border-bottom-right-radius: var(--rounded-2-border-radius);
  }
</style>