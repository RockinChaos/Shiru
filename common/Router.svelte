<script>
  import Home from '@/views/Home/Home.svelte'
  import MediaHandler, { nowPlaying as media } from '@/views/Player/MediaHandler.svelte'
  import Settings from '@/views/Settings/Settings.svelte'
  import WatchTogether from '@/views/WatchTogether/WatchTogether.svelte'
  import AiringSchedule from '@/views/AiringSchedule.svelte'
  import ViewTorrent from '@/views/TorrentManager/TorrentManager.svelte'
  import Miniplayer, { isMobile, isSuperSmall } from '@/views/Player/Miniplayer.svelte'
  import Search from '@/views/Search.svelte'
  import { cache, caches } from '@/modules/cache.js'
  import { search, key } from '@/modules/sections.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { status } from '@/modules/networking.js'

  export let page = 'home'
  export let overlay = []
  export let playPage = false
  export let statusTransition = false

  export let miniplayerPadding = getPadding()
  export let miniplayerActive = false
  setInterval(() => (miniplayerPadding = getPadding()), 500)
  function getPadding() {
    const miniplayerTop = cache.getEntry(caches.GENERAL, 'posMiniplayer')?.includes('top')
    let pixelPadding
    if ($isMobile) pixelPadding = miniplayerTop ? 150 : 220
    else pixelPadding = (parseFloat(cache.getEntry(caches.GENERAL, 'widthMiniplayer')) || ($isSuperSmall ? 0.25 : 0.15)) * window.innerWidth * (11 / 16)
    return (miniplayerTop ? 'padding-top: ' : 'padding-bottom: ') + `${pixelPadding}px !important`
  }

  $: miniplayerActive = !(playPage || !$media || !Object.keys($media).length || $media?.display)
  $: visible = !overlay.includes('torrent') && !overlay.includes('notifications') && !overlay.includes('profiles') && !overlay.includes('minimizetray') && !overlay.includes('trailer') && !playPage && !$media?.display
  $: miniplayer = ($media && (Object.keys($media).length > 0)) && ((page !== 'player' && visible) || (overlay.includes('viewanime') && visible))
</script>
<div class='w-full h-full position-absolute overflow-hidden' class:invisible={!($media && (Object.keys($media).length > 0)) || (playPage && overlay.includes('viewanime')) || (!visible && (page !== 'player'))}>
  <Miniplayer active={miniplayer} class='bg-dark-light rounded-10 z-100 miniplayer-border {(page === `player` && !overlay.includes(`viewanime`)) ? `h-full` : ``}' padding='2rem' bind:page bind:overlay>
    <MediaHandler {miniplayer} bind:page bind:overlay bind:playPage />
  </Miniplayer>
</div>

{#if page === 'settings'}
  <Settings bind:playPage bind:overlay bind:statusTransition miniplayerPadding={miniplayerActive ? miniplayerPadding : ''} />
{:else if page === 'home'}
  <Home />
{:else if page === 'search'}
  <Search search={search} key={key}/>
{:else if page === 'schedule'}
  <AiringSchedule />
{:else if page === 'watchtogether'}
  <WatchTogether />
{:else if page === 'torrents'}
  <ViewTorrent class='overflow-y-scroll overflow-x-hidden' miniplayerPadding={miniplayerActive ? miniplayerPadding : ''}/>
{/if}