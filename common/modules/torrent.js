import { files, nowPlaying as media } from '../views/Player/MediaHandler.svelte'
import { page } from '@/App.svelte'
import { settings } from '@/modules/settings.js'
import { cache, caches } from '@/modules/cache.js'
import { toast } from 'svelte-sonner'
import clipboard from './clipboard.js'
import IPC from '@/modules/ipc.js'
import 'browser-event-target-emitter'
import Debug from 'debug'

const debug = Debug('ui:torrent')

const torrentRx = /(^magnet:){1}|(^[A-F\d]{8,40}$){1}|(.*\.torrent$){1}/i

class TorrentWorker extends EventTarget {
  constructor () {
    super()
    this.ready = new Promise(resolve => {
      IPC.once('port', () => {
        this.port = window.port
        this.port.onmessage(this.handleMessage.bind(this))
        resolve()
      })
      IPC.emit('portRequest')
    })
    clipboard.on('text', ({ detail }) => {
      for (const { text } of detail) {
        if (page?.value !== 'watchtogether' && torrentRx.exec(text)) {
          media.set(null)
          add(text)
          this.dispatch('info', 'A Magnet Link has been detected and is being processed. Files will be loaded shortly...')
        }
      }
    })
    clipboard.on('files', async ({ detail }) => {
      for (const file of detail) {
        if (file.name.endsWith('.torrent')) {
          media.set(null)
          add(new Uint8Array(await file.arrayBuffer()))
        }
      }
    })
  }

  handleMessage ({ data }) {
    this.emit(data.type, data.data)
  }

  async send (type, data, transfer) {
    await this.ready
    debug(`Sending message ${type}`, JSON.stringify(data))
    this.port.postMessage({ type, data }, transfer)
  }
}

export const client = new TorrentWorker()

client.send('load', await cache.read(caches.GENERAL, 'loadedTorrent'))

client.on('files', ({ detail }) => {
  files.set(detail)
})

client.on('error', ({ detail }) => {
  debug(`Error: ${detail.message || detail}`)
  if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Errors')) {
    toast.error('Torrent Error', {description: '' + (detail.message || detail)})
  }
})

client.on('warn', ({ detail }) => {
  debug(`Warn: ${detail.message || detail}`)
  if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Warnings')) {
    toast.warning('Torrent Warning', {description: '' + (detail.message || detail)})
  }
})

client.on('info', ({ detail }) => {
  debug(`Info: ${detail.message || detail}`)
  toast('Torrent Info', { description: '' + (detail.message || detail) })
})

export async function add (torrentID, hide) {
  if (torrentID) {
    debug('Adding torrent', { torrentID })
    if (torrentID.startsWith?.('magnet:')) {
      await cache.write(caches.GENERAL, 'loadedTorrent', JSON.stringify(torrentID))
    } else {
      await cache.write(caches.GENERAL, 'loadedTorrent', torrentID)
    }
    files.set([])
    if (!hide) {
      page.set('player')
      window.dispatchEvent(new Event('overlay-check'))
    }
    client.send(`torrent`, torrentID)
  }
}
// external player for android
client.on('open', ({ detail }) => {
  debug(`Open: ${detail}`)
  IPC.emit('intent', detail)
})

IPC.on('intent-end', () => {
  client.dispatch('externalWatched')
})
