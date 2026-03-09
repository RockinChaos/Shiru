<script context='module'>
  import { readable } from 'simple-store-svelte'

  const mql = matchMedia('(min-width: 769px)')
  const isMobile = readable(!mql.matches, set => {
    const check = ({ matches }) => set(!matches)
    mql.addEventListener('change', check)
    return () => mql.removeEventListener('change', check)
  })

  const smql = matchMedia('(min-width: 1300px)')
  const isSuperSmall = readable(!smql.matches, set => {
    const check = ({ matches }) => set(!matches)
    smql.addEventListener('change', check)
    return () => mql.removeEventListener('change', check)
  })

  const lgmql = matchMedia('(min-width: 993px)')
  const isLg = readable(lgmql.matches, set => {
    const check = ({ matches }) => set(matches)
    lgmql.addEventListener('change', check)
    return () => lgmql.removeEventListener('change', check)
  })
</script>

<script>
  import { onMount, onDestroy } from 'svelte'
  import { cache, caches } from '@/modules/cache.js'
  import { page, modal } from '@/modules/navigation.js'
  import { settings } from '@/modules/settings.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { click } from '@/modules/click.js'

  export let playbackPaused = true
  export let active = false
  export let shelved = false

  let padding = '2rem'
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
  let resizing = false
  let dragId = 1
  let shelveLeft = false
  let touchShelveTime = 0
  let hovered = false
  let bounceId = 1
  let bouncing = false
  let peekActive = false
  let idleTimeout = null
  let shelveTimeout = null
  let shelvingTime = 0
  let lastEdgeEnterUnshelve = 0
  let windowFocused = document.hasFocus()

  $: draggingPos = ''
  $: resize = !$isMobile
  $: position = cache.getEntry(caches.GENERAL, 'posMiniplayer') || 'bottom right'
  $: if (!dragging) cache.setEntry(caches.GENERAL, 'posMiniplayer', position)
  $: minWidthRatio = $isSuperSmall ? 0.25 : 0.15
  $: playerPage = $page === page.PLAYER && (!$modal || !modal.length || !modal.exists(modal.ANIME_DETAILS))
  $: shelveTabLeft = shelved ? shelveLeft : !!(position + draggingPos).match(/left/i)
  $: {
    if (active && !dragging && !resizing) idleShelve(playbackPaused, $settings.autoHideMiniplayer)
    else if (shelved && playerPage && (!$modal || !modal.length)) unshelve()
  }
  $: paddingTop = (() => {
    if (!active || (!position.match(/top/i) && !draggingPos.match(/top/i))) return padding
    if ($page === page.SETTINGS && (!$modal || !modal.length)) return $isLg ? SUPPORTS.isAndroid ? padding : '4rem' : SUPPORTS.isAndroid ? '9rem' : '13rem'
    return SUPPORTS.isAndroid ? padding : '4rem'
  })()
  $: paddingLeft = (() => {
    if (!active || (!position.match(/left/i) && !draggingPos.match(/left/i))) return padding
    if ($page === page.SETTINGS && (!$modal || !modal.length) && $isLg) return '32rem'
    return padding
  })()

  function draggable(node) {
    const initial = { x: 0, y: 0 }
    let timeout = null
    let clampedLeft = 0

    function dragStart(event) {
      clearTimeout(timeout)
      dragging = true
      touchShelveTime = 0
      padding = '0rem'
      position = ''
      if (paddingLeft === '32rem') clampedLeft = remToPixels(parseFloat('30'))
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
      unshelve()
    }

    function dragEnd({ clientX, clientY, pointerId, changedTouches }) {
      document.body.removeEventListener('touchmove', handleDrag)
      document.body.removeEventListener('pointermove', handleDrag)
      clampedLeft = 0
      dragging = false
      touchShelveTime = 0
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
      left = Math.max(clampedLeft, point.clientX - initial.x) + 'px'
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
      resizing = true
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
      resizing = false
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

  function idleShelve(isPaused, autoHide) {
    clearTimeout(shelveTimeout)
    if (isPaused && !hovered && autoHide) {
      shelveTimeout = setTimeout(() => {
        if (playbackPaused && !hovered && active && !dragging && !resizing) triggerShelve()
      }, 5_000)
    } else if (!isPaused) unshelve()
  }
  function triggerShelve() {
    const posStr = position + draggingPos
    shelveLeft = !!(posStr.match(/left/i))
    shelved = true
    shelvingTime = Date.now()
    resetIdleBounce()
  }
  function unshelve() {
    shelved = false
    bouncing = false
    bounceId++
    clearTimeout(shelveTimeout)
    clearTimeout(idleTimeout)
  }
  function manualShelve() {
    if (!active || !playbackPaused) return
    clearTimeout(shelveTimeout)
    triggerShelve()
  }

  function handleEdgeEnter() {
    if (!windowFocused) return
    hovered = true
    const now = Date.now()
    if (shelved && settings.value.autoHideMiniplayer && (!shelvingTime || (now - shelvingTime > 400))) {
      if (peekActive) cancelBounce()
      unshelve()
      lastEdgeEnterUnshelve = now
    }
    clearTimeout(shelveTimeout)
  }
  function handleEdgeLeave() {
    hovered = false
    if (playbackPaused && active && !dragging && !resizing && settings.value.autoHideMiniplayer) {
      clearTimeout(shelveTimeout)
      shelveTimeout = setTimeout(() => {
        if (playbackPaused && !hovered && active && !dragging && !resizing) triggerShelve()
      }, 3_000)
    }
  }
  function handleShelfTap() {
    if (Date.now() - lastEdgeEnterUnshelve < 300) return
    if (shelved) {
      unshelve()
      hovered = true
      setTimeout(() => hovered = false, 3_000)
    } else manualShelve()
  }
  function swipeShelve(node) {
    let startX = 0
    let startY = 0

    function onTouchStart(event) {
      if (dragging) return
      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      touchShelveTime = Date.now()
    }

    function onTouchEnd(event) {
      if (dragging) return
      const touch = event.changedTouches[0]
      const dx = touch.clientX - startX
      if ((Date.now() - touchShelveTime) > 400) return
      if (Math.abs(dx) < 10) return
      if (Math.abs(touch.clientY - startY) > Math.abs(dx)) return
      const swipedRight = dx > 0
      const posStr = position + draggingPos
      if (!shelved) {
        if (!playbackPaused) return
        const shelveToRight = !posStr.match(/left/i) && swipedRight
        const shelveToLeft = posStr.match(/left/i) && !swipedRight
        if (shelveToRight || shelveToLeft) triggerShelve()
      } else if (shelved && ((shelveLeft && swipedRight) || (!shelveLeft && !swipedRight))) unshelve()
    }

    node.addEventListener('touchstart', onTouchStart, { passive: true })
    node.addEventListener('touchend', onTouchEnd, { passive: true })
    return {
      destroy() {
        node.removeEventListener('touchstart', onTouchStart)
        node.removeEventListener('touchend', onTouchEnd)
      }
    }
  }

  function resetIdleBounce() {
    clearTimeout(idleTimeout)
    if (!shelved) return
    idleTimeout = setTimeout(() => {
      if (!shelved || hovered) return
      triggerBounce()
    }, 15_000)
  }
  function triggerBounce() {
    const _bounceId = ++bounceId
    peekActive = true
    bouncing = true
    setTimeout(() => {
      if (bounceId !== _bounceId) return
      bouncing = false
      peekActive = false
      resetIdleBounce()
    }, 1_200)
  }
  function cancelBounce() {
    if (!container) return
    bounceId++
    bouncing = false
    peekActive = false
    container.style.transform = `translateX(${(new DOMMatrix(window.getComputedStyle(container).transform)).m41}px)`
    requestAnimationFrame(() => container.style.transform = '')
    resetIdleBounce()
  }
  function onGlobalActivity() {
    if (!shelved) return
    if (peekActive) {
      cancelBounce()
    } else resetIdleBounce()
  }

  const onFocus = () => requestAnimationFrame(() => windowFocused = true)
  const onBlur = () => windowFocused = false
  onMount(() => {
    calculateWidth()
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    window.addEventListener('resize', calculateWidth)
    document.addEventListener('wheel', onGlobalActivity, { passive: true })
    document.addEventListener('mousemove', onGlobalActivity, { passive: true })
    document.addEventListener('touchstart', onGlobalActivity, { passive: true })
    document.addEventListener('keydown', onGlobalActivity, { passive: true })
  })
  onDestroy(() => {
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('resize', calculateWidth)
    document.removeEventListener('wheel', onGlobalActivity)
    document.removeEventListener('mousemove', onGlobalActivity)
    document.removeEventListener('touchstart', onGlobalActivity)
    document.removeEventListener('keydown', onGlobalActivity)
    clearTimeout(shelveTimeout)
    clearTimeout(idleTimeout)
  })
</script>

<div
  class='miniplayer-container z-55 {position} {$$restProps.class}'
  class:active
  class:animate={!dragging && !shelved}
  class:custompos={!position}
  class:shelved
  class:shelved-left={shelved && shelveLeft}
  class:shelved-right={shelved && !shelveLeft}
  class:miniplayer-border={!shelved}
  class:player-page={playerPage}
  class:bouncing
  style:--left={left}
  style:--top={top}
  style:--height={height}
  style:--width={width}
  style:--padding-top={paddingTop}
  style:--padding-left={paddingLeft}
  style:--padding-bottom={padding}
  style:--padding-right={padding}
  style:--maxwidth={maxWidth}
  style:--minwidth={minWidth}
  class:z-5={$page === page.SETTINGS && !dragging && (!$modal || !modal.length)}
  role='group'
  bind:this={container}
  use:swipeShelve
  on:dragstart|preventDefault|self
  on:mouseenter={handleEdgeEnter}
  on:mouseleave={handleEdgeLeave}
  on:focusout={event => { if (!container.contains(event.relatedTarget)) handleEdgeLeave() }}>
  {#if active}
    <div
      class='shelf-tab position-absolute top-0 bottom-0 d-flex z-5 align-items-center justify-content-center not-reactive'
      class:pointer-events-none={!playbackPaused}
      class:shelf-tab-left={shelveTabLeft}
      class:shelf-tab-right={!shelveTabLeft}
      class:shelf-tab-visible={shelved}
      class:shelf-tab-ghost={!shelved}
      class:shelf-pointer-left={((shelved && !shelveTabLeft) || (!shelved && shelveTabLeft)) && playbackPaused}
      class:shelf-pointer-right={((shelved && shelveTabLeft) || (!shelved && !shelveTabLeft)) && playbackPaused}
      role='button'
      tabindex='0'
      aria-label={shelved ? 'Show miniplayer' : 'Shelve miniplayer'}
      on:focus={handleEdgeEnter}
      use:click|stopPropagation={handleShelfTap}
      on:keydown={event => event.key === 'Enter' && handleShelfTap()}>
      <div class='shelf-grip d-flex flex-column align-items-center justify-content-center pointer-events-none'/>
    </div>
  {/if}
  <div class='resize resize-{position ? (position.match(/top/i) ? `b` : `t`) + (position.match(/left/i) ? `r` : `l`) : `tl`}' class:d-none={!resize || !active || shelved} use:resizable/>
  <slot/>
  <div class='miniplayer-footer touch-none' class:dragging use:draggable tabindex='-1'>::::</div>
  <div class='h-full w-20 position-absolute top-0 z--1' class:mr--10={shelveTabLeft} class:ml--10={!shelveTabLeft} class:right-0={shelveTabLeft}/>
  <div class='h-20 w-full position-absolute mt--10 z--1'/>
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
    width: clamp(var(--minwidth), var(--width), var(--maxwidth)) !important;
  }
  .active.custompos {
    top: clamp(var(--padding-top), var(--top), 100% - var(--height) - var(--padding-top)) !important;
    left: clamp(var(--padding-left), var(--left), 100% - var(--width) - var(--padding-left)) !important;
    height: var(--height) !important;
  }
  .active.top {
    top: var(--padding-top) !important;
  }
  .active.bottom {
    bottom: var(--padding-bottom) !important;
  }
  .active.left {
    left: var(--padding-left) !important;
  }
  .active.right {
    right: var(--padding-right) !important;
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
  .miniplayer-container.animate:not(.player-page) {
    transition-duration: 0.5s;
    transition-property: top, left, transform;
    transition-timing-function: cubic-bezier(0.3, 1.5, 0.8, 1);
  }
  .miniplayer-container:not(.shelved):not(.player-page) {
    transform: translateX(0);
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), top 0.5s cubic-bezier(0.3, 1.5, 0.8, 1), left 0.5s cubic-bezier(0.3, 1.5, 0.8, 1);
  }
  .miniplayer-container.shelved-right:not(.player-page) {
    transform: translateX(calc(100% - 3px));
    transition: transform 0.45s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .miniplayer-container.shelved-left:not(.player-page) {
    transform: translateX(calc(-100% - 4px));
    transition: transform 0.45s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .miniplayer-container.shelved-right.bouncing {
    animation: peek-right 1.15s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }
  .miniplayer-container.shelved-left.bouncing {
    animation: peek-left 1.15s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }
  @keyframes peek-right {
    0%   { transform: translateX(calc(100% - 3px)); }
    28%  { transform: translateX(calc(100% - 34px)); }
    43%  { transform: translateX(calc(100% - 24px)); }
    57%  { transform: translateX(calc(100% - 30px)); }
    70%  { transform: translateX(calc(100% - 26px)); }
    100% { transform: translateX(calc(100% - 3px)); }
  }
  @keyframes peek-left {
    0%   { transform: translateX(calc(-100% - 4px)); }
    28%  { transform: translateX(calc(-100% + 25px)); }
    43%  { transform: translateX(calc(-100% + 15px)); }
    57%  { transform: translateX(calc(-100% + 21px)); }
    70%  { transform: translateX(calc(-100% + 17px)); }
    100% { transform: translateX(calc(-100% - 4px)); }
  }
  .shelf-tab {
    background: var(--dark-color-light);
    transition: opacity 0.15s ease 0.35s;
  }
  .shelf-tab-right {
    width: 2.6rem;
    left: -1px;
    border-top-left-radius: 1rem;
    border-bottom-left-radius: 1rem;
  }
  .shelf-tab-left {
    width: 1.7rem;
    right: -1px;
    border-top-right-radius: 1rem;
    border-bottom-right-radius: 1rem;
  }
  .shelf-grip {
    gap: 3px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .shelf-tab-visible .shelf-grip {
    opacity: 1;
    transition: opacity 0.1s ease 0.35s;
  }
  .shelf-tab-visible:hover {
    background: var(--dark-color-very-light);
  }
  .shelf-grip::before,
  .shelf-grip::after {
    content: '';
    display: block;
    width: 2px;
    border-radius: 2px;
    background: var(--white-color);
  }
  .shelf-grip::before {
    height: 14px;
  }
  .shelf-grip::after {
    height: 7px;
    opacity: 0.4;
  }
  .shelf-tab-ghost {
    top: 3.5rem !important;
    bottom: 5.5rem !important;
    opacity: 0 !important;
    transition: none !important;
  }
  .shelf-pointer-right {
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Cfilter id='s'%3E%3CfeDropShadow dx='0' dy='0' stdDeviation='1' flood-color='black' flood-opacity='0.7'/%3E%3C/filter%3E%3Cg filter='url(%23s)'%3E%3Cline x1='3' y1='2' x2='3' y2='18' stroke='white' stroke-width='1.5' stroke-linecap='square'/%3E%3Cline x1='7' y1='10' x2='15' y2='10' stroke='white' stroke-width='1.5' stroke-linecap='square'/%3E%3Cpolygon points='16,10 11,6 11,14' fill='white'/%3E%3C/g%3E%3C/svg%3E") 10 10, e-resize;
  }
  .shelf-pointer-left {
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Cfilter id='s'%3E%3CfeDropShadow dx='0' dy='0' stdDeviation='1' flood-color='black' flood-opacity='0.7'/%3E%3C/filter%3E%3Cg filter='url(%23s)'%3E%3Cline x1='17' y1='2' x2='17' y2='18' stroke='white' stroke-width='1.5' stroke-linecap='square'/%3E%3Cline x1='5' y1='10' x2='13' y2='10' stroke='white' stroke-width='1.5' stroke-linecap='square'/%3E%3Cpolygon points='4,10 9,6 9,14' fill='white'/%3E%3C/g%3E%3C/svg%3E") 10 10, w-resize;
  }
  @media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
    .shelf-pointer-right {
      cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 20 20'%3E%3Cfilter id='s'%3E%3CfeDropShadow dx='0' dy='0' stdDeviation='1' flood-color='black' flood-opacity='0.7'/%3E%3C/filter%3E%3Cg filter='url(%23s)'%3E%3Cline x1='3' y1='2' x2='3' y2='18' stroke='white' stroke-width='1.5' stroke-linecap='square'/%3E%3Cline x1='7' y1='10' x2='15' y2='10' stroke='white' stroke-width='1.5' stroke-linecap='square'/%3E%3Cpolygon points='16,10 11,6 11,14' fill='white'/%3E%3C/g%3E%3C/svg%3E") 5 5, e-resize;
    }
    .shelf-pointer-left {
      cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 20 20'%3E%3Cfilter id='s'%3E%3CfeDropShadow dx='0' dy='0' stdDeviation='1' flood-color='black' flood-opacity='0.7'/%3E%3C/filter%3E%3Cg filter='url(%23s)'%3E%3Cline x1='17' y1='2' x2='17' y2='18' stroke='white' stroke-width='1.5' stroke-linecap='square'/%3E%3Cline x1='5' y1='10' x2='13' y2='10' stroke='white' stroke-width='1.5' stroke-linecap='square'/%3E%3Cpolygon points='4,10 9,6 9,14' fill='white'/%3E%3C/g%3E%3C/svg%3E") 5 5, w-resize;
    }
  }
</style>