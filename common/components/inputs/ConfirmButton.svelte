<script>
  import { Check, X } from 'lucide-svelte'
  import { onDestroy } from 'svelte'
  import { click } from '@/modules/lib/click.js'

  let _click = () => {}
  export { _click as click }
  export let confirmClass = 'btn-primary'
  export let confirmText = 'Confirm'
  export let confirmIcon = Check
  export let cancelClass = ''
  export let cancelText = 'Cancel'
  export let cancelIcon = X
  export let primaryClass = ''
  export let actionClass = ''
  export let timeout = 5_000
  export let disabled = false
  export let dataToggle = ''
  export let dataPlacement = ''
  export let dataTitle = ''
  export let title = ''

  let timeoutId = null
  let intervalId = null
  let timeRemaining = timeout || 1
  $: progress = (timeRemaining / (timeout || 1)) * 100
  $: reversed = actionClass.split(/\s+/).includes('flex-row-reverse')

  const CLAZZ_TYPES = ['btn-primary', 'btn-secondary', 'btn-success', 'btn-danger', 'text-primary', 'text-secondary', 'text-success', 'text-danger', 'text-muted', 'text-white']
  /**
   * Removes button type classes from a base class list when the component already defines its own button type.
   *
   * @param {string} rest Class list (e.g. from $$restProps.class).
   * @param {string} own Class list defined by the component itself.
   * @return {string} The sanitized class list with conflicting button types removed.
   */
  const sanitize = (rest = '', own = '') => {
    const ownHasBtnType = own.split(/\s+/).some(c => CLAZZ_TYPES.includes(c))
    return rest.split(/\s+/).filter(c => !ownHasBtnType || !CLAZZ_TYPES.includes(c)).join(' ')
  }

  /**
   * Starts the confirmation countdown or executes the action if confirmed.
   *
   * @param {boolean} [confirmed=false] Whether the action is confirmed.
   */
  function confirm(confirmed = false) {
    if (confirmed) {
      if (!disabled) _click()
      cleanup()
    } else {
      if (disabled) return
      intervalId = setInterval(() => (timeRemaining -= 100), 100)
      timeoutId = setTimeout(cleanup, timeout)
    }
  }

  /** Clears timers and resets state. */
  function cleanup() {
    timeRemaining = timeout || 1
    clearTimeout(timeoutId)
    timeoutId = null
    clearInterval(intervalId)
    intervalId = null
  }

  /** Clears timers on component destroy. */
  onDestroy(cleanup)
</script>

<div class='d-contents'>
  <button type='button' class='{$$restProps.class} {primaryClass} animate' class:hidden={timeoutId !== null} data-toggle={timeoutId === null && dataToggle || ''} data-placement={timeoutId === null && dataPlacement || ''} {title} data-title={timeoutId === null && dataTitle || ''} {disabled} use:click={() => confirm()}>
    <slot />
  </button>
</div>
<div class='{actionClass} position-relative action-container d-contents animate' class:hidden={timeoutId === null}>
  <button type='button' class='{sanitize($$restProps.class, confirmClass)} {!confirmClass.includes(`w-auto`) ? `w-full` : ``} d-flex align-items-center justify-content-center position-relative overflow-hidden border-0 {confirmClass.replace(`w-auto`, ``)}' {disabled} use:click={() => confirm(true)}>
    {#if confirmIcon}
      <svelte:component this={confirmIcon} size='2rem' strokeWidth='3'/>
    {/if}
    <span class:ml-5={confirmIcon} class:d-none={!confirmText}>{confirmText}</span>
    <div class='position-absolute left-0 bottom-0 progress-bar' style='width: {reversed ? Math.max((progress - 50) * 2, 0) : Math.min(progress * 2, 100)}%'></div>
  </button>
  <button type='button' class='{sanitize($$restProps.class, cancelClass)} {!cancelClass.includes(`w-auto`) ? `w-full` : ``} d-flex align-items-center justify-content-center position-relative overflow-hidden border-0 {cancelClass.replace(`w-auto`, ``)}' {disabled} use:click={cleanup}>
    {#if cancelIcon}
      <svelte:component this={cancelIcon} size='2rem' strokeWidth='3'/>
    {/if}
    <span class:ml-5={cancelIcon} class:d-none={!cancelText}>{cancelText}</span>
    <div class='position-absolute left-0 bottom-0 progress-bar' style='width: {reversed ? Math.min(progress * 2, 100) : Math.max((progress - 50) * 2, 0)}%'></div>
  </button>
</div>

<style>
  .progress-bar {
    height: 2px;
    background: var(--warning-color);
    transition: width 0.1s linear;
  }
  .action-container {
    gap: 0.5rem;
  }
  .animate {
    transition: opacity 0.25s ease-out, transform 0.25s ease-out, filter 0.25s ease-out, scale 0.2s ease;
  }
  .animate.hidden {
    position: absolute;
    transform: translateX(-8px);
    pointer-events: none;
    filter: blur(4px);
    opacity: 0;
    height: 0;
    width: 0;
  }
</style>
