<script context='module'>
  import { IPC } from '@/modules/bridge.js'
  import { setContext } from 'svelte'
  import { writable } from 'simple-store-svelte'
  import { anilistClient } from '@/modules/anilist.js'
  import { enableHistory, destroyHistory } from '@/modules/history.js'
  import { settings } from '@/modules/settings.js'
  export const page = writable('home')
  export const overlay = writable([])
  export const statusTransition = writable(false)
  export const playPage = writable(settings.value.disableMiniplayer || false)
  export const view = writable(null)
  export async function handleAnime (detail) {
    IPC.emit('window-show')
    view.set(null)
    view.set((await anilistClient.searchIDSingle(!detail.mal ? { id: detail.id } : { idMal: detail.id })).data.Media)
  }
  IPC.on('open-anime', handleAnime)
  window.addEventListener('open-anime', (event) => handleAnime(event.detail))
  IPC.on('schedule', () => page.set('schedule'))
  window.addEventListener('player', () => page.set('player'))
  playPage.subscribe((value) => {
    const currentSettings = settings.value
    currentSettings.disableMiniplayer = value
    settings.value = currentSettings
  })
</script>

<script>
  import Sidebar from '@/components/Sidebar.svelte'
  import Router from '@/Router.svelte'
  import ViewAnime from '@/views/ViewAnime/ViewAnime.svelte'
  import TorrentModal from '@/views/TorrentSearch/TorrentModal.svelte'
  import Menubar from '@/components/Menubar.svelte'
  import UpdateModal from '@/views/Updater/UpdateModal.svelte'
  import Profiles from '@/components/Profiles.svelte'
  import Notifications from '@/components/Notifications.svelte'
  import MinimizeTray from '@/components/MinimizeTray.svelte'
  import Navbar from '@/components/Navbar.svelte'
  import Status from '@/components/Status.svelte'
  import { status } from '@/modules/networking.js'
  import { Toaster } from 'svelte-sonner'
  import { onMount, onDestroy } from 'svelte'

  setContext('view', view)
  IPC.emit('main-ready')

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
    document.addEventListener('fullscreenchange', updateFullscreen)
  })
  onDestroy(() => {
    destroyHistory()
    unsubscribeMonitor()
    clearTimeout(transitionTimer)
    document.removeEventListener('fullscreenchange', updateFullscreen)
  })
</script>

<UpdateModal bind:overlay={$overlay} />
<div class='page-wrapper with-transitions bg-dark position-relative pl-safe-area' data-sidebar-type='overlayed-all'>
  <Status />
  <Menubar />
  <Sidebar bind:page={$page} bind:playPage={$playPage} />
  <Navbar bind:page={$page} bind:playPage={$playPage} />
  <div class='overflow-hidden content-wrapper h-full' class:status-transition={$statusTransition}>
    <Toaster visibleToasts={2} position='top-right' theme='dark' richColors duration={10_000} closeButton toastOptions={{class: `${$page === 'settings' ? 'mt-70 mt-lg-0' : ''} ${isFullscreen && !$overlay?.length ? 'd-none' : ''}`}} />
    <ViewAnime bind:overlay={$overlay} />
    <TorrentModal bind:overlay={$overlay} />
    <Notifications bind:overlay={$overlay} />
    <Profiles bind:overlay={$overlay} />
    <MinimizeTray bind:overlay={$overlay} />
    <Router bind:page={$page} bind:overlay={$overlay} bind:playPage={$playPage} bind:statusTransition={$statusTransition} />
  </div>
</div>

<style>
  .page-wrapper {
    height: calc(100% - var(--navbar-height)) !important;
  }
  .content-wrapper {
    will-change: width;
    white-space: pre-line;
    top: 0 !important;
  }
  .page-wrapper > .content-wrapper {
    margin-left: var(--sidebar-minimised) !important;
    width: calc(100% - var(--sidebar-minimised)) !important;
    height: calc(100% - var(--wrapper-offset, 0rem)) !important;
  }
</style>