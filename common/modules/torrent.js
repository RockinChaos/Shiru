import { files, nowPlaying as media } from '@/components/MediaHandler.svelte'
import { page } from '@/modules/navigation.js'
import { capitalize, stripRootFolder, equalsIgnoreCase, getTorrentSettings } from '@/modules/util.js'
import { settings, debugStore } from '@/modules/settings.js'
import { cache, caches } from '@/modules/cache.js'
import { SUPPORTS } from '@/modules/support.js'
import { status } from '@/modules/networking.js'
import { writable } from 'simple-store-svelte'
import { toast } from '@/modules/lib/toast.js'
import clipboard from '@/modules/lib/clipboard.js'
import { TORRENT, ELECTRON } from '@/modules/bridge.js'
import { get } from 'svelte/store'
import Debug from 'debug'
const debug = Debug('ui:torrent')

/** @typedef {import('@/types').Torrent} Torrent */

const excludedToastMessages = ['no buffer space', 'localDescription']
const torrentRx = /(^magnet:){1}|(^[A-F\d]{8,40}$){1}|(.*\.torrent$){1}/i
let _settings

/** @type {import('simple-store-svelte').Writable<boolean>} */
export const loadingSession = writable(true)
/** @type {import('simple-store-svelte').Writable<Partial<Torrent>>} */
export const loadedTorrent = writable({})
/** @type {import('simple-store-svelte').Writable<Torrent[]>} */
export const stagingTorrents = writable([])
/** @type {import('simple-store-svelte').Writable<Torrent[]>} */
export const seedingTorrents = writable([])
/** @type {import('simple-store-svelte').Writable<Torrent[]>} */
export const completedTorrents = writable([])
/** @type {import('simple-store-svelte').Writable<{ total: number, free: number }>} */
export const diskSpace = writable({ total: 0, free: 0 })
/** @type {import('simple-store-svelte').Writable<Partial<Torrent> & { fileProgress: number }> & { stop?: () => void }} */
export const currentStats = Object.assign(writable({ infoHash: undefined, fileProgress: 0, numPeers: 0, uploadSpeed: 0, downloadSpeed: 0 }), { stop: undefined })

loadedTorrent.subscribe(torrent => {
  const infoHash = torrent?.infoHash
  if (infoHash === currentStats.value.infoHash) return
  currentStats.stop?.()
  currentStats.stop = undefined
  currentStats.set({ infoHash, fileProgress: 0, numPeers: 0, uploadSpeed: 0, downloadSpeed: 0 })
  if (infoHash) {
    currentStats.stop = watchStats(infoHash, stats => {
      if (!stats.current || loadedTorrent.value?.infoHash !== infoHash) return
      currentStats.set(stats)
    }, 300)
  }
})

clipboard.addEventListener('text', ({ detail }) => {
  for (const { text } of detail) {
    if (page.value !== page.WATCH_TOGETHER && torrentRx.exec(text)) {
      if (settings.value.stageImportedTorrents) stage(text)
      else {
        media.value = { torrent: true }
        add(text, null, null, true)
      }
    }
  }
})
if (!SUPPORTS.isAndroid) {
  clipboard.addEventListener('files', async ({ detail }) => {
    for (const file of detail) {
      if (file.name.endsWith('.torrent')) {
        const torrentID = new Uint8Array(await file.arrayBuffer())
        if (settings.value.stageImportedTorrents) stage(torrentID)
        else {
          media.value = { torrent: true }
          add(torrentID)
        }
      }
    }
  })
}

_settings = getTorrentSettings(settings.value, cache.cacheID, get(debugStore))
TORRENT.portRequest(_settings).then(async () => {
  await setupTorrentClient()
  status.subscribe(value => TORRENT.updateNetwork(value).catch(error => notify('error', error)))
  settings.subscribe(value => {
    const settingsVal = getTorrentSettings(value, cache.cacheID, get(debugStore))
    if (JSON.stringify(_settings) !== JSON.stringify(settingsVal)) {
      _settings = settingsVal
      TORRENT.updateSettings(_settings).catch(error => notify('error', error))
    }
  })

  window.addEventListener('add', (event) => add(event.detail.resolvedHash, event.detail.search, event.detail.resolvedHash)) // TODO: Circular Dependency (MediaHandler.svelte)
  TORRENT.onCrash(() => {
    console.error('Ooops! WebTorrent Crashed! A crash has been detected... The process has automatically been restarted.')
    toast.error('Ooops! WebTorrent Crashed!', {
      description: 'A crash has been detected... The process has automatically been restarted.',
      duration: 15_000,
      force: true,
      dedupe: true
    })
    TORRENT.portRequest(_settings).then(() => setupTorrentClient()).catch(error => notify('error', error.message))
  })
  TORRENT.onRequest(opts => {
    ELECTRON.showAndFocus()
    debug(`Got torrent request for:`, JSON.stringify(opts))
    if (settings.value.stageImportedTorrents) stage(opts.magnet, null, null, opts.base64)
    else add(opts.magnet, null, null, null, opts.base64)
  })
}).catch(error => notify('error', error.message))

/**
 * Publishes the playable files returned by torrent metadata.
 * @param {object[]} _files Playable file descriptors.
 * @returns {void}
 */
function onReady(_files) {
  debug(`Got files request:`, _files?.length)
  files.set(_files)
}

/**
 * Applies a torrent lifecycle change to renderer stores and session cache.
 * @param {string|null} hash Torrent hash, or null for clearing the current torrent.
 * @param {{current?: {stats?: Torrent, infoHash?: string, id?: string, local?: boolean}, staging?: Torrent, seeding?: Torrent, completed?: Torrent, untrack?: boolean}} update Changed role or removal notification.
 * @returns {void}
 */
function updateTorrent(hash, update) {
  requestTorrentMedia([update.current?.stats || update.staging || update.seeding || update.completed])
  if (update.current) {
    const detail = update.current
    const { stats, ...data } = detail
    loadedTorrent.update(() => stats || {})
    cache.setEntry(caches.GENERAL, 'loadedTorrent', data)
    debug(`Got loaded request for torrent:`, data?.infoHash)
    deduplicate(data?.infoHash)
  }
  if (update.staging) {
    const detail = update.staging
    debug(`Staging torrent:`, JSON.stringify(detail.infoHash))
    const torrents = cache.getEntry(caches.GENERAL, 'stagingTorrents') || []
    const source = (detail.resolving || detail.verifying) && detail.magnetURI ? { id: detail.magnetURI, infoHash: detail.infoHash } : detail.infoHash
    cache.setEntry(caches.GENERAL, 'stagingTorrents', [...torrents.filter(torrent => !equalsIgnoreCase(torrent?.infoHash ?? torrent, detail.infoHash)), source])
    deduplicate(detail.infoHash, 'seedingTorrents', 'completedTorrents')
    if (equalsIgnoreCase(loadedTorrent.value?.infoHash, detail.infoHash)) loadedTorrent.update(() => ({}))
    stagingTorrents.update(prev => [detail, ...prev.filter(torrent => !equalsIgnoreCase(torrent.infoHash, detail.infoHash))])
  }
  if (update.seeding) {
    const detail = update.seeding
    debug(`Seeding torrent:`, JSON.stringify(detail.infoHash))
    const torrents = cache.getEntry(caches.GENERAL, 'seedingTorrents') || []
    if (!torrents.includes(detail.infoHash)) cache.setEntry(caches.GENERAL, 'seedingTorrents', Array.from(new Set([...torrents, detail.infoHash])))
    deduplicate(detail.infoHash, 'stagingTorrents', 'completedTorrents')
    if (equalsIgnoreCase(loadedTorrent.value?.infoHash, detail.infoHash)) loadedTorrent.set({})
    seedingTorrents.update(prev => [detail, ...prev.filter(torrent => !equalsIgnoreCase(torrent.infoHash, detail.infoHash))])
  }
  if (update.completed) {
    const detail = update.completed
    debug(`Completed torrent:`, JSON.stringify(detail))
    const torrents = cache.getEntry(caches.GENERAL, 'completedTorrents') || []
    if (!torrents.includes(detail?.infoHash)) cache.setEntry(caches.GENERAL, 'completedTorrents', Array.from(new Set([...torrents, detail.infoHash])))
    deduplicate(detail?.infoHash, 'stagingTorrents', 'seedingTorrents')
    if (equalsIgnoreCase(loadedTorrent.value?.infoHash, detail.infoHash)) loadedTorrent.update(() => ({}))
    completedTorrents.update(prev => [detail, ...prev.filter(torrent => !equalsIgnoreCase(torrent.infoHash, detail.infoHash))])
  }
  if (update.untrack) {
    const detail = hash
    debug(`Got untrack request for torrent:`, JSON.stringify(detail))
    deduplicate(detail)
    if (equalsIgnoreCase(loadedTorrent.value?.infoHash, detail)) loadedTorrent.set({})
  }
}

/**
 * Merges restored completed torrents and finishes session loading.
 * @param {Torrent[]} detail
 * @returns {void}
 */
function onCompleted(detail) {
  debug('Got completed stats request')
  requestTorrentMedia(detail)
  completedTorrents.update(torrents => Array.from(new Map([...detail, ...torrents].map(torrent => [torrent.infoHash, torrent])).values()))
  loadingSession.set(false)
}

/**
 * Returns available torrents in playback priority order using their saved file metadata.
 * @param mediaId
 * @param episode
 */
export function findTorrents(mediaId, episode) {
  if (!mediaId) return []
  return [loadedTorrent.value, ...seedingTorrents.value, ...stagingTorrents.value, ...completedTorrents.value].filter(torrent => {
    if (!torrent?.infoHash) return false
    const files = Object.values(torrent.media?.files || {}).filter(file => file.anilist_id)
    return (files.length ? files : [torrent.media?.default]).some(file => {
      if (!file || file.anilist_id !== Number(mediaId) || file.failed) return false
      if (episode == null) return true
      const range = file.episodeRange || (typeof file.episode === 'string' && /^(\d+)\s*[~-]\s*(\d+)$/.exec(file.episode))
      if (range) return episode >= Number(range.first ?? range[1]) && episode <= Number(range.last ?? range[2])
      return file.episode != null ? Number(file.episode) === Number(episode) : !files.length
    })
  })
}

/** @param torrent */
export function getTorrentMedia(torrent) {
  const files = Object.values(torrent?.media?.files || {}).filter(file => file.anilist_id)
  if (!files.length) return torrent?.media?.default && { ...torrent.media.default, files: [] }
  const anilist_id = Math.min(...files.map(file => file.anilist_id))
  return {
    ...(files.length === 1 ? files[0] : {}),
    anilist_id,
    mal_id: files.find(file => file.anilist_id === anilist_id && file.mal_id)?.mal_id,
    locked: files.every(file => file.locked),
    failed: files.every(file => file.failed),
    files
  }
}

/**
 * @param hash
 * @param data
 * @param path
 */
export async function setTorrentMedia(hash, data, path) {
  try {
    const anilist_id = data.media?.id ?? data.anilist_id
    const locked = !!(data.locked || data.parseObject?.locked)
    const media = await TORRENT.setMedia(hash, {
      ...(path ? { path } : {}),
      anilist_id,
      mal_id: data.media?.idMal ?? cache.getMedia(anilist_id)?.idMal ?? (data.anilist_id === anilist_id ? data.mal_id : null),
      episode: data.episode ?? null,
      episodeRange: data.episodeRange ?? null,
      season: data.season ?? null,
      failed: !locked && !!(data.failed || data.parseObject?.failed),
      locked,
    })
    if (equalsIgnoreCase(loadedTorrent.value?.infoHash, hash)) loadedTorrent.update(torrent => ({ ...torrent, media }))
    for (const store of [stagingTorrents, seedingTorrents, completedTorrents]) {
      store.update(torrents => torrents.map(torrent => equalsIgnoreCase(torrent.infoHash, hash) ? { ...torrent, media } : torrent))
    }
    for (const file of files.value) {
      if (equalsIgnoreCase(file.infoHash, hash)) file.mediaData = media.files?.[stripRootFolder(file.path)]
    }
    return true
  } catch (error) {
    notify('error', error)
    return false
  }
}

function requestTorrentMedia(torrents) {
  const ids = new Set(torrents.flatMap(torrent => {
    const files = Object.values(torrent?.media?.files || {}).filter(file => file.anilist_id)
    return (files.length ? files : [torrent?.media?.default]).map(file => file?.anilist_id).filter(Boolean)
  }))
  for (const id of ids) {
    if (!cache.getMedia(id)?.id) cache.requestMedia(id).catch(error => console.warn('Could not load torrent media', error))
  }
}

export async function add(torrentID, search, hash, magnet, base64 = false) {
  if (torrentID) {
    debug('Adding torrent', JSON.stringify({ torrentID, search, hash, magnet }))
    files.set([])
    page.navigateTo(page.PLAYER)
    media.value = search ? { media: (search.media || media.value?.media), episode: (search.episode || media.value?.episode), ...(media.value?.torrent ? { torrent: true } : { feed: true }) } : { torrent: true }
    if (SUPPORTS.isAndroid && !settings.value.enableExternal && settings.value.autoFullscreen) document.querySelector('.content-wrapper').requestFullscreen() // this WILL not work with auto-select torrents due to permissions check.
    try {
      const torrent = await TORRENT.stream(torrentID, (equalsIgnoreCase(hash, torrentID) && torrentID) || false, magnet, base64, onReady)
      if (torrent?.infoHash && search) await setTorrentMedia(torrent.infoHash, search)
    } catch (error) {
      notify('error', error)
    }
  }
}
export async function stage(torrentID, search, hash, base64 = false) {
  if (torrentID) {
    debug('Pre-Adding torrent', JSON.stringify({ torrentID, search, hash }))
    let torrent
    try {
      torrent = await TORRENT.stage(torrentID, (equalsIgnoreCase(hash, torrentID) && torrentID) || false, base64)
    } catch (error) {
      notify('error', error)
      return false
    }
    if (torrent?.infoHash && search) await setTorrentMedia(torrent.infoHash, search)
    if (hash) {
      const existingTorrent = seedingTorrents.value.find(torrent => torrent.infoHash === hash) || completedTorrents.value.find(torrent => equalsIgnoreCase(torrent.infoHash, hash))
      if (existingTorrent) {
        stagingTorrents.update(list => [...list, existingTorrent])
        seedingTorrents.update(torrents => torrents.filter(torrent => !equalsIgnoreCase(torrent.infoHash, hash)))
        completedTorrents.update(torrents => torrents.filter(torrent => !equalsIgnoreCase(torrent.infoHash, hash)))
      }
    }
    return torrent || false
  }
  return false
}
export async function unload(torrent, hash, force = false) {
  if (torrent) {
    debug('Unloading torrent', JSON.stringify({ torrent, hash }))
    TORRENT.unload({ torrent, hash }).catch(error => notify('error', error))
  } else if (force) {
    files.value = []
    media.value = { ...media.value, display: true } // set display to true to allow the 'Last Watched' button to remain on the SideBar.
    TORRENT.unload(null).catch(error => notify('error', error)) // this will not override the cached loadedTorrent, we rely on users to enable disableStartupTorrent if they don't want to load the previous torrent when the app starts.
  }
}
export async function untrack(hash) {
  if (hash) {
    debug('Untracking torrent', hash)
    if (equalsIgnoreCase(loadedTorrent.value?.infoHash, hash)) {
      files.value = []
      media.value = { ...media.value, display: true } // set display to true to allow the 'Last Watched' button to remain on the SideBar.
    }
    TORRENT.untrack(hash).catch(error => notify('error', error))
  }
}
export async function complete(hash) {
  if (hash) {
    debug('Stopping Seeding torrent', hash)
    TORRENT.complete(hash).catch(error => notify('error', error))
  }
}
export async function reannounce(hash) {
  if (hash) {
    debug('Requesting reannounce for torrent', hash)
    TORRENT.reannounce(hash).catch(error => notify('error', error))
  }
}

function deduplicate(hash, ..._caches) {
  if (!hash) return
  const cacheList = _caches.length ? _caches : ['stagingTorrents', 'seedingTorrents', 'completedTorrents']
  for (const cacheName of cacheList) {
    const list = cache.getEntry(caches.GENERAL, cacheName) || []
    const filtered = list.filter(torrent => !equalsIgnoreCase(torrent?.infoHash ?? torrent, hash))
    if (filtered.length !== list.length) {
      debug(`Detected duplicate torrent in: ${cacheName}`)
      cache.setEntry(caches.GENERAL, cacheName, filtered)
    }
  }
  if (_caches.includes('stagingTorrents') || !_caches.length) stagingTorrents.update(arr => arr.filter(torrent => !equalsIgnoreCase(torrent.infoHash, hash)))
  if (_caches.includes('seedingTorrents') || !_caches.length) seedingTorrents.update(arr => arr.filter(torrent => !equalsIgnoreCase(torrent.infoHash, hash)))
  if (_caches.includes('completedTorrents') || !_caches.length) completedTorrents.update(arr => arr.filter(torrent => !equalsIgnoreCase(torrent.infoHash, hash)))
}

/**
 * Polls one torrent without overlapping requests.
 * @param {string} infoHash
 * @param {(stats: NonNullable<Awaited<ReturnType<typeof TORRENT.getTorrentStats>>>) => void} callback
 * @param {number} [duration=5000]
 * @returns {() => void} Stops future requests and discards any pending result.
 */
export function watchStats(infoHash, callback, duration = 5_000) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer
  /** @type {boolean} */
  let destroyed = false
  /**
   * Fetches one snapshot and schedules the next request only after it settles.
   * @returns {Promise<void>}
   */
  async function refresh() {
    try {
      const stats = await TORRENT.getTorrentStats(infoHash)
      if (!destroyed && stats) callback(stats)
    } catch (error) {
      if (!destroyed) console.warn('Failed to read torrent stats', error)
    } finally {
      if (!destroyed && duration > 0) timer = setTimeout(refresh, duration)
    }
  }
  refresh()
  return () => {
    destroyed = true
    clearTimeout(timer)
  }
}

async function setupTorrentClient() {
  loadingSession.set(true)
  loadedTorrent.value = {}
  stagingTorrents.value = []
  seedingTorrents.value = []
  completedTorrents.value = []
  currentStats.set({ infoHash: undefined, fileProgress: 0, numPeers: 0, uploadSpeed: 0, downloadSpeed: 0 })
  await TORRENT.subscribe(notify, updateTorrent)
  if (!settings.value.disableStartupTorrent) TORRENT.restoreSession((cache.getEntry(caches.GENERAL, 'stagingTorrents') || []).filter(Boolean), (cache.getEntry(caches.GENERAL, 'seedingTorrents') || []).filter(Boolean), (cache.getEntry(caches.GENERAL, 'completedTorrents') || []).filter(Boolean), cache.getEntry(caches.GENERAL, 'loadedTorrent'), onReady).then(onCompleted).catch(error => notify('error', error.message))
  else {
    debug(`Unloading torrent(s) from previous session`)
    TORRENT.unload(cache.getEntry(caches.GENERAL, 'loadedTorrent')).catch(error => notify('error', error))
    const unloadedCompleted = Array.from(new Set([...(cache.getEntry(caches.GENERAL, 'completedTorrents') || []), ...(cache.getEntry(caches.GENERAL, 'seedingTorrents') || []), ...(cache.getEntry(caches.GENERAL, 'stagingTorrents') || [])].map(torrent => torrent?.infoHash ?? torrent))).filter(Boolean)
    cache.setEntry(caches.GENERAL, 'loadedTorrent', {})
    cache.setEntry(caches.GENERAL, 'completedTorrents', unloadedCompleted)
    cache.setEntry(caches.GENERAL, 'stagingTorrents', [])
    cache.setEntry(caches.GENERAL, 'seedingTorrents', [])
    TORRENT.restoreSession(null, null, unloadedCompleted).then(onCompleted).catch(error => notify('error', error.message))
  }
}

function notify(type, detail) {
  debug(`${capitalize(type)}:`, detail.message || JSON.stringify(detail))
  for (const exclude of excludedToastMessages) {
    if ((detail.message || detail)?.toLowerCase()?.includes(exclude)) return
  }
  if (type === 'warn') toast.warning(`Torrent Warning`, { description: '' + (detail.message || detail), respectLevel: true, dedupe: true })
  else if (type === 'error') toast.error(`Torrent Error`, { description: '' + (detail.message || detail), respectLevel: true, dedupe: true })
  else toast.info(`Torrent ${capitalize(type)}`, { description: '' + (detail.message || detail) })
}