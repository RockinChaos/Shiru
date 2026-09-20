<script>
  import { Earth, WifiOff, CloudAlert, ClockAlert } from 'lucide-svelte'
  import { status, previousStatus } from '@/modules/networking.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { alToken } from '@/modules/settings.js'
  import { onDestroy } from 'svelte'

  let transition = true
  $: {
    const root = document.documentElement
    if ($status !== 'online') root.style.setProperty('--wrapper-offset', 'calc(var(--statusbar-height) + var(--safe-area-top))')
    else root.style.removeProperty('--wrapper-offset')
  }

  function onOrientation() {
    if ($status !== 'online') {
      transition = false
      requestAnimationFrame(() => (transition = true))
    }
  }

  if (SUPPORTS.isAndroid) {
    screen.orientation.addEventListener('change', onOrientation)
    onDestroy(() => screen.orientation.removeEventListener('change', onOrientation))
  }
</script>

<div class='overflow-hidden status-bar h-0' class:status-bar-transition={transition} class:offline={!SUPPORTS.isAndroid && $status !== 'online'} class:offline-safe={SUPPORTS.isAndroid && $status !== 'online'}>
  <div class='z-79 position-absolute d-flex align-items-center justify-content-center overflow-hidden status-bar h-0' style='width: calc(100% - var(--safe-area-navigation-right) - var(--safe-area-left))' class:status-bar-transition={transition} class:offline={!SUPPORTS.isAndroid && $status !== 'online'} class:offline-safe={SUPPORTS.isAndroid && $status !== 'online'} class:padding-safe={SUPPORTS.isAndroid} class:bg-very-dark={$status !== 'online' || previousStatus.value === 'limited_anilist'} class:bg-success={$status === 'online' && previousStatus.value !== 'limited_anilist'}>
    <div class='d-flex align-items-center justify-content-center w-full h-full px-md-80 px-20'>
      {#if $status === 'online'}
        <Earth class='flex-shrink-0' size='1.8rem' strokeWidth='2.5' />
        <span class='ml-10 font-weight-semi-bold font-size-16 text-truncate'>Connection Restored</span>
      {:else if $status === 'limited_anilist'}
        <ClockAlert class='flex-shrink-0' size='1.8rem' strokeWidth='2.5' />
        <span class='ml-10 font-weight-semi-bold font-size-16 text-truncate'>Anilist Rate Limited</span>
      {:else if $status.match(/offline/i)}
        <svelte:component this={$status === 'offline' ? WifiOff : CloudAlert} class='flex-shrink-0' size='1.8rem' strokeWidth='2.5' />
        <span class='ml-10 font-weight-semi-bold font-size-16 text-truncate'>{$status === 'offline' ? 'Offline' : alToken ? 'AniList Outage' : 'AniList Outage or Blocked, Try Signing In'}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .status-bar.offline {
    height: var(--statusbar-height);
  }
  .status-bar.offline-safe {
    height: calc(var(--statusbar-height) + var(--safe-area-top));
  }
  .status-bar.offline-safe.padding-safe {
    padding-top: var(--safe-area-top);
  }
  .status-bar-transition {
    transition: height 0.3s ease, padding-top 0.3s ease;
    transition-delay: 2s;
  }
  .status-bar:not(.status-bar-transition) {
    transition: none !important;
  }
</style>