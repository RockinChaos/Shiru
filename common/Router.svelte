<script context='module'>
  import { readable } from 'simple-store-svelte'

  const mql = matchMedia('(min-width: 769px)')
  const isMobile = readable(!mql.matches, set => {
    const check = ({ matches }) => set(!matches)
    mql.addEventListener('change', check)
    return () => mql.removeEventListener('change', check)
  })
</script>

<script>
  import Home from './views/Home/Home.svelte'
  import MediaHandler from './views/Player/MediaHandler.svelte'
  import Settings from '@/views/Settings/Settings.svelte'
  import WatchTogether from './views/WatchTogether/WatchTogether.svelte'
  import Miniplayer from 'svelte-miniplayer'
  import Search, { search } from './views/Search.svelte'
  import AiringSchedule from './views/AiringSchedule.svelte'

  export let page = 'home'
  export let overlay = []

  $: minwidth = $isMobile ? '200px' : '35rem'
  $: maxwidth = $isMobile ? '200px' : '60rem'
  $: $search = page === 'search' && $search.scheduleList ? { format: [], format_not: [], status: [], status_not: [] } : { format: [], format_not: [], status: [], status_not: [], ...$search }
  $: visible = !overlay.includes('torrent') && !overlay.includes('notifications') && !overlay.includes('profiles') && !overlay.includes('minimizetray')
</script>

<div class='w-full h-full position-absolute overflow-hidden'>
  <Miniplayer active={(page !== 'player' && visible) || (overlay.includes('viewanime') && visible)} class='bg-dark-light z-100 {(page === `player` && !overlay.includes(`viewanime`)) ? `h-full` : ``}' {minwidth} {maxwidth} width='300px' padding='2rem' resize={!$isMobile}>
    <MediaHandler miniplayer={page !== 'player' || overlay.includes('viewanime')} bind:page bind:overlay />
  </Miniplayer>
</div>
{#if page === 'settings'}
  <Settings />
{:else if page === 'home'}
  <Home />
{:else if page === 'search'}
  <Search />
{:else if page === 'schedule'}
  <AiringSchedule />
{:else if page === 'watchtogether'}
  <WatchTogether />
{/if}
