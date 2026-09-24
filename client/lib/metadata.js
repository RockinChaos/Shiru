import _Metadata from '@rockinchaos/matroska-metadata'
import { fontRx } from '@/modules/util.js'
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
  /** @type {(event: {iterator: AsyncIterable<Uint8Array>}, cb: (iterator: AsyncIterable<Uint8Array>) => void) => void} */
  handleIterator = ({ iterator }, cb) => cb(this.destroyed ? iterator : this.metadata.parseStream(iterator))

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
    }).catch(error => console.warn('Failed to read tracks', error))

    /**  Extract chapter markers for navigation */
    this.metadata.getChapters().then(chapters => {
      if (this.destroyed) return
      debug(`Found ${chapters?.length} chapters`)
      this.client.dispatch('chapters', chapters)
    }).catch(error => console.warn('Failed to read chapters', error))

    /** Extract embedded attachments (primarily fonts for styled subtitles) */
    this.metadata.getAttachments().then(files => {
      if (this.destroyed) return
      debug(`Found ${files?.length} attachments`)
      for (const file of files) {
        if (fontRx.test(file.filename) || file.mimetype?.toLowerCase().includes('font')) {
          this.client.createAttachmentURL(file.data, this)
            .then(url => this.client?.dispatch('file', { url }))
            .catch(error => {
              if (this.destroyed) return
              debug('Failed to expose embedded font:', error)
            })
        }
      }
    }).catch(error => console.warn('Failed to read attachments', error))

    /** Listen for real-time subtitle events during playback */
    this.metadata.on('subtitle', (subtitle, trackNumber) => {
      if (this.destroyed) return
      debug(`Found subtitle for track: ${trackNumber}: ${subtitle.text}`)
      this.client.dispatch('subtitle', { subtitle, trackNumber })
    })

    this.metadata.on('warning', error => {
      if (this.destroyed) return
      console.warn('Subtitle parsing warning:', error)
    })

    if (this.file.name.endsWith('.mkv') || this.file.name.endsWith('.webm')) {
      this.file.on('iterator', this.handleIterator)
    } else {
      console.warn('Unsupported file format: ' + this.file?.name)
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
    this.destroyed = true
    this.file?.off('iterator', this.handleIterator)
    this.client?.clearAttachments(this)
    this.metadata?.removeAllListeners()
    this.metadata?.destroy()
    this.metadata = null
    this.client = null
    this.file = null
  }
}