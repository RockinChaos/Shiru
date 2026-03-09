import { SecureLogger, enableWebviewListener } from 'cordova-plugin-secure-logger'
import { IPC } from '../preload/preload.js'
import { Device } from '@capacitor/device'

const _console = { ...console }
const stripAnsi = str => str?.replace(/\x1b\[[0-9;]*m/g, '')
const wrap = level => (...args) => {
  SecureLogger[level](level, stripAnsi(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')))
  _console[level === 'info' ? 'log' : level](...args)
}
console.log = wrap('info')
console.debug = wrap('debug')
console.warn = wrap('warn')
console.error = wrap('error')

enableWebviewListener()
SecureLogger.setEventCacheFlushInterval(1_000)
SecureLogger.configure({
  minLevel: 2,
  maxFileSizeBytes: 4_000_000, // 4MB
  maxTotalCacheSizeBytes: 10_000_000, // 10MB
  maxFileCount: 10
}).catch(error => console.error('SecureLogger configure failed', JSON.stringify(error)))

export default class Debug {
  constructor () {
    IPC.on('get-log-contents', async () => {
      try {
        const blob = await SecureLogger.getCacheBlob()
        IPC.emit('log-contents', new TextDecoder().decode(blob))
      } catch (error) {
        console.debug('Failed to fetch logs', error)
        IPC.emit('log-contents', `Failed to fetch logs... ${JSON.stringify(error)}`)
      }
    })
    IPC.on('reset-log-contents', async () => { IPC.emit('log-reset', { success: await SecureLogger.clearCache() }) })
    IPC.on('get-device-info', async () => {
      const deviceInfo = {
        features: {},
        info: await Device.getInfo(),
        cpu: {},
        ram: {}
      }
      IPC.emit('device-info', JSON.stringify(deviceInfo))
    })
  }
}