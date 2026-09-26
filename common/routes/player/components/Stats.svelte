<script context='module'>
  import { writable } from 'simple-store-svelte'

  export const stats = writable(null)
  let togglePanel = null

  export function toggleStats() {
    togglePanel?.()
  }
</script>

<script>
  import { click } from '@/modules/lib/click.js'
  import { onDestroy } from 'svelte'
  import { X } from 'lucide-svelte'

  export let video
  export let paused
  export let miniplayer
  export let current
  export let playableFiles
  export let playFile

  let requestCallback = null
  let statsTimeout
  let destroyed = false
  function toggle() {
    if (!video || destroyed) return
    if (requestCallback) {
      $stats = null
      clearTimeout(statsTimeout)
      video.cancelVideoFrameCallback(requestCallback)
      requestCallback = null
    } else {
      requestCallback = video.requestVideoFrameCallback((a, b) => {
        if (destroyed) return
        $stats = {}
        handleStats(a, b, b)
      })
      if (paused) { // callback will not trigger until video is unpaused, just show basic stats for now...
        $stats = {}
        handleStats(performance.now(), { mediaTime: video.currentTime, presentedFrames: 1, processingDuration: 0 }, { mediaTime: video.currentTime, presentedFrames: 1 })
      }
    }
  }
  async function handleStats(now, metadata, lastmeta) {
    if ($stats && !destroyed) {
      const msbf = (metadata.mediaTime - lastmeta.mediaTime) / (metadata.presentedFrames - lastmeta.presentedFrames)
      const fps = (1 / msbf).toFixed(3)
      $stats = {
        fps,
        presented: metadata.presentedFrames,
        dropped: video.getVideoPlaybackQuality()?.droppedVideoFrames,
        processing: metadata.processingDuration + ' ms',
        viewport: video.clientWidth + 'x' + video.clientHeight,
        resolution: video.videoWidth + 'x' + video.videoHeight,
        buffer: getBufferHealth(metadata.mediaTime) + ' s',
        speed: video.playbackRate || 1
      }
      statsTimeout = setTimeout(() => {
        if (!destroyed) requestCallback = video.requestVideoFrameCallback((n, m) => handleStats(n, m, metadata))
      }, 200)
    }
  }
  function getBufferHealth(time) {
    for (let index = video.buffered.length; index--;) {
      if (time < video.buffered.end(index) && time >= video.buffered.start(index)) {
        return (video.buffered.end(index) - time) | 0
      }
    }
    return 0
  }
  togglePanel = toggle

  onDestroy(() => {
    if (togglePanel === toggle) togglePanel = null
    destroyed = true
    $stats = null
    clearTimeout(statsTimeout)
    if (requestCallback) video?.cancelVideoFrameCallback(requestCallback)
  })
</script>

{#if $stats && !miniplayer}
  <div class='position-absolute top-0 bg-tp p-10 ml-20 mt-100 text-monospace rounded z-50'>
    <button class='close btn btn-square mt-5' type='button' use:click={toggle}>
      <X size='1.4rem' strokeWidth='3'/>
    </button>
    <div>FPS: {$stats.fps}</div>
    <div>Presented frames: {$stats.presented}</div>
    <div>Dropped frames: {$stats.dropped}</div>
    <div>Frame time: {$stats.processing}</div>
    <div>Viewport: {$stats.viewport}</div>
    <div>Resolution: {$stats.resolution}</div>
    <div>Buffer health: {$stats.buffer}</div>
    <div>Playback speed: {$stats.speed?.toFixed(1)}x</div>
    <div>Name: {current?.name || ''}</div>
    {#if playableFiles?.length > 1}
      <div class='mt-10'>All files in this batch:</div>
      <div class='overflow-auto ml-10 mt-5' style='max-height: 200px;'>
        {#each playableFiles as file, fileIndex (fileIndex)}
          <div class='ctrl rounded-10 pl-5 pr-5 pbf' title={file.name} use:click={() => playFile(file)}>
            {file.name || 'UNK'}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .mt-100 {
    margin-top: 10rem !important;
  }

  .bg-tp {
    background: hsla(var(--black-color-hsl), 0.73);
    backdrop-filter: blur(10px);
  }

  .bg-tp .close {
    position: absolute;
    top: 0;
    right: 0;
    cursor: pointer;
    color: inherit;
    padding: var(--alert-close-padding);
    line-height: var(--alert-close-line-height);
    font-size: var(--alert-close-font-size);
    background-color: transparent;
    border-color: transparent;
  }

  .pbf:hover {
    background: var(--tertiary-color);
  }

  .ctrl {
    cursor: pointer;
  }
</style>
