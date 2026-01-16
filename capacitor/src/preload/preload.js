import { App } from '@capacitor/app'
import { NodeJS } from 'capacitor-nodejs'
import { IntentUri } from 'capacitor-intent-uri'
import { ForegroundService, Importance, ServiceType } from '@capawesome-team/capacitor-android-foreground-service'
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'
import { cache, caches } from '@/modules/cache.js'
import Updater from '../main/updater.js'
import EventEmitter from 'events'

if (typeof localStorage === 'undefined') {
  const data = {}
  globalThis.localStorage = {
    setItem: (k, v) => { data[k] = v },
    getItem: (k) => data[k] || null
  }
}

if (typeof indexedDB === 'undefined') {
  globalThis.indexedDB = fakeIndexedDB
}

export const IPC = new EventEmitter()
const ready = NodeJS.whenReady()
const STREAMING_FG_ID = 1001
ForegroundService.createNotificationChannel({
  id: 'external-playback',
  name: 'External Playback',
  description: 'Keeps Video Streaming To An External Player Active',
  importance: Importance.Min
})

window.IPC = IPC
window.version = {
  platform: globalThis.cordova?.platformId,
  arch: navigator.platform?.split(' ')?.[1]
}
window.android = {
  /**
   * Requests "All Files" access permission when needed, resolves `true` if access is granted, or `false` if denied.
   *
   * @returns {Promise<boolean>} Resolves with `true` when access is granted, otherwise `false`.
   */
  requestFileAccess: async () => {
    if (window.NativeBridge?.hasAllFilesAccess()) return true
    window.NativeBridge?.requestAllFilesAccess()
    return new Promise((resolve) => {
      const listener = App.addListener('appStateChange', (state) => {
        if (state.isActive) {
          listener.remove()
          if (window.NativeBridge?.hasAllFilesAccess()) resolve(true)
          else resolve(false)
        }
      })
    })
  },
  /**
   * Launches an external playback intent and shows a foreground service while playback is active, resolves when the app returns to the foreground.
   *
   * @param {string} url - The intent URL to launch externally.
   * @returns {Promise<void>} Resolves when the app returns and the service stops.
   */
  launchExternal: (url) => {
    ForegroundService.startForegroundService({
      id: STREAMING_FG_ID,
      title: 'External Playback',
      body: 'Delivering Content To Your External Player',
      smallIcon: 'ic_filled',
      notificationChannelId: 'external-playback',
      serviceType: ServiceType.MediaPlayback,
      silent: true
    })
    return new Promise((resolve) => {
      IntentUri.openUri({ url }).then(() => {
        ForegroundService.stopForegroundService()
        resolve()
      })
    })
  }
}

IPC.on('portRequest', async () => {
  window.port = {
    onmessage: cb => {
      NodeJS.addListener('ipc', ({ args }) => cb(args[0]))
    },
    postMessage: (data, b) => {
      NodeJS.send({ eventName: 'ipc', args: [{ data }] })
    }
  }
  await ready
  await cache.isReady
  NodeJS.send({ eventName: 'port-init', args: [] })
  let stethoscope = true
  NodeJS.addListener('webtorrent-heartbeat', () => {
    if (stethoscope) {
      stethoscope = false
      NodeJS.send({ eventName: 'main-heartbeat', args: [{ ...cache.getEntry(caches.GENERAL, 'settings'), userID: cache.cacheID }] })
      NodeJS.addListener('torrentRequest', () => {
        NodeJS.send({ eventName: 'torrentPort', args: [] })
        IPC.emit('port')
      })
    }
  })
})

IPC.on('webtorrent-reload', () => NodeJS.send({eventName: 'webtorrent-reload', args: []}))

IPC.once('version', async () => {
  const { version } = await App.getInfo()
  IPC.emit('version', version)
})

const autoUpdater = new Updater(IPC, 'https://github.com/RockinChaos/Shiru/releases/latest/download/latest-android.yml', 'https://api.github.com/repos/RockinChaos/Shiru/releases/latest')
IPC.on('update', () => autoUpdater.checkForUpdates())
IPC.on('quit-and-install', () => {
  if (autoUpdater.updateAvailable) autoUpdater.install(true)
})