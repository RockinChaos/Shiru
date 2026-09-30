<script>
  import { Home, Search, Users, Download, CalendarSearch, Settings, Bell, BellDot, ListVideo, LogIn, CloudDownload, Heart, TvMinimalPlay, History } from 'lucide-svelte'
  import NavLink from '@/components/navigation/components/NavLink.svelte'
  import { page, modal, playPage } from '@/modules/navigation.js'
  import { unreadCount } from '@/modules/notification/manager.js'
  import { nowPlaying } from '@/components/MediaHandler.svelte'
  import { updateState } from '@/modals/UpdateModal.svelte'
  import Helper from '@/modules/providers/helper.js'
  import { settings } from '@/modules/settings.js'
  import { toast } from '@/modules/lib/toast.js'
  import { COMMON } from '@/modules/bridge.js'

  /** @type {string} */
  export let item
  /** @type {boolean} */
  export let drawer = false
  /** @type {boolean} */
  export let sidebar = false
  /** @type {string} */
  export let size = '3.6rem'
  /** @type {() => void} */
  export let closeDrawer = () => {}

  /** @type {string} */
  $: iconCss = drawer ? '' : 'flex-shrink-0 p-5 m-5 rounded'
  /** @type {boolean} */
  $: expandableSidebar = sidebar && $settings.expandingSidebar

  /**
   * Returns the click handler for a given nav item
   *
   * @param {string} item The item key (page route, modal id, or special string)
   * @returns {() => void}
   */
  function getClick(item) {
    if (item === 'DONATE') return () => { closeDrawer(); COMMON.openURI('https://contribute.shiru.app/') }
    else if (item === 'UPDATE_DOWNLOADING') return () => { closeDrawer(); toast.info('Update is downloading...', { description: 'This may take a moment, the update will be ready shortly.' }) }
    else if (item === 'UPDATE_READY') {
      return () => {
        closeDrawer()
        if ($updateState !== 'ready') updateState.set('ready')
        else modal.open(modal.UPDATE_PROMPT)
      }
    } else if (item === modal.ANIME_DETAILS) {
      return () => {
        closeDrawer()
        if ($playPage && ($page === page.PLAYER) && !($modal && modal.length)) playPage.set(false)
        if ($playPage) {
          page.navigateTo(page.PLAYER)
        } else if ($modal[modal.ANIME_DETAILS]?.data?.id === $nowPlaying?.media?.id && modal.focused === modal.ANIME_DETAILS) {
          modal.close(modal.ANIME_DETAILS)
        } else {
          modal.open(modal.ANIME_DETAILS, $nowPlaying?.media)
        }
      }
    } else if (item === 'ANIME_DETAILS_ALT') {
      return () => {
        closeDrawer()
        if (!$nowPlaying?.media) return
        if ($modal[modal.ANIME_DETAILS]?.data?.id === $nowPlaying?.media?.id && modal.focused === modal.ANIME_DETAILS) {
          modal.close(modal.ANIME_DETAILS)
        } else {
          modal.open(modal.ANIME_DETAILS, $nowPlaying.media)
        }
      }
    } else if (Object.values(page).includes(item)) return () => { closeDrawer(); page.navigateTo(item) }
    return () => { closeDrawer(); modal.toggle(item) }
  }
</script>

{#if item === page.HOME}
  <NavLink click={getClick(item)} page={page.HOME} text='Home' class={$$restProps.class} {drawer} {sidebar}>
    <Home class={iconCss} style='height: {size}; width: {size};' strokeWidth='2.5' />
  </NavLink>
{:else if item === page.SEARCH}
  <NavLink click={getClick(item)} page={page.SEARCH} text='Search' class={$$restProps.class} {drawer} {sidebar}>
    <Search class={iconCss} style='height: {size}; width: {size};' strokeWidth='2.5' />
  </NavLink>
{:else if item === page.SCHEDULE}
  <NavLink click={getClick(item)} page={page.SCHEDULE} text='Schedule' class={$$restProps.class} {drawer} {sidebar}>
    <CalendarSearch class={iconCss} style='height: {size}; width: {size};' strokeWidth='2.5' />
  </NavLink>
{:else if item === modal.ANIME_DETAILS}
  <NavLink
      click={getClick(item)}
      altClick={getClick('ANIME_DETAILS_ALT')}
      page={$playPage ? page.PLAYER : null}
      modal={modal.ANIME_DETAILS}
      text={$nowPlaying?.display ? `${drawer || expandableSidebar ? 'Last ' : ''}Watched` : `${drawer || expandableSidebar ? 'Now ' : ''}Playing`}
      class={$$restProps.class} {drawer} {sidebar}>
    <svelte:component this={$playPage ? TvMinimalPlay : $nowPlaying?.display ? History : ListVideo} class={iconCss} style='height: {size}; width: {size};' strokeWidth='2.5' />
  </NavLink>
{:else if item === page.WATCH_TOGETHER}
  <NavLink click={getClick(item)} page={page.WATCH_TOGETHER} text={drawer || expandableSidebar ? 'Watch Together' : 'Lobby'} class={$$restProps.class} {drawer} {sidebar}>
    <Users class={iconCss} style='height: {size}; width: {size};' strokeWidth='2.5' />
  </NavLink>
{:else if item === page.TORRENT_MANAGER}
  <NavLink click={getClick(item)} page={page.TORRENT_MANAGER} text='Manager' class={$$restProps.class} {drawer} {sidebar}>
    <Download class={iconCss} style='height: {size}; width: {size};' strokeWidth='2.5' />
  </NavLink>
{:else if item === 'UPDATE_DOWNLOADING'}
  <NavLink click={getClick(item)} modal={modal.UPDATE_PROMPT} text='Updating' class={$$restProps.class} {drawer} {sidebar} let:hovering>
    <CloudDownload class='{iconCss} fill-1' strokeWidth='2.5' style='height: {size}; width: {size}; --fill-button-color: { hovering ? `var(--gray-color-very-dim)` : `var(--tertiary-color-light)` }' />
  </NavLink>
{:else if item === 'UPDATE_READY'}
  <NavLink click={getClick(item)} modal={modal.UPDATE_PROMPT} text='Upgrade' class={$$restProps.class} {drawer} {sidebar} let:hovering>
    <CloudDownload class='{iconCss} fill-1' strokeWidth='2.5' style='height: {size}; width: {size}; --fill-button-color: { hovering ? `var(--gray-color-very-dim)` : `var(--success-color-light)` }' />
  </NavLink>
{:else if item === modal.NOTIFICATIONS}
  <NavLink click={getClick(item)} modal={modal.NOTIFICATIONS} text={drawer || expandableSidebar ? 'Notifications' : 'Inbox'} class={$$restProps.class} {drawer} {sidebar} let:hovering let:active>
    {#if $unreadCount && $unreadCount > 0}
      <div class='d-flex align-items-center noselect-transition' class:noselect={!active}>
        <BellDot class='{iconCss} fill-1 notify' strokeWidth='2.5' style='height: {size}; width: {size}; --fill-button-color: { hovering ? `var(--gray-color-very-dim)` : `var(--notify-color)` }' />
      </div>
    {:else}
      <Bell class={iconCss} style='height: {size}; width: {size};' strokeWidth='2.5' />
    {/if}
  </NavLink>
{:else if item === page.SETTINGS}
  <NavLink click={getClick(item)} page={page.SETTINGS} text='Settings' class={$$restProps.class} {drawer} {sidebar}>
    <Settings class={iconCss} style='height: {size}; width: {size};' strokeWidth='2.5' />
  </NavLink>
{:else if item === modal.PROFILE}
  <NavLink click={getClick(item)} modal={modal.PROFILE} text={Helper.getUser() ? 'Profiles' : 'Login'} class={$$restProps.class} {drawer} {sidebar} let:active>
    {#if Helper.getUserAvatar()}
      <img src={Helper.getUserAvatar()} class={`${drawer ? '' : 'p-3 m-5'} noselect-transition`} style='height: {size}; width: {size};' class:noselect={!active} alt='profile' />
    {:else}
      <LogIn class={iconCss} style='height: {size}; width: {size};' strokeWidth='2.5' />
    {/if}
  </NavLink>
{:else if item === 'DONATE'}
  <NavLink click={getClick(item)} text='Donate' class={$$restProps.class} {drawer} {sidebar} let:hovering>
    <div class='d-flex align-items-center noselect'>
      <Heart class='{iconCss} fill-1 donate' strokeWidth='2.5' fill='currentColor' style='height: {size}; width: {size}; --fill-button-color: { hovering ? `var(--gray-color-very-dim)` : `var(--quattuordenary-color)` }' />
    </div>
  </NavLink>
{/if}

<style>
  .noselect {
    opacity: .5;
  }
  .noselect-transition {
    transition: opacity .8s cubic-bezier(.25, .8, .25, 1);
  }
  :global(.donate) {
    animation: pink_glow 1s ease-in-out infinite alternate;
    will-change: drop-shadow;
  }
  :global(.notify) {
    will-change: drop-shadow;
    animation: purple_glow 1s ease-in-out infinite alternate, bell_shake 10s infinite;
  }
  :global(.fill-1) {
    color: var(--fill-button-color);
    text-shadow: 0 0 1rem var(--fill-button-color);
  }
</style>