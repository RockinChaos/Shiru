import { App } from '@capacitor/app'
import { NodeJS } from 'capacitor-nodejs'
import { cache, caches } from '@/modules/cache.js'
import EventEmitter from 'events'

const ready = NodeJS.whenReady()

const main = new EventEmitter()

export default main

main.on('portRequest', async () => {
  globalThis.port = {
    onmessage: cb => {
      NodeJS.addListener('ipc', ({ args }) => cb(args[0]))
    },
    postMessage: (data, b) => {
      NodeJS.send({ eventName: 'ipc', args: [{ data }] })
    }
  }
  await ready
  await cache.isReady
  NodeJS.send({ eventName: 'port-init', args: [cache.getEntry(caches.GENERAL, 'settings')] })
  let stethoscope = true
  NodeJS.addListener('webtorrent-heartbeat', () => {
    if (stethoscope) {
      stethoscope = false
      NodeJS.send({eventName: 'main-heartbeat', args: []})
      main.emit('port')
    }
  })
})

const [_platform, arch] = navigator.platform.split(' ')

globalThis.version = {
  platform: globalThis.cordova?.platformId,
  arch
}

main.once('version', async () => {
  const { version } = await App.getInfo()
  main.emit('version', version)
})
