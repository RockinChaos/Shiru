<script>
  import { position as miniplayerPos, isLg } from '@/components/Miniplayer.svelte'
  import { toasts, toast } from '@/modules/lib/toast.js'
  import Toast from '@/components/toast/Toast.svelte'
  import { settings } from '@/modules/settings.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { page, modal } from '@/modules/navigation.js'
  import { fade } from 'svelte/transition'

  /** @type {'top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-center'|'bottom-right'} */
  export let position = 'top-right'
  /** @type {number} */
  export let max = 3
  /** @type {number} */
  export let gap = 10
  /** @type {number} */
  export let peek = 12
  /** @type {boolean} */
  export let hidden = false

  /** @type {Record<string, number>} */
  const heightsById = {}
  /** @type {HTMLDivElement} */
  let toasterEl
  /** @type {boolean} */
  let expanded = false

  /** Whether this toaster is anchored to the top of the screen */
  $: fromTop = position.startsWith('top')
  /** Direction multiplier for vertical offsets: toasts stack downward from the top, or upward from the bottom */
  $: signY = fromTop ? 1 : -1
  /** Toasts belonging to this toaster's position, respecting the hidden/force visibility rule and the current Toast Levels setting */
  $: filtered = $toasts.filter(toast => toast.position === position && (!hidden || toast.force) && (!toast.respectLevel || allowedByLevel(toast.type, $settings.toasts)))
  /** The most recent toasts, capped at max */
  $: activeVisible = filtered.slice(-max)
  /** Ids of the currently visible toasts, used to pause/resume their auto-dismiss timers */
  $: visibleIds = activeVisible.map(toast => toast.id)
  /** Visible toasts in render order, frontmost (newest) first */
  $: stackOrder = [...activeVisible].reverse()
  /** Pauses auto-dismiss for visible toasts while the stack is expanded, resumes otherwise */
  $: for (const id of visibleIds) (expanded ? toast.pause : toast.resume)(id)
  /** Cumulative pixel offset of each toast in stackOrder when the stack is expanded */
  $: expandedOffsets = getExpandedOffsets(stackOrder, heightsById, gap)
  /** Total height of the expanded stack, used to size the toaster container */
  $: expandedHeight = stackOrder.length ? expandedOffsets[expandedOffsets.length - 1] + (heightsById[stackOrder[stackOrder.length - 1]?.id] ?? 0) : 0

  /**
   * Computes each toast's cumulative vertical offset for the expanded (spaced-out) layout.
   *
   * @param {import('@/modules/lib/toast.js').ToastData[]} order Toasts in display order
   * @param {Record<string, number>} heights Measured height per toast id
   * @param {number} spacing Pixel gap between toasts
   * @returns {number[]} Offset in pixels for each toast, indexed to match order
   */
  function getExpandedOffsets(order, heights, spacing) {
    let acc = 0
    return order.map(toast => {
      const offset = acc
      acc += (heights[toast.id] ?? 0) + spacing
      return offset
    })
  }

  /**
   * Determines whether a toast of the given type is allowed to be shown under the given Toast Levels setting.
   * 'info'/'loading'/'default' toasts are always allowed, since they're typically important status updates rather than noise.
   *
   * @param {string} type
   * @param {string} level current value of settings.toasts
   * @returns {boolean}
   */
  function allowedByLevel(type, level) {
    if (!level || level === 'All') return true
    if (level === 'None') return false
    if (type === 'error') return level.includes('Errors')
    if (type === 'warning' || type === 'success') return level.includes('Warnings')
    return true
  }

  /**
   * Collapses the expanded stack when the user clicks outside the toaster.
   *
   * @param {MouseEvent} event
   */
  function handleWindowClick(event) {
    if (expanded && toasterEl && !toasterEl.contains(/** @type {Node} */ (event.target))) expanded = false
  }
</script>

<svelte:window on:click={handleWindowClick} />

<div
  class='toaster position-fixed z-105 wm-420 {$$restProps.class}'
  class:expanded
  style='height: {expandedHeight}px'
  bind:this={toasterEl}
  class:toaster-top-left={position === 'top-left'}
  class:toaster-top-center={position === 'top-center'}
  class:toaster-top-right={position === 'top-right'}
  class:toaster-bottom-left={position === 'bottom-left'}
  class:toaster-bottom-center={position === 'bottom-center'}
  class:toaster-bottom-right={position === 'bottom-right'}
  style:--menu-bar={!SUPPORTS.isAndroid ? '4rem' : '0rem'}
  style:--top-bar={$page === page.SETTINGS && !$isLg ? '7rem' : '0rem'}
  style:--miniplayer-left={(position.endsWith('left') && ($miniplayerPos.trim() === position.replace('-', ' '))) ? '3rem' : '0rem'}
  style:--miniplayer-right={(position.endsWith('right') && ($miniplayerPos.trim() === position.replace('-', ' '))) ? '3rem' : '0rem'}
  style:--seekbar-height={$page === page.PLAYER && (!$modal || !modal.length) ? '7rem' : '0rem'}
  on:mouseenter={() => (expanded = true)}
  on:mouseleave={() => (expanded = false)}
  on:focusin={() => (expanded = true)}
  on:focusout={() => (expanded = false)}
  role='group'>
  {#each stackOrder as data, index (data.id)}
    <div
      class='toaster-item position-absolute left-0 right-0'
      style:--y={`${signY * expandedOffsets[index]}px`}
      style:--y-collapsed={`${signY * Math.min(index, 2) * peek}px`}
      style:--scale-collapsed={Math.max(1 - index * .045, .9)}
      style:--opacity-collapsed={Math.max(1 - index * .1, .7)}
      style='z-index: {stackOrder.length - index};'
      bind:clientHeight={heightsById[data.id]}
      out:fade={{ duration: 150 }}>
      <Toast {data} {position} {expanded} isFront={index === 0} onTap={() => (expanded = true)} />
    </div>
  {/each}
</div>

<style>
  .toaster {
    --toast-edge-top: calc(max(var(--wrapper-offset, 0px), var(--safe-area-top), 1.6rem) + var(--menu-bar) + var(--top-bar));
    --toast-edge-bottom: calc(var(--bottombar-height) + max(var(--safe-area-bottom), 1.6rem) + var(--seekbar-height));
    --toast-edge-left: calc(max(var(--safe-area-left), 1.6rem) + var(--miniplayer-left));
    --toast-edge-right: calc(max(var(--safe-area-right), var(--safe-area-navigation-right), 1.6rem) + var(--miniplayer-right));
    width: calc(100% - 3.2rem);
    transition: top .28s cubic-bezier(.22, 1, .36, 1), right .28s cubic-bezier(.22, 1, .36, 1), bottom .28s cubic-bezier(.22, 1, .36, 1), left .28s cubic-bezier(.22, 1, .36, 1);
  }

  .toaster-top-left {
    left: var(--toast-edge-left);
    top: var(--toast-edge-top);
  }
  .toaster-top-center {
    left: 50%;
    top: var(--toast-edge-top);
    transform: translateX(-50%);
  }
  .toaster-top-right {
    right: var(--toast-edge-right);
    top: var(--toast-edge-top);
  }
  .toaster-bottom-left {
    left: var(--toast-edge-left);
    bottom: var(--toast-edge-bottom);
  }
  .toaster-bottom-center {
    left: 50%;
    bottom: var(--toast-edge-bottom);
    transform: translateX(-50%);
  }
  .toaster-bottom-right {
    right: var(--toast-edge-right);
    bottom: var(--toast-edge-bottom);
  }

  .toaster-item {
    opacity: var(--opacity-collapsed);
    transform: translateY(var(--y-collapsed)) scale(var(--scale-collapsed));
    transition: transform .28s cubic-bezier(.22, 1, .36, 1), opacity .22s ease;
  }
  .toaster-top-left .toaster-item,
  .toaster-top-center .toaster-item,
  .toaster-top-right .toaster-item {
    top: 0;
    transform-origin: center top;
  }
  .toaster-bottom-left .toaster-item,
  .toaster-bottom-center .toaster-item,
  .toaster-bottom-right .toaster-item {
    bottom: 0;
    transform-origin: center bottom;
  }
  .toaster.expanded .toaster-item {
    opacity: 1;
    transform: translateY(var(--y)) scale(1);
  }
</style>
