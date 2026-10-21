import { createTorrentHost } from '@client/lib/ipc.js'
import { ipcRenderer } from 'electron'

/** @type {ReturnType<typeof createTorrentHost>|undefined|null} */
let host
/** @type {Promise<void>|undefined} */
let destroying

/**
 * Stops the current host before another initialization, allowing five seconds for shutdown.
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

ipcRenderer.on('torrent:init', async (event, settings) => {
  try {
    await destroy()
    host = createTorrentHost(ipcRenderer, settings)
  } catch (error) {
    ipcRenderer.send('torrent:init-error', error.message)
  }
})
ipcRenderer.on('torrent:reload', () => destroy().catch(console.error))
