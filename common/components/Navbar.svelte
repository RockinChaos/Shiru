<script>
  import { getContext } from 'svelte'
  import { rss } from '@/views/TorrentSearch/TorrentModal.svelte'
  import { nowPlaying as media } from '@/views/Player/MediaHandler.svelte'
  import { profileView } from '@/components/Profiles.svelte'
  import { notifyView, hasUnreadNotifications } from '@/components/Notifications.svelte'
  import { actionPrompt } from '@/components/MinimizeTray.svelte'
  import NavbarLink from '@/components/NavbarLink.svelte'
  import { Home, Search, Users, Download, CalendarSearch, Settings, Bell, BellDot, ListVideo, History, TvMinimalPlay } from 'lucide-svelte'
  const view = getContext('view')
  export let page
  export let playPage
</script>

<nav class='navbar z-80 navbar-fixed-bottom d-block d-md-none border-0 bg-dark bt-10'>
  <div class='navbar-menu h-full d-flex flex-row justify-content-center align-items-center m-0 pb-5 animate'>
    <NavbarLink click={() => { page = 'home'; if ($view) $view = null }} _page='home' text='Home' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Home size='3.6rem' class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </NavbarLink>
    <NavbarLink click={() => { page = 'search'; if ($view) $view = null }} _page='search' icon='search' text='Search' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Search size='3.6rem' class='flex-shrink-0 p-5 m-5 rounded' stroke-width='2.5' stroke='currentColor' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </NavbarLink>
    <NavbarLink click={() => { page = 'schedule' }} _page='schedule' icon='schedule' text='Schedule' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <CalendarSearch size='3.6rem' class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </NavbarLink>
    {#if $media?.media || (playPage && (Object.keys($media).length > 0))}
      {@const currentMedia = $view}
      {@const active = $view && !$notifyView && !$profileView && !$actionPrompt && 'active'}
      {@const wasOverlay = ($view || $profileView || $notifyView || $actionPrompt || $rss)}
      <NavbarLink click={() => {
        if (playPage && (page === 'player') && !wasOverlay) {
          playPage = false
        }
        if (playPage) {
          page = 'player'
        } else {
          $view = (currentMedia?.id === $media?.media.id && active ? null : $media?.media)
        }
      }} rbClick={() => { if ($media?.media) $view = (currentMedia?.id === $media.media.id && active ? null : $media.media) }} _page={playPage ? 'player' : ''} icon='queue_music' text={$media?.display ? 'Last Watched' : 'Now Playing'} {page} overlay={active} nowPlaying={!playPage && ($view?.id === $media?.media?.id)} let:active>
        <svelte:component this={playPage ? TvMinimalPlay : $media?.display ? History : ListVideo} size='3.6rem' class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
      </NavbarLink>
    {/if}
    <NavbarLink click={() => { page = 'watchtogether' }} _page='watchtogether' icon='groups' text='Watch Together' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Users size='3.6rem' class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </NavbarLink>
    <NavbarLink click={() => { page = 'torrents' }} _page='torrents' icon='download' text='Torrents' css='d-none d-sm-block' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Download size='3.6rem' class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </NavbarLink>
    <NavbarLink click={() => { $notifyView = !$notifyView }} icon='bell' text='Notifications' {page} overlay={$notifyView && 'notify'} nowPlaying={$view} let:active let:hovering>
      {#if $hasUnreadNotifications &&  $hasUnreadNotifications > 0}
        <BellDot size='3.6rem' class='flex-shrink-0 p-5 m-5 rounded fill-1 notify' strokeWidth='2.5' color='currentColor' style='--fill-button-color: {hovering ? `var(--gray-color-very-dim)` : `var(--notify-color)`}'/>
      {:else}
        <Bell size='3.6rem' class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={$notifyView ? 'currentColor' : 'var(--gray-color-very-dim)'}/>
      {/if}
    </NavbarLink>
    <NavbarLink click={() => { page = 'settings' }} _page='settings' icon='settings' text='Settings' {page} overlay={($view || $profileView || $notifyView || $actionPrompt || $rss) && 'active'} let:active>
      <Settings size='3.6rem' class='flex-shrink-0 p-5 m-5 rounded' strokeWidth='2.5' color={active ? 'currentColor' : 'var(--gray-color-very-dim)'} />
    </NavbarLink>
  </div>
</nav>

<style>
  .navbar .animate :global(.donate) {
    animation: pink_glow 1s ease-in-out infinite alternate;
    will-change: drop-shadow;
  }
  .navbar .animate :global(.notify) {
    animation: purple_glow 1s ease-in-out infinite alternate, bell_shake 10s infinite;
    will-change: drop-shadow;
  }
  .navbar :global(.fill-1) {
    color: var(--fill-button-color);
    text-shadow: 0 0 1rem var(--fill-button-color);
  }
  .bt-10 {
    border-top: .10rem var(--border-color-sp) solid !important;
  }
</style>
