import { createCallbackBridge } from '@client/lib/remote.js'
import { errorToString } from '@client/lib/util.js'
import TorrentClient from 'webtorrent-client'
import Debug from 'debug'
const debug = Debug('torrent:ipc')

/**
 * Owns the message channel and process lifecycle around a transport-independent client.
 * @param {any} ipc
 * @param {...any} args Arguments forwarded to the client constructor.
 * @returns {{client: TorrentClient, destroy: () => Promise<void>}}
 */
export function createTorrentHost(ipc, ...args) {
  /** @type {any} */
  let port = null
  /** @type {Promise<void>|null} */
  let destroying = null
  /** @type {ReturnType<typeof createCallbackBridge>} */
  const callbacks = createCallbackBridge(message => {
    if (!port || destroying) throw new Error('Torrent connection closed')
    port.postMessage(message)
  }, error => debug('Torrent callback failed:', error))
  /** @type {TorrentClient} */
  const client = new TorrentClient(...args)
  /** Forwards an uncaught process error to the client notification handler.
   * @param {Error} error
   * @returns {void}
   */
  const handleError = error => client.handleError(error)

  /**
   * Handles incoming IPC messages and dispatches torrent operations.
   * @param {{data: any}} opts
   * @param {(message: any) => void} reply
   * @returns {Promise<void>} Resolves after handling or replying to the message.
   */
  async function handleMessage({ data }, reply) {
    if (data?.type !== 'request') {
      if (data) callbacks.receive(data)
      return
    }
    debug('Received IPC call:', data.method)
    try {
      if (destroying || client.client.destroyed) throw new Error('Torrent client was destroyed')
      const path = typeof data.method === 'string' ? data.method.split('.') : []
      if (!path.length || path.some(key => ['constructor', 'prototype', '__proto__', 'destroy'].includes(key))) throw new Error('Unknown torrent method: ' + data.method)
      let owner = client
      for (const key of path.slice(0, -1)) {
        const property = Object.getOwnPropertyDescriptor(owner, key)
        if (!property) throw new Error('Torrent object is unavailable: ' + data.method)
        owner = property.value
        if (owner == null) {
          reply({ type: 'response', id: data.id, data: null })
          return
        }
        if (typeof owner !== 'object') throw new Error('Torrent object is unavailable: ' + data.method)
      }
      const prototype = Object.getPrototypeOf(owner)
      const method = prototype !== Object.prototype && Object.getOwnPropertyDescriptor(prototype, path.at(-1))?.value
      if (typeof method !== 'function') throw new Error('Unknown torrent method: ' + data.method)
      const result = await method.apply(owner, callbacks.decode(data.args))
      reply({ type: 'response', id: data.id, data: result })
    } catch (error) {
      reply({ type: 'response', id: data.id, error: errorToString(error) })
    }
  }

  /**
   * Replaces the renderer message port and clears callbacks owned by the old connection.
   * @param {{ports: any[]}} event
   * @returns {void}
   */
  function connect({ ports }) {
    if (destroying || client.client.destroyed) return
    if (port) {
      callbacks.clear()
      port.onmessage = null
      port.close?.()
    }
    port = ports[0]
    const reply = port.postMessage.bind(port)
    port.onmessage = event => handleMessage(event, reply).catch(error => debug('IPC reply failed:', error))
  }

  /**
   * Closes the client and port, then acknowledges process shutdown.
   * @returns {Promise<void>} Shared promise for the in-progress or completed shutdown.
   */
  function destroy() {
    if (destroying) return destroying
    ipc.removeListener('torrent:port', connect)
    ipc.removeListener('torrent:destroy', onDestroy)
    process.removeListener('uncaughtException', handleError)
    callbacks.clear()
    destroying = Promise.resolve().then(() => client.destroy()).catch(error => {
      console.error('Torrent shutdown failed:', error)
    }).finally(() => {
      if (port) {
        port.onmessage = null
        port.close?.()
        port = null
      }
      ipc.send('torrent:destroyed')
      ipc.emit('torrent:destroyed')
    })
    return destroying
  }

  /** Handles shutdown events and reports unexpected teardown failures.
   * @returns {Promise<void>}
   */
  const onDestroy = () => destroy().catch(error => debug('Torrent shutdown failed:', error))
  ipc.on('torrent:port', connect)
  ipc.on('torrent:destroy', onDestroy)
  process.on('uncaughtException', handleError)
  return { client, destroy }
}
