<script context='module'>
  import { readable } from 'simple-store-svelte'

  const mql = matchMedia('(min-width: 769px)')
  export const isMobile = readable(!mql.matches, set => {
    const check = ({ matches }) => set(!matches)
    mql.addEventListener('change', check)
    return () => mql.removeEventListener('change', check)
  })

  const smql = matchMedia('(min-width: 1300px)')
  export const isSuperSmall = readable(!smql.matches, set => {
    const check = ({ matches }) => set(!matches)
    smql.addEventListener('change', check)
    return () => mql.removeEventListener('change', check)
  })
</script>

<script>
  import { onMount, onDestroy } from 'svelte'
  import { cache, caches } from '@/modules/cache.js'

  export let active = false
  export let padding = '1rem'
  export let page = 'home'
  export let overlay = []
  const tmppadding = padding
  const fixedMobileWidth = 25
  let rootFontSize = 16
  let minWidth = '0rem'
  let maxWidth = '100rem'
  const maxWidthRatio = 0.4
  let widthRatio = null
  let widthPx = 0
  let width = '0rem'
  let height = '0px'
  let left = '0px'
  let top = '0px'
  let container = null
  let dragging = false
  let dragId = 1

  $: draggingPos = ''
  $: resize = !$isMobile
  $: position = cache.getEntry(caches.GENERAL, 'posMiniplayer') || 'bottom right'
  $: if (!dragging) cache.setEntry(caches.GENERAL, 'posMiniplayer', position)
  $: minWidthRatio = $isSuperSmall ? 0.25 : 0.15

  function draggable(node) {
    const initial = { x: 0, y: 0 }
    let timeout = null

    function dragStart(event) {
      clearTimeout(timeout)
      dragging = true
      padding = '0rem'
      position = ''
      const bounds = container.getBoundingClientRect()
      const relativeBounds = container.offsetParent.getBoundingClientRect() ?? { left: 0, top: 0 }
      const { pointerId, offsetX, offsetY, target } = event
      initial.x = offsetX + relativeBounds.left
      initial.y = bounds.height - (target.clientHeight - offsetY) + relativeBounds.top
      widthPx = bounds.width
      width = widthPx + 'px'
      height = bounds.height + 'px'
      handleDrag(event)
      document.body.addEventListener('touchmove', handleDrag, { passive: false })
      document.body.addEventListener('pointermove', handleDrag)
      if (pointerId) node.setPointerCapture(pointerId)
    }

    function dragEnd({ clientX, clientY, pointerId, changedTouches }) {
      document.body.removeEventListener('touchmove', handleDrag)
      document.body.removeEventListener('pointermove', handleDrag)
      dragging = false
      padding = tmppadding
      const point = changedTouches?.[0] ?? { clientX, clientY }
      const istop = window.innerHeight / 2 - point.clientY >= 0
      const isleft = window.innerWidth / 2 - point.clientX >= 0
      top = istop ? padding : `calc(100% - ${height})`
      left = isleft ? padding : `calc(100% - ${width})`
      if (pointerId) node.releasePointerCapture(pointerId)
      draggingPos = istop ? ' top' : ' bottom'
      draggingPos += isleft ? ' left' : ' right'
      dragId++
      let currentDragId = dragId
      timeout = setTimeout(() => {
        if (currentDragId === dragId) {
          position += istop ? ' top' : ' bottom'
          position += isleft ? ' left' : ' right'
          draggingPos = ''
        }
      }, 600)
    }

    function handleDrag(event) {
      event.stopPropagation()
      const { clientX, clientY, touches } = event
      const point = touches?.[0] ?? { clientX, clientY }
      left = point.clientX - initial.x + 'px'
      top = point.clientY - initial.y + 'px'
    }

    node.addEventListener('pointerdown', dragStart)
    node.addEventListener('pointerup', dragEnd)
    node.addEventListener('touchend', dragEnd, { passive: false })
    return {
      destroy() {
        node.removeEventListener('pointerdown', dragStart)
        node.removeEventListener('pointerup', dragEnd)
        node.removeEventListener('touchend', dragEnd)
      }
    }
  }

  function resizable(node) {
    let startRatio = 0
    let startX = 0

    function resizeStart({ clientX, touches, pointerId }) {
      startX = touches?.[0]?.clientX ?? clientX
      startRatio = widthRatio ?? minWidthRatio
      document.body.addEventListener('pointermove', handleResize)
      if (pointerId) node.setPointerCapture(pointerId)
    }

    function handleResize({ clientX }) {
      if (clientX == null) return
      widthRatio = startRatio + ((clientX - startX) / window.innerWidth * (position?.match(/left/i) ? 1 : -1))
      widthRatio = Math.max(minWidthRatio, Math.min(maxWidthRatio, widthRatio))
      width = `${pixelsToRem(widthRatio * window.innerWidth)}rem`
    }

    function resizeEnd({ pointerId }) {
      document.body.removeEventListener('pointermove', handleResize)
      if (pointerId) node.releasePointerCapture(pointerId)
      cacheRatio()
    }

    node.addEventListener('pointerdown', resizeStart)
    node.addEventListener('pointerup', resizeEnd)
    node.addEventListener('touchend', resizeEnd, { passive: false })
    return {
      destroy() {
        node.removeEventListener('pointerdown', resizeStart)
        node.removeEventListener('pointerup', resizeEnd)
        node.removeEventListener('touchend', resizeEnd)
      }
    }
  }

  const remToPixels = rem => rem * rootFontSize
  const pixelsToRem = pixels => pixels / rootFontSize
  function parseEntry(entry) {
    if (entry == null) return null
    if (typeof entry === 'number') {
      if (entry > 0 && entry <= 1) return { type: 'ratio', ratio: entry }
      return { type: 'px', px: entry }
    }
    const stringEntry = String(entry).trim()
    if (/^\d*\.?\d+$/.test(stringEntry)) {
      const floatEntry = parseFloat(stringEntry)
      if (floatEntry > 0 && floatEntry <= 1) return { type: 'ratio', ratio: floatEntry }
      return { type: 'px', px: floatEntry }
    }
    if (stringEntry.endsWith('px')) return { type: 'px', px: parseFloat(stringEntry) }
    if (stringEntry.endsWith('rem')) return { type: 'rem', rem: parseFloat(stringEntry) }
    if (stringEntry.endsWith('%')) return { type: 'percent', percent: parseFloat(stringEntry) }
    return null
  }

  function cacheRatio() {
    if ($isMobile) return
    if (widthRatio == null) return
    cache.setEntry(caches.GENERAL, 'widthMiniplayer', widthRatio)
  }
  async function calculateWidth() {
    await new Promise(resolve => setTimeout(resolve))
    rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    if ($isMobile) {
      width = `${fixedMobileWidth}rem`
      minWidth = `${fixedMobileWidth}rem`
      maxWidth = `${fixedMobileWidth}rem`
      return
    }
    const cachedWidth = cache.getEntry(caches.GENERAL, 'widthMiniplayer')
    if (widthRatio == null && cachedWidth != null) {
      const parsedWidth = parseEntry(cachedWidth)
      if (parsedWidth) {
        if (parsedWidth.type === 'ratio') widthRatio = parsedWidth.ratio
        else if (parsedWidth.type === 'px') widthRatio = parsedWidth.px / window.innerWidth
        else if (parsedWidth.type === 'rem') widthRatio = remToPixels(parsedWidth.rem) / window.innerWidth
        else if (parsedWidth.type === 'percent') widthRatio = parsedWidth.percent / 100
      }
    }
    if (widthRatio == null) widthRatio = minWidthRatio
    const _widthRatio = Math.max(minWidthRatio, Math.min(maxWidthRatio, widthRatio))
    if (!($isSuperSmall && widthRatio <= minWidthRatio)) widthRatio = _widthRatio
    width = `${pixelsToRem(_widthRatio * window.innerWidth)}rem`
    minWidth = `${minWidthRatio * 100}%`
    maxWidth = `${maxWidthRatio * 100}%`
    cacheRatio()
  }

  onMount(() => {
    calculateWidth()
    window.addEventListener('resize', calculateWidth)
  })
  onDestroy(() => window.removeEventListener('resize', calculateWidth))
</script>

<div class='miniplayer-container {active && (position.match(/top/i) || draggingPos.match(/top/i)) ? page === `settings` && !overlay?.length ? `mt-100 mt-lg-20` : `mt-20` : ``} {active && (position.match(/left/i) || draggingPos.match(/left/i)) && page === `settings` && !overlay?.length ? `ml-lg-280` : ``} {position} {$$restProps.class}' class:active class:animate={!dragging} class:custompos={!position}
     style:--left={left} style:--top={top} style:--height={height} style:--width={width} style:--padding={padding} style:--maxwidth={maxWidth} style:--minwidth={minWidth}
     role='group' bind:this={container} on:dragstart|preventDefault|self>
  <div class='resize resize-{position ? (position.match(/top/i) ? `b` : `t`) + (position.match(/left/i) ? `r` : `l`) : `tl`}' class:d-none={!resize || !active} use:resizable />
  <slot />
  <div class='miniplayer-footer touch-none' class:dragging use:draggable tabindex='-1'>::::</div>
  <div class='h-20 w-full position-absolute'/>
</div>

<style>
  .resize {
    background: transparent;
    position: absolute;
    user-select: none;
    width: 1.5rem;
    height: 1.5rem;
    z-index: 100;
  }
  .resize-tl {
    top: 0;
    left: 0;
    cursor: nw-resize;
  }
  .resize-tr {
    top: 0;
    right: 0;
    cursor: sw-resize;
  }
  .resize-bl {
    bottom: 0;
    left: 0;
    margin-bottom: 2.2rem;
    cursor: sw-resize;
  }
  .resize-br {
    bottom: 0;
    right: 0;
    margin-bottom: 2.2rem;
    cursor: nw-resize;
  }
  .active {
    position: absolute;
    width: clamp(var(--minwidth), var(--width), var(--maxwidth)) !important
  }
  .active.custompos {
    top: clamp(var(--padding), var(--top), 100% - var(--height) - var(--padding)) !important;
    left: clamp(var(--padding), var(--left), 100% - var(--width) - var(--padding)) !important;
    height: var(--height) !important;
  }
  .active.top {
    top: var(--padding) !important
  }
  .active.bottom {
    bottom: var(--padding) !important
  }
  .active.left {
    left: var(--padding) !important
  }
  .active.right {
    right: var(--padding) !important
  }
  .animate {
    transition-duration: 0.5s;
    transition-property: top, left;
    transition-timing-function: cubic-bezier(0.3, 1.5, 0.8, 1);
  }
  .miniplayer-footer {
    display: none;
    letter-spacing: .15rem;
    cursor: grab;
    font-weight: 600;
    user-select: none;
    padding-bottom: .2rem;
    text-align: center;
  }
  .miniplayer-border {
    box-shadow: 0 0 0.2rem 0.05rem var(--dark-color-very-light) !important;
  }
  .dragging {
    cursor: grabbing !important;
  }
  .active > .miniplayer-footer {
    display: block !important;
  }
</style>