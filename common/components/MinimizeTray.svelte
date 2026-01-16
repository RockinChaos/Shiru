<script context='module'>
  import { settings } from '@/modules/settings.js'
  import { writable } from 'simple-store-svelte'
  import { click } from '@/modules/click.js'
  import { IPC, VERSION } from '@/modules/bridge.js'
  import { Minimize2, SquareX, X } from 'lucide-svelte'

  export const actionPrompt = writable(false)
</script>
<script>
  export let overlay

  let modal
  let rememberChoice
  function close () {
    $actionPrompt = false
    rememberChoice = false
    setTimeout(() => { if (overlay.includes('minimizetray')) overlay = overlay.filter(item => item !== 'minimizetray') })
  }
  function checkClose ({ keyCode }) {
    if (keyCode === 27) close()
  }
  $: $actionPrompt && (modal?.focus(), setOverlay())
  $: !$actionPrompt && close()
  function setOverlay() {
    if (!overlay.includes('minimizetray')) overlay = [...overlay, 'minimizetray']
  }
  function minimizeTray() {
    if (rememberChoice) $settings.closeAction = 'Minimize'
    close()
    IPC.emit('window-hide')
  }
  async function closeWindow() {
    if (rememberChoice) {
      $settings.closeAction = 'Close'
      await new Promise(res => setTimeout(res, 2050))
    }
    IPC.emit('close')
  }
  IPC.on('window-close', () => {
    if ($settings.closeAction === 'Prompt') $actionPrompt = !$actionPrompt
    else if ($settings.closeAction === 'Minimize') minimizeTray()
    else closeWindow()
  })
  window.addEventListener('overlay-check', () => { if ($actionPrompt) close() })
</script>

<div class='modal z-55' class:show={$actionPrompt}>
  {#if $actionPrompt}
    <div class='modal-dialog' on:pointerup|self={close} on:keydown={checkClose} tabindex='-1' role='button' bind:this={modal}>
      <div class='modal-content w-600 d-flex flex-column bg-very-dark'>
        <div class='d-flex justify-content-between align-items-start w-auto'>
          <button type='button' class='btn btn-square ml-auto d-flex align-items-center justify-content-center' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
        </div>
        <h3 class='mb-0 text-center'>Are You Sure You Want To Quit?</h3>
        <p class='mt-1 text-center text-wrap'>Shiru can be minimized to the {VERSION.platform !== 'darwin' ? 'system tray' : ' dock and menu bar'} instead, useful if you want to receive notifications and seed torrents.</p>
        <div class='mb-20 modal-body d-flex flex-column justify-content-center align-items-center'>
          <div class='custom-switch text-center'>
            <input type='checkbox' id='remember-choice' bind:checked={rememberChoice} />
            <label for='remember-choice'>{'Remember my choice'}</label>
          </div>
        </div>
        <div class='mt-20 d-flex justify-content-center w-auto'>
          <button type='button' class='btn btn-primary mr-10 d-flex justify-content-center align-items-center w-130' on:click={minimizeTray}>
            <span class='mr-10 d-flex align-items-center'>
              <Minimize2 size='1.7rem' />
            </span>
            <span class='mt-2 mr-5 text-center'>Minimize</span>
          </button>
          <button type='button' class='btn btn-danger d-flex justify-content-center align-items-center w-130' on:click={closeWindow}>
            <span class='mr-10 d-flex align-items-center'>
              <SquareX size='1.7rem' />
            </span>
            <span class='mt-2 mr-5 text-center'>Close</span>
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .w-130 {
    width: 13rem;
  }
</style>