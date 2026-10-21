import { createTorrentHost } from '@client/lib/ipc.js'
import { env, stdout, stderr } from 'node:process'
import { channel } from 'bridge'

/** @type {ReturnType<typeof createTorrentHost>|undefined|null} */
let host
/** @type {Promise<void>|undefined} */
let destroying

/**
 * Stops the current host, allowing up to five seconds for shutdown.
 * @returns {Promise<void>} Shared shutdown completion.
 */
function destroy() {
  if (destroying) return destroying
  const previous = host
  host = null
  destroying = Promise.race([
    previous?.destroy(),
    new Promise(resolve => setTimeout(resolve, 5_000).unref?.())
  ]).finally(() => { destroying = undefined })
  return destroying
}

/** Original stream writer retained while forwarding background logs.
 * @type {(buffer: string|Uint8Array, encoding?: BufferEncoding|((error?: Error|null) => void), callback?: (error?: Error|null) => void) => boolean}
 */
const originalStderrWrite = stderr.write.bind(stderr)
stderr.write = (data, ...args) => {
  originalStderrWrite(data, ...args)
  channel.send('torrent:log', { level: 'error', message: typeof data === 'string' ? data.trim() : data.toString().trim() })
}
/** Original stream writer retained while forwarding background logs.
 * @type {(buffer: string|Uint8Array, encoding?: BufferEncoding|((error?: Error|null) => void), callback?: (error?: Error|null) => void) => boolean}
 */
const originalStdoutWrite = stdout.write.bind(stdout)
stdout.write = (data, ...args) => {
  originalStdoutWrite(data, ...args)
  channel.send('torrent:log', { level: 'debug', message: typeof data === 'string' ? data.trim() : data.toString().trim() })
}

channel.on('torrent:init', async settings => {
  try {
    await destroy()
    channel.removeAllListeners('torrent:message')
    channel.removeAllListeners('torrent:connect')
    const port = {
      onmessage: _ => {},
      postMessage: data => channel.send('torrent:message', { data })
    }
    channel.on('torrent:message', a => port.onmessage?.(a))
    channel.once('torrent:connect', () => channel.emit('torrent:port', { ports: [port] }))
    host = createTorrentHost(channel, settings, env.TMPDIR)
  } catch (error) {
    channel.send('torrent:init-error', error.message)
  }
})
channel.on('torrent:reload', () => destroy().catch(console.error))
