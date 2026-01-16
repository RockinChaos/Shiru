import { files, nowPlaying as media } from '@/views/Player/MediaHandler.svelte'
import { page } from '@/App.svelte'
import { settings } from '@/modules/settings.js'
import { cache, caches } from '@/modules/cache.js'
import { SUPPORTS } from '@/modules/support.js'
import { status } from '@/modules/networking.js'
import { writable } from 'simple-store-svelte'
import { toast } from 'svelte-sonner'
import clipboard from '@/modules/clipboard.js'
import { setHash } from '@/modules/anime/animehash.js'
import { IPC } from '@/modules/bridge.js'
import WPC from '@/modules/wpc.js'
import 'browser-event-target-emitter'
import Debug from 'debug'
const debug = Debug('ui:torrent')

const excludedToastMessages = ['no buffer space', 'localDescription']
const torrentRx = /(^magnet:){1}|(^[A-F\d]{8,40}$){1}|(.*\.torrent$){1}/i
let _settings
class TorrentWorker extends EventTarget {

  constructor () {
    super()
    this.ready = new Promise(resolve => {
      IPC.once('port', () => {
        this.port = window.port
        this.port.onmessage(this.handleMessage.bind(this))
        resolve()
      })
      _settings = { userID: cache.cacheID, dht: !settings.value.torrentDHT, torrentUTP: !settings.value.torrentUTP, torrentPeX: !settings.value.torrentPeX, maxConns: settings.value.maxConns, downloadLimit: (settings.value.torrentSpeed * 1048576) || 0, uploadLimit: (settings.value.torrentSpeed * 1048576) || 0, torrentPort: settings.value.torrentPort || 0, dhtPort: settings.value.dhtPort || 0, torrentPersist: settings.value.torrentPersist, torrentStreamedDownload: settings.value.torrentStreamedDownload, torrentPathNew: settings.value.torrentPathNew, playerPath: settings.value.playerPath, seedingLimit: settings.value.seedingLimit }
      IPC.emit('portRequest', _settings)
    })
  }

  handleMessage ({ data }) {
    this.emit(data.type, data.data)
  }

  async send (type, data, transfer) {
    await this.ready
    debug(`Sending message ${type}`, data && type !== 'load' ? JSON.stringify(data) : '')
    this.port.postMessage({ type, data }, transfer)
  }
}

export let client = new TorrentWorker()
export const loadedTorrent = writable({})
export const stagingTorrents = writable([])
export const seedingTorrents = writable([])
export const completedTorrents = writable([])
setupTorrentClient()

status.subscribe(value => client.send('networking', value))
settings.subscribe(value => {
  let settingsVal = { userID: cache.cacheID, dht: !value.torrentDHT, torrentUTP: !value.torrentUTP, torrentPeX: !value.torrentPeX, maxConns: value.maxConns, downloadLimit: (value.torrentSpeed * 1048576) || 0, uploadLimit: (value.torrentSpeed * 1048576) || 0, torrentPort: value.torrentPort || 0, dhtPort: value.dhtPort || 0, torrentPersist: value.torrentPersist, torrentStreamedDownload: value.torrentStreamedDownload, torrentPathNew: value.torrentPathNew, playerPath: value.playerPath, seedingLimit: value.seedingLimit }
  if (JSON.stringify(_settings) !== JSON.stringify(settingsVal)) {
    _settings = settingsVal
    client.send('settings', _settings)
  }
})

IPC.on('webtorrent-crashed', () => {
  console.error('Ooops! WebTorrent Crashed! A crash has been detected... The process has automatically been restarted.')
  toast.dismiss()
  toast.error('Ooops! WebTorrent Crashed!', {
    description: 'A crash has been detected... The process has automatically been restarted.',
    duration: 15000
  })
  client = new TorrentWorker()
  setupTorrentClient()
})
window.addEventListener('torrent-unload', () => {
  files.value = []
  media.value = { ...media.value, display: true } // set display to true to allow the 'Last Watched' button to remain on the SideBar.
  client.send('unload', null) // this will not override the cached loadedTorrent, we rely on users to enable disableStartupTorrent if they don't want to load the previous torrent when the app starts.
})
window.addEventListener('add', (event) => add(event.detail.resolvedHash, event.detail.search, event.detail.resolvedHash))
window.addEventListener('rescan', () => client.send('rescan'))
clipboard.on('text', ({ detail }) => {
  for (const { text } of detail) {
    if (page?.value !== 'watchtogether' && torrentRx.exec(text)) {
      media.value = { torrent: true }
      add(text, null, null, true)
    }
  }
})
clipboard.on('files', async ({ detail }) => { // doesn't work on Capacitor....
  for (const file of detail) {
    if (file.name.endsWith('.torrent')) {
      media.value = { torrent: true }
      add(new Uint8Array(await file.arrayBuffer()))
    }
  }
})

export async function add(torrentID, search, hash, magnet) {
  if (torrentID) {
    debug('Adding torrent', JSON.stringify({ torrentID, search, hash, magnet }))
    files.set([])
    page.set('player')
    media.value = search ? { media: (search.media || media.value?.media), episode: (search.episode || media.value?.episode), ...(media.value?.torrent ? { torrent: true } : { feed: true }) } : { torrent: true }
    if (hash && search) setHash(hash, { mediaId: search.media?.id, episode: search.episode, client: true })
    window.dispatchEvent(new Event('overlay-check'))
    if (SUPPORTS.isAndroid && !settings.value.enableExternal) document.querySelector('.content-wrapper').requestFullscreen() // this WILL not work with auto-select torrents due to permissions check.
    client.send('torrent', { id: torrentID, hash: (hash === torrentID && torrentID) || false, magnet })
  }
}
export async function stage(torrentID, search, hash) {
  if (torrentID) {
    debug('Pre-Adding torrent', JSON.stringify({ torrentID, search, hash }))
    if (hash && search) setHash(hash, { mediaId: search.media?.id, episode: search.episode, client: true })
    client.send('stage', { id: torrentID, hash: (hash === torrentID && torrentID) || false })
    if (hash) {
      const existingTorrent = seedingTorrents.value.find(torrent => torrent.infoHash === hash) || completedTorrents.value.find(torrent => torrent.infoHash === hash)
      if (existingTorrent) {
        stagingTorrents.update(list => [...list, existingTorrent])
        seedingTorrents.update(torrents => torrents.filter(torrent => torrent.infoHash !== hash))
        completedTorrents.update(torrents => torrents.filter(torrent => torrent.infoHash !== hash))
      }
    }
  }
}
export async function unload(torrent, hash) {
  if (torrent) {
    debug('Unloading torrent', JSON.stringify({ torrent, hash }))
    client.send('unload', { torrent, hash })
  }
}
export async function untrack(hash) {
  if (hash) {
    debug('Untracking torrent', hash)
    client.send('untrack', hash)
  }
}
export async function complete(hash) {
  if (hash) {
    debug('Stopping Seeding torrent', hash)
    client.send('complete', hash)
  }
}

function deduplicateTorrents(hash, ..._caches) {
  if (!hash) return
  for (const cacheName of _caches) {
    const list = cache.getEntry(caches.GENERAL, cacheName) || []
    const filtered = list.filter(h => h !== hash)
    if (filtered.length !== list.length) {
      debug(`Detected duplicate torrent in: ${cacheName}`)
      cache.setEntry(caches.GENERAL, cacheName, filtered)
    }
  }
}

function setupTorrentClient() {
  loadedTorrent.value = {}
  stagingTorrents.value = []
  seedingTorrents.value = []
  completedTorrents.value = []
  if (!settings.value.disableStartupTorrent) {
    client.send('load', cache.getEntry(caches.GENERAL, 'loadedTorrent'))
    client.send('stage_all', cache.getEntry(caches.GENERAL, 'stagingTorrents').filter(Boolean))
    client.send('seed_all', cache.getEntry(caches.GENERAL, 'seedingTorrents').filter(Boolean))
  } else {
    debug(`Unloading torrent(s) from previous session`)
    client.send('unload', cache.getEntry(caches.GENERAL, 'loadedTorrent'))
    cache.setEntry(caches.GENERAL, 'loadedTorrent', {})
    cache.setEntry(caches.GENERAL, 'completedTorrents', Array.from(new Set([...(cache.getEntry(caches.GENERAL, 'completedTorrents') || []), ...(cache.getEntry(caches.GENERAL, 'seedingTorrents') || []), ...(cache.getEntry(caches.GENERAL, 'stagingTorrents') || [])])))
    cache.setEntry(caches.GENERAL, 'stagingTorrents', [])
    cache.setEntry(caches.GENERAL, 'seedingTorrents', [])
  }
  client.send('complete_all', cache.getEntry(caches.GENERAL, 'completedTorrents').filter(Boolean))

  for (const event of ['magnet', 'stats', 'chapters', 'progress', 'externalReady', 'externalWatched', 'androidExternal', 'scrape_done', 'rescan_done']) client.on(event, ({ detail }) => WPC.send(event, detail))
  for (const event of ['current', 'scrape', 'externalPlay', 'debug']) WPC.listen(event, (detail) => client.send(event, detail))

  // external player for android
  client.on('open', ({ detail }) => {
    debug(`Open:`, JSON.stringify(detail))
    IPC.emit('intent', detail)
  })

  client.on('activity', ({ detail }) => {
    loadedTorrent.update(() => ({ ...detail.current }))
    stagingTorrents.update(() => Array.from(new Map(detail.staging.map(torrent => [torrent.infoHash, torrent])).values()))
    seedingTorrents.update(() => Array.from(new Map(detail.seeding.map(torrent => [torrent.infoHash, torrent])).values()))
  })

  client.on('files', ({ detail }) => files.set(detail))

  client.on('loaded', ({ detail }) => {
    cache.setEntry(caches.GENERAL, 'loadedTorrent', detail)
    deduplicateTorrents(detail?.infoHash, 'stagingTorrents', 'seedingTorrents', 'completedTorrents')
    client.emit('untrack', detail?.infoHash)
  })
  client.on('untrack',  ({ detail }) => {
    debug(`Untracking torrent:`, JSON.stringify(detail))
    for (const category of ['stagingTorrents', 'seedingTorrents', 'completedTorrents']) {
      const list = cache.getEntry(caches.GENERAL, category) || []
      if (list.includes(detail)) cache.setEntry(caches.GENERAL, category, list.filter(h => h !== detail))
    }
    stagingTorrents.update(arr => arr.filter(torrent => torrent.infoHash !== detail))
    seedingTorrents.update(arr => arr.filter(torrent => torrent.infoHash !== detail))
    completedTorrents.update(arr => arr.filter(torrent => torrent.infoHash !== detail))
  })
  client.on('staging',  ({ detail }) => {
    debug(`Staging torrent:`, JSON.stringify(detail))
    const torrents = cache.getEntry(caches.GENERAL, 'stagingTorrents') || []
    if (!torrents.includes(detail)) {
      cache.setEntry(caches.GENERAL, 'stagingTorrents', Array.from(new Set([...torrents, detail])))
    }
    deduplicateTorrents(detail, 'seedingTorrents', 'completedTorrents')
    const found = structuredClone(loadedTorrent.value?.infoHash === detail || seedingTorrents.value.find(torrent => torrent.infoHash === detail) || completedTorrents.value.find(torrent => torrent.infoHash === detail))
    if (loadedTorrent.value?.infoHash === detail) loadedTorrent.update(() => ({}))
    seedingTorrents.update(torrents => torrents.filter(torrent => torrent.infoHash !== detail))
    completedTorrents.update(torrents => torrents.filter(torrent => torrent.infoHash !== detail))
    if (found) (found.incomplete ? stagingTorrents : seedingTorrents).update(prev => [found, ...prev.filter(torrent => torrent.infoHash !== detail)])
  })
  client.on('seeding',  ({ detail }) => {
    debug(`Seeding torrent:`, JSON.stringify(detail))
    const torrents = cache.getEntry(caches.GENERAL, 'seedingTorrents') || []
    if (!torrents.includes(detail)) cache.setEntry(caches.GENERAL, 'seedingTorrents', Array.from(new Set([...torrents, detail])))
    deduplicateTorrents(detail, 'stagingTorrents', 'completedTorrents')
  })
  client.on('completed',  ({ detail }) => {
    debug(`Completed torrent:`, JSON.stringify(detail))
    const torrents = cache.getEntry(caches.GENERAL, 'completedTorrents') || []
    if (!torrents.includes(detail?.infoHash)) cache.setEntry(caches.GENERAL, 'completedTorrents', Array.from(new Set([...torrents, detail.infoHash])))
    deduplicateTorrents(detail?.infoHash, 'stagingTorrents', 'seedingTorrents')
    if (loadedTorrent.value?.infoHash === detail.infoHash) loadedTorrent.update(() => ({}))
    stagingTorrents.update(arr => arr.filter(torrent => torrent.infoHash !== detail.infoHash))
    seedingTorrents.update(arr => arr.filter(torrent => torrent.infoHash !== detail.infoHash))
    completedTorrents.update(prev => [detail, ...prev.filter(torrent => torrent.infoHash !== detail.infoHash)])
  })
  client.on('completedStats', ({ detail }) => {
    WPC.send('rescan_done')
    completedTorrents.update(torrents => [...Array.from(new Map(detail.map(torrent => [torrent.infoHash, torrent])).values()), ...torrents])
  })

  client.on('error', ({ detail }) => {
    debug(`Error:`, detail.message || JSON.stringify(detail))
    if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Errors')) {
      for (const exclude of excludedToastMessages) {
        if ((detail.message || detail)?.toLowerCase()?.includes(exclude)) return
      }
      toast.error('Torrent Error', {description: '' + (detail.message || detail)})
    }
  })
  client.on('warn', ({ detail }) => {
    debug(`Warn:`, detail.message || JSON.stringify(detail))
    if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Warnings')) {
      for (const exclude of excludedToastMessages) {
        if ((detail.message || detail)?.toLowerCase()?.includes(exclude)) return
      }
      toast.warning('Torrent Warning', {description: '' + (detail.message || detail)})
    }
  })
  client.on('info', ({ detail }) => {
    debug(`Info:`, detail.message || JSON.stringify(detail))
    for (const exclude of excludedToastMessages) {
      if ((detail.message || detail)?.toLowerCase()?.includes(exclude)) return
    }
    toast('Torrent Info', { description: '' + (detail.message || detail) })
  })
}