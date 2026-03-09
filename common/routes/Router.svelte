<script>
  import HomePage from '@/routes/home/HomePage.svelte'
  import MediaHandler, { nowPlaying as media } from '@/components/MediaHandler.svelte'
  import SettingsPage from '@/routes/settings/SettingsPage.svelte'
  import WatchTogetherPage from '@/routes/w2g/WatchTogetherPage.svelte'
  import SchedulePage from '@/routes/SchedulePage.svelte'
  import TorrentPage from '@/routes/torrentManager/TorrentPage.svelte'
  import Miniplayer from '@/components/Miniplayer.svelte'
  import SearchPage from '@/routes/search/SearchPage.svelte'
  import { writable } from 'simple-store-svelte'
  import { search, key } from '@/modules/sections.js'
  import { page, modal, playPage } from '@/modules/navigation.js'

  export let statusTransition = false

  const playbackPaused = writable(true)
  const miniplayerShelved = writable(false)

  $: visible = !$modal[modal.TORRENT_MENU] && !$modal[modal.NOTIFICATIONS] && !$modal[modal.PROFILE] && !$modal[modal.MINIMIZE_PROMPT] && !$modal[modal.TRAILER] && !$playPage && !$media?.display
  $: miniplayer = ($media && (Object.keys($media).length > 0)) && (($page !== page.PLAYER && visible) || ($modal[modal.ANIME_DETAILS] && visible))
</script>
<div class='w-full h-full position-absolute overflow-hidden' class:invisible={!($media && (Object.keys($media).length > 0)) || ($playPage && $modal[modal.ANIME_DETAILS]) || (!visible && ($page !== page.PLAYER))}>
  <Miniplayer active={miniplayer} bind:playbackPaused={$playbackPaused} bind:shelved={$miniplayerShelved} class='bg-dark-light rounded-10 {($page === page.PLAYER && !$modal[modal.ANIME_DETAILS]) ? `h-full` : ``}' >
    <MediaHandler {miniplayer} bind:playbackPaused={$playbackPaused} bind:miniplayerShelved={$miniplayerShelved} />
  </Miniplayer>
</div>

{#if $page === page.SETTINGS}
  <SettingsPage bind:statusTransition/>
{:else if $page === page.HOME}
  <HomePage />
{:else if $page === page.SEARCH}
  <SearchPage search={search} key={key}/>
{:else if $page === page.SCHEDULE}
  <SchedulePage />
{:else if $page === page.WATCH_TOGETHER}
  <WatchTogetherPage />
{:else if $page === page.TORRENT_MANAGER}
  <TorrentPage class='overflow-y-scroll overflow-x-hidden'/>
{/if}