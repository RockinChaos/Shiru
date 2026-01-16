import _Metadata from 'matroska-metadata'
import { arr2hex, hex2bin } from 'uint8-util'
import { fontRx } from '@/modules/util.js'
import { SUPPORTS } from '@/modules/support.js'
import Debug from 'debug'
const debug = Debug('torrent:parser')

/**
 * Parses Matroska/WebM container metadata and streams subtitles and attachments.
 * Automatically destroys itself if no valid tracks are found.
 */
export default class Metadata {
  /** @type {boolean} */
  parsed = false
  /** @type {_Metadata} */
  metadata = null
  /** @type {import('webtorrent-client').default|null} */
  client = null
  /** @type {any} */
  file = null
  /** @type {boolean} */
  destroyed = false

  /**
   * @param {import('webtorrent-client').default} client - Torrent client instance
   * @param {any} file - WebTorrent file instance
   */
  constructor (client, file) {
    debug('Initializing parser for file: ' + file?.name)
    this.client = client
    this.file = file
    this.metadata = new _Metadata(file)

    /**  Extract track information (video, audio, subtitle tracks) */
    this.metadata.getTracks().then(tracks => {
      if (this.destroyed) return
      debug('Tracks received: ' + tracks)
      if (!tracks.length) {
        this.parsed = true
        this.destroy()
      } else this.client.dispatch('tracks', tracks)
    })

    /**  Extract chapter markers for navigation */
    this.metadata.getChapters().then(chapters => {
      if (this.destroyed) return
      debug(`Found ${chapters?.length} chapters`)
      this.client.dispatch('chapters', chapters)
    })

    /** Extract embedded attachments (primarily fonts for styled subtitles) */
    this.metadata.getAttachments().then(files => {
      if (this.destroyed) return
      debug(`Found ${files?.length} attachments`)
      for (const file of files) {
        if (fontRx.test(file.filename) || file.mimetype?.toLowerCase().includes('font')) {
          const data = hex2bin(arr2hex(file.data))
          if (SUPPORTS.isAndroid && data.length > 15_000_000) {
            debug('Skipping large font file on Android: ' + file?.filename)
            continue
          }
          this.client.dispatch('file', data)
        }
      }
    })

    /** Listen for real-time subtitle events during playback */
    this.metadata.on('subtitle', (subtitle, trackNumber) => {
      if (this.destroyed) return
      debug(`Found subtitle for track: ${trackNumber}: ${subtitle.text}`)
      this.client.dispatch('subtitle', { subtitle, trackNumber })
    })

    if (this.file.name.endsWith('.mkv') || this.file.name.endsWith('.webm')) {
      this.file.on('iterator', ({ iterator }, cb) => {
        if (this.destroyed) return cb(iterator)
        cb(this.metadata.parseStream(iterator))
      })
    } else {
      debug('Unsupported file format: ' + this.file?.name)
    }
  }

  /**
   * Cleans up the parser and releases all resources.
   */
  destroy () {
    if (this.destroyed) {
      debug('Parser already destroyed')
      return
    }
    debug('Destroying Parser')
    this.metadata?.removeAllListeners()
    this.metadata?.destroy()
    this.destroyed = true
    this.metadata = null
    this.client = null
    this.file = null
  }
}