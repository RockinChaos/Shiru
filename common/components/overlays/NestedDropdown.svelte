<script>
  import { onDestroy } from 'svelte'
  import { click } from '@/modules/lib/click.js'
  import { fadeIn, fadeOut, baseFontSize } from '@/modules/util.js'
  import { ChevronLeft, ChevronRight } from 'lucide-svelte'

  /**
   * @typedef {Object} DropdownItem
   * @property {any} [icon] lucide icon component
   * @property {string} [label] Display label
   * @property {string} [labelCSS] CSS to apply to the display label
   * @property {string} [value] Right-aligned display value
   * @property {string} [valueCSS] CSS to apply to the display value
   * @property {DropdownItem[]} [children] Nested items
   * @property {function} [onSelect] Called on selection
   * @property {string} [inputmode] For input type items
   * @property {string} [pattern] For input type items
   * @property {string} [step] For input type items
   * @property {number} [max] Maximum numerical value for input type items
   * @property {number} [min] Minimum numerical value for input type items
   * @property {function} [onInput] Called with the new value on input
   * @property {boolean} [close] If the dropdown should close after picking the item
   * @property {boolean} [disabled] If the item is disabled
   * @property {'separator'} [type] Renders a horizontal rule
   */

  /** @type {DropdownItem[]} */
  export let items = []
  /** Optional label shown in the root panel header. */
  export let title = ''
  /** @type {'auto'|'top'|'bottom'|'left'|'right'} */
  export let direction = 'auto'
  /** @type number */
  export let panelWidth = 36
  /** @type number */
  export let panelHeight = 42
  /** @type number */
  export let panelWidthPadding = 3
  /** @type number */
  export let panelHeightPadding = 3
  /** @type string */
  export let panelColor = 'var(--dm-dropdown-menu-bg-color)'
  /** @type {HTMLElement|null} Optional element to constrain the panels size and clamp positioning within */
  export let containerEl = null
  /** @type {boolean} */
  export let alignStart = false
  /** @type boolean */
  export let isOpen = false

  const CARET_GAP = .375
  const CARET_HEIGHT = 1
  const HEADER_HEIGHT = 6
  const ANIMATION_MS = 200

  let isSliding = false
  let stack = []
  let depth = 0
  let panelEl
  let trackEl
  let triggerWrapEl
  let listHeight = 0
  let headerHeight = 0
  let renderPanelHeight = panelHeight
  let renderPanelWidth = panelWidth
  let panelStyle = ''
  let caretStyle = ''
  let caretTop = false
  let caretLeft = false
  let caretVertical = true

  $: syncStack(isOpen, items)

  /**
   * Rebuilds the navigation stack from the updated items prop, re-deriving each
   * levels items from its parents children so reactive values stay current.
   *
   * @param {boolean} isOpen
   * @param {DropdownItem[]} currentItems
   */
  function syncStack(isOpen, currentItems) {
    if (!isOpen || stack.length === 0 || stack[0].items === currentItems) return
    const rebuilt = [{ ...stack[0], items: currentItems }]
    for (let i = 1; i < stack.length; i++) {
      const match = rebuilt[i - 1].items.find((/** @type {DropdownItem} */ item) => item.label === stack[i].label)
      if (!match?.children) break
      rebuilt.push({ ...stack[i], items: match.children })
    }
    stack = rebuilt
  }

  /** Opens or closes the dropdown. */
  function toggle() { isOpen ? close() : open() }

  /** Resets navigation state and opens the panel, then positions it relative to the trigger. */
  function open() {
    stack = [{ label: title, items }]
    depth = 0
    listHeight = 0
    headerHeight = 0
    isOpen = true

    const observer = new MutationObserver(() => {
      if (!panelEl) return
      observer.disconnect()
      listHeight = measureListHeight(0)
      headerHeight = targetHeaderHeight(0)
      position()
    })
    observer.observe(document.body, { childList: true, subtree: true })

    window.addEventListener('pointerdown', onOutsideClick, true)
    window.addEventListener('keydown', onEscapeKey, true)
    window.addEventListener('resize', () => requestAnimationFrame(() => requestAnimationFrame(position)), true)
  }

  /** Closes the panel and removes all global event listeners. */
  function close() {
    isOpen = false
    window.removeEventListener('pointerdown', onOutsideClick, true)
    window.removeEventListener('keydown', onEscapeKey, true)
    window.removeEventListener('resize', position, true)
  }

  /**
   * Converts pixels to rem using the current root font size.
   *
   * @param {number} px
   * @returns {number}
   */
  function toRem(px) {
    return px / baseFontSize.value
  }

  /**
   * Returns the natural scrollHeight of the list at the given stack index,
   * capped at panelHeight rem to keep the panel from growing too tall.
   *
   * @param {number} stackIndex
   * @returns {number}
   */
  function measureListHeight(stackIndex) {
    if (!trackEl) return 0
    const panels = trackEl.querySelectorAll(':scope > .nd-slide')
    const list = panels[stackIndex]?.querySelector('.nd-list')
    return list ? Math.min(toRem(list.scrollHeight), panelHeight) : 0
  }

  /**
   * Returns the target header height for a given stack depth.
   *
   * @param {number} stackIndex
   * @returns {number}
   */
  function targetHeaderHeight(stackIndex) {
    return (stackIndex !== 0 || title) ? HEADER_HEIGHT : 0
  }

  /**
   * Positions the panel relative to the trigger and derives `renderPanelWidth`/`renderPanelHeight`,
   * capping them to the available space so the panel can shrink to fit.
   */
  function position() {
    if (!panelEl || !triggerWrapEl) return

    const viewportWidth = toRem(window.innerWidth)
    const viewportHeight = toRem(window.innerHeight)
    const rawBounds = containerEl ? containerEl.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    const capLeft = Math.max(0, toRem(rawBounds.left))
    const capTop = Math.max(0, toRem(rawBounds.top))
    const capRight = Math.min(viewportWidth, toRem(rawBounds.right))
    const capBottom = Math.min(viewportHeight, toRem(rawBounds.bottom))
    const capWidth = Math.max(0, capRight - capLeft)
    const capHeight = Math.max(0, capBottom - capTop)
    const triggerClientRect = triggerWrapEl.getBoundingClientRect()
    const triggerRect = {
      top: toRem(triggerClientRect.top),
      bottom: toRem(triggerClientRect.bottom),
      left: toRem(triggerClientRect.left),
      right: toRem(triggerClientRect.right),
      width: toRem(triggerClientRect.width),
      height: toRem(triggerClientRect.height)
    }
    const spaceLeft = triggerRect.left - capLeft - CARET_HEIGHT - CARET_GAP - panelWidthPadding
    const spaceRight = capRight - triggerRect.right - CARET_HEIGHT - CARET_GAP - panelWidthPadding
    const spaceTopRaw = triggerRect.top - capTop - CARET_HEIGHT - CARET_GAP - panelHeightPadding
    const spaceBottomRaw = capBottom - triggerRect.bottom - CARET_HEIGHT - CARET_GAP - panelHeightPadding

    let openLeft, openTop
    if (direction === 'left' || direction === 'right') {
      openLeft = direction === 'left' ? true : direction === 'right' ? false : spaceRight < spaceLeft
      caretVertical = false
      caretLeft = openLeft

      const sideSpace = openLeft ? spaceLeft : spaceRight
      renderPanelWidth = Math.max(0, Math.min(panelWidth, capWidth - 2 * panelWidthPadding, sideSpace))

      const maxTotalHeight = capHeight - CARET_HEIGHT - CARET_GAP - 2 * panelHeightPadding
      renderPanelHeight = Math.max(0, Math.min(listHeight, maxTotalHeight - headerHeight))
      const totalPanelHeight = renderPanelHeight + headerHeight

      let left = openLeft ? triggerRect.left - renderPanelWidth - CARET_HEIGHT - CARET_GAP : triggerRect.right + CARET_HEIGHT + CARET_GAP
      let top = alignStart ? triggerRect.top : triggerRect.top + triggerRect.height / 2 - totalPanelHeight / 2
      top = Math.max(capTop + panelHeightPadding, Math.min(top, capBottom - totalPanelHeight - panelHeightPadding))

      const triggerCenterY = triggerRect.top + triggerRect.height / 2
      const caretY = Math.max(CARET_HEIGHT + .4, Math.min(triggerCenterY - top, totalPanelHeight - CARET_HEIGHT - .4))

      const offsetParentRect = panelEl.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 }
      const scrollTop = toRem(panelEl.offsetParent?.scrollTop ?? 0)
      const scrollLeft = toRem(panelEl.offsetParent?.scrollLeft ?? 0)
      left -= toRem(offsetParentRect.left) - scrollLeft
      top -= toRem(offsetParentRect.top) - scrollTop

      panelStyle = `left:${left}rem; top:${top}rem; width:${renderPanelWidth}rem; transform-origin:${openLeft ? 'right' : 'left'} center; --list-max-height:${renderPanelHeight}rem; --panel-max-width:${panelWidth}rem;`
      caretStyle = openLeft ? `right:-${CARET_HEIGHT}rem; top:${caretY}rem;` : `left:-${CARET_HEIGHT}rem; top:${caretY}rem;`
    } else {
      openTop = direction === 'top' ? true : direction === 'bottom' ? false : spaceBottomRaw < spaceTopRaw
      caretVertical = true
      caretTop = openTop
      renderPanelWidth = Math.max(0, Math.min(panelWidth, capWidth - 2 * panelWidthPadding))

      const sideSpace = openTop ? spaceTopRaw : spaceBottomRaw
      const maxTotalHeight = Math.min(capHeight - CARET_HEIGHT - CARET_GAP - 2 * panelHeightPadding, sideSpace)
      renderPanelHeight = Math.max(0, Math.min(listHeight, maxTotalHeight - headerHeight))
      const totalPanelHeight = renderPanelHeight + headerHeight

      let top = openTop ? triggerRect.top - totalPanelHeight - CARET_HEIGHT - CARET_GAP : triggerRect.bottom + CARET_HEIGHT + CARET_GAP
      const triggerCenterX = triggerRect.left + triggerRect.width / 2
      let left = Math.max(capLeft + panelWidthPadding, Math.min(triggerCenterX - renderPanelWidth / 2, capRight - renderPanelWidth - panelWidthPadding))
      const caretX = Math.max(CARET_HEIGHT + .4, Math.min(triggerCenterX - left, renderPanelWidth - CARET_HEIGHT - .4))

      const offsetParentRect = panelEl.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 }
      const scrollTop = toRem(panelEl.offsetParent?.scrollTop ?? 0)
      const scrollLeft = toRem(panelEl.offsetParent?.scrollLeft ?? 0)
      left -= toRem(offsetParentRect.left) - scrollLeft
      top -= toRem(offsetParentRect.top) - scrollTop

      panelStyle = `left:${left}rem; top:${top}rem; width:${renderPanelWidth}rem; transform-origin:${openTop ? 'bottom' : 'top'} center; --list-max-height:${renderPanelHeight}rem; --panel-max-width:${panelWidth}rem;`
      caretStyle = openTop ? `left:${caretX}rem; bottom:-${CARET_HEIGHT}rem;` : `left:${caretX}rem; top:-${CARET_HEIGHT}rem;`
    }

    if (trackEl) trackEl.style.transform = `translateX(${-(depth * renderPanelWidth)}rem)`
  }

  /**
   * Pushes a submenu onto the navigation stack and animates the panel sliding in.
   *
   * @param {DropdownItem} item
   */
  function drillIn(item) {
    if (isSliding || !item.children?.length) return
    const previousDepth = depth
    stack = [...stack, { label: item.label, items: item.children }]
    const newDepth = stack.length - 1
    isSliding = true

    const observer = new MutationObserver(() => {
      const newPanel = trackEl?.querySelectorAll(':scope > .nd-slide')[newDepth]
      if (!newPanel) return
      observer.disconnect()
      depth = newDepth

      animateTransition({
        fromX: -(previousDepth * renderPanelWidth),
        toX: -(newDepth * renderPanelWidth),
        fromListHeight: listHeight,
        toListHeight: measureListHeight(newDepth),
        fromHeaderHeight: headerHeight,
        toHeaderHeight: targetHeaderHeight(newDepth),
        onComplete: () => isSliding = false
      })
    })
    observer.observe(trackEl, { childList: true })
  }

  /** Pops the current submenu off the stack and animates the panel sliding back. */
  function drillBack() {
    if (isSliding || depth === 0) return
    const previousDepth = depth
    const newDepth = depth - 1
    depth = newDepth
    isSliding = true

    animateTransition({
      fromX: -(previousDepth * renderPanelWidth),
      toX: -(newDepth * renderPanelWidth),
      fromListHeight: listHeight,
      toListHeight: measureListHeight(newDepth),
      fromHeaderHeight: headerHeight,
      toHeaderHeight: targetHeaderHeight(newDepth),
      onComplete: () => {
        stack = stack.slice(0, newDepth + 1)
        isSliding = false
      }
    })
  }

  /**
   * Animates the panel slide and card resize in lockstep.
   * The track uses the Web Animations API (compositor-thread, no JS per frame).
   * The height values use a rAF loop since they drive Svelte reactive bindings.
   *
   * @param {{ fromX: number, toX: number, fromListHeight: number, toListHeight: number, fromHeaderHeight: number, toHeaderHeight: number, onComplete: function }} options
   */
  function animateTransition({ fromX, toX, fromListHeight, toListHeight, fromHeaderHeight, toHeaderHeight, onComplete }) {
    const animate = trackEl.animate(
      [{ transform: `translateX(${fromX}rem)` }, { transform: `translateX(${toX}rem)` }],
      { duration: ANIMATION_MS, easing: 'cubic-bezier(.25, 1, .5, 1)', fill: 'forwards' })

    const start = performance.now()
    /** @param {DOMHighResTimeStamp} now */
    const frame = (now) => {
      const elapsed = Math.min((now - start) / ANIMATION_MS, 1)
      const eased = 1 - Math.pow(1 - elapsed, 3) // cubic-out matching the WAAPI curve above
      listHeight = fromListHeight + (toListHeight - fromListHeight) * eased
      headerHeight = fromHeaderHeight + (toHeaderHeight - fromHeaderHeight) * eased
      position()
      if (elapsed < 1) requestAnimationFrame(frame)
      else {
        listHeight = toListHeight
        headerHeight = toHeaderHeight
        animate.commitStyles?.()
        animate.cancel()
        onComplete?.()
      }
    }
    requestAnimationFrame(frame)
  }

  /**
   * Filters a panels items array, removing separators that have no
   * visible non-separator item on either side, and collapsing consecutive ones.
   *
   * @param {DropdownItem[]} items
   * @returns {DropdownItem[]}
   */
  function filterItems(items) {
    return items.filter((item, index) => {
      if (item.type !== 'separator') return true
      return (items.slice(0, index).findLast(_item => _item.type !== 'separator')) !== undefined && (items.slice(index + 1).find(_item => _item.type !== 'separator')) !== undefined
    })
  }

  /**
   * Handles item selection. Drills in if the item has children,
   * calls onSelect and closes if it's a leaf, or ignores display-only items.
   *
   * @param {DropdownItem} item
   */
  function pick(item) {
    if (item.disabled || item.type === 'separator') return
    if (item.children?.length) {
      drillIn(item)
      return
    }
    if (item.onSelect) item.onSelect()
    if (item.close) close()
  }

  /**
   * Closes the panel when a pointerdown fires outside both the panel and trigger.
   *
   * @param {PointerEvent} event
   */
  function onOutsideClick(event) {
    if (!panelEl || panelEl.contains(event.target) || triggerWrapEl.contains(event.target)) return
    close()
  }

  /**
   * Escape navigates back one level, or closes the panel if already at root.
   *
   * @param {KeyboardEvent} event
   */
  function onEscapeKey(event) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    depth > 0 ? drillBack() : close()
  }

  /**
   * Handles keyboard navigation for a menu item.
   *
   * @param {KeyboardEvent} event
   * @param {DropdownItem} item
   */
  function onKey(event, item) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      pick(item)
    } else if (event.key === 'ArrowRight' && item.children?.length) {
      event.preventDefault()
      drillIn(item)
    } else if (event.key === 'ArrowLeft' && depth !== 0) {
      event.preventDefault()
      drillBack()
    }
  }

  onDestroy(close)
</script>

<button bind:this={triggerWrapEl} class='nd-trigger-wrap d-inline-flex align-items-center bg-transparent border-0 p-0 pointer h-full' use:click={toggle}>
  <slot {isOpen} {toggle} />
</button>

{#if isOpen}
  <div
      bind:this={panelEl}
      class='nd-panel position-absolute z-20 cursor-default not-reactive'
      style={panelStyle}
      style:--panel-color={panelColor}
      role='dialog'
      aria-modal='true'
      title={stack[depth]?.label ?? title}
      aria-label={stack[depth]?.label ?? title}
      in:fadeIn={{ startScale: .95, duration: 150 }}
      out:fadeOut={{ endScale: 1, duration: 120 }}
      use:click|stopPropagation
      on:contextmenu|stopPropagation>
    <div
        class='nd-caret position-absolute w-0 h-0 pointer-events-none'
        class:nd-caret-top={caretVertical && !caretTop}
        class:nd-caret-bottom={caretVertical && caretTop}
        class:nd-caret-left={!caretVertical && !caretLeft}
        class:nd-caret-right={!caretVertical && caretLeft}
        style={caretStyle}
        aria-hidden='true'
    />
    <div class='nd-card w-full rounded-5 overflow-hidden mw-0 {$$restProps.class}'>
      <div class='nd-header d-flex align-items-center overflow-hidden flex-shrink-0 mw-0 pr-20 pl-10' style='height: {headerHeight}rem; opacity: {headerHeight / HEADER_HEIGHT};'>
        {#if depth !== 0}
          <button class='nd-back d-flex align-items-center justify-content-center border-0 rounded-circle bg-transparent pointer flex-shrink-0 p-0' use:click={drillBack} title='Back' aria-label='Back' style='transform: scale({headerHeight / HEADER_HEIGHT});'>
            <ChevronLeft size='2rem' strokeWidth='2.5' />
          </button>
        {/if}
        <span class='nd-title font-size-18 font-weight-medium text-dropdown text-truncate flex-1 mw-0 ml-10' style='transform: scaleY({headerHeight / HEADER_HEIGHT}); transform-origin: center center;'>{stack[depth]?.label ?? title}</span>
      </div>
      <div class='nd-rule flex-shrink-0' style='opacity: {headerHeight / HEADER_HEIGHT};' />
      <div class='nd-port overflow-hidden mw-0' style='height: {listHeight > renderPanelHeight ? renderPanelHeight : listHeight}rem;'>
        <div bind:this={trackEl} class='nd-track d-flex align-items-start will-transform' style='width: {stack.length * renderPanelWidth}rem;'>
          {#each stack as panel, panelIndex (panelIndex)}
            <div class='nd-slide flex-shrink-0 mw-0' style='width: {renderPanelWidth}rem;' aria-hidden={panelIndex !== depth ? true : undefined}>
              <ul role='menu' class='nd-list overflow-y-auto overflow-x-hidden mw-0 py-5 m-0' class:sliding={isSliding}>
                {#each filterItems(panel.items) as item, itemIndex (item.type === 'separator' ? `separator-${itemIndex}` : `${item.label ?? 'item'}-${itemIndex}`)}
                  {#if item.type === 'separator'}
                    <li class='nd-separator my-5 mx-0' role='separator' />
                  {:else if item.type === 'input'}
                    <li class='nd-item nd-item-input d-flex align-items-center justify-content-between pointer gap-10 mw-0 px-20 my-5' title={item.label} aria-label={item.label} role='menuitem' tabindex={panelIndex !== depth || item.disabled ? -1 : 0}>
                      <span class='nd-item-left d-flex flex-1 align-items-center mw-0 {item.labelCSS ? item.labelCSS : ``}'>
                        {#if item.icon}
                          <span class='nd-icon d-flex align-items-center justify-content-center flex-shrink-0 w-20 h-20' aria-hidden='true'>
                            <svelte:component this={item.icon} size='2rem' strokeWidth='2' />
                          </span>
                        {/if}
                        <span class='nd-label font-size-17 text-truncate mw-0' class:ml-10={!item.icon}>{item.label}</span>
                      </span>
                    <input
                      class='nd-input font-size-14 text-right text-truncate'
                      type='text'
                      inputmode={item.inputmode}
                      pattern={item.pattern}
                      step={item.step}
                      value={item.value}
                      style='width: {(String(item.value ?? '').length || 1) * 1.2 + 1.6}rem'
                      use:click|stopPropagation
                      on:input|stopPropagation={(/** @type {InputEvent & { currentTarget: HTMLInputElement }} */ event) => {
                        if (item.inputmode === 'numeric' || item.inputmode === 'decimal') {
                          const raw = event.currentTarget.value
                          if (raw.endsWith('-') && raw.length > 1) event.currentTarget.value = String(-parseFloat(raw))
                          else event.currentTarget.value = raw.replace(/(?!^-)[^0-9.]/g, '').replace(/^(-?)0+(\d)/, '$1$2')
                          const value = parseFloat(event.currentTarget.value)
                          if (item.max !== undefined && !isNaN(value) && value > item.max) {
                            event.currentTarget.value = String(item.max)
                            item.onInput?.(String(item.max))
                          } else if (item.min !== undefined && !isNaN(value) && value < item.min) {
                            event.currentTarget.value = String(item.min)
                            item.onInput?.(String(item.min))
                          } else {
                            item.onInput?.(event.currentTarget.value)
                          }
                        } else {
                          item.onInput?.(event.currentTarget.value)
                        }
                        event.currentTarget.style.width = ((event.currentTarget.value.length || 1) * 1.2 + 1.6) + 'rem'
                      }}
                    />
                    </li>
                  {:else}
                    <li class='nd-item d-flex align-items-center justify-content-between pointer gap-10 mw-0 px-20 my-5 ' class:disabled={item.disabled} title={item.label} aria-label={item.label} role='menuitem' tabindex={panelIndex !== depth || item.disabled ? -1 : 0} use:click={() => pick(item)} on:keydown={(/** @type {KeyboardEvent} */ event) => onKey(event, item)}>
                      <span class='nd-item-left d-flex flex-1 align-items-center mw-0 {item.labelCSS ? item.labelCSS : ``}'>
                        {#if item.icon}
                          <span class='nd-icon d-flex align-items-center justify-content-center flex-shrink-0 w-20 h-20' aria-hidden='true'>
                              <svelte:component this={item.icon} size='2rem' strokeWidth='2' />
                          </span>
                        {/if}
                        <span class='nd-label font-size-17 text-dropdown text-truncate mw-0'>{item.label}</span>
                      </span>
                      <span class='nd-item-right d-flex align-items-center flex-shrink-0'>
                        {#if item.value !== undefined}
                          <span class='nd-value font-size-14 text-nowrap text-truncate mw-0 {item.valueCSS ? item.valueCSS : ``}' class:text-muted={!item.valueCSS}>{item.value}</span>
                        {/if}
                        {#if item.children?.length}
                          <span class='nd-chevron d-flex align-items-center {item.valueCSS ? item.valueCSS : ``}' class:text-muted={!item.valueCSS} aria-hidden='true'>
                            <ChevronRight size='1.5rem' strokeWidth='2' />
                          </span>
                        {/if}
                      </span>
                    </li>
                  {/if}
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .nd-panel {
    filter: drop-shadow(0 1rem 3.5rem hsla(var(--black-color-hsl), .60)) drop-shadow(0 .5rem 1rem hsla(var(--black-color-hsl), .38));
    max-width: var(--panel-max-width);
  }
  .nd-card {
    background: var(--panel-color);
    border: var(--dropdown-menu-border-width) solid var(--dm-dropdown-divider-bg-color);
    box-shadow: var(--dm-dropdown-menu-box-shadow);
  }

  .nd-caret {
    transform: translateX(-50%);
  }
  .nd-caret-top {
    border-left: 1.1rem solid transparent;
    border-right: 1.1rem solid transparent;
    border-bottom: 1.1rem solid var(--panel-color);
  }
  .nd-caret-bottom {
    border-left: 1.1rem solid transparent;
    border-right: 1.1rem solid transparent;
    border-top: 1.1rem solid var(--panel-color);
  }
  .nd-caret-left {
    transform: translateY(-50%);
    border-top: 1.1rem solid transparent;
    border-bottom: 1.1rem solid transparent;
    border-right: 1.1rem solid var(--panel-color);
  }
  .nd-caret-right {
    transform: translateY(-50%);
    border-top: 1.1rem solid transparent;
    border-bottom: 1.1rem solid transparent;
    border-left: 1.1rem solid var(--panel-color);
  }

  .nd-back {
    width: 4rem;
    height: 4rem;
    color: var(--dm-base-text-color-light);
    transition: background .12s, color .12s;
  }
  .nd-back:hover,
  .nd-back:focus-visible {
    background: var(--dm-button-bg-color-hover) !important;
    color: var(--dm-base-text-color) !important;
    outline: none;
  }

  .nd-rule {
    height: var(--dropdown-divider-height);
    background: var(--dm-dropdown-divider-bg-color);
  }

  .nd-list {
    list-style: none;
    max-height: var(--list-max-height);
  }
  .nd-list.sliding::-webkit-scrollbar-track,
  .nd-list.sliding::-webkit-scrollbar-thumb {
    border: transparent !important;
    background: transparent !important;
  }

  .nd-input {
    background: var(--dm-input-bg-color);
    border: var(--input-border-width) solid var(--dm-input-border-color);
    border-radius: var(--input-border-radius);
    color: var(--dm-base-text-color);
    padding: .4rem .8rem;
    min-width: 4rem;
  }
  .nd-item {
    height: 5.4rem;
    user-select: none;
    outline: none;
    transition: background .1s;
  }
  .nd-item:hover {
    background: var(--dm-dropdown-item-bg-color-hover, hsla(var(--white-color-hsl), .07));
  }
  .nd-item:focus-visible {
    box-shadow: inset .25rem 0 0 var(--dm-base-text-color) !important;
    background: var(--dm-dropdown-item-bg-color-hover, hsla(var(--white-color-hsl), .07));
  }
  .nd-item.disabled {
    opacity: .34;
    cursor: default;
    pointer-events: none;
  }
  .nd-item-left {
    gap: 1.25rem;
  }
  .nd-item-right {
    gap: .8rem;
  }

  .nd-header {
    gap: .25rem;
  }

  .nd-icon {
    color: var(--dm-base-text-color-light);
  }

  .nd-separator {
    height: var(--dropdown-divider-height);
    background: var(--dm-dropdown-divider-bg-color);
  }

  .text-dropdown {
    color: var(--dm-dropdown-menu-text-color);
  }
</style>