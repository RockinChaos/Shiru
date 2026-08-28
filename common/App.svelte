<script context='module'>
  import { COMMON } from '@/modules/bridge.js'
  import { writable } from 'simple-store-svelte'
  import { page, modal, destroyHistory, enableHistory } from '@/modules/navigation.js'

  export const statusTransition = writable(false)
</script>

<script>
  import Bottombar from '@/components/navigation/Bottombar.svelte'
  import Sidebar from '@/components/navigation/Sidebar.svelte'
  import Router from '@/routes/Router.svelte'
  import DetailsModal from '@/modals/details/DetailsModal.svelte'
  import TorrentModal from '@/modals/torrent/TorrentModal.svelte'
  import Menubar from '@/components/Menubar.svelte'
  import UpdateModal from '@/modals/UpdateModal.svelte'
  import ProfilesModal from '@/modals/ProfilesModal.svelte'
  import NotificationModal from '@/modals/notification/NotificationModal.svelte'
  import MinimizeModal from '@/modals/MinimizeModal.svelte'
  import Status from '@/components/Status.svelte'
  import { status } from '@/modules/networking.js'
  import Toaster from '@/components/toast/Toaster.svelte'
  import { onMount, onDestroy } from 'svelte'
  import '@/modules/themes.js'

  let currentStatus = status.value
  let transitionTimer
  const unsubscribeMonitor = status.subscribe(value => {
    if (value !== currentStatus) {
      clearTimeout(transitionTimer)
      statusTransition.set(true)
      transitionTimer = setTimeout(() => statusTransition.set(false), 2_500)
      transitionTimer.unref?.()
      currentStatus = value
    }
  })

  let isFullscreen = !!document.fullscreenElement
  function updateFullscreen() {
    isFullscreen = !!document.fullscreenElement
  }

  onMount(() => {
    enableHistory()
    setTimeout(() => COMMON.windowReady(), 150).unref?.()
    document.addEventListener('fullscreenchange', updateFullscreen)
  })
  onDestroy(() => {
    destroyHistory()
    unsubscribeMonitor()
    clearTimeout(transitionTimer)
    document.removeEventListener('fullscreenchange', updateFullscreen)
  })
</script>

<MinimizeModal />
<UpdateModal />
<div class='page-wrapper with-transitions bg-dark position-relative pl-safe-area pr-navigation-safe-area' data-sidebar-type='overlayed-all'>
  <Status />
  <Menubar />
  <Sidebar />
  <Bottombar />
  <div class='overflow-hidden content-wrapper h-full' class:status-transition={$statusTransition}>
    <Toaster position='top-right' max={5} hidden={isFullscreen && (!$modal || !modal.length)} />
    <DetailsModal />
    <TorrentModal />
    <NotificationModal />
    <ProfilesModal />
    <Router bind:statusTransition={$statusTransition} />
  </div>
</div>

<style>
  .page-wrapper {
    height: calc(100% - var(--bottombar-height) - max(0px, calc(var(--safe-area-navigation-bottom) - var(--safe-area-gesture-bottom)))) !important;
  }
  .content-wrapper {
    will-change: width;
    white-space: pre-line;
    top: 0 !important;
  }
  .page-wrapper > .content-wrapper {
    margin-left: var(--sidebar-minimised) !important;
    width: calc(100% - var(--sidebar-minimised)) !important;
    height: calc(100% - var(--wrapper-offset, 0px)) !important;
  }
  @media (max-width: 768px) {
    .page-wrapper {
      height: calc(100% - var(--bottombar-height) - max(var(--safe-area-navigation-bottom), var(--safe-area-gesture-bottom))) !important;
    }
  }
</style>
