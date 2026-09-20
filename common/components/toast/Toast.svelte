<script>
  import { toast } from '@/modules/lib/toast.js'
  import { Loader2, X } from 'lucide-svelte'

  /** @type {import('@/modules/lib/toast.js').ToastData} */
  export let data
  /** @type {string} */
  export let position = 'top-right'
  /** @type {boolean} */
  export let isFront = false
  /** @type {boolean} */
  export let expanded = false
  /** @type {() => void} */
  export let onTap = () => {}

  /** @type {number} */
  let startX = 0
  /** @type {number} */
  let dragX = 0
  /** @type {boolean} */
  let dragging = false
  /** @type {boolean} */
  let didDrag = false

  $: elapsedSinceUpdate = Date.now() - data.updatedAt
  $: showProgress = data.duration && data.duration !== Infinity
  $: allowedDirection = position.includes('right') ? 'left' : position.includes('left') ? 'right' : 'either'

  /** Dismisses this toast */
  function dismiss() {
    toast.dismiss(data.id)
  }

  /**
   * Begins a drag gesture, pausing the toast's auto-dismiss timer.
   *
   * @param {PointerEvent} event
   */
  function onPointerDown(event) {
    if (event.target == null || /** @type {HTMLElement} */ (event.target).closest('.toast-close, .toast-action')) return
    dragging = true
    didDrag = false
    startX = event.clientX
    toast.pause(data.id)
    if (event.currentTarget) /** @type {HTMLElement} */ (event.currentTarget).setPointerCapture(event.pointerId)
  }

  /**
   * Tracks pointer movement during a drag, damping motion in the wrong swipe direction.
   *
   * @param {PointerEvent} event
   */
  function onPointerMove(event) {
    if (!dragging) return
    const raw = event.clientX - startX
    if (Math.abs(raw) > 5) didDrag = true
    dragX = ((allowedDirection === 'left' && raw > 0) || (allowedDirection === 'right' && raw < 0)) ? raw * .3 : raw
  }

  /** Ends a drag gesture, dismissing the toast if the swipe passed the distance and direction threshold */
  function onPointerUp() {
    if (!dragging) return
    dragging = false
    if ((Math.abs(dragX) > 80) && (allowedDirection === 'either' || (allowedDirection === 'left' && dragX < 0) || (allowedDirection === 'right' && dragX > 0))) {
      dismiss()
      return
    }
    dragX = 0
    if (!expanded) toast.resume(data.id)
  }

  /**
   * Handles keyboard activation (Enter/Space), mirroring onClick for the frontmost toast.
   *
   * @param {KeyboardEvent} event
   */
  function onKeydown(event) {
    if (event.target == null || /** @type {HTMLElement} */ (event.target).closest('.toast-close, .toast-action')) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onClick()
  }

  /** Handles clicking, triggering the tap handler only for the frontmost toast and only if it was not a drag */
  function onClick() {
    if (didDrag || !isFront) return
    onTap()
  }
</script>

<div
    class='toast position-relative overflow-hidden rounded-10 grab w-full'
    class:toast-success={data.type === 'success'}
    class:toast-error={data.type === 'error'}
    class:toast-warning={data.type === 'warning'}
    class:toast-loading={data.type === 'loading'}
    class:toast-info={data.type !== 'success' && data.type !== 'error' && data.type !== 'warning' && data.type !== 'loading'}
    class:dragging
    style:--drag-x={`${dragX}px`}
    style:--drag-fade={`${1 - Math.min(Math.abs(dragX) / 160, .6)}`}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    on:click={onClick}
    on:keydown={onKeydown}
    tabindex='-1'
    role='button'>
  <div class='toast-row d-flex gap-10 align-items-start' class:blur-10={!isFront && !expanded}>
    {#key data.type}
      <div class='toast-icon icon-pop flex-shrink-0 d-flex align-items-center justify-content-center rounded-5 mt-2'>
        {#if data.type === 'success'}
          <svg viewBox='0 0 24 24' width='2.2rem' height='2.2rem' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'>
            <circle cx='12' cy='12' r='10' class='icon-draw icon-draw-circle' />
            <path d='m8 12.5 2.8 2.8L16 9.5' class='icon-draw icon-draw-check' />
          </svg>
        {:else if data.type === 'error'}
          <svg viewBox='0 0 24 24' width='2.2rem' height='2.2rem' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'>
            <circle cx='12' cy='12' r='10' class='icon-draw icon-draw-circle' />
            <path d='m9 9 6 6' class='icon-draw icon-draw-x1' />
            <path d='m15 9-6 6' class='icon-draw icon-draw-x2' />
          </svg>
        {:else if data.type === 'warning'}
          <svg viewBox='0 0 24 24' width='2.2rem' height='2.2rem' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'>
            <path d='m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' class='icon-draw icon-draw-triangle' />
            <path d='M12 9v4' class='icon-draw icon-draw-excl-line' />
            <circle cx='12' cy='17' r='1.5' fill='currentColor' stroke='none' class='icon-draw-dot' />
          </svg>
        {:else if data.type === 'loading'}
          <Loader2 size={17} class='toast-spin' />
        {:else} <!-- info or unspecified data type -->
          <svg viewBox='0 0 24 24' width='2.2rem' height='2.2rem' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'>
            <circle cx='12' cy='12' r='10' class='icon-draw icon-draw-circle' />
            <path d='M12 16v-4' class='icon-draw icon-draw-i-bar' />
            <circle cx='12' cy='8' r='1.5' fill='currentColor' stroke='none' class='icon-draw-dot' />
          </svg>
        {/if}
      </div>
    {/key}
    <div class='toast-body d-flex flex-1 mw-0 flex-column'>
      {#if data.title}<span class='toast-title font-weight-bold font-size-14 text-break text-white'>{data.title}</span>{/if}
      {#if data.description}<span class='toast-description font-size-12 text-break pre-wrap text-muted'>{data.description}</span>{/if}
    </div>
    {#if data.action}
      <button
        type='button'
        class='toast-action position-absolute tr-6 flex-shrink-0 border-0 pointer font-size-12 font-weight-semi-bold text-white'
        on:click|stopPropagation={() => {
          data.action?.onClick?.()
          dismiss()
        }}>
        {data.action.label}
      </button>
    {:else}
      <button type='button' class='toast-close position-absolute tr-6 d-flex align-items-center justify-content-center rounded-2 border-0 text-muted bg-transparent pointer m-0 p-0' aria-label='Dismiss' on:click|stopPropagation={dismiss}>
        <X size='1.8rem' strokeWidth={2.5} />
      </button>
    {/if}
  </div>
  {#key data.updatedAt}
    <div class='toast-progress-track' class:blur-10={!isFront && !expanded}>
      <div
          class='toast-progress-bar w-full h-full'
          class:toast-progress-static={!showProgress}
          style:--toast-duration={showProgress ? `${data.duration}ms` : undefined}
          style:--toast-delay={showProgress ? `-${elapsedSinceUpdate}ms` : undefined}
          style:--toast-play-state={dragging || expanded ? 'paused' : 'running'} />
    </div>
  {/key}
</div>

<style>
  .tr-6 {
    top: .6rem;
    right: .6rem;
  }
  .blur-10 {
    filter: blur(1rem);
  }

  .toast {
    background: color-mix(in srgb, var(--dark-color-very-light) 78%, transparent);
    border: 1px solid hsla(var(--white-color-hsl), .07);
    box-shadow: inset 0 1px 0 hsla(var(--white-color-hsl), .045), 0 6px 14px hsla(var(--black-color-hsl), .4), 0 1px 3px hsla(var(--black-color-hsl), .25);
    backdrop-filter: blur(20px) saturate(150%);
    -webkit-backdrop-filter: blur(20px) saturate(150%);
    touch-action: pan-y;
    transform: translateX(var(--drag-x, 0));
    opacity: var(--drag-fade, 1);
    transition: scale .15s ease, box-shadow .15s ease;
    animation: toast-in .32s cubic-bezier(.21, 1.02, .73, 1);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(.8rem) scale(.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .toast.dragging {
    transition: none;
  }
  .toast:active,
  .toast:hover {
    scale: 1.01;
  }

  .toast-row {
    padding: 1.2rem 4.4rem 1.2rem 1.3rem;
  }
  .toast-body {
    gap: .3rem;
    padding-top: .1rem;
  }
  .toast-title {
    line-height: 1.25;
  }
  .toast-description {
    line-height: 1.4;
  }
  .toast-action {
    margin-top: .1rem;
    padding: .55rem 1.1rem;
    border-radius: .7rem;
    background: color-mix(in srgb, var(--gray-color-light) 20%, transparent);
    box-shadow: inset 0 1px 0 hsla(var(--white-color-hsl), .06);
  }
  .toast-action:hover,
  .toast-action:active {
    background: color-mix(in srgb, var(--gray-color-very-light) 10%, transparent);
  }

  .toast-close {
    width: 2.4rem;
    height: 2.4rem;
  }
  .toast-close:hover,
  .toast-close:active {
    color: var(--text-white) !important;
    scale: 1.15;
  }

  .toast-progress-track {
    height: .3rem;
    background: hsla(var(--white-color-hsl), .05);
  }
  .toast-progress-bar {
    background: var(--type-color);
    opacity: .8;
    transform-origin: left;
    animation: toast-progress linear forwards;
    animation-duration: var(--toast-duration, 10000ms);
    animation-delay: var(--toast-delay, 0ms);
    animation-play-state: var(--toast-play-state, running);
  }
  .toast-progress-static {
    animation: none;
    transform: scaleX(1);
  }
  @keyframes toast-progress {
    from { transform: scaleX(1); }
    to { transform: scaleX(0); }
  }

  .toast-icon {
    width: 2.8rem;
    height: 2.8rem;
    background: var(--type-soft);
    color: var(--type-color);
    animation: icon-pop .28s cubic-bezier(.34, 1.56, .64, 1);
  }
  @keyframes icon-pop {
    from {
      transform: scale(.6);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  .icon-draw-circle {
    stroke-dasharray: 64;
    stroke-dashoffset: 64;
    animation: icon-draw .4s ease forwards;
  }
  .icon-draw-check {
    stroke-dasharray: 16;
    stroke-dashoffset: 16;
    animation: icon-draw .25s ease forwards .25s;
  }
  .icon-draw-triangle {
    stroke-dasharray: 59;
    stroke-dashoffset: 59;
    animation: icon-draw .4s ease forwards;
  }
  .icon-draw-excl-line {
    stroke-dasharray: 5;
    stroke-dashoffset: 5;
    animation: icon-draw .18s ease forwards .3s;
  }
  .icon-draw-dot {
    opacity: 0;
    animation: dot-fade .18s ease forwards .28s;
  }
  .icon-draw-i-bar {
    stroke-dasharray: 4;
    stroke-dashoffset: 4;
    animation: icon-draw .18s ease forwards .25s;
  }
  .icon-draw-x1,
  .icon-draw-x2 {
    stroke-dasharray: 10;
    stroke-dashoffset: 10;
  }
  .icon-draw-x1 {
    animation: icon-draw .18s ease forwards .25s;
  }
  .icon-draw-x2 {
    animation: icon-draw .18s ease forwards .38s;
  }
  @keyframes icon-draw {
    to { stroke-dashoffset: 0; }
  }
  @keyframes dot-fade {
    to { opacity: 1; }
  }
  :global(.toast-spin) {
    animation: toast-spin .9s linear infinite;
  }
  @keyframes toast-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .toast-success {
    --type-color: var(--success-color-dim);
    --type-soft: hsla(var(--success-color-dim-hsl), .16);
  }
  .toast-error {
    --type-color: var(--error-color-very-light);
    --type-soft: hsla(var(--error-color-very-light-hsl), .22);
  }
  .toast-warning {
    --type-color: var(--warning-color);
    --type-soft: hsla(var(--warning-color-hsl), .16);
  }
  .toast-info {
    --type-color: var(--primary-color-light);
    --type-soft: hsla(var(--primary-color-light-hsl), .12);
  }
  .toast-loading {
    --type-color: var(--gray-color-dim);
    --type-soft: hsla(var(--gray-color-dim-hsl), .16);
  }
</style>
