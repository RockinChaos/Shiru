<script>
  import SoftModal from '@/components/SoftModal.svelte'
  import { TvMinimalPlay } from 'lucide-svelte'
  import { writable } from 'simple-store-svelte'
  import { anilistClient } from '@/modules/anilist.js'
  import { click } from '@/modules/click.js'
  import { X } from 'lucide-svelte'
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import { episodesList } from '@/modules/episodes.js'
  import { ELECTRON } from '@/modules/bridge.js'

  export let overlay
  export let staticMedia
  const hide = writable(true)
  let loading = true
  let trailer = writable(false)

  function close () {
    setTimeout(() => { if (overlay.includes('trailer')) overlay = overlay.filter(item => item !== 'trailer') })
    trailer.set(false)
  }

  function show () {
    hide.set(false)
    return ''
  }

  $: if ($trailer && !overlay.includes('trailer')) overlay = [...overlay, 'trailer']
  window.addEventListener('overlay-check', () => { if ($trailer) close() })
</script>
<button class='btn bg-dark-light btn-lg btn-square d-none align-items-center justify-content-center shadow-none border-0 mr-10' class:d-flex={!$hide} data-toggle='tooltip' data-placement='top' data-target-breakpoint='md' data-title='Watch Trailer' use:click={() => trailer.set(!$trailer)}>
  <TvMinimalPlay size='1.7rem' />
</button>
<SoftModal class='pointer-events-none w-full scrollbar-none align-items-center mb-30' css={`top-0 left-0 position-fixed`} bind:showModal={$trailer} shouldRender={true} {close} id='viewTrailer'>
  <div class='pointer-events-auto d-flex align-items-center rounded-top-5 w-full wm-calc bg-dark h-40'>
    <span class='title ml-20 font-weight-very-bold text-muted select-all mr-20 font-scale-18'>{anilistClient.title(staticMedia)}</span>
    <button type='button' class='btn btn-square bg-transparent shadow-none border-0 d-flex align-items-center justify-content-center ml-auto mr-5' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
  </div>
  <div class='pointer-events-auto ratio-16-9 position-relative w-full wm-calc overflow-hidden rounded-bottom-5'>
<!--    < css='h-full' bind:hide={$hide} loop={false} bind:autoPause={$trailer} autoPlay={false} autoMute={false} controls={true} fullScreen={true} ids={[staticMedia.trailer?.id, () => episodesList.getMedia(staticMedia.idMal).then(metadata => [metadata?.data?.trailer?.youtube_id])]} title={staticMedia.title.userPreferred}/>-->
    {#await (staticMedia.trailer?.id && staticMedia) || episodesList.getMedia(staticMedia.idMal) then trailerUrl}
      {@const trailerId = trailerUrl?.trailer?.id || trailerUrl?.data?.trailer?.youtube_id}
      {#if trailerId}
        {show()}
        {#if $trailer}
          {#await ELECTRON.getYouTube() then youtubeServer}
            <div class='pointer-events-auto ratio-16-9 position-relative w-full wm-calc'>
              <SmartImage class='ratio-16-9 img-cover w-full h-full rounded-bottom-6' images={[...(trailerId ? [`https://i.ytimg.com/vi/${trailerId}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${trailerId}/hqdefault.jpg`] : []), staticMedia.bannerImage, staticMedia.coverImage?.extraLarge ]} hidden={!loading}/>
              <iframe
                  class='position-absolute w-full h-full top-0 left-0 border-0 rounded-bottom-5'
                  class:d-none={loading}
                  title={staticMedia.title.userPreferred}
                  allow='autoplay'
                  allowfullscreen
                  on:load={() => { loading = false }}
                  src={`${youtubeServer}/embed/${trailerId}?autoplay=1&vq=medium&cc_lang_pref=ja`}
              />
            </div>
          {/await}
        {/if}
      {/if}
    {/await}
  </div>
</SoftModal>

<style>
  .rounded-top-5 {
    border-radius: .5rem .5rem 0 0;
  }
  .rounded-bottom-5 {
    border-radius: 0 0 .5rem .5rem;
  }
  .wm-calc {
    max-width: min(max(70vw, 100rem), calc(75vh * (16 / 9)));
  }
  .title {
    display: inline-block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
</style>