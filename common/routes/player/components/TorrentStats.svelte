<script>
  import { Users, ArrowDown, ArrowUp } from 'lucide-svelte'
  import { fastPrettyBytes } from '@/modules/util.js'
  import { TORRENT } from '@/modules/bridge.js'

  export let visible = true

  const torrent = {}
  TORRENT.onCurrentStats(updateStats)
  function updateStats (detail) {
    torrent.peers = detail.numPeers || 0
    torrent.up = detail.uploadSpeed || 0
    torrent.down = detail.downloadSpeed || 0
  }
</script>

{#if visible}
  <span class='icon'><Users class='pt-5 block-scale-30' strokeWidth={3} /> </span>
  <span class='stats font-scale-24'>{torrent.peers || 0}</span>
  <span class='icon'><ArrowDown class='block-scale-30' /></span>
  <span class='stats font-scale-24'>{fastPrettyBytes(torrent.down)}/s</span>
  <span class='icon'><ArrowUp class='block-scale-30' /></span>
  <span class='stats font-scale-24'>{fastPrettyBytes(torrent.up)}/s</span>
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
