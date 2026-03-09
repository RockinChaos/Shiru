<script>
  import { nowPlaying as media } from '@/components/MediaHandler.svelte'
  import { hasUnreadNotifications } from '@/modals/NotificationsModal.svelte'
  import { updateState } from '@/modals/UpdateModal.svelte'
  import { settings } from '@/modules/settings.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { status } from '@/modules/networking.js'
  import { click } from '@/modules/click.js'
  import { toast } from 'svelte-sonner'
  import Helper from '@/modules/helper.js'
  import { page, modal, playPage } from '@/modules/navigation.js'
  import { IPC, ELECTRON, VERSION } from '@/modules/bridge.js'
  import { goBack, goForward, canGoBack, canGoForward } from '@/modules/navigation.js'
  import SidebarLink from '@/components/navigation/SidebarLink.svelte'
  import { MoveLeft, MoveRight, CalendarSearch, Download, CloudDownload, Heart, Home, Search, ListVideo, History, TvMinimalPlay, LogIn, Settings, Users, Bell, BellDot } from 'lucide-svelte'

  const btnSize = !SUPPORTS.isAndroid ? '3.1rem' : '3.6rem'
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
        <SidebarLink click={goBack} icon='moveleft' css='p-0 m-0 ml-5 h-auto w-30' innerCss='rounded-left-block' >
          <MoveLeft size={'2.5rem'} class='flex-shrink-0 rounded m-0' strokeWidth='2.5' color={$canGoBack ? 'currentColor' : 'var(--gray-color-very-dim)'} />
        </SidebarLink>
        <SidebarLink click={goForward} icon='moveright' css='p-0 m-0 h-auto w-30' innerCss='rounded-right-block' >
          <MoveRight size={'2.5rem'} class='flex-shrink-0 rounded m-0' strokeWidth='2.5' color={$canGoForward ? 'currentColor' : 'var(--gray-color-very-dim)'} />
        </SidebarLink>
      </div>
      <img src='./icon_filled.png' tabindex='-1' class='w-50 h-50 m-10 pointer d-sm-h-none p-5' alt='ico' use:click={() => page.navigateTo(page.HOME)} />
    {/if}
    <SidebarLink click={() => page.navigateTo(page.HOME)} _page={page.HOME} icon='home' text='Home' css='{!SUPPORTS.isAndroid ? `mt-md-h-auto` : ``}' let:active>
      <Home size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    <SidebarLink click={() => page.navigateTo(page.SEARCH)} _page={page.SEARCH} icon='search' text='Search' let:active>
      <Search size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' stroke-width='2.5' stroke='currentColor' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    <SidebarLink click={() => page.navigateTo(page.SCHEDULE)} _page={page.SCHEDULE} icon='schedule' text='Schedule' let:active>
      <CalendarSearch size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    {#if $media?.media || ($playPage && (Object.keys($media).length > 0))}
      {@const currentMedia = $modal[modal.ANIME_DETAILS]?.data}
      {@const wasModal = $modal && modal.length}
      <SidebarLink
        click={() => {
          if ($playPage && ($page === page.PLAYER) && !wasModal) {
            playPage.set(false)
          }
          if ($playPage) {
            page.navigateTo(page.PLAYER)
          } else if (currentMedia?.id === $media?.media.id && modal.length === 1) {
            modal.close(modal.ANIME_DETAILS)
          } else {
            modal.open(modal.ANIME_DETAILS, $media?.media)
          }
        }}
        rbClick={() => {
          if ($media?.media) {
            if (currentMedia?.id === $media.media.id && modal.length === 1) {
              modal.close(modal.ANIME_DETAILS)
            } else {
              modal.open(modal.ANIME_DETAILS, $media.media)
            }
          }
        }} _page={$playPage ? page.PLAYER : null} icon='queue_music' text={$media?.display ? 'Last Watched' : 'Now Playing'} _modal={modal.ANIME_DETAILS} let:active>
        <svelte:component this={$playPage ? TvMinimalPlay : $media?.display ? History : ListVideo} size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active && (currentMedia?.id === $media?.media?.id) ? 'currentColor' : 'var(--gray-color-very-dim)'} />
      </SidebarLink>
    {/if}
    <SidebarLink click={() => page.navigateTo(page.WATCH_TOGETHER)} _page={page.WATCH_TOGETHER} icon='groups' text='Watch Together' let:active>
      <Users size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    <SidebarLink click={() => page.navigateTo(page.TORRENT_MANAGER)} _page={page.TORRENT_MANAGER} icon='download' text='Torrents' css='d-sm-h-none' let:active>
      <Download size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    {#if $settings.donate && !SUPPORTS.isAndroid}
      <SidebarLink click={() => { IPC.emit('open', 'https://github.com/sponsors/RockinChaos/') }} icon='favorite' text='Support This App' css='mt-md-h-auto d-sm-h-none' let:active let:hovering>
        <Heart size={btnSize} class='flex-shrink-0 p-5 m-5 rounded fill-1 donate' strokeWidth='2.5' fill='currentColor' style='--fill-button-color: {hovering ? `var(--gray-color-very-dim)` : `var(--quattuordenary-color)`}' />
      </SidebarLink>
    {/if}
    {#if $updateState === 'downloading'}
      <SidebarLink click={() => { toast('Update is downloading...', { description: 'This may take a moment, the update will be ready shortly.' }) }} icon='download' text='Update Downloading...' css='{!$settings.donate && !SUPPORTS.isAndroid ? `mt-md-h-auto` : ``} d-sm-h-none' _modal={modal.UPDATE_PROMPT} let:active let:hovering>
        <CloudDownload size={btnSize} class='flex-shrink-0 p-5 m-5 rounded fill-1' strokeWidth='2.5' color='currentColor' style='--fill-button-color: {hovering ? `var(--gray-color-very-dim)` : `var(--tertiary-color-light)`}' />
      </SidebarLink>
    {:else if $updateState === 'ready' || $updateState === 'ignored' || $updateState === 'aborted'}
      <SidebarLink click={() => { if ($updateState !== 'ready') updateState.set('ready'); else modal.open(modal.UPDATE_PROMPT) }} icon='download' text='Update Available!' css='{!$settings.donate && !SUPPORTS.isAndroid ? `mt-md-h-auto` : ``} d-sm-h-none' _modal={modal.UPDATE_PROMPT} let:active let:hovering>
        <CloudDownload size={btnSize} class='flex-shrink-0 p-5 m-5 rounded fill-1' strokeWidth='2.5' color='currentColor' style='--fill-button-color: {hovering ? `var(--gray-color-very-dim)` : `var(--success-color-light)`}' />
      </SidebarLink>
    {/if}
    <SidebarLink click={() => { modal.toggle(modal.NOTIFICATIONS) }} icon='bell' text='Notifications' css='{!$settings.donate && $updateState !== `downloading` && $updateState !== `ready` && $updateState !== `ignored` && !SUPPORTS.isAndroid ? `mt-md-h-auto` : ``}' _modal={modal.NOTIFICATIONS} let:active let:hovering>
      {#if $hasUnreadNotifications && $hasUnreadNotifications > 0}
        <BellDot size={btnSize} class='flex-shrink-0 p-5 m-5 rounded fill-1 notify' strokeWidth='2.5' color='currentColor' style='--fill-button-color: {hovering ? `var(--gray-color-very-dim)` : `var(--notify-color)`}' />
      {:else}
        <Bell size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
      {/if}
    </SidebarLink>
    <SidebarLink click={() => page.navigateTo(page.SETTINGS)} _page={page.SETTINGS} icon='settings' text='Settings' let:active>
      <Settings size={btnSize} class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </SidebarLink>
    {#if !SUPPORTS.isAndroid}
      <SidebarLink click={() => modal.toggle(modal.PROFILE)} icon='login' text={Helper.getUser() ? 'Profiles' : 'Login'} _modal={modal.PROFILE} image={Helper.getUserAvatar()}>
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
</style>