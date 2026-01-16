<script context='module'>
  import { writable } from 'simple-store-svelte'
  import { click } from '@/modules/click.js'
  import WPC from '@/modules/wpc.js'
  import { matchPhrase } from '@/modules/util.js'
  import { settings } from '@/modules/settings.js'
  import { status } from '@/modules/networking.js'
  import { loadedTorrent, completedTorrents, seedingTorrents, stagingTorrents } from '@/modules/torrent.js'
  import ErrorCard from '@/components/cards/ErrorCard.svelte'
  import TorrentDetails from '@/views/TorrentManager/TorrentDetails.svelte'
  import { Search, RefreshCw, TriangleAlert, Package, Percent, Activity, Scale, Gauge, CloudDownload, CloudUpload, Sprout, Magnet, Timer } from 'lucide-svelte'
  const rescanning = writable(true)
  WPC.listen('rescan_done', () => rescanning.value = false)
</script>
<script>
  export let miniplayerPadding = ''

  let searchText = ''
  function filterResults(results, searchText) {
    const dedupe = results.filter((torrent, index, arr) => arr.findIndex(_torrent => _torrent.infoHash === torrent.infoHash) === index)
    if (!searchText?.length) return dedupe
    return dedupe.filter(({ name }) => matchPhrase(searchText, name, 0.4, false, true)) || []
  }
  $: disableRescan = ($seedingTorrents?.length + $stagingTorrents?.length + 1) >= settings.value.seedingLimit && !settings.value.torrentPersist
  $: filteredLoaded = matchPhrase(searchText, $loadedTorrent?.name, 0.4, false, true)
  $: filteredStaging = filterResults($stagingTorrents, searchText) || []
  $: filteredSeeding = filterResults($seedingTorrents, searchText) || []
  $: filteredCompleted = filterResults($completedTorrents, searchText) || []
  $: foundResults = !(searchText?.length && !filteredLoaded && !filteredStaging.length && !filteredSeeding.length && !filteredCompleted.length)
</script>

<div class='bg-dark h-full w-full root status-transition {$$restProps.class}' class:pt-safe-area={$$restProps.class && !$status.match(/offline/i)} style={miniplayerPadding}>
  <div class='w-full status-transition' class:pl-20={$$restProps.class} class:pt-28px={$$restProps.class && !$status.match(/offline/i)}>
    <h4 class='font-weight-bold m-0 mb-10'>Manage Torrents</h4>
    <div class='d-flex align-items-center'>
      <div class='input-group wm-600'>
        <Search size='2.6rem' strokeWidth='2.5' class='position-absolute z-10 text-dark-light h-full pl-10 pointer-events-none' />
        <input
          type='search'
          class='form-control bg-dark-very-light pl-40 rounded-1 h-40 text-truncate'
          autocomplete='off'
          spellcheck='false'
          data-option='search'
          placeholder='Filter torrents by text, or manually specify one by pasting a magnet link or torrent file' disabled={$rescanning} bind:value={searchText} />
      </div>
      <button type='button' use:click={() => { if (!disableRescan) { $rescanning = true; window.dispatchEvent(new Event('rescan')) } }} disabled={disableRescan || $rescanning} title={disableRescan ? 'Enable Persist Files or Increase Seeding Limit' : $rescanning ? 'Rescanning Cache...' : 'Rescan Cache'} class='btn btn-primary d-flex align-items-center justify-content-center ml-20 mr-20 font-scale-16 h-full' class:cursor-wait={$rescanning}><RefreshCw class='mr-10' size='1.8rem' strokeWidth='2.5'/><span>Rescan</span></button>
    </div>
  </div>
  <div class='d-none' class:d-inline-block={disableRescan}>
    <div class='alert bg-warning border-warning-dim text-warning-very-dim p-10 pl-15 mt-10 mb-5 d-flex {$$restProps.class ? `ml-20` : ``}'>
      <TriangleAlert class='flex-shrink-0' size='1.8rem' />
      <span class='ml-10'>You've reached your pre-download limit. To pre-download more torrents, stop seeding some, increase your seeding limit, or enable Persist Files in Client Settings.</span>
    </div>
  </div>
  <div class='d-flex flex-column w-full text-wrap text-break-word font-scale-16 mt-20'>
    <div class='d-flex flex-row mb-10 font-scale-18'>
      <div class='font-weight-bold p-5 ml-20 mw-150 flex-1 w-auto'>Name</div>
      <div class='font-weight-bold p-5 w-150 d-none d-md-block'><span class='d-none d-lg-block'>Size</span><Package class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150'><span class='d-none d-lg-block'>Progress</span><Percent class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150'><span class='d-none d-lg-block'>Status</span><Activity class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150 d-none d-md-block'><span class='d-none d-lg-block'>Ratio</span><Scale class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150 d-none d-md-block'><span class='d-none d-lg-block'>Down Speed</span><CloudDownload class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150 d-block d-md-none'><span class='d-none d-lg-block'>Speed</span><Gauge class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150 d-none d-md-block'><span class='d-none d-lg-block'>Up Speed</span><CloudUpload class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150'><span class='d-none d-lg-block'>Seeders</span><Sprout class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-150 d-none d-md-block'><span class='d-none d-lg-block'>Leechers</span><Magnet class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-115 d-none d-md-block'><span class='d-none d-lg-block'>ETA</span><Timer class='d-lg-none' size='2rem'/></div>
      <div class='font-weight-bold p-5 w-40 mr-5 mr-md-20 flex-shrink-0'/>
    </div>
    {#if foundResults}
      {#if !searchText?.length || filteredLoaded}
        <TorrentDetails bind:data={$loadedTorrent} current={true} {disableRescan} />
      {/if}
      {#each filteredStaging as torrent (torrent.infoHash)}
        <TorrentDetails data={torrent} {disableRescan}/>
      {/each}
      {#each filteredSeeding as torrent (torrent.infoHash)}
        <TorrentDetails data={torrent} {disableRescan}/>
      {/each}
      {#each filteredCompleted as torrent (torrent.infoHash)}
        <TorrentDetails data={torrent} completed={true} {disableRescan}/>
      {/each}
    {:else}
      <ErrorCard promise={{ errors: [ { message: 'found no results' }]}}/>
    {/if}
  </div>
</div>