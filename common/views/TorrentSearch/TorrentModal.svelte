<script context='module'>
  import SoftModal from '@/components/SoftModal.svelte'
  import TorrentMenu from '@/views/TorrentSearch/TorrentMenu.svelte'
  import { findInCurrent } from '@/views/Player/MediaHandler.svelte'
  import { writable } from 'simple-store-svelte'

  export const rss = writable(null)

  export function playAnime (media, episode = 1, force = false) {
    episode = Number(episode)
    episode = isNaN(episode) ? 1 : episode
    if (!force && findInCurrent({ media, episode })) {
      window.dispatchEvent(new Event('overlay-check'))
      window.dispatchEvent(new Event('player'))
      return
    }
    rss.set({ media, episode })
  }
</script>

<script>
  export let overlay

  $: search = $rss
  function close () {
    setTimeout(() => { if (overlay.includes('torrent')) overlay = overlay.filter(item => item !== 'torrent') })
    $rss = null
  }

  $: if (search && !overlay.includes('torrent')) overlay = [...overlay, 'torrent']
  window.addEventListener('overlay-check', () => { if (search) close() })
</script>

<SoftModal class='m-0 w-full wm-1150 h-full rounded bg-very-dark pt-0 mx-20' bind:showModal={search} {close} id='torrentModal'>
  {#if search}
    <TorrentMenu {search} {close} />
  {/if}
</SoftModal>