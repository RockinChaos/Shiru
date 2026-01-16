<script>
  import { Earth, WifiOff, CloudAlert } from 'lucide-svelte'
  import { status } from '@/modules/networking.js'
  import { SUPPORTS } from '@/modules/support.js'
  $: {
    const root = document.documentElement
    if ($status.match(/offline/i)) root.style.setProperty('--wrapper-offset', getComputedStyle(root).getPropertyValue('--statusbar-height').trim())
    else root.style.removeProperty('--wrapper-offset')
  }
</script>

<div class='overflow-hidden status-bar h-0' class:offline={!SUPPORTS.isAndroid && $status.match(/offline/i)} class:offline-safe={SUPPORTS.isAndroid && $status.match(/offline/i)}>
  <div class='z-101 position-absolute w-full d-flex align-items-center justify-content-center overflow-hidden status-bar h-0' class:offline={!SUPPORTS.isAndroid && $status.match(/offline/i)} class:offline-safe={SUPPORTS.isAndroid && $status.match(/offline/i)} class:padding-safe={SUPPORTS.isAndroid} class:bg-very-dark={$status.match(/offline/i)} class:bg-success={!$status.match(/offline/i)}>
    {#if $status === 'online'}
      <Earth size='1.8rem' strokeWidth='2.5' />
      <span class='ml-10 font-weight-semi-bold font-size-16'>Connection Restored</span>
    {:else if $status.match(/offline/i)}
      <svelte:component this={$status === 'offline' ? WifiOff : CloudAlert} size='1.8rem' strokeWidth='2.5' />
      <span class='ml-10 font-weight-semi-bold font-size-16'>{$status === 'offline' ? 'Offline' : 'AniList Outage'}</span>
    {/if}
  </div>
</div>

<style>
  .status-bar {
    transition: height 0.3s ease, padding-top 0.3s ease;
    transition-delay: 2s;
  }
  .status-bar.offline {
    height: var(--statusbar-height);
  }
  .status-bar.offline-safe {
    height: calc(var(--statusbar-height) + var(--safe-area-top));
  }
  .status-bar.offline-safe.padding-safe {
    padding-top: var(--safe-area-top);
  }
</style>