import { SecureLogger, enableWebviewListener } from 'cordova-plugin-secure-logger'
import { Device } from '@capacitor/device'
import { ipcWire } from './ipc.js'

const _console = { ...console }
const escape = String.fromCharCode(27)
const stripAnsi = str => str?.replace(new RegExp(`${escape}\\[[0-9;]*m`, 'g'), '')
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
    ipcWire.handle('common:resetLog', async () => ({ success: await SecureLogger.clearCache() }))
    ipcWire.handle('common:getDeviceInfo', async () => {
      const [info, battery] = await Promise.all([Device.getInfo(), Device.getBatteryInfo(), Device.getId()])
      return {
        info,
        battery,
        ram: navigator.deviceMemory ?? {}
      }
    })
  }

  async getLogContents() {
    const blob = await SecureLogger.getCacheBlob()
    return new TextDecoder().decode(blob)
  }
}
