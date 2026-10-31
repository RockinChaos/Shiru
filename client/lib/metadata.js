import _Metadata from '@rockinchaos/matroska-metadata'
import { subRx, fontRx, videoRx } from '@/modules/util.js'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import Debug from 'debug'
const debug = Debug('torrent:parser')

/**
 * Parses Matroska/WebM container metadata and streams subtitles and attachments.
 * Stops stream parsing when no subtitle tracks are found; chapters and files remain available.
 */
export default class Metadata {
  /** @type {boolean} */
  parsed = false
  /** @type {((data: {subtitle: any, trackNumber: number}) => void)|null} */
  subtitleCallback = null
  /** @type {{subtitle: any, trackNumber: number}[]|null} */
  pendingSubtitles = []
  /** @type {_Metadata} */
  metadata = null
  /** @type {import('webtorrent-client').default|null} */
  client = null
  /** @type {any} */
  file = null
  /** @type {any} */
  files = null
  /** @type {Map<string, Uint8Array>} */
  attachments = new Map()
  /** @type {ReturnType<typeof createServer>|null} */
  attachmentServer = null
  /** @type {Promise<void>|null} */
  attachmentServerReady = null
  /** @type {boolean} */
  destroyed = false
  /** @type {(event: {iterator: AsyncIterable<Uint8Array>}, cb: (iterator: AsyncIterable<Uint8Array>) => void) => void} */
  handleIterator = ({ iterator }, cb) => cb(this.destroyed ? iterator : this.metadata.parseStream(iterator))

  /**
   * @param {any} file The current file being processed.
   * @param {any} files All files in the torrent.
   */
  constructor (file, files) {
    debug('Initializing parser for file: ' + file?.name)
    this.file = file
    this.files = files
    this.metadata = new _Metadata(file)

    /** Listen for real-time subtitle events during playback */
    this.metadata.on('subtitle', (subtitle, trackNumber) => {
      if (this.destroyed) return
      debug(`Found subtitle for track: ${trackNumber}: ${subtitle.text}`)
      const data = { subtitle, trackNumber }
      if (this.subtitleCallback) this.subtitleCallback(data)
      else this.pendingSubtitles?.push(data)
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
   * Extract track information (video, audio, subtitle tracks)
   * @returns {Promise<any[]|null>} Tracks, or null when metadata is unavailable or destroyed.
   */
  async getTracks() {
    if (this.destroyed || !this.metadata) return null
    const tracks = await this.metadata.getTracks()
    if (this.destroyed || !this.metadata) return null
    debug('Tracks received: ' + tracks)
    if (!tracks.length) {
      this.parsed = true
      this.file?.off('iterator', this.handleIterator)
      this.offSubtitles()
    }
    return tracks
  }

  /**
   * Extract chapter markers for navigation
   * @returns {Promise<any[]|null>} Chapter markers, or null when metadata is unavailable or destroyed.
   */
  async getChapters() {
    if (this.destroyed || !this.metadata) return null
    const chapters = await this.metadata.getChapters()
    if (this.destroyed || !this.metadata) return null
    debug(`Found ${chapters?.length} chapters`)
    return chapters
  }

  /**
   * Registers streamed subtitle, font, and file callbacks and drains buffered packets.
   * @param {(data: {subtitle: any, trackNumber: number}) => void} onSubtitle Receives each subtitle packet.
   * @param {(font: {url: string}) => void} onFont Receives font URLs.
   * @param {(file: {name: string, url: string}) => void} onSubtitleFile Receives subtitle descriptors.
   * @returns {null|void}
   */
  onSubtitles(onSubtitle, onFont, onSubtitleFile) {
    if (this.destroyed || !this.metadata) return null
    this.subtitleCallback = onSubtitle
    for (const data of this.pendingSubtitles || []) onSubtitle(data)
    this.pendingSubtitles = null
    /** Extract embedded attachments (primarily fonts for styled subtitles) */
    this.metadata.getAttachments().then(files => {
      if (this.destroyed) return
      debug(`Found ${files?.length} attachments`)
      for (const file of files) {
        if (fontRx.test(file.filename) || file.mimetype?.toLowerCase().includes('font')) {
          this.#createAttachmentURL(file.data)
            .then(url => !this.destroyed && onFont({ url }))
            .catch(error => {
              if (this.destroyed) return
              debug('Failed to expose embedded font:', error)
            })
        }
      }
    }).catch(error => console.warn('Failed to read attachments', error))

    // find subtitle files
    if (!this.files) return
    const videoFiles = this.files.filter(file => videoRx.test(file.name))
    const videoName = this.file.name.substring(0, this.file.name.lastIndexOf('.')) || this.file.name
    // array of subtitle files that match video name, or all subtitle files when only 1 vid file
    const subfiles = this.files.filter(file => subRx.test(file.name) && (videoFiles.length === 1 ? true : file.name.includes(videoName)))
    debug(`Found ${subfiles?.length} subtitle files`)
    for (const file of subfiles) {
      file.arrayBuffer().then(async data => {
        if (this.destroyed) return
        const url = await this.#createAttachmentURL(new Uint8Array(data))
        if (!this.destroyed) onSubtitleFile({name: file.name, url})
      }).catch(error => {
        if (!this.destroyed) debug('Failed to expose subtitle file:', error)
      })
    }

    // find font files
    if (!this.files) return
    const fontFiles = this.files.filter(file => fontRx.test(file.name))
    const map = {}

    // deduplicate fonts
    // some releases have duplicate fonts for diff languages
    // if they have different chars, we can't find that out anyways
    // so some chars might fail, on REALLY bad releases
    for (const file of fontFiles) map[file.name] = file
    debug(`Found ${Object.keys(map).length} font files`)

    for (const file of Object.values(map)) {
      file.arrayBuffer().then(async data => {
        if (this.destroyed) return
        const url = await this.#createAttachmentURL(new Uint8Array(data))
        if (!this.destroyed) onFont({url})
      }).catch(error => {
        if (!this.destroyed) debug('Failed to expose font file:', error)
      })
    }
  }

  /**
   * Starts a loopback server for transferring attachments to the renderer
   * @private
   * @returns {void}
   */
  #createAttachmentServer() {
    this.attachmentServer = createServer((req, res) => {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname
      const id = pathname.startsWith('/attachment/') ? pathname.slice('/attachment/'.length) : ''
      const attachment = this.attachments.get(id)

      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
      res.setHeader('Cache-Control', 'no-store')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      if (req.method !== 'GET' || !attachment) {
        res.writeHead(404)
        res.end()
        return
      }

      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Length', attachment.byteLength)
      res.once('finish', () => this.attachments.delete(id))
      res.end(attachment)
    })
    this.attachmentServerReady = new Promise((resolve, reject) => {
      this.attachmentServer.once('error', reject)
      this.attachmentServer.listen(0, '127.0.0.1', () => {
        this.attachmentServer.removeListener('error', reject)
        this.attachmentServer.on('error', error => console.warn('Attachment server error:', error))
        if (this.destroyed) this.attachmentServer.close()
        resolve()
      })
    })
  }

  /**
   * Makes an attachment available to the renderer through a short-lived loopback URL.
   * @private
   * @param {Uint8Array} data Attachment bytes.
   * @returns {Promise<string>} URL that can be fetched once by the renderer.
   */
  async #createAttachmentURL(data) {
    if (this.destroyed) throw new Error('Metadata was destroyed')
    if (!this.attachmentServerReady) this.#createAttachmentServer()
    await this.attachmentServerReady
    if (this.destroyed) throw new Error('Metadata was destroyed')
    const id = randomUUID()
    this.attachments.set(id, data)
    return `http://127.0.0.1:${this.attachmentServer.address().port}/attachment/${id}`
  }

  /**
   * Stops subtitle delivery and discards buffered packets.
   * @returns {void}
   */
  offSubtitles() {
    this.subtitleCallback = null
    this.pendingSubtitles = null
  }

  /**
   * Cleans up the parser and releases all resources.
   * @returns {void}
   */
  destroy () {
    if (this.destroyed) {
      debug('Parser already destroyed')
      return
    }
    debug('Destroying Parser')
    this.destroyed = true
    this.offSubtitles()
    this.file?.off('iterator', this.handleIterator)
    this.attachments.clear()
    if (this.attachmentServer?.listening) this.attachmentServer.close()
    this.metadata?.removeAllListeners()
    this.metadata?.destroy()
    this.metadata = null
    this.file = null
  }
}