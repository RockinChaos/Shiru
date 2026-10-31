import { createTorrentHost } from '@client/lib/ipc.js'
import { ipcRenderer } from 'electron'

/** @type {ReturnType<typeof createTorrentHost>|undefined|null} */
let host
/** @type {Promise<void>|undefined} */
let destroying
/** @type {string|null} */
let initialization = null

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

ipcRenderer.on('torrent:init', async (event, { settings, requestId }) => {
  initialization = requestId
  try {
    await destroy()
    if (requestId !== initialization) throw new Error('Torrent initialization superseded')
    host = createTorrentHost(ipcRenderer, settings)
    ipcRenderer.send('torrent:ready', requestId)
  } catch (error) {
    ipcRenderer.send('torrent:init-error', requestId, error.message)
  }
})
ipcRenderer.on('torrent:reload', () => {
  initialization = null
  destroy().catch(console.error)
})
