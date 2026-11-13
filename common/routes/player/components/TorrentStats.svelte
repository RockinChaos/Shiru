<script>
  import { Users, ArrowDown, ArrowUp, Zap } from 'lucide-svelte'
  import { fastPrettyBytes } from '@/modules/util.js'
  import { currentStats } from '@/modules/torrent.js'

  export let visible = true

  const torrent = {}

  $: updateStats($currentStats)

  /**
   * Updates the displayed peer count and transfer speeds.
   * @param {{numPeers?: number, uploadSpeed?: number, downloadSpeed?: number}} detail
   * @returns {void}
   */
  function updateStats (detail) {
    torrent.peers = detail.numPeers || 0
    torrent.up = detail.uploadSpeed || 0
    torrent.down = detail.downloadSpeed || 0
  }
</script>

{#if visible}
  {#if $currentStats?.debrid}
    <span class='icon'><Zap class='pt-5 block-scale-30' strokeWidth={2.5} /></span>
    <span class='stats font-scale-24'>{$currentStats.debridProvider || 'Debrid'} · Instant</span>
  {:else}
    <span class='icon'><Users class='pt-5 block-scale-30' strokeWidth={3} /> </span>
    <span class='stats font-scale-24'>{torrent.peers || 0}</span>
    <span class='icon'><ArrowDown class='block-scale-30' /></span>
    <span class='stats font-scale-24'>{fastPrettyBytes(torrent.down)}/s</span>
    <span class='icon'><ArrowUp class='block-scale-30' /></span>
    <span class='stats font-scale-24'>{fastPrettyBytes(torrent.up)}/s</span>
  {/if}
{/if}

<style>
  .stats {
    font-size: 2.3rem;
    padding-top: 1.5rem;
    white-space: nowrap;
    font-weight: 600;
    font-family: Roboto, Arial, Helvetica, sans-serif;
  }

  .icon {
    font-size: 2.8rem;
    padding: 1.5rem;
    display: flex;
  }
</style>
