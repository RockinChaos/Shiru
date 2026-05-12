import P2PT from 'p2pt'

import Event, { EventTypes } from '@/routes/w2g/components/events.js'
import Helper from '@/modules/providers/helper.js'
import { add } from '@/modules/torrent.js'
import { generateRandomHexCode } from '@/modules/util.js'
import { writable } from 'simple-store-svelte'
import Debug from 'debug'
const debug = Debug('ui:w2g')

const version = 1

/**
 * @typedef {Record<string, {user: import('@/modules/providers/anilist/al.d.ts').Viewer | {id: string }, peer?: import('p2pt').Peer<any>}>} PeerList
 */

export class W2GClient extends EventTarget {

  #listeners = []

  addEventListener(type, listener, options) {
    this.#listeners.push({ type, listener, options })
    super.addEventListener(type, listener, options)
  }

  removeAllListeners() {
    for (const { type, listener, options } of this.#listeners) {
      super.removeEventListener(type, listener, options)
    }
    this.#listeners = []
  }

  static #announce = [
    atob('d3NzOi8vdHJhY2tlci53ZWJ0b3JyZW50LmRldg=='),
    atob('d3NzOi8vdHJhY2tlci5vcGVud2VidG9ycmVudC5jb20='),
    atob('d3NzOi8vdHJhY2tlci5idG9ycmVudC54eXov'),
    atob('d3NzOi8vdHJhY2tlci5maWxlcy5mbTo3MDczL2Fubm91bmNl')
  ]

  player = {
    paused: true,
    time: 0
  }

  index = 0
  /** @type {{magnet: string, hash: string} | null} */
  magnet = null
  isHost = false
  hostId = null
  #p2pt
  #announceInterval
  code
  /** @type {import('simple-store-svelte').Writable<{message: string, user: import('@/modules/providers/anilist/al.d.ts').Viewer | {id: string }, type: 'incoming' | 'outgoing', date: Date}[]>} */
  messages = writable([])

  self = Helper.getUser() || { id: generateRandomHexCode(16) }
  /** @type {import('simple-store-svelte').Writable<PeerList>} */
  peers = writable({ [this.self.id]: { user: this.self } })

  get inviteLink () {
    return `shiru://w2g/${this.code}`
  }

  /**
   * Should be called when media index changed locally
   * @param {number} index
   */
  localMediaIndexChanged (index) {
    this.index = index

    this.mediaIndexChanged(index)
  }

  /**
   * Should be called when player state changed locally
   * @param {import('@/routes/w2g/components/events.js').default} state
   */
  localPlayerStateChanged ({ payload }) {
    debug(`localPlayerStateChanged: ${JSON.stringify(payload)}`)
    this.player.paused = payload.paused
    this.player.time = payload.time

    this.playerStateChanged(this.player)
  }

  /**
   * @param {string} code lobby code
   */
  constructor (code) {
    super()
    this.isHost = !code

    this.hostId = !code ? this.self.id : null

    this.code = code ?? generateRandomHexCode(16)

    debug(`W2GClient: ${this.code}, ${this.isHost}`)

    this.#p2pt = new P2PT(W2GClient.#announce, this.code)

    this.#wireEvents()
    this.#p2pt.start().catch(err => debug('p2pt start failed: %o', err))

    // Re-announce to trackers periodically to discover peers that joined later
    this.#announceInterval = setInterval(() => {
      this.#p2pt?.requestMorePeers()
    }, 15_000)
  }

  magnetLink (magnet) {
    debug(`magnetLink: ${this.magnet?.hash} ${magnet.hash}`)
    this.magnet = magnet
    this.isHost = true
    this.hostId = this.self.id
    this.#sendToPeers(new Event('magnet', magnet))
  }

  /** @param {number} index */
  mediaIndexChanged (index) {
    debug(`mediaIndexChanged: ${this.index} ${index}`)
    if (this.index !== index) {
      this.index = index
      this.#sendToPeers(new Event('index', index))
    }
  }

  _playerStateChanged (state) {
    debug(`_playerStateChanged: ${this.player?.paused} ${state?.paused} ${this.player?.time} ${state?.time}`)
    if (!state) return false
    if (this.player.paused !== state.paused || this.player.time !== state.time) {
      this.player = state
      return true
    }
  }

  playerStateChanged (state) {
    debug(`playerStateChanged: ${JSON.stringify(state)}`)
    if (this._playerStateChanged(state)) this.#sendToPeers(new Event('player', state))
  }

  message (message) {
    debug(`message: ${message}`)
    this.messages.update(messages => [...messages, ({
      message,
      user: this.self,
      type: 'outgoing',
      date: new Date()
    })])
    this.#sendToPeers(new Event('message', message))
  }

  #wireEvents () {
    this.#p2pt.on('peerconnect', this.#onPeerconnect.bind(this))
    this.#p2pt.on('msg', this.#onMsg.bind(this))
    this.#p2pt.on('peerclose', this.#onPeerclose.bind(this))
    this.#p2pt.on('trackerwarning', (err) => {
      debug('tracker warning: %o', err)
    })
    this.#p2pt.on('trackerconnect', (tracker, stats) => {
      debug('tracker connected: %s (%d/%d)', tracker.announceUrl, stats.connected, stats.total)
    })
  }

  /**
   * @param {import('p2pt').Peer} peer
   * @param {import('./events.js').default} event
   */
  #sendEvent (peer, event) {
    debug(`#sendEvent: ${peer.id} ${JSON.stringify(event)}`)
    this.#p2pt?.send(peer, JSON.stringify(event))
  }

  /**
   * Should be called only on 'peerconnect'
   * @param {import('p2pt').Peer} peer
   */
  #sendInitialSessionState (peer) {
    this.#sendEvent(peer, new Event('magnet', this.magnet))
    this.#sendEvent(peer, new Event('index', this.index))
    this.#sendEvent(peer, new Event('player', this.player))
  }

  async #onPeerconnect (peer) {
    debug(`#onPeerconnect: ${peer.id}`)
    this.#sendEvent(peer, new Event('init', { ...this.self, isHost: this.isHost, version: version }))
  }

  /**
   * @param {import('p2pt').Peer} peer
   * @param {Event} data
   */
  #onMsg (peer, data) {
    debug(`#onMsg: ${peer.id} ${JSON.stringify(data)}`)
    data = typeof data === 'string' ? JSON.parse(data) : data

    switch (data.type) {
      case EventTypes.SessionInitEvent: {
        const { version: peerVersion, isHost, ...user } = data.payload
        if (peerVersion !== version) {
          if (this.isHost) {
            this.#p2pt.send(peer, JSON.stringify(new Event('reject', {
              reason: peerVersion > version ? 'outdated_host' : 'outdated_peer',
              peerVersion,
              hostVersion: version
            }))).then(() => peer.destroy())
          }
          break
        }
        this.peers.update(peers => {
          peers[peer.id] = { peer, user }
          return peers
        })
        if (isHost) this.hostId = peer.id
        if (this.isHost) this.#sendInitialSessionState(peer)
        break
      }
      case EventTypes.SessionRejectEvent: {
        this.dispatchEvent(new CustomEvent('reject', {
          detail: {
            peerId: peer.id,
            peerVersion: data.payload.peerVersion,
            hostVersion: data.payload.hostVersion,
            isNewer: data.payload.reason === 'outdated_host'
          }
        }))
        this.destroy()
        break
      }
      case EventTypes.MagnetLinkEvent: {
        if (data.payload?.magnet == null) break
        if (this.hostId && peer.id !== this.hostId) break // Ignore if not from host. TODO: Make this optional.
        const { hash, magnet } = data.payload
        if (hash !== this.magnet?.hash) {
          this.isHost = false
          this.magnet = data.payload
          add(magnet)
        }

        break
      }
      case EventTypes.MediaIndexEvent: {
        if (data.payload == null) break
        if (this.index !== data.payload) {
          this.index = data.payload
          this.dispatchEvent(new CustomEvent('index', { detail: data.payload }))
        }
        break
      }
      case EventTypes.PlayerStateEvent: {
        if (data.payload?.time == null) break
        if (this._playerStateChanged(data.payload)) this.dispatchEvent(new CustomEvent('player', { detail: data.payload }))
        break
      }
      case EventTypes.MessageEvent:{
        const peerEntry = this.peers.value[peer.id]
        if (!peerEntry) break
        this.messages.update(messages => [...messages, ({ message: data.payload, user: peerEntry.user, type: 'incoming', date: new Date() })])
        break
      }
      default:
        debug('Invalid message type', data)
    }
  }

  #onPeerclose (peer) {
    debug(`#onPeerclose: ${peer.id}`)
    this.peers.update(peers => {
      delete peers[peer.id]
      return peers
    })
  }

  /** @param {import('./events.js').default} event */
  #sendToPeers (event) {
    if (!this.#p2pt) return
    for (const { peer } of Object.values(this.peers.value)) {
      if (peer) this.#sendEvent(peer, event)
    }
  }

  destroy () {
    debug('destroy')
    clearInterval(this.#announceInterval)
    this.#p2pt?.destroy()
    this.removeAllListeners()
    this.#p2pt = null
    this.magnet = null
    this.hostId = null
    this.isHost = false
    this.peers.value = {}
  }
}
