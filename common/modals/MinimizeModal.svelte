<script context='module'>
  import SoftModal from '@/components/modals/SoftModal.svelte'
  import { Minimize2, SquareX, X } from 'lucide-svelte'
  import { COMMON, ELECTRON } from '@/modules/bridge.js'
  import { settings } from '@/modules/settings.js'
  import { modal } from '@/modules/navigation.js'
  import { click } from '@/modules/lib/click.js'
</script>
<script>
  function minimizeTray() {
    if ($modal[modal.MINIMIZE_PROMPT]?.data) $settings.closeAction = 'Minimize'
    ELECTRON.hideWindow()
    close()
  }
  async function exitApp() {
    if ($modal[modal.MINIMIZE_PROMPT]?.data) {
      ELECTRON.hideWindow()
      $settings.closeAction = 'Close'
    }
    ELECTRON.exit()
  }
  function close() {
    modal.close(modal.MINIMIZE_PROMPT)
  }
  ELECTRON.onExitIntent(() => {
    if ($settings.closeAction === 'Prompt') modal.toggle(modal.MINIMIZE_PROMPT, false)
    else if ($settings.closeAction === 'Minimize') minimizeTray()
    else exitApp()
  })
</script>

<SoftModal class='m-0 w-600 mw-0 mh-full d-flex flex-column rounded bg-very-dark pt-0 py-30 pl-30 pr-30 mx-20 scrollbar-none' css='z-110 m-0 p-0 modal-soft-ellipse' innerCss='m-0 p-0' showModal={$modal[modal.MINIMIZE_PROMPT]} {close} id={modal.MINIMIZE_PROMPT}>
  <button type='button' class='btn btn-square ml-auto d-flex align-items-center justify-content-center rounded-2 flex-shrink-0 mt-30' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
  <p class='my-0 text-center text-white font-scale-24 font-weight-semi-bold'>Minimize or Exit?</p>
  <p class='mt-1 text-center text-wrap'>Minimizing keeps Shiru running in the {COMMON.getPlatformInfo().platform !== 'darwin' ? 'system tray' : 'dock and menu bar'} to continue receiving notifications and seeding torrents.</p>
  <div class='mb-20 modal-body d-flex flex-column justify-content-center align-items-center'>
    <div class='custom-switch fit-content'>
      <input type='checkbox' id='remember-choice' bind:checked={$modal[modal.MINIMIZE_PROMPT].data} />
      <label for='remember-choice'>{'Don\'t ask again'}</label>
    </div>
  </div>
  <div class='mt-20 d-flex justify-content-center w-auto'>
    <button type='button' class='btn btn-primary mr-10 d-flex justify-content-center align-items-center w-130' on:click={minimizeTray}>
      <Minimize2 size='1.7rem' />
      <span class='ml-10 mr-5'>Minimize</span>
    </button>
    <button type='button' class='btn btn-danger d-flex justify-content-center align-items-center w-130' on:click={exitApp}>
      <SquareX size='1.7rem' />
      <span class='ml-10 mr-5'>Exit</span>
    </button>
  </div>
</SoftModal>