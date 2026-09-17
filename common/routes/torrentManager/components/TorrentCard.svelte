<script>
  import { add, stage, unload, untrack, complete, reannounce } from '@/modules/torrent.js'
  import { Database, Clapperboard, Film, EllipsisVertical, Check } from 'lucide-svelte'
  import { eta, createListener, fastPrettyBytes } from '@/modules/util.js'
  import NestedDropdown from '@/components/overlays/NestedDropdown.svelte'
  import { anilistClient } from '@/modules/providers/anilist/anilist.js'
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import AnimeResolver from '@/modules/anime/animeresolver.js'
  import { copyToClipboard } from '@/modules/lib/clipboard.js'
  import { getId } from '@/modules/anime/animehash.js'
  import { settings } from '@/modules/settings.js'
  import { modal } from '@/modules/navigation.js'
  import { mediaCache } from '@/modules/cache.js'
  import { click } from '@/modules/lib/click.js'
  import { onDestroy, onMount } from 'svelte'
  /** @type {import('@/modules/torrent.js').Torrent} */
  export let data
  /** @type {boolean} */
  export let current = false
  /** @type {boolean} */
  export let completed = false
  /** @type {boolean} */
  export let disableRescan = false
  /** @type {HTMLElement} Container used to constrain the dropdown panel. */
  export let container

  /** @type {string} */
  const infoHash = data.infoHash
  /** @type {string} */
  const cleanName = data.name && AnimeResolver.cleanFileName(data.name)
  /** @type {{ reactive: import('simple-store-svelte').Writable<boolean>, init: (create: boolean, boundary?: boolean) => void }} */
  const { reactive, init } = createListener([`react-${infoHash}`])
  /** @type {EventListenerOrEventListenerObject} */
  const onFileEdit = () => resolved = getResolvedId(infoHash)
  /** Resolved media info */
  let resolved = getResolvedId(infoHash)
  /** @type {boolean} */
  let viewOptions = false
  /** @type {boolean} */
  let showLoadIn = true

  $: resolvedId = resolved?.mediaId
  $: episode = resolved?.files?.length <= 1 ? !resolved?.files?.length ? resolved?.episode : (Number.isFinite(Number(resolved?.files?.[0]?.episode)) ? Number(resolved?.files?.[0]?.episode) : resolved?.episode) : null
  $: episodeRange = resolved?.files?.length <= 1 ? !resolved?.files?.length ? (resolved?.episodeRange && `${resolved.episodeRange.first} ~ ${resolved.episodeRange.last}`)
      : (resolved?.files?.[0]?.episodeRange && `${resolved?.files?.[0].episodeRange.first} ~ ${resolved?.files?.[0].episodeRange.last}`) || (resolved?.episodeRange && `${resolved.episodeRange.first} ~ ${resolved.episodeRange.last}`)
        : null
  $: search = resolvedId && $mediaCache[resolvedId] ? { media: $mediaCache[resolvedId], episode, episodeRange } : null
  $: watched = isWatched(search, resolved)
  $: progressPct = data.size && (!data.missing_pieces || (data.progress && data.progress < 1)) ? ((data.progress * 100) || 0).toFixed(1) : (data.missing_pieces ? null : '0')
  $: statusLabel = completed ? (data.incomplete ? ((data.missing_pieces && !(data.progress && data.progress < 1)) ? 'Missing Pieces' : 'Incomplete') : 'Completed')
    : data.progress === 1 ? 'Seeding'
      : data.size && (data.downloadSpeed || data.uploadSpeed) ? 'Downloading'
        : !(data.downloadSpeed || data.uploadSpeed) && data.eta > 1000 && data.eta < Infinity && data.progress < 1 && !settings.value.torrentStreamedDownload ? 'Scanning'
          : data.name ? 'Stalled' : '—'

  /**
   * Determines whether the resolved media for this torrent has been fully watched.
   * @param {{ media: import('@/modules/providers/anilist/al.d.ts').Media, episode?: number, episodeRange?: string } | null} search
   * @param {{ files?: { mediaId: number }[] }} resolved
   * @returns {boolean}
   */
  function isWatched(search, resolved) {
    if (!search) return false
    const media = search.media
    if (search.episode || search.episode === 0) {
      return media?.mediaListEntry?.status === 'COMPLETED' || (media?.mediaListEntry?.progress ?? 0) >= (search.episode - (search.episode === 0 ? 1 : 0))
    }
    if (media?.format === 'MOVIE' && (media?.episodes ?? 0) <= 1) {
      return media?.mediaListEntry?.status === 'COMPLETED' || (media?.mediaListEntry?.progress ?? 0) > 0
    }
    const files = resolved?.files?.map((/** @type {{ mediaId: number }} */ file) => $mediaCache[file.mediaId]).filter(Boolean) ?? []
    if (files.length > 0) {
      return files.every(media => media?.mediaListEntry?.status === 'COMPLETED' || ((media.episodes ?? 0) > 0 && (media?.mediaListEntry?.progress ?? 0) >= (media.episodes ?? 0)))
    }
    // individual files have not been resolved, fallback to the main media entry
    return media?.mediaListEntry?.status === 'COMPLETED' || ((media.episodes ?? 0) > 0 && (media?.mediaListEntry?.progress ?? 0) >= (media.episodes ?? 0))
  }

  /**
   * Returns a seeding quality label based on the upload ratio.
   * @param {number} ratio
   * @param {number} progress
   * @returns {string}
   */
  function ratioType(ratio, progress) {
    if (progress < 1 && !data.incomplete) return 'Leeching'
    else if (ratio < 0.5) return 'Leecher'
    else if (ratio < 1.0) return 'Fair'
    else if (ratio < 2.5) return 'Good'
    return 'Seeder'
  }

  /**
   * Gets resolved media info for the infoHash.
   * @param {string} infoHash
   */
  function getResolvedId(infoHash) {
    return getId(infoHash, { client: true }, true)
  }

  /** Opens the anime details modal for the resolved media, if available. */
  function viewMedia() {
    if (resolvedId && $mediaCache[resolvedId]) modal.open(modal.ANIME_DETAILS, $mediaCache[resolvedId])
  }

  /** Handles an alt-click, opens the resolved media, stages a completed torrent, or completes a finished one. */
  function altClick() {
    if (resolvedId && $mediaCache[resolvedId]) viewMedia()
    else if (completed) stage(infoHash, null, infoHash)
    else if (data.progress === 1) complete(infoHash)
  }

  onMount(() => {
    init(true)
    window.addEventListener('fileEdit', onFileEdit)
  })
  onDestroy(() => {
    init(false, true)
    window.removeEventListener('fileEdit', onFileEdit)
  })
</script>

<div class='torrent-row' class:current class:incomplete={completed && data.incomplete}>
  <div
      role='button'
      tabindex='0'
      class='border-top py-10 text-wrap text-break-word d-flex'
      class:not-reactive={!$reactive || current || viewOptions}
      class:pointer={!current}
      aria-label={!current ? 'Play Torrent' : 'Currently Playing'}
      title={!current ? 'Play Torrent' : 'Currently Playing'}
      use:click={() => { if (!current) add(infoHash, search, infoHash) }}
      on:contextmenu|preventDefault={altClick}>
    <div class='t-grid w-full' class:load-in={showLoadIn} on:animationend={() => showLoadIn = false}>

      <div class='d-flex ml-15 align-items-center' class:watched>
        <div class='rounded-5 d-flex justify-content-center align-items-center overflow-hidden z-10 icon-container position-relative flex-shrink-0'>
          <SmartImage class='rounded-5 w-auto' images={[$mediaCache[resolvedId]?.coverImage?.extraLarge, $mediaCache[resolvedId]?.coverImage?.medium, (!$mediaCache[resolvedId] ? './404_cover.jpg' : './no_image_cover.jpg')]} color='var(--status-color)' style='height: 100%; object-fit: cover; object-position: center;'/>
          <div class='overlay position-absolute inset-0 d-none align-items-center justify-content-center text-white rounded' class:d-flex={watched} aria-hidden='true'>
            <Check size='3rem' strokeWidth={3} />
          </div>
        </div>
        <div class='p-5 name d-flex flex-column'>
          {#if resolvedId}
            <div class='font-scale-14 font-weight-semi-bold line-2 overflow-hidden d-flex align-items-center' title={`${$mediaCache[resolvedId] ? (anilistClient.title($mediaCache[resolvedId]) + ((episode || episode === 0) ? ` Episode ${episode}` : ``)) : cleanName || ``}`}>
              {#if episodeRange || episode || episode === 0}
                <span class='d-inline-flex align-items-center align-middle px-6 py-1 rounded mb-5 badge-episode gap-5' title={`Episode ${episodeRange || episode}`}><Clapperboard size='1.4rem'/>{episodeRange || episode}</span>
              {:else if $mediaCache[resolvedId]?.format === 'MOVIE'}
                <span class='d-inline-flex align-items-center align-middle px-6 py-1 rounded mb-5 badge-movie gap-5' title='Movie'><Film size='1.4rem'/>Movie</span>
              {:else}
                <span class='d-inline-flex align-items-center align-middle px-6 py-1 rounded mb-5 badge-batch gap-5' title='Batch'><Database size='1.4rem'/>Batch</span>
              {/if}
              {#if $mediaCache[resolvedId]}
                <span class='font-scale-16 font-weight-very-bold'>{anilistClient.title($mediaCache[resolvedId])}</span>
              {/if}
            </div>
          {/if}
          <div class='font-scale-14 text-muted line-2 overflow-hidden' title={cleanName}>{cleanName || '—'}</div>
        </div>
      </div>

      <div class='p-5 d-none d-md-block font-weight-semi-bold align-self-center' class:watched>{fastPrettyBytes(data.size)}</div>
      <div class='p-5 font-weight-semi-bold align-self-center' class:watched>{progressPct != null ? `${Number(progressPct)}%` : '—'}</div>
      <div class='p-5 font-weight-semi-bold align-self-center' class:watched>
        <span class='dot mr-sm-5 d-inline-block flex-shrink-0'
              style:--dot-color={
                statusLabel === 'Downloading' ? 'var(--warning-color-dim)' :
                statusLabel === 'Stalled' ? 'var(--octonary-color)' :
                statusLabel === 'Scanning' ? 'var(--white-color)' :
                statusLabel === 'Seeding' ? 'var(--success-color)' :
                statusLabel === 'Completed' ? 'var(--gray-color-light)' :
                'var(--error-color-light)'
              }
        />
        <span class='d-none d-sm-inline'>{statusLabel}</span>
      </div>
      <div class='p-5 d-none d-md-block font-weight-semi-bold align-self-center' class:watched>
        {(data.ratio > 0 && ((Math.ceil(data.ratio * 100) / 100)?.toFixed(2))) || (!completed && data.name && (data.progress ? ((Math.ceil((data.ratio || 0) * 100) / 100)?.toFixed(2)) : '0.00')) || (data.incomplete && (!data.missing_pieces || (data.progress && data.progress < 1)) ? '0.01' : '—')}
        <span class='text-muted text-nowrap' class:d-none={(!(data.ratio > 0) && completed && (!data.incomplete || (data.missing_pieces && !(data.progress && data.progress < 1)))) || !data.name}>{` (${ratioType(data.ratio || 0, data.progress)})`}</span>
      </div>

      <div class='p-5 d-lg-none font-weight-semi-bold align-self-center' class:watched>{completed ? '—' : `${fastPrettyBytes(data.progress === 1 ? data.uploadSpeed || data.downloadSpeed || 0 : data.downloadSpeed || data.uploadSpeed || 0)}/s`}</div>
      <div class='p-5 d-none d-lg-block font-weight-semi-bold align-self-center' class:watched>{completed ? '—' : `${fastPrettyBytes(data.downloadSpeed || 0)}/s`}</div>
      <div class='p-5 d-none d-lg-block font-weight-semi-bold align-self-center' class:watched>{completed ? '—' : `${fastPrettyBytes(data.uploadSpeed || 0)}/s`}</div>

      <div class='p-5 d-none d-sm-block align-self-center' class:watched>
        <span class='font-weight-semi-bold d-sm-inline d-lg-none' class:watched>{completed ? '—' : data.numPeers || 0}</span>
        <span class='font-weight-semi-bold d-none d-lg-inline' class:watched>{completed ? '—' : data.numSeeders || 0}</span>
        <span class='text-muted text-nowrap' class:watched class:d-none={completed}>{` (${data.totalSeeders || 0})`}</span>
      </div>
      <div class='p-5 d-none d-lg-block align-self-center' class:watched>
        <span class='font-weight-semi-bold'>{completed ? '—' : data.numLeechers || 0}</span>
        <span class='text-muted text-nowrap' class:d-none={completed}>{` (${data.numPeers || 0})`}</span>
      </div>
      <div class='p-5 d-none d-md-block font-weight-semi-bold align-self-center' class:watched>{data.eta > 0 && data.progress < 1 ? eta(new Date(Date.now() + data.eta)) : '∞'}</div>

      <div class={`react-${infoHash} mr-5 mr-md-20 h-auto`} class:d-none={!infoHash}>
        <NestedDropdown title='Options' direction='left' alignStart={true} panelWidth={20} panelHeightPadding={3} containerEl={container} bind:isOpen={viewOptions} items={[
          ...(!current && infoHash ? [{
            label: 'Play',
            close: true,
            onSelect: () => add(infoHash, search, infoHash)
          }] : []),
          ...(infoHash ? [{
            label: 'Untrack',
            close: true,
            onSelect: () => untrack(infoHash)
          }] : []),
          ...(completed && data.incomplete && settings.value.seedingLimit > 1 && !disableRescan && infoHash ? [{
            label: 'Resume',
            close: true,
            onSelect: () => stage(infoHash, null, infoHash)
          }] : []),
          ...(current && infoHash ? [{
            label: 'Stop Playing',
            close: true,
            onSelect: () => unload(infoHash, true)
          }] : []),
          ...(!completed && !current && data.progress < 1 && settings.value.torrentPersist && infoHash ? [{
            label: 'Stop Download',
            close: true,
            onSelect: () => unload(infoHash, true)
          }] : []),
          ...(!completed && !current && data.progress === 1 && settings.value.torrentPersist && infoHash ? [{
            label: 'Stop Seeding',
            close: true,
            onSelect: () => complete(infoHash)
          }] : []),
          ...(completed && !data.incomplete && settings.value.seedingLimit > 1 && !disableRescan && infoHash ? [{
            label: 'Start Seeding',
            close: true,
            onSelect: () => stage(infoHash, null, infoHash)
          }] : []),
          { type: 'separator' },
          ...(resolvedId && $mediaCache[resolvedId] ? [{
            label: 'View Media',
            close: true,
            onSelect: () => viewMedia()
          }] : []),
          ...(!completed && infoHash ? [{
            label: 'Reannounce',
            close: true,
            onSelect: () => reannounce(infoHash)
          }] : []),
          ...(data.magnetURI ? [{
            label: 'Copy Magnet',
            close: true,
            onSelect: () => copyToClipboard(data.magnetURI, 'magnet URL')
          }] : [])
        ]}>
          <span class='btn btn-square h-full bg-transparent shadow-none border-0 options d-flex align-items-center muted justify-content-center flex-shrink-0 w-40' title='Options'>
            <EllipsisVertical size='2rem' />
          </span>
        </NestedDropdown>
      </div>

    </div>
  </div>
</div>

<style>
  .py-1 {
    padding-top: .1rem; padding-bottom: .1rem;
  }
  .px-6 {
    padding-left: .6rem; padding-right: .6rem;
  }

  .watched {
    opacity: .7;
  }
  .overlay {
    background: hsla(var(--black-color-hsl), .55);
  }
  .current {
    border-left: .5rem solid var(--primary-color-dim);
    background-color: hsla(var(--primary-color-dim-hsl), .15);
  }
  .incomplete {
    background: hsla(var(--error-color-light-hsl), .2);
  }

  .icon-container {
    width: 6rem;
    height: 8rem;
  }

  .torrent-row {
    transition: background .1s;
  }
  .torrent-row:hover {
    background: hsla(var(--gray-color-hsl), .12);
  }

  .badge-episode {
    background: hsla(var(--primary-color-hsl), .2);
    color: hsla(var(--primary-color-light-hsl), .9);
  }
  .badge-movie {
    background: color-mix(in srgb, var(--septenary-color) 20%, transparent);
    color: color-mix(in srgb, color-mix(in srgb, var(--septenary-color) 70%, white) 90%, transparent);
  }
  .badge-batch {
    background: color-mix(in srgb, var(--nonary-color) 20%, transparent);
    color: color-mix(in srgb, var(--nonary-color) 90%, transparent);
  }

  .dot {
    width: .8rem;
    height: .8rem;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--dot-color)
  }

  .load-in {
    animation: .4s ease 0s load-in !important;
    will-change: auto !important;
  }
  @keyframes load-in {
    from { opacity: 0; transform: translateX(1rem); }
    to { opacity: 1; transform: translateX(0); }
  }
</style>