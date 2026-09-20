<script>
  import { diskSpace, loadingSession, loadedTorrent, completedTorrents, seedingTorrents, stagingTorrents } from '@/modules/torrent.js'
  import { Search, RefreshCw, TriangleAlert, Percent, Activity, Gauge, UserSearch, Timer, CloudAlert, CloudUpload, CloudDownload, FolderX, FolderCheck, HardDrive } from 'lucide-svelte'
  import TorrentCard from '@/routes/torrentManager/components/TorrentCard.svelte'
  import AnimeResolver from '@/modules/anime/animeresolver.js'
  import ErrorCard from '@/components/cards/ErrorCard.svelte'
  import { debounce, matchPhrase } from '@/modules/util.js'
  import { anitomyscript } from '@/modules/anime/anime.js'
  import { getId } from '@/modules/anime/animehash.js'
  import { settings } from '@/modules/settings.js'
  import { status } from '@/modules/networking.js'
  import { mediaCache } from '@/modules/cache.js'
  import { toast } from '@/modules/lib/toast.js'
  import { click } from '@/modules/lib/click.js'
  import { TORRENT } from '@/modules/bridge.js'
  import { scale } from 'svelte/transition'
  import { flip } from 'svelte/animate'

  /** @type {boolean} */
  export let statusTransition = false

  /** @typedef {'staging'|'stalled'|'seeding'|'incomplete'|'completed'} StatusKey */

  /**
   * @typedef {Object} AnitomyResult
   * @property {string} [anime_title]
   * @property {string} [episode]
   * @property {string} [file_name]
   */

  /** @typedef {import('@/modules/torrent.js').Torrent & { current: boolean, completed: boolean, category: string }} Torrent */

  /** @type {number} */
  const TORRENT_PAGE_SIZE = 25
  /** @type {Object.<string, string[]>} Categories pushed to the bottom of the list for each sort key */
  const BOTTOM_FOR_METRIC = {
    down: ['completed', 'incomplete'],
    up: ['completed', 'incomplete'],
    seeders: ['completed', 'incomplete'],
    leechers: ['completed', 'incomplete'],
    eta: ['completed', 'incomplete'],
    ratio: ['completed']
  }
  /** @type {Object.<string, number>} */
  const STATUS_ORDER = { current: 0, staging: 1, seeding: 2, incomplete: 3, completed: 4 }
  /** @type {Record<StatusKey, { icon: import('svelte').ComponentType, label: string }>} */
  const STATUS = {
    stalled: { icon: CloudAlert, label: 'Stalled' },
    staging: { icon: CloudDownload, label: 'Downloading' },
    seeding: { icon: CloudUpload, label: 'Seeding' },
    incomplete: { icon: FolderX, label: 'Incomplete' },
    completed: { icon: FolderCheck, label: 'Completed' }
  }
  /** @type {{ key: string, direction: string }} */
  const sortOrder = { key: 'status', direction: 'asc' }
  const resolvedCache = /** @type {Map<string, { name: string, anime_title: string|null, resolvedId: number|null }>} */ (new Map())

  /** @type {HTMLElement} */
  let container
  /** @type {string} */
  let searchText = ''
  /** @type {StatusKey|null} */
  let statusFilter = null
  /** @type {number} */
  let torrentCount = TORRENT_PAGE_SIZE
  /** @type {Torrent[]} All torrents merged from every source */
  let allTorrents = mergeTorrents($loadedTorrent, $stagingTorrents, $seedingTorrents, $completedTorrents)
  /** @type {string[]} Hashes matching the current search, sorted */
  let filteredHashes = filterAndSort(allTorrents, searchText, statusFilter).map(torrent => torrent.infoHash)
  /** @type {string[]} Hashes currently mounted */
  let currentHashes = filteredHashes.slice(0, torrentCount)
  /** @type {Set<string>} Hashes seen since the last search/sort change */
  let knownHashes = new Set(allTorrents.map(torrent => torrent.infoHash))

  $: shiruBytes = [...($seedingTorrents ?? []), ...($completedTorrents ?? []), ...($stagingTorrents ?? []), ...($loadedTorrent?.infoHash ? [$loadedTorrent] : [])].reduce((sum, torrent) => sum + (torrent.downloaded ?? (torrent.size ?? 0) * (torrent.progress ?? 1)), 0)
  $: otherBytes = Math.max(0, ($diskSpace?.total ? $diskSpace.total - $diskSpace.free : 0) - shiruBytes)
  $: freePercent = $diskSpace?.total ? ($diskSpace.free / $diskSpace.total) * 100 : 0
  $: noDiskSpace = freePercent <= 5 && ($diskSpace?.free ?? 0) < 30 * 1024 ** 3
  $: lowDiskSpace = !noDiskSpace && freePercent <= 15 && ($diskSpace?.free ?? 0) < 80 * 1024 ** 3

  $: allTorrents = mergeTorrents($loadedTorrent, $stagingTorrents, $seedingTorrents, $completedTorrents)
  $: torrentsByHash = Object.fromEntries(allTorrents.map(torrent => [torrent.infoHash, torrent]))
  $: statusCounts = getStatuses(allTorrents)
  $: resyncTorrents(allTorrents, searchText)
  $: resortTorrents(torrentsByHash)
  $: currentTorrents = currentHashes.map(hash => torrentsByHash[hash]).filter(Boolean)
  $: disableRescan = ($seedingTorrents?.length + $stagingTorrents?.length + 1) >= settings.value.seedingLimit && !settings.value.torrentPersist

  /**
   * Updates filtered torrent results from search input (debounced).
   * Resets pagination and scroll position.
   *
   * @param {string} value
   */
  const updateSearch = debounce((/** @type {string} */ value) => resetPagination(value), 500)

  /**
   * Rebuilds filteredHashes from scratch and resets pagination back to the first page.
   *
   * @param {string} [search]
   */
  function resetPagination(search = searchText) {
    container?.scrollTo?.({ top: 0 })
    filteredHashes = filterAndSort(allTorrents, search, statusFilter).map(torrent => torrent.infoHash)
    torrentCount = TORRENT_PAGE_SIZE
    currentHashes = filteredHashes.slice(0, torrentCount)
    knownHashes = new Set(allTorrents.map(torrent => torrent.infoHash))
  }

  /**
   * Gets or starts resolving info for a torrent, caching the result by hash.
   *
   * @param {Torrent} torrent
   * @returns {{ name: string, anime_title: string|null, resolvedId: number|null }}
   */
  function getResolvedInfo(torrent) {
    const cached = resolvedCache.get(torrent.infoHash)
    if (cached) return cached
    const cleanName = torrent.name ? AnimeResolver.cleanFileName(torrent.name) : ''
    const resolvedId = getId(torrent.infoHash, { client: true }, true)?.mediaId ?? null
    /** @type {{ name: string, anime_title: string|null, resolvedId: number|null }} */
    const info = { name: cleanName, anime_title: null, resolvedId }
    resolvedCache.set(torrent.infoHash, info)
    if (cleanName) {
      anitomyscript(cleanName).then(result => {
        info.anime_title = /** @type {AnitomyResult[] | undefined} */ (result)?.[0]?.anime_title ?? null
        filteredHashes = filterAndSort(allTorrents, searchText, statusFilter).map(torrent => torrent.infoHash)
        resortTorrents(torrentsByHash)
      }).catch(() => {})
    }
    return info
  }

  /**
   * Combines the current, staging, seeding, and completed torrents into one flat list with categories.
   *
   * @param {Partial<import('@/modules/torrent.js').Torrent>} loadedTorrent
   * @param {import('@/modules/torrent.js').Torrent[]} stagingTorrents
   * @param {import('@/modules/torrent.js').Torrent[]} seedingTorrents
   * @param {import('@/modules/torrent.js').Torrent[]} completedTorrents
   * @returns {Torrent[]}
   */
  function mergeTorrents(loadedTorrent, stagingTorrents, seedingTorrents, completedTorrents) {
    const merged = [
      ...(loadedTorrent?.infoHash ? [/** @type {Torrent} */ ({ ...loadedTorrent, current: true, completed: false, category: 'current' })] : []),
      ...(stagingTorrents?.filter(torrent => torrent.infoHash).map(torrent => ({ ...torrent, current: false, completed: false, category: 'staging' })) ?? []),
      ...(seedingTorrents?.filter(torrent => torrent.infoHash).map(torrent => ({ ...torrent, current: false, completed: false, category: 'seeding' })) ?? []),
      ...(completedTorrents?.filter(torrent => torrent.infoHash).map(torrent => ({ ...torrent, current: false, completed: true, category: (torrent.progress ?? 1) === 1 ? 'completed' : 'incomplete' })) ?? []),
    ]
    merged.forEach(torrent => getResolvedInfo(torrent))
    return merged
  }

  /**
   * Merges newly arrived torrents into the visible list if they match the current search.
   *
   * @param {Torrent[]} allTorrents
   * @param {string} searchText
   */
  function resyncTorrents(allTorrents, searchText) {
    if (statusFilter) {
      const stillMatchesCurrent = currentHashes.filter(hash => matchesStatus(torrentsByHash[hash], statusFilter))
      if (stillMatchesCurrent.length !== currentHashes.length) currentHashes = stillMatchesCurrent
      const stillMatchesFiltered = filteredHashes.filter(hash => matchesStatus(torrentsByHash[hash], statusFilter))
      if (stillMatchesFiltered.length !== filteredHashes.length) filteredHashes = stillMatchesFiltered
    }
    const newTorrents = allTorrents.filter(torrent => !knownHashes.has(torrent.infoHash))
    if (newTorrents.length) {
      knownHashes = new Set(allTorrents.map(torrent => torrent.infoHash))
      const matchingHashes = new Set(filterAndSort(newTorrents, searchText, statusFilter).map(torrent => torrent.infoHash))
      if (matchingHashes.size) {
        filteredHashes = filterAndSort(allTorrents, searchText, statusFilter).map(torrent => torrent.infoHash)
        const loadedSet = new Set(currentHashes)
        let mergedHashes = filteredHashes.filter(hash => loadedSet.has(hash) || matchingHashes.has(hash))
        if (mergedHashes.length > torrentCount) {
          if (torrentCount > TORRENT_PAGE_SIZE) torrentCount = mergedHashes.length
          else mergedHashes = mergedHashes.slice(0, torrentCount)
        }
        currentHashes = mergedHashes
      }
    }
  }

  /**
   * Re-sorts the currently visible torrents in place when their data changes, without adding or removing any.
   *
   * @param {Object.<string, Torrent>} torrentsByHash
   */
  function resortTorrents(torrentsByHash) {
    if (!currentHashes.length) return
    const currentVisible = currentHashes.map(hash => torrentsByHash[hash]).filter(Boolean)
    if (currentVisible.length !== currentHashes.length) return
    const resorted = sortTorrents(currentVisible).map(torrent => torrent.infoHash)
    if (resorted.some((hash, index) => hash !== currentHashes[index])) {
      currentHashes = resorted
    }
  }

  /**
   * Gets the comparable value for a torrent for a given sort key.
   *
   * @param {Torrent} torrent
   * @param {string} key
   * @returns {string|number}
   */
  function getSortValue(torrent, key) {
    switch (key) {
      case 'name': {
        const info = getResolvedInfo(torrent)
        return (info.anime_title || info.name || torrent.name || '').toLowerCase()
      }
      case 'size': return torrent.size ?? 0
      case 'progress': return torrent.progress ?? 0
      case 'ratio': return torrent.ratio ?? 0
      case 'down': return torrent.downloadSpeed ?? 0
      case 'up': return torrent.uploadSpeed ?? 0
      case 'eta': return torrent.eta ?? Infinity
      case 'seeders': return torrent.numSeeders ?? 0
      case 'leechers': return torrent.numLeechers ?? 0
      case 'cachedAt':
      default: return torrent.cachedAt ?? 0
    }
  }

  /**
   * Sorts a list of torrents according to the current sort key and direction.
   *
   * @param {Torrent[]} list
   * @returns {Torrent[]}
   */
  function sortTorrents(list) {
    const direction = sortOrder.direction === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      if (sortOrder.key === 'status') {
        const rankA = STATUS_ORDER[a.category] ?? 99
        const rankB = STATUS_ORDER[b.category] ?? 99
        if (rankA !== rankB) return (rankA - rankB) * direction
        return (b.cachedAt ?? 0) - (a.cachedAt ?? 0)
      } else if (BOTTOM_FOR_METRIC[sortOrder.key]) {
        const aBottom = BOTTOM_FOR_METRIC[sortOrder.key].includes(a.category)
        const bBottom = BOTTOM_FOR_METRIC[sortOrder.key].includes(b.category)
        if (aBottom !== bBottom) return aBottom ? 1 : -1
        if (aBottom && bBottom) return (b.cachedAt ?? 0) - (a.cachedAt ?? 0)
      }
      const aValue = getSortValue(a, sortOrder.key)
      const bValue = getSortValue(b, sortOrder.key)
      if (aValue < bValue) return -1 * direction
      if (aValue > bValue) return 1 * direction
      return (b.cachedAt ?? 0) - (a.cachedAt ?? 0)
    })
  }

  /**
   * Checks whether a torrent matches search text across its raw name, resolved anime title, and known media titles.
   *
   * @param {Torrent} torrent
   * @param {string} searchText
   * @returns {boolean}
   */
  function matchesSearch(torrent, searchText) {
    if (!searchText?.length) return true
    const info = getResolvedInfo(torrent)
    const media = info.resolvedId ? $mediaCache[info.resolvedId] : null
    const candidates = [torrent.name, info.anime_title, media?.title?.romaji, media?.title?.english, media?.title?.native].filter(/** @returns {phrase is string} */ (phrase) => Boolean(phrase))
    return candidates.some(text => matchPhrase(searchText, text, .35, false, true))
  }

  /**
   * Checks whether a torrent matches the active status filter.
   *
   * @param {Torrent} torrent
   * @param {string|null} statusFilter
   * @returns {boolean}
   */
  function matchesStatus(torrent, statusFilter) {
    if (!statusFilter) return true
    if (statusFilter === 'stalled') return isStalled(torrent)
    if (isStalled(torrent)) return false
    return torrent.category === statusFilter
      || (statusFilter === 'staging' && torrent.category === 'current' && torrent.progress < 1)
      || (statusFilter === 'seeding' && torrent.category === 'current' && torrent.progress === 1)
  }

  /**
   * Removes duplicate torrents, filters by search text and status filter, and sorts the result.
   *
   * @param {Torrent[]} results
   * @param {string} searchText
   * @param {string|null} statusFilter
   * @returns {Torrent[]}
   */
  function filterAndSort(results, searchText, statusFilter) {
    const dedupe = results.filter((torrent, index, arr) => arr.findIndex(_torrent => _torrent.infoHash === torrent.infoHash) === index)
    const filtered = dedupe.filter(torrent => matchesSearch(torrent, searchText) && matchesStatus(torrent, statusFilter))
    return sortTorrents(filtered)
  }

  /**
   * Formats a byte count into a human-readable string.
   *
   * @param {number} bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const value = bytes / 1024 ** exponent
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[exponent]}`
  }

  /**
   * Loads additional torrents when scrolling near bottom.
   * Implements simple infinite scroll pagination.
   *
   * @param {Event} event
   */
  function handleScroll(event) {
    const container = /** @type {HTMLElement} */ (event.target)
    if (currentHashes.length !== filteredHashes.length && container.scrollTop + container.clientHeight + 10 >= container.scrollHeight) {
      const nextBatch = filteredHashes.slice(currentHashes.length, currentHashes.length + TORRENT_PAGE_SIZE)
      currentHashes = [...new Set([...currentHashes, ...nextBatch])]
      torrentCount = currentHashes.length
    }
  }

  /** Triggers a rescan of the torrent cache, unless rescanning is currently disabled. */
  function rescan() {
    if (disableRescan) return
    $loadingSession = true
    const id = toast.loading('Rescanning...', { description: 'Scanning the torrent cache, this may take a moment...', dedupe: true, duration: Infinity })
    TORRENT.rescan()
      .then((/** @type {{ missingCount: number, removedCount: number }} */ { missingCount, removedCount }) => toast.update(id, { type: 'success', title: 'Rescan Complete', description: `Found ${missingCount} missing torrents and ${removedCount} removed from cache.`, duration: 6000 }))
      .catch(() => toast.update(id, { type: 'error', title: 'Rescan Failed', description: 'Torrent cache rescan failed, please try again.', duration: 6000 }))
      .finally(() => ($loadingSession = false))
  }

  /**
   * Toggles a status filter on/off.
   *
   * @param {StatusKey} statusKey
   */
  function toggleStatus(statusKey) {
    statusFilter = statusFilter === statusKey ? null : statusKey
    resetPagination()
  }

  /**
   * Checks if a torrent is stalled.
   *
   * @param {Torrent} torrent
   * @returns {boolean}
   */
  function isStalled(torrent) {
    if (torrent.completed || torrent.progress === 1) return false
    if (torrent.size && (torrent.downloadSpeed || torrent.uploadSpeed)) return false
    return !(!(torrent.downloadSpeed || torrent.uploadSpeed) && torrent.eta > 1000 && torrent.eta < Infinity && torrent.progress < 1 && !settings.value.torrentStreamedDownload)
  }

  /**
   * Counts the staging, stalled, seeding, incomplete, and completed torrents.
   *
   * @param {Torrent[]} torrents
   * @returns {{ staging: number, stalled: number, seeding: number, incomplete: number, completed: number }}
   */
  function getStatuses(torrents) {
    const counts = { staging: 0, stalled: 0, seeding: 0, incomplete: 0, completed: 0 }
    for (const torrent of torrents) {
      if (isStalled(torrent)) { counts.stalled++; continue }
      if (torrent.category === 'current') {
        torrent.progress < 1 ? counts.staging++ : counts.seeding++
        continue
      }
      if (torrent.category === 'staging') counts.staging++
      else if (torrent.category === 'seeding') counts.seeding++
      else if (torrent.category === 'incomplete') counts.incomplete++
      else if (torrent.category === 'completed') counts.completed++
    }
    if (statusFilter && !counts[statusFilter]) {
      statusFilter = null
      resetPagination()
    }
    return counts
  }

  /**
   * Changes the active sort key, or flips direction if the same key is clicked again.
   *
   * @param {string} key
   */
  function toggleSort(key) {
    if (key === 'status' && statusFilter) {
      statusFilter = null
      sortOrder.key = 'status'
      sortOrder.direction = 'asc'
      resetPagination()
      return
    } else if (sortOrder.key === key) {
      sortOrder.direction = sortOrder.direction === 'asc' ? 'desc' : 'asc'
    } else {
      sortOrder.key = key
      sortOrder.direction = key === 'name' || key === 'status' ? 'asc' : 'desc'
    }
    container?.scrollTo?.({ top: 0 })
    filteredHashes = filterAndSort(allTorrents, searchText, statusFilter).map(torrent => torrent.infoHash)
    currentHashes = filteredHashes.slice(0, torrentCount)
  }
</script>

<div class='root bg-dark d-flex flex-column h-full w-full overflow-y-scroll overflow-x-hidden' bind:this={container} on:scroll={handleScroll}>
  <div class='header w-full pl-20 position-sticky top-0 bg-dark z-20 pb-10 mb-15' class:status-transition={statusTransition} class:pt-28px={$status === 'online'} class:pt-15={$status !== 'online'}>
    <h4 class='font-weight-bold m-0 mb-10'>Manage Torrents</h4>
    <div class='d-flex align-items-center'>
      <div class='input-group wm-600'>
        <Search size='2.6rem' strokeWidth='2.4' class='position-absolute z-10 text-dark-light h-full pl-10 pointer-events-none' />
        <input
            type='search'
            class='form-control bg-dark-very-light pl-40 rounded-1 h-40 text-truncate'
            autocomplete='off'
            spellcheck='false'
            data-option='search'
            placeholder='Filter torrents by text, or manually specify one by pasting a magnet link or torrent file'
            disabled={$loadingSession}
            bind:value={searchText}
            on:input={(event) => updateSearch(/** @type {HTMLInputElement | null} */ (event.target)?.value)}/>
      </div>
      <button type='button' use:click={rescan} disabled={disableRescan || $loadingSession} title={disableRescan ? 'Enable Persist Files or Increase Seeding Limit' : $loadingSession ? 'Rescanning Cache...' : 'Rescan Cache'} class='btn btn-primary d-flex align-items-center justify-content-center ml-20 mr-20 font-scale-16 h-full' class:cursor-wait={$loadingSession}>
        <RefreshCw class='mr-10' size='1.8rem' strokeWidth='2.4'/><span>Rescan</span>
      </button>
    </div>
  </div>

  <div class='mx-20 mb-10'>
    <div class='alert bg-warning border-warning-dim text-warning-very-dim p-10 px-15 mb-25 d-none' class:d-inline-flex={disableRescan}>
      <TriangleAlert class='flex-shrink-0' size='1.8rem' />
      <span class='ml-10 select-text'>You've reached your pre-download limit. To pre-download more torrents, stop seeding some, increase your seeding limit, or enable Persist Files in Client Settings.</span>
    </div>
    <div class='disk-bar mb-15 wm-726 text-muted'>
      <div class='d-flex align-items-center justify-content-between'>
        <div class='d-flex align-items-end overflow-hidden text-white gap-5'>
          <HardDrive size='2rem' strokeWidth='2.4' class='flex-shrink-0 mb-3'/>
          <span class='font-size-13 text-truncate select-text' title={$settings.torrentPathNew ?? 'tmp'}>{$settings.torrentPathNew ?? 'tmp'}</span>
        </div>
      <span class='font-size-13 flex-shrink-0 ml-15' title='{formatBytes($diskSpace?.free)} free of {formatBytes($diskSpace?.total)}'>
        <span class='font-scale-16 font-weight-bold' class:text-white={!lowDiskSpace && !noDiskSpace} class:text-warning={lowDiskSpace} class:text-danger={noDiskSpace}>{formatBytes($diskSpace?.free)}</span> free of {formatBytes($diskSpace?.total)}
      </span>
      </div>
      <div class='disk-bar-track d-flex h-10 gap-3 w-full overflow-hidden mt-2'>
        <div class='disk-bar-segment h-full bg-primary' title='Shiru Files' style='width: {$diskSpace?.total ? (shiruBytes / $diskSpace.total) * 100 : 0}%'/>
        <div class='disk-bar-segment h-full bg-other' title='Other Files' style='width: {$diskSpace?.total ? (otherBytes / $diskSpace.total) * 100 : 0}%'/>
        <div class='disk-bar-segment h-full bg-dark-very-light' title='Free Space' style='width: {freePercent}%'/>
      </div>
      <div class='d-flex gap-20'>
        <button type='button' class='disk-bar-legend-item d-flex align-items-center gap-5 border-0 bg-transparent pointer p-5' use:click={() => toggleSort('size')}>
          <span class='disk-bar-dot d-inline-block bg-primary'/>
          <span class='font-scale-12'>Shiru</span>
          <span class='font-scale-12 font-weight-bold text-white'>{formatBytes(shiruBytes)}</span>
        </button>
        <div class='d-flex align-items-center gap-5 p-5'>
          <span class='disk-bar-dot d-inline-block bg-other'/>
          <span class='font-scale-12'>Other</span>
          <span class='font-scale-12 font-weight-bold text-white'>{formatBytes(otherBytes)}</span>
        </div>
      </div>
    </div>
    <div class='d-flex flex-wrap status-row'>
      {#each (/** @type {StatusKey[]} */ (['stalled', 'staging', 'seeding', 'incomplete', 'completed'])).filter(key => statusCounts[key]) as key (key)}
        <button type='button' class='status-filter text-muted font-size-13 font-weight-bold border-0 bg-transparent p-0 pointer d-flex align-items-center no-scale' disabled={$loadingSession} class:active={statusFilter === key} on:click={() => toggleStatus(key)} animate:flip={{ duration: 200 }} transition:scale={{ duration: 200, start: .7 }}>
          <svelte:component this={STATUS[key].icon} size='2rem' class='mr-5' strokeWidth='2.4'/>{STATUS[key].label}: {statusCounts[key]}
        </button>
      {/each}
    </div>
  </div>

  <div class='d-flex flex-column flex-1 w-full text-wrap text-break-word font-scale-16'>
    <div class='t-grid labels position-sticky bg-dark z-20 bt-10 font-scale-18 mb-5' class:status-transition={statusTransition} style='top: calc(9rem + {$status === 'online' ? `28px` : `1.5rem`})'>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-flex ml-20 mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'name'} class:desc={sortOrder.key === 'name' && sortOrder.direction === 'desc'} on:click={() => toggleSort('name')}>
        <span>Name</span>
      </button>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-none d-md-flex mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'size'} class:desc={sortOrder.key === 'size' && sortOrder.direction === 'desc'} on:click={() => toggleSort('size')}>
        <span>Size</span>
      </button>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-flex mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'progress'} class:desc={sortOrder.key === 'progress' && sortOrder.direction === 'desc'} on:click={() => toggleSort('progress')}>
        <span class='d-none d-md-inline'>Progress</span><Percent class='d-md-none' size='2rem'/>
      </button>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-flex mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'status' && !statusFilter} class:desc={sortOrder.key === 'status' && sortOrder.direction === 'desc'} on:click={() => toggleSort('status')}>
        <span class='d-none d-md-inline'>Status</span><Activity class='d-md-none' size='2rem'/>
      </button>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-none d-md-flex mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'ratio'} class:desc={sortOrder.key === 'ratio' && sortOrder.direction === 'desc'} on:click={() => toggleSort('ratio')}>
        <span>Ratio</span>
      </button>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-flex d-lg-none mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'down'} class:desc={sortOrder.key === 'down' && sortOrder.direction === 'desc'} on:click={() => toggleSort('down')}>
        <span class='d-none d-md-inline'>Speed</span><Gauge class='d-md-none' size='2rem'/>
      </button>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-none d-lg-flex mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'down'} class:desc={sortOrder.key === 'down' && sortOrder.direction === 'desc'} on:click={() => toggleSort('down')}>
        <span>Down</span>
      </button>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-none d-lg-flex mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'up'} class:desc={sortOrder.key === 'up' && sortOrder.direction === 'desc'} on:click={() => toggleSort('up')}>
        <span>Up</span>
      </button>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-none d-sm-flex d-lg-none mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'seeders'} class:desc={sortOrder.key === 'seeders' && sortOrder.direction === 'desc'} on:click={() => toggleSort('seeders')}>
        <span class='d-none d-md-inline'>Peers</span><UserSearch class='d-md-none' size='2rem'/>
      </button>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-none d-lg-flex mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'seeders'} class:desc={sortOrder.key === 'seeders' && sortOrder.direction === 'desc'} on:click={() => toggleSort('seeders')}>
        <span>Seeders</span>
      </button>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-none d-lg-flex mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'leechers'} class:desc={sortOrder.key === 'leechers' && sortOrder.direction === 'desc'} on:click={() => toggleSort('leechers')}>
        <span>Leechers</span>
      </button>
      <button type='button' class='sort-header border-0 bg-transparent pointer font-weight-bold p-5 d-none d-md-flex mb-0 pb-0 no-scale' disabled={$loadingSession} class:active={sortOrder.key === 'eta'} class:desc={sortOrder.key === 'eta' && sortOrder.direction === 'desc'} on:click={() => toggleSort('eta')}>
        <span class='d-none d-md-inline'>ETA</span><Timer class='d-md-none' size='2rem'/>
      </button>
      <div class='font-weight-bold p-5 mr-5 mr-md-20 mb-0 pb-0'/>
    </div>

    <div class='flex-1' >
      {#if currentTorrents.length}
        {#each currentTorrents as torrent (torrent.infoHash)}
          <div animate:flip={{ duration: 300 }}>
            <TorrentCard data={torrent} current={torrent.current} completed={torrent.completed} {disableRescan} {container} />
          </div>
        {/each}
      {:else}
        <ErrorCard promise={{ errors: [ { message: searchText?.length && allTorrents.filter(torrent => torrent.infoHash).length ? 'found no results' : $loadingSession && !allTorrents.filter(torrent => torrent.infoHash).length ? 'loading torrent library' : 'found no loaded torrents' }]}}/>
      {/if}
    </div>
  </div>
</div>

<style>
  .header::after,
  .labels::after {
    content: '';
    position: absolute;
    bottom: -.8rem;
    left: 0;
    right: 0;
    height: .8rem;
    background: linear-gradient(to bottom, var(--dark-color), transparent);
    pointer-events: none;
    z-index: 1;
  }

  .sort-header {
    font: inherit;
    color: inherit;
    background-repeat: no-repeat;
    background-size: 98% .2rem;
    background-position: top left;
    transition: opacity .15s ease;
  }
  .sort-header.active {
    color: var(--primary-color);
    background-image: linear-gradient(var(--primary-color), var(--primary-color));
  }
  .sort-header.active.desc {
    background-position: bottom left;
  }
  .sort-header:hover,
  .status-filter:hover {
    opacity: .7;
  }

  .status-row {
    column-gap: 2rem;
    row-gap: 1rem;
  }
  .status-filter {
    transition: opacity .15s ease;
  }
  .status-filter.active {
    color: var(--primary-color) !important;
  }

  .disk-bar-dot {
    height: .9rem;
    width: .9rem;
    border-radius: .2rem;
  }
  .disk-bar-track {
    border-radius: .3rem;
  }
  .disk-bar-segment {
    transition: width .4s ease;
  }
  .bg-other {
    background-color: hsla(var(--gray-color-light-hsl), .6) !important;
  }
</style>