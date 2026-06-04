import Debug from 'debug'
const debug = Debug('torrent:httpfile')

/**
 * A minimal WebTorrent-file-like wrapper backed by an HTTP(S) URL that supports
 * range requests (such as a TorBox CDN link).
 *
 * It deliberately implements the same async-iterator contract that
 * `matroska-metadata` expects from a non-`slice` file source:
 *
 *   file[Symbol.asyncIterator]({ start })  ->  AsyncIterator<Uint8Array>
 *
 * This is what powers "stream the container metadata over HTTP" so embedded
 * subtitles, fonts, tracks and chapters can be extracted without a local
 * BitTorrent engine.
 */
export default class HTTPFile {
  /** Marks this as an HTTP-backed source so consumers can skip torrent-only hooks. */
  httpStream = true

  /**
   * @param {string} url - Range-capable HTTP(S) URL to the file.
   * @param {object} [opts]
   * @param {string} [opts.name] - File name (used for extension based parsing decisions).
   * @param {number} [opts.size] - File size in bytes, when known.
   */
  constructor (url, { name, size } = {}) {
    this.url = url
    this.name = name || ''
    this.size = size || 0
    this.length = this.size
  }

  /**
   * Streams the file (optionally from a byte offset) as a sequence of Uint8Array chunks.
   * @param {{ start?: number, end?: number }} [range]
   * @returns {AsyncGenerator<Uint8Array>}
   */
  async * [Symbol.asyncIterator] ({ start = 0, end } = {}) {
    const headers = {}
    if (start || end != null) headers.Range = `bytes=${start || 0}-${end != null ? end : ''}`
    debug(`Streaming ${this.name} ${headers.Range || '(full)'}`)
    const res = await fetch(this.url, { headers })
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} while streaming ${this.name}`)
    if (!res.body) return
    for await (const chunk of res.body) {
      yield chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    }
  }

  /**
   * Downloads the entire file into memory. Used for small sidecar assets such as
   * external subtitle (.ass/.srt) and font files.
   * @returns {Promise<ArrayBuffer>}
   */
  async arrayBuffer () {
    const res = await fetch(this.url)
    if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${this.name}`)
    return res.arrayBuffer()
  }

  /* Inert EventEmitter-ish surface so code written for WebTorrent files is safe. */
  on () { return this }
  once () { return this }
  removeListener () { return this }
  removeAllListeners () { return this }
}
