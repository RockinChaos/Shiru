import { ipcRenderer } from 'electron'
import { statfs } from 'fs/promises'

async function storageQuota (directory) {
  const { bsize, bavail } = await statfs(directory)
  return bsize * bavail
}

let heartbeatId
function setHeartBeat() {
  heartbeatId = setInterval(() => ipcRenderer.send('webtorrent-heartbeat'), 500)
}

setHeartBeat()
ipcRenderer.on('main-heartbeat', async (event, settings) => {
  clearInterval(heartbeatId)
  const { default: TorrentClient } = await import('webtorrent-client')
  globalThis.client = new TorrentClient(ipcRenderer, storageQuota, 'node', settings)
})
ipcRenderer.on('webtorrent-reload', async () => {
  globalThis.client?.destroy()
  await new Promise(resolve => {
    ipcRenderer.once('destroyed', resolve)
    setTimeout(resolve, 5000).unref?.()
  })
  setHeartBeat()
})