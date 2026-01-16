import { channel } from 'bridge'
import { statfs } from 'fs/promises'
import { env } from 'node:process'

async function storageQuota (directory) {
  const { bsize, bavail } = await statfs(directory)
  return bsize * bavail
}

let client
let heartbeatId
function setHeartBeat() {
  heartbeatId = setInterval(() => channel.send('webtorrent-heartbeat'), 500)
}

channel.on('main-heartbeat', async settings => {
  clearInterval(heartbeatId)
  const { default: TorrentClient } = await import('webtorrent-client')
  client = new TorrentClient(channel, storageQuota, 'node', { userID: settings.userID, dht: !settings.torrentDHT, torrentUTP: !settings.torrentUTP, torrentPeX: !settings.torrentPeX, maxConns: settings.maxConns, downloadLimit: (settings.torrentSpeed * 1048576) || 0, uploadLimit: (settings.torrentSpeed * 1048576) || 0, torrentPort: settings.torrentPort || 0, dhtPort: settings.dhtPort || 0, torrentPersist: settings.torrentPersist, torrentStreamedDownload: settings.torrentStreamedDownload, torrentPathNew: (settings.torrentPathNew || env.TMPDIR), TMPDIR: env.TMPDIR, playerPath: settings.playerPath, seedingLimit: settings.seedingLimit })
})

channel.on('port-init', () => {
  const port = {
    onmessage: _ => {},
    postMessage: data => {
      channel.send('ipc', { data })
    }
  }
  channel.on('ipc', a => port.onmessage(a))
  if (!client) {
    setHeartBeat()
    channel.on('torrentPort', () => {
      channel.emit('port', {
        ports: [port]
      })
    })
  }
  channel.on('webtorrent-reload', async () => {
    if (client) {
      client.destroy()
      await new Promise(resolve => {
        channel.once('destroyed', resolve)
        setTimeout(resolve, 5000).unref?.()
      })
      setHeartBeat()
    }
  })
})