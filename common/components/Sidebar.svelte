<script>
  import { getContext } from 'svelte'
  import { rss } from '@/views/TorrentSearch/TorrentModal.svelte'
  import { nowPlaying as media } from '@/views/Player/MediaHandler.svelte'
  import { profileView } from '@/components/Profiles.svelte'
  import { notifyView, hasUnreadNotifications } from '@/components/Notifications.svelte'
  import { actionPrompt } from '@/components/MinimizeTray.svelte'
  import { updateState } from '@/views/Updater/UpdateModal.svelte'
  import { settings } from '@/modules/settings.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { status } from '@/modules/networking.js'
  import { click } from '@/modules/click.js'
  import { toast } from 'svelte-sonner'
  import Helper from '@/modules/helper.js'
  import { IPC, ELECTRON, VERSION } from '@/modules/bridge.js'
  import { goBack, goForward, canGoBack, canGoForward } from '@/modules/history.js'
  import SidebarLink from '@/components/SidebarLink.svelte'
  import { MoveLeft, MoveRight, CalendarSearch, Download, CloudDownload, Heart, Home, Search, ListVideo, History, TvMinimalPlay, LogIn, Settings, Users, Bell, BellDot } from 'lucide-svelte'

  const view = getContext('view')
  const btnSize = !SUPPORTS.isAndroid ? '3.1rem' : '3.6rem'

  export let page
  export let playPage

  let _status = status.value
  $: statusTransition = false
  $: {
    if (_status !== $status) {
      statusTransition = true
      setTimeout(() => (statusTransition = false), 3000)
      _status = $status
    }
  }
  let fullScreen = false
  ELECTRON.isFullScreen().then(isFullScreen => {
    fullScreen = isFullScreen
    ELECTRON.onFullScreen((isFullScreen) => fullScreen = isFullScreen)
  })
</script>

<div class='sidebar z-80 d-md-block' class:animated={$settings.expandingSidebar}>
  <div class='z--1 pointer-events-none h-full bg-dark position-absolute' style='width: var(--sidebar-width)'/>
  <div class='sidebar-overlay z--1 pointer-events-none h-full position-absolute' class:animated={$settings.expandingSidebar} />
  <div class='sidebar-menu h-full d-flex flex-column m-0 pb-5 animate' class:br-10={!$settings.expandingSidebar}>
    <div class='w-50 top-0 flex-shrink-0 pointer-events-none {_status?.match(/offline/i) ? `h-25` : `${VERSION.platform === `darwin` && !fullScreen ? `h-25` : `h-0`}`}' class:status-transition={statusTransition}/>
    {#if !SUPPORTS.isAndroid}
      <div class='d-flex align-items-center justify-content-center z-102' style='width: var(--sidebar-width); margin-top:{`1rem`} !important'>
        <SidebarLink click={goBack} icon='moveleft' css='p-0 m-0 ml-5 h-auto w-30' innerCss='rounded-left-block' {page}>
          <MoveLeft size={'2.5rem'} class='flex-shrink-0 rounded m-0' strokeWidth='2.5' color={$canGoBack ? 'currentColor' : 'var(--gray-color-very-dim)'} />
        </SidebarLink>
        <SidebarLink click={goForward} icon='moveright' css='p-0 m-0 h-auto w-30' innerCss='rounded-right-block' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'}>
          <MoveRight size={'2.5rem'} class='flex-shrink-0 rounded m-0' strokeWidth='2.5' color={$canGoForward ? 'currentColor' : 'var(--gray-color-very-dim)'} />
        </SidebarLink>
      </div>
      <img src='./icon_filled.png' tabindex='-1' class='w-50 h-50 m-10 pointer d-sm-h-none p-5' alt='ico' use:click={() => { $view = null; window.dispatchEvent(new Event('overlay-check')); page = 'home' }} />
    {/if}
    <SidebarLink click={() => { page = 'home'; if ($view) $view = null }} _page='home' icon='home' text='Home' css='{!SUPPORTS.isAndroid ? `mt-md-h-auto` : ``}' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Home size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    <SidebarLink click={() => { page = 'search'; if ($view) $view = null }} _page='search' icon='search' text='Search' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Search size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' stroke-width='2.5' stroke='currentColor' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    <SidebarLink click={() => { page = 'schedule' }} _page='schedule' icon='schedule' text='Schedule' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <CalendarSearch size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    {#if $media?.media || (playPage && (Object.keys($media).length > 0))}
      {@const currentMedia = $view}
      {@const active = $view && !$notifyView && !$profileView && !$actionPrompt && 'active'}
      {@const wasOverlay = ($view || $profileView || $notifyView || $actionPrompt || $rss)}
      <SidebarLink click={() => {
        if (playPage && (page === 'player') && !wasOverlay) {
          playPage = false
        }
        if (playPage) {
          page = 'player'
        } else {
          $view = (currentMedia?.id === $media?.media.id && active ? null : $media?.media)
        }
      }} rbClick={() => { if ($media?.media) $view = (currentMedia?.id === $media.media.id && active ? null : $media.media) }} _page={playPage ? 'player' : ''} icon='queue_music' text={$media?.display ? 'Last Watched' : 'Now Playing'} {page} overlay={active} nowPlaying={!playPage && ($view?.id === $media?.media?.id)} let:active>
        <svelte:component this={playPage ? TvMinimalPlay : $media?.display ? History : ListVideo} size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
      </SidebarLink>
    {/if}
    <SidebarLink click={() => { page = 'watchtogether' }} _page='watchtogether' icon='groups' text='Watch Together' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Users size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    <SidebarLink click={() => { page = 'torrents' }} _page='torrents' icon='download' text='Torrents' css='d-sm-h-none' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Download size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    {#if $settings.donate && !SUPPORTS.isAndroid}
      <SidebarLink click={() => { IPC.emit('open', 'https://github.com/sponsors/RockinChaos/') }} icon='favorite' text='Support This App' css='mt-md-h-auto d-sm-h-none' {page} let:active let:hovering>
        <Heart size={btnSize} class='flex-shrink-0 p-5 m-5 rounded fill-1 donate' strokeWidth='2.5' fill='currentColor' style='--fill-button-color: {hovering ? `var(--gray-color-very-dim)` : `var(--quattuordenary-color)`}' />
      </SidebarLink>
    {/if}
    {#if $updateState === 'downloading'}
      <SidebarLink click={() => { toast('Update is downloading...', { description: 'This may take a moment, the update will be ready shortly.' }) }} icon='download' text='Update Downloading...' css='{!$settings.donate && !SUPPORTS.isAndroid ? `mt-md-h-auto` : ``} d-sm-h-none' {page} let:active let:hovering>
        <CloudDownload size={btnSize} class='flex-shrink-0 p-5 m-5 rounded fill-1' strokeWidth='2.5' color='currentColor' style='--fill-button-color: {hovering ? `var(--gray-color-very-dim)` : `var(--tertiary-color-light)`}' />
      </SidebarLink>
    {:else if $updateState === 'ready' || $updateState === 'ignored'}
      <SidebarLink click={() => { $updateState = 'ready' }} icon='download' text='Update Available!' css='{!$settings.donate && !SUPPORTS.isAndroid ? `mt-md-h-auto` : ``} d-sm-h-none' {page} let:active let:hovering>
        <CloudDownload size={btnSize} class='flex-shrink-0 p-5 m-5 rounded fill-1' strokeWidth='2.5' color='currentColor' style='--fill-button-color: {hovering ? `var(--gray-color-very-dim)` : `var(--success-color-light)`}' />
      </SidebarLink>
    {/if}
    <SidebarLink click={() => { $notifyView = !$notifyView }} icon='bell' text='Notifications' css='{!$settings.donate && $updateState !== `downloading` && $updateState !== `ready` && $updateState !== `ignored` && !SUPPORTS.isAndroid ? `mt-md-h-auto` : ``}' {page} overlay={!$actionPrompt && $notifyView && 'notify'} nowPlaying={$view} let:active let:hovering>
      {#if $hasUnreadNotifications && $hasUnreadNotifications > 0}
        <BellDot size={btnSize} class='flex-shrink-0 p-5 m-5 rounded fill-1 notify' strokeWidth='2.5' color='currentColor' style='--fill-button-color: {hovering ? `var(--gray-color-very-dim)` : `var(--notify-color)`}' />
      {:else}
        <Bell size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
      {/if}
    </SidebarLink>
    <SidebarLink click={() => { page = 'settings' }} _page='settings' icon='settings' text='Settings' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Settings size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    {#if !SUPPORTS.isAndroid}
      <SidebarLink click={() => { $profileView = !$profileView }} icon='login' text={Helper.getUser() ? 'Profiles' : 'Login'} {page} overlay={!$notifyView && !$actionPrompt && $profileView && 'profile'} nowPlaying={$view} image={Helper.getUserAvatar()}>
        <LogIn size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' />
      </SidebarLink>
    {/if}
  </div>
</div>

<style>
  .sidebar .animate :global(.donate) {
    animation: pink_glow 1s ease-in-out infinite alternate;
    will-change: drop-shadow;
  }
  .sidebar .animate :global(.notify) {
    animation: purple_glow 1s ease-in-out infinite alternate, bell_shake 10s infinite;
    will-change: drop-shadow;
  }
  .sidebar :global(.fill-1) {
    color: var(--fill-button-color);
    text-shadow: 0 0 1rem var(--fill-button-color);
  }
  .sidebar {
    background: none !important;
    overflow-y: unset;
    overflow-x: visible;
    left: unset;
  }
  .sidebar.animated, .sidebar-overlay.animated {
    transition: width .8s cubic-bezier(0.25, 0.8, 0.25, 1), left .8s cubic-bezier(0.25, 0.8, 0.25, 1) !important;
  }
  .sidebar.animated:hover {
    width: 22rem
  }
  .sidebar-overlay {
    width: var(--sidebar-width);
    background: var(--sidebar-gradient);
    backdrop-filter: blur(2px);
  }
  .sidebar.animated:hover .sidebar-overlay {
    width: 63rem
  }
  .br-10 {
    border-right: .10rem var(--border-color-sp) solid !important;
  }
</style>