<script context='module'>
  import { settings } from '@/modules/settings.js'
  import { matchPhrase, createListener } from '@/modules/util.js'
  import { sanitiseTerms } from '@/views/TorrentSearch/TorrentCard.svelte'
  import { add } from '@/modules/torrent.js'
  import { nowPlaying as currentMedia } from '@/views/Player/MediaHandler.svelte'
  import { animeSchedule } from '@/modules/anime/animeschedule.js'
  import { cache, caches } from '@/modules/cache.js'
  import { status } from '@/modules/networking.js'
  import { anitomyscript, getMediaMaxEp, getKitsuMappings, getEpisodeMetadataForMedia } from '@/modules/anime/anime.js'
  import { loadedTorrent, completedTorrents, seedingTorrents, stagingTorrents } from '@/modules/torrent.js'
  import { dedupe, getResultsFromExtensions } from '@/modules/extensions/handler.js'
  import { getId, getHash } from '@/modules/anime/animehash.js'
  import AnimeResolver from '@/modules/anime/animeresolver.js'
  import { anilistClient } from '@/modules/anilist.js'
  import { click } from '@/modules/click.js'
  import { X, Search, EllipsisVertical, Timer, Clapperboard, MonitorCog, ArrowDownWideNarrow, ChevronLeft, ChevronUp, ChevronDown } from 'lucide-svelte'
  import Debug from 'debug'
  const debug = Debug('ui:torrents')

  /** @typedef {import('@/modules/al.d.ts').Media} Media */
  /** @typedef {import('anitomyscript').AnitomyResult} AnitomyResult */
  /** @typedef {import('extensions/index.d.ts').TorrentResult} Result */

  /** @param {Media} media */
  function isMovie (media) {
    if (!media) return false
    if (media.format === 'MOVIE') return true
    if ([...Object.values(media.title), ...media.synonyms].some(title => title?.toLowerCase().includes('movie') && !title?.toLowerCase().includes('short'))) return true // TODO: revisit this, it causes false positives since the term "movie" is used randomly on shorts that are clearly not movie length.
    // if (!getParentForSpecial(media)) return true // TODO: this is good for checking movies, but false positives with normal TV shows
    return media.duration > 80 && media.episodes === 1
  }

  /**
   * @param {Object} search
   * @param {AnitomyResult} result
   * @param {string} audioLang
   * @param {boolean} exactMatch
   */
  async function getRequestedAudio(search, result, audioLang, exactMatch = true) {
    const terms = [...new Map((await sanitiseTerms(search, result))?.map(term => [term.term.text, term.term])).values()]
    const checkTerm = (term, keyword) => (Array.isArray(term.text) ? term.text : [term.text]).some(text => text.toLowerCase().includes(keyword.toLowerCase()))
    const exactAudio = terms.some(term => checkTerm(term, audioLang))
    const dualAudio = terms.some(term => checkTerm(term, 'dual'))
    return exactAudio || (exactMatch ? exactAudio : dualAudio)
  }

  /**
   * @param {Object} search
   * @param {Result[]} results
   * @param {string} audioLang
   * @param {string[]} torrentProvider
   */
  async function getBest(search, results, audioLang, torrentProvider = []) {
    if (!results || !results.length) return null
    const candidates = []
    if (audioLang !== 'jpn') {
      const checks = await Promise.all(
        results.map(async result => ({
          result,
          exactBest: (await getRequestedAudio(search, result.parseObject, audioLang)) && result.seeders > 9,
          exactAlt: (await getRequestedAudio(search, result.parseObject, audioLang, false)) && result.seeders > 9,
          dualBest: (await getRequestedAudio(search, result.parseObject, audioLang)) && result.seeders > 1,
          dualAlt: (await getRequestedAudio(search, result.parseObject, audioLang, false)) && result.seeders > 1
        })))
      candidates.push(...checks.filter(check => check.exactBest).map(check => check.result), ...checks.filter(check => check.exactAlt).map(check => check.result), ...checks.filter(check => check.dualBest).map(check => check.result), ...checks.filter(check => check.dualAlt).map(check => check.result))
    }
    candidates.push(...results.filter(result => (result.type === 'best' || result.type === 'alt') && result.seeders > 9))
    const uniqueCandidates = Array.from(new Set(candidates))
    const toConsider = uniqueCandidates.length ? uniqueCandidates : results
    if (torrentProvider?.length) {
      const filteredByProvider = toConsider.filter(result => result.parseObject?.release_group && torrentProvider.some(provider => result.parseObject.release_group.toLowerCase().includes(provider.toLowerCase())))
      if (filteredByProvider.length) return filteredByProvider[0]
    }
    return toConsider[0] || results[0]
  }

  function filterResults(results, searchText) {
    if (!searchText?.length) return results
    return results.filter(({ title }) => matchPhrase(searchText, title, 0.4, false, true)) || []
  }

  /**
   * @param {Result[]} results
   * @param {string} sort
   */
  function sortResults(results, sort) {
    if (!results) return { results: [], hiddenResults: [] }
    const deduped = Array.from(dedupe(results)).map(result => {
      if (!(result.parseObject?.release_group && result.parseObject.release_group.length < 20)) result.parseObject = { ...result.parseObject, release_group: 'No Group' }
      return result
    })
    return {
      results: deduped.filter(entry => entry.seeders > 0 || entry.source?.managed).sort((a, b) => {
        switch (sort) {
          case 'smallest': return a.size - b.size
          case 'best': return (b.type === 'best') - (a.type === 'best') || (b.type === 'alt') - (a.type === 'alt')
          case 'batch': return (b.type === 'batch') - (a.type === 'batch')
          case 'new': return new Date(b.date) - new Date(a.date)
          case 'old': return new Date(a.date) - new Date(b.date)
          case 'seeders':
          default: return b.seeders - a.seeders
        }
      }),
      hiddenResults: deduped.filter(entry => !entry.seeders && !entry.source?.managed)
    }
  }

  const languages = [
    { value: 'jpn', label: 'Japanese' },
    { value: 'eng', label: 'English' },
    { value: 'chi', label: 'Chinese' },
    { value: 'por', label: 'Portuguese' },
    { value: 'spa', label: 'Spanish' },
    { value: 'ger', label: 'German' },
    { value: 'pol', label: 'Polish' },
    { value: 'cze', label: 'Czech' },
    { value: 'dan', label: 'Danish' },
    { value: 'gre', label: 'Greek' },
    { value: 'fin', label: 'Finnish' },
    { value: 'fre', label: 'French' },
    { value: 'hun', label: 'Hungarian' },
    { value: 'ita', label: 'Italian' },
    { value: 'kor', label: 'Korean' },
    { value: 'dut', label: 'Dutch' },
    { value: 'nor', label: 'Norwegian' },
    { value: 'rum', label: 'Romanian' },
    { value: 'rus', label: 'Russian' },
    { value: 'slo', label: 'Slovak' },
    { value: 'swe', label: 'Swedish' },
    { value: 'ara', label: 'Arabic' },
    { value: 'idn', label: 'Indonesian' }
  ]
</script>

<script>
  import TorrentCard from '@/views/TorrentSearch/TorrentCard.svelte'
  import TorrentCardSk from '@/components/skeletons/TorrentCardSk.svelte'
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import ErrorCard from '@/components/cards/ErrorCard.svelte'
  import { onDestroy } from 'svelte'
  import { writable } from 'simple-store-svelte'

  /** @type {{ media: Media, episode?: number }} */
  export let search
  export let close

  let countdown = 5
  let timeoutHandle
  const maxEpisode = 10000

  /**
   * @param {ReturnType<typeof getBest>} promise
   * @param {boolean} ready
   */
  async function autoPlay (promise, ready) {
    const best = await promise
    if (!search || !best || !ready) return
    if ($settings.rssAutoplay) {
      clearTimeout(timeoutHandle)
      const decrement = () => {
        countdown--
        if (countdown === 0) {
          play(best)
        } else {
          timeoutHandle = setTimeout(decrement, 1000)
        }
      }
      timeoutHandle = setTimeout(decrement, 1000)
    }
  }

  function dubFinished() {
    const airingMedia = animeSchedule.dubAiring.value?.find(entry => entry.media?.media?.id === search.media.id)
    return !airingMedia || (airingMedia.episodeNumber === search.media.episodes && (new Date().getTime() >= new Date(airingMedia.episodeDate).getTime())) || ((search.media.mediaListEntry?.progress ?? 0) > airingMedia.episodeNumber)
  }

  const movie = isMovie(search.media)
  let batch = search.media.status === 'FINISHED' && (!settings.value.preferDubs || dubFinished()) && !movie

  const results = writable({})
  function addResults(newItems, source) {
    if (!newItems?.length) return ''
    results.update(r => ({ ...r, torrents: [...(r?.torrents ?? []), ...newItems.map(item => ({ ...item, source }))] }))
    return ''
  }

  async function addCachedHashes(cachedHashes) {
    if (!cachedHashes?.length) return
    const cachedTorrents = []
    const torrents = [...completedTorrents.value, ...seedingTorrents.value, ...stagingTorrents.value, loadedTorrent.value].filter(Boolean)
    for (const cached of cachedHashes) {
      const torrent = torrents.find(torrent => torrent.infoHash === cached.hash)
      if (!torrent) continue
      const title = AnimeResolver.cleanFileName(torrent.name)
      let searchEpisode = search?.episode
      let isLocked = cached.locked ?? (cached.files?.length === 1 && (cached.files[0].locked || cached.files[0].parseObject?.locked)) ?? false
      if (!isLocked && Array.isArray(cached.files) && searchEpisode != null) {
        const normalizedEpisode = Number.isFinite(Number(searchEpisode)) ? Number(searchEpisode) : searchEpisode
        const matchingFile = cached.files.find(file => file.episode === normalizedEpisode)
        if (matchingFile) isLocked = matchingFile.locked ?? false
      }
      cachedTorrents.push({
        title,
        link: torrent.magnetURI,
        seeders: torrent.totalSeeders ?? 0,
        leechers: torrent.totalLeechers ?? 0,
        hash: torrent.infoHash,
        size: torrent.size,
        date: torrent.date,
        accuracy: isLocked ? 'high' : 'medium',
        parseObject: (await anitomyscript(title))?.[0],
        source: { managed: true, name: `Local (${torrent.staging ? 'Staging' : torrent.seeding ? 'Seeding' : torrent.current ? 'Now Playing' : 'Completed'})` }
      })
    }
    if (cachedTorrents.length) results.update(result => ({ ...result, torrents: [...(result?.torrents ?? []), ...cachedTorrents] }))
  }

  async function queryExtensions(request, resolution) {
    $results = {}
    const cachedHashes = []
    for (const resolvedHash of getHash(search?.media?.id, { episode: search?.episode, client: true, batchGuess: true }, false, true, true) ?? []) {
      if (resolvedHash) {
        const cachedFile = getId(resolvedHash, { fileHash: resolvedHash }, true)
        if (cachedFile) cachedHashes.push(cachedFile)
        else {
          const cachedTorrent = getId(resolvedHash, {}, true)
          if (cachedTorrent) cachedHashes.push(cachedTorrent)
        }
      }
    }
    await addCachedHashes(cachedHashes)
    debug(`Querying extensions for torrent sources for ${search?.media?.id}`)
    let promises
    try {
      promises = await getResultsFromExtensions({ ...request, batch, movie, resolution })
    } catch (error) {
      if (search != null && search.media?.id === request?.media?.id && search.episode === request?.episode) {
        errors = Promise.resolve({ errors: [error] })
        results.update(r => ({...r, resolved: true}))
      }
    }
    if (search == null || search.media?.id !== request?.media?.id) return null
    debug(`Query promises from extensions have been accepted for ${search?.media?.id}`)
    return promises
  }

  async function getErrors(request, promises) {
    const queries = await promises
    if (!queries) return null
    const uniqueErrors = new Set()
    await (async () => {
      (await Promise.all(Array.from(queries, ([_, extension]) => extension.promise))).forEach((result) => {
        if (result.errors && result.errors.length > 0) result.errors.forEach((error) => uniqueErrors.add(error.message))
      })
    })()
    if (search == null || search.media?.id !== request?.media?.id || search.episode !== request?.episode) return null
    results.update(r => ({ ...r, resolved: true }))
    debug(`All query promises have successfully been resolved for ${search?.media?.id}:E${search?.episode}`, JSON.stringify(Array.from(uniqueErrors)))
    if ($status !== 'offline' && JSON.stringify(Array.from(uniqueErrors)).match(/found no results/i) && (search?.media?.status !== 'FINISHED' || !search?.media?.episodes) && (getMediaMaxEp(search?.media, true) < search?.episode)) return { errors: [ { message: `${anilistClient.title(search.media)} ${search.media?.format !== 'MOVIE' || (getMediaMaxEp(search?.media, false) > 1) ? `Episode ${search.media.nextAiringEpisode?.episode || search.episode}` : ``} hasn't released yet! ${search?.media?.nextAiringEpisode?.timeUntilAiring ? `\n${search.media?.format !== 'MOVIE' || (getMediaMaxEp(search?.media, false) > 1) ? `This episode` : `This movie`} will be released on ${new Date(Date.now() + search.media.nextAiringEpisode?.timeUntilAiring * 1000).toDateString()}` : ''}` }]}
    return { errors: Array.from(uniqueErrors).map((message) => ({ message })) }
  }

  $: resolution = $settings.rssQuality
  $: queries = queryExtensions({...search}, resolution)
  $: errors = getErrors({...search}, queries)

  $: queryResults = sortResults($results?.torrents, $settings.torrentSort)
  $: lookup = queryResults?.results

  $: best = null
  let current = 0
  let bestPromiseId = current
  $: {
    bestPromiseId = ++current
    resolveBest(search, lookup, $settings.audioLanguage, $settings.torrentProvider)
  }
  async function resolveBest(search, lookup, audioLanguage, torrentProvider = []) {
    const result = await getBest(search, lookup, audioLanguage, torrentProvider)
    if (bestPromiseId === current) best = result
  }

  $: lookupHidden = queryResults?.hiddenResults
  $: viewHidden = false

  $: if (!$settings.rssAutoplay) clearTimeout(timeoutHandle)
  $: autoPlay(best, $results?.resolved)

  const lastMagnet = cache.getEntry(caches.HISTORY, 'lastMagnet')?.[`${search?.media?.id}`]?.[`${search?.episode}`] || cache.getEntry(caches.HISTORY, 'lastMagnet')?.[`${search?.media?.id}`]?.batch
  let searchText = ''

  /** @param {import('extensions/index.d.ts').TorrentResult} result */
  function play (result) {
    $currentMedia = search
    $currentMedia.accuracy = result.accuracy
    const existingMagnets = cache.getEntry(caches.HISTORY, 'lastMagnet') || {}
    cache.setEntry(caches.HISTORY, 'lastMagnet', { ...existingMagnets, [search?.media?.id]: !result.parseObject?.episode_number || Array.isArray(result.parseObject.episode_number) ? { [`batch`]: result } : { ...(existingMagnets[search?.media?.id] || {}), [`${search.episode}`]: result } })
    add(result.link, { media: search?.media, episode: search?.episode }, result.hash)
    close()
  }

  function episodeInput ({ target }) {
    const episode = Number(target.value)
    const episodeValue = episode > maxEpisode ? maxEpisode : episode
    if (search.episode === episodeValue) {
      target.value = episodeValue
    } else if (episode || episode === 0) {
      search.episode = episodeValue
      if (episode > maxEpisode) target.value = maxEpisode
    }
  }

  function autoPlayToggle() {
    $settings.rssAutoplay = !$settings.rssAutoplay
    if ($settings.rssAutoplay) countdown = 5
  }

  const showOptions = writable(false)
  function toggleDropdown({ target }) {
    target.classList.toggle('active')
    target.closest('.dropdown').classList.toggle('show')
  }

  $: {
    if ($showOptions) {
      const { reactive, init } = createListener([`primary`])
      init(true, true)
      reactive.subscribe(value => {
        if (!value) {
          showOptions.set(false)
          init(false, true)
        }
      })
    }
  }

  onDestroy(() => {
    clearTimeout(timeoutHandle)
    showOptions.set(false)
    viewHidden = false
    $results = {}
    search = null
    best = null
    current = 0
    bestPromiseId = 0
  })
</script>

<div class='controls w-full bg-very-dark position-sticky top-0 z-10 pt-20 pb-10 px-30 mb-10'>
  <div class='d-flex'>
    <h3 class='mb-0 font-weight-bold text-white title mr-5 font-scale-40'>{anilistClient.title(search?.media)}</h3>
    <button type='button' class='btn btn-square bg-dark-very-light ml-auto d-flex align-items-center justify-content-center rounded-2 flex-shrink-0' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
    <div class='position-absolute top-0 left-0 w-full h-full z--1'>
      <div class='position-absolute w-full h-full overflow-hidden' >
        <SmartImage class='img-cover w-full h-full' images={[
          search.media.bannerImage,
          ...(search.media.trailer?.id ? [
            `https://i.ytimg.com/vi/${search.media.trailer.id}/maxresdefault.jpg`,
            `https://i.ytimg.com/vi/${search.media.trailer.id}/hqdefault.jpg`] : []),
          () => getKitsuMappings(search.media.id).then(metadata =>
            [metadata?.included?.[0]?.attributes?.coverImage?.original,
            metadata?.included?.[0]?.attributes?.coverImage?.large,
            metadata?.included?.[0]?.attributes?.coverImage?.small,
            metadata?.included?.[0]?.attributes?.coverImage?.tiny]),
          () => getEpisodeMetadataForMedia(search.media).then(metadata => metadata?.[1]?.image),
          search.media.coverImage?.extraLarge]}
        />
      </div>
      <div class='position-absolute top-0 left-0 w-full h-full' style='background: var(--torrent-banner-gradient)' />
    </div>
  </div>
  <div class='input-group mt-20 h-40 long-input z-11'>
    <Search size='2.6rem' strokeWidth='2.5' class='position-absolute z-10 text-dark-light h-full pl-10 pointer-events-none' />
    <input
      type='search'
      class='form-control bg-dark-very-light pl-40 pr-30 rounded-3 h-40 text-truncate'
      autocomplete='off'
      spellcheck='false'
      data-option='search'
      placeholder='Filter torrents by text, or manually specify one by pasting a magnet link or torrent file' bind:value={searchText} />
    <div class='dropdown primary dropleft with-arrow position-absolute z-20 h-full right-0' use:click={() => {showOptions.set(!$showOptions)}}>
      <button type='button' class='options h-full bg-transparent shadow-none border-0 pointer p-0 pr-10 muted d-flex align-items-center' title='More Options'><EllipsisVertical size='2rem' /></button>
      <div class='position-absolute visibility top-0 text-capitalize hm-40 text-nowrap bg-dark-very-light dmr-arrow' class:hidden={!$showOptions}>
        <div class='dropdown dropleft with-arrow z-20 pointer p-5 rounded-1 option' aria-label='Preferred Audio Language' title='Preferred Audio Language' use:click={toggleDropdown}>
          <div class='d-flex align-items-center justify-content-center pr-5'><ChevronLeft size='2rem' strokeWidth={2.5}  /><span class='ml-10'>Preferred Audio</span></div>
          <div class='dropdown-menu dropdown-menu-right text-capitalize text-nowrap'>
            <div class='custom-radio overflow-y-auto overflow-x-hidden hm-400'>
              {#each languages as language}
                <input name='audio-radio-set' type='radio' id='audio-{language.value}-radio' value={language.value} checked={language.value === $settings.audioLanguage} />
                <label for='audio-{language.value}-radio' use:click={() => { $settings.audioLanguage = language.value }} class='pb-5'>
                  {language.label}
                </label>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class='row mt-10'>
    <div class='col-12 col-sm-6 d-flex align-items-center justify-content-center justify-content-sm-start'>
      <div class='d-flex align-items-center mr-5' title='Toggle Autoplay'>
        <Timer size='2.75rem' class='position-absolute z-10 text-dark-light pl-10 pointer-events-none' />
        <button type='button' class='form-control w-full bg-dark-very-light pointer control text-nowrap {!$settings.rssAutoplay ? `pl-15` : `px-25`}' use:click={() => autoPlayToggle()}>
        <span class:ml-20={!$settings.rssAutoplay} class:ml-10={$settings.rssAutoplay}>
          {#if $settings.rssAutoplay}
            Autoplay [{countdown}]
          {:else}
            Autoplay [Off]
          {/if}
        </span>
        </button>
      </div>
      <div class='d-flex align-items-center mr-5' style='width: calc(5.2rem + {(String(search.episode).length <= 10 ? String(search.episode).length : 10) * 1}rem) !important' title='Episode'>
        <Clapperboard size='2.75rem' class='position-absolute z-10 text-dark-light pl-10 pointer-events-none' />
        <input type='number' inputmode='numeric' pattern='[0-9]*' max={maxEpisode} class='form-control bg-dark-very-light pl-40 control' placeholder='5' value={search.episode} on:input={episodeInput} disabled={(!search.episode && search.episode !== 0) || movie} />
      </div>
    </div>
    <div class='col-12 col-sm-6 d-flex align-items-center mt-5 justify-content-center mt-sm-0 justify-content-sm-end'>
      <div class='d-flex align-items-center pr-5' title='Sorting Preference'>
        <ArrowDownWideNarrow size='2.75rem' class='position-absolute z-10 text-dark-light pl-10 pointer-events-none' />
        <select class='form-control w-full bg-dark-very-light pl-40 control' bind:value={$settings.torrentSort}>
          <option value='seeders' selected>Seeders</option>
          <option value='smallest' selected>Smallest</option>
          <option value='new' selected>Newest</option>
          <option value='old' selected>Oldest</option>
          <option value='batch' selected>Batch</option>
          <option value='best' selected>Best</option>
        </select>
      </div>
      <div class='d-flex align-items-center' title='Video Quality'>
        <MonitorCog size='2.75rem' class='position-absolute z-10 text-dark-light pl-10 pointer-events-none' />
        <select class='form-control w-full bg-dark-very-light pl-40 control' bind:value={$settings.rssQuality}>
          <option value='1080' selected>1080p</option>
          <option value='720'>720p</option>
          <option value='540'>540p</option>
          <option value='480'>480p</option>
          <option value=''>Any</option>
        </select>
      </div>
    </div>
  </div>
</div>
<div class='mt-10 mb-sm-10 px-30'>
{#if $results?.resolved && !$results?.torrents?.length}
  <div class='mt-80'>
    <ErrorCard promise={errors} />
  </div>
{:else}
  {#if $results?.torrents?.length && !$results?.resolved && (!best || !Object.values(best)?.length)}
    <TorrentCardSk />
  {:else if $results?.torrents?.length}
    {#if best}<TorrentCard type='best' countdown={$settings.rssAutoplay && $results?.resolved ? countdown : -1} result={best} {play} media={search.media} episode={search.episode} />{/if}
    {#if lastMagnet}
      {#each filterResults(lookup, searchText) as result}
        {#if ((result.link === lastMagnet.link) || (result.hash === lastMagnet.hash)) && (result.seeders ?? 0) > 1 && ((best?.link !== lastMagnet.link) && (best?.hash !== lastMagnet.hash)) }
          <TorrentCard type='magnet' result={result} {play} media={search.media} episode={search.episode} />
        {/if}
      {/each}
    {/if}
  {/if}
  {#each filterResults(lookup, searchText) as result}
    {#if ((best?.link !== result.link) && (best?.hash !== result.hash)) && (!lastMagnet || (((result.link !== lastMagnet.link) || (result.hash !== lastMagnet.hash)) || (result.seeders ?? 0) <= 1))}
      <TorrentCard {result} {play} media={search.media} episode={search.episode} />
    {/if}
  {/each}
  {#if lookupHidden?.length && $results?.resolved && filterResults(lookupHidden, searchText)?.length}
    <button type='button' class='mb-10 control bd-highlight h-50 btn w-full p-5 rounded-3 d-flex align-items-center font-size-16 font-weight-semi-bold overflow-hidden' class:bg-dark={!viewHidden} class:bg-primary={viewHidden} use:click={()=> { viewHidden = !viewHidden }}>
      <span class='ml-20'>{lookupHidden?.length} Unseeded Result{lookupHidden?.length > 1 ? 's' : ''} (Unavailable)</span>
      <svelte:component this={ viewHidden ? ChevronUp : ChevronDown } class='ml-auto mr-10' size='2.2rem' />
    </button>
    {#if viewHidden}
      {#each filterResults(lookupHidden, searchText) as result}
        {#if (!best || ((best.link !== result.link) && (best.hash !== result.hash))) && (!lastMagnet || (((result.link !== lastMagnet.link) || (result.hash !== lastMagnet.hash)) || (result.seeders ?? 0) <= 1))}
          <div class='unavailable'><TorrentCard {result} {play} media={search.media} episode={search.episode} /></div>
        {/if}
      {/each}
    {/if}
  {/if}
  {#if queries}
    {#await queries then queries}
      {#each queries as [key, extension] (key)}
        {#await extension.promise}
          <TorrentCardSk name={extension.name} icon={extension.icon || 'none'} />
        {:then resolved}
          {addResults(resolved, { name: extension.name, icon: extension.icon })}
        {/await}
      {/each}
    {/await}
  {/if}
  {#if !$results?.resolved}
    {#each Array.from({ length: $results?.torrents?.length ? Math.max(15 - $results.torrents.length, 0) : 15 }) as _}
      <TorrentCardSk />
    {/each}
  {/if}
{/if}
</div>

<style>
  .unavailable {
    opacity: 0.6;
  }
  .visibility {
    margin-top: .4rem;
    margin-left: -15.5rem;
    transition: opacity 0.1s ease-in;
  }

  .controls {
    box-shadow: 0 1.2rem 1.2rem var(--dark-color-dim);
  }
  .title {
    display: inline-block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-shadow: 2px 2px 4px hsla(var(--black-color-hsl), 1);
  }
  .pr-30 {
    padding-right: 3rem;
  }
  .mt-80 {
    margin-top: 8rem;
  }
  .px-25 {
    padding-left: 2.5rem;
    padding-right: 2rem;
  }
</style>