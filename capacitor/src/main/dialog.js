import { FolderPicker } from 'capacitor-folder-picker'
import { IPC } from '../preload/preload.js'
import { toast } from 'svelte-sonner'

export default class Dialog {
  STORAGE_TYPE_MAP = { primary: '/sdcard/', secondary: '/sdcard/'}

  constructor() {
    IPC.on('dialog', async () => {
      const result = await FolderPicker.chooseFolder()
      const normalizedPath = decodeURIComponent(result.path)
      const [, uri, ...path] = normalizedPath.split(':')
      const [, , app, subpath, type, ...rest] = uri.split('/')

      if (app !== 'com.android.externalstorage.documents') return toast.error('Unverified app', { description: `Expected com.android.externalstorage.documents but got: ${app}\n\nThis location was selected using a cloud or virtual file browser. Please switch to “This device” or “Files” and choose a local folder.'` })
      if (rest.length) return toast.error('Unsupported uri', { description: 'Unexpected access type, got: tree/' + rest.join('/') })
      if (subpath !== 'tree') return toast.error('Unsupported subpath type', { description: 'Expected tree subpath, got: ' + subpath })

      let base = this.STORAGE_TYPE_MAP[type]
      if (!base) {
        if (!/[a-z0-9]{4}-[a-z0-9]{4}/i.test(type)) return toast.error('Unsupported storage type')
        base = `/storage/${type}/`
      }
      IPC.emit('path', base + path.join(''))
    })
    IPC.on('log-contents', async (log) => {
      try {
        await window.cordova.plugins.saveDialog.saveFile(new Blob([log], { type: 'application/octet-stream' }), `shiru-log-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
        IPC.emit('log-exported', { error: false })
      } catch (error) {
        console.debug('Failed to export logs', error)
        IPC.emit('log-exported', { error: true })
      }
    })
  }
}