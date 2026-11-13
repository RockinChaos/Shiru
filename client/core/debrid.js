import { EventEmitter } from 'node:events'
import { extname } from 'node:path'

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.ass': 'text/plain; charset=utf-8',
  '.ssa': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const DEFAULT_TIMEOUT_MS = 25_000
const URL_REQUEST_TIMEOUT_MS = 20_000
const STREAM_CHUNK_TIMEOUT_MS = 30_000

/**
 * Infers a sensible Content-Type for video/subtitle/font files when upstream omits one.
 *
 * @param {string} filename
 * @param {string | null} upstreamType
 * @returns {string}
 */
function resolveContentType(filename, upstreamType) {
  const ext = extname(filename || '').toLowerCase()
  if (upstreamType && upstreamType !== 'application/octet-stream') return upstreamType
  return MIME_TYPES[ext] || upstreamType || 'application/octet-stream'
}

/**
 * Executes an HTTP request inside the CORS-free Node runtime on behalf of the renderer.
 *
 * @param {{
 *   url: string,
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string | { __formData: Array<{ name: string, value: string | Uint8Array, filename?: string, contentType?: string }> },
 *   responseType?: 'json' | 'text' | 'arrayBuffer',
 *   timeout?: number
 * }} options
 */
export async function executeDebridRequest(options) {
  const { url, method = 'GET', headers = {}, body, responseType = 'json', timeout = DEFAULT_TIMEOUT_MS } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const cleanHeaders = { ...headers }
    /** @type {any} */
    let requestBody = body
    if (body && typeof body === 'object' && Array.isArray(body.__formData)) {
      const form = new FormData()
      for (const entry of body.__formData) {
        if (entry.encoding === 'base64' && typeof entry.value === 'string') {
          const buf = Buffer.from(entry.value, 'base64')
          form.append(entry.name, new Blob([buf], { type: entry.contentType || 'application/octet-stream' }), entry.filename || 'file.torrent')
        } else if (entry.value instanceof Uint8Array || ArrayBuffer.isView(entry.value)) {
          const view = entry.value instanceof Uint8Array ? entry.value : new Uint8Array(entry.value.buffer, entry.value.byteOffset, entry.value.byteLength)
          const copy = new Uint8Array(view.byteLength)
          copy.set(view)
          form.append(entry.name, new Blob([copy], { type: entry.contentType || 'application/octet-stream' }), entry.filename || 'file.torrent')
        } else {
          form.append(entry.name, String(entry.value ?? ''))
        }
      }
      requestBody = form
      delete cleanHeaders['Content-Type']
      delete cleanHeaders['content-type']
    }

    const res = await fetch(url, {
      method,
      headers: cleanHeaders,
      body: requestBody,
      signal: controller.signal
    })

    let data
    if (responseType === 'arrayBuffer') {
      data = new Uint8Array(await res.arrayBuffer())
    } else if (responseType === 'text') {
      data = await res.text()
    } else {
      const text = await res.text()
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = text
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      data
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Virtual Matroska/HTTP file adapter implementing `[Symbol.asyncIterator]` and `arrayBuffer()`
 * so `@rockinchaos/matroska-metadata` and Shiru's subtitle/chapter extractors work identically
 * on Debrid HTTP streams as they do on WebTorrent files.
 */
export class DebridFile {
  /** @type {Set<AbortController>} */
  #activeControllers = new Set()

  /**
   * @param {{
   *   id: string | number,
   *   name: string,
   *   path: string,
   *   length: number,
   *   infoHash: string,
   *   providerId: string,
   *   providerName: string,
   *   torrentId: string | number,
   *   torrentName: string,
   *   remoteUrl?: string | null,
   *   headers?: Record<string, string>,
   *   resolveUrl: (forceRefresh?: boolean) => Promise<{ url: string, headers?: Record<string, string> }>
   * }} opts
   */
  constructor(opts) {
    this.id = opts.id
    this.name = opts.name
    this.path = opts.path
    this.length = Number(opts.length) || 0
    this.size = this.length
    this.infoHash = opts.infoHash
    this.providerId = opts.providerId
    this.providerName = opts.providerName
    this.torrentId = opts.torrentId
    this.torrentName = opts.torrentName
    this.remoteUrl = opts.remoteUrl || null
    this.headers = opts.headers || {}
    this.resolveUrl = opts.resolveUrl
    this.destroyed = false
  }

  /**
   * Ensures a fresh direct remote URL is available.
   *
   * @param {boolean} [forceRefresh=false]
   * @returns {Promise<{ url: string, headers: Record<string, string> }>}
   */
  async ensureRemoteUrl(forceRefresh = false) {
    if (this.destroyed) throw new Error('Debrid file has been destroyed')
    if (this.remoteUrl && !forceRefresh) {
      return { url: this.remoteUrl, headers: this.headers }
    }
    const resolved = await this.resolveUrl(forceRefresh)
    this.remoteUrl = resolved.url
    this.headers = resolved.headers || this.headers || {}
    return { url: this.remoteUrl, headers: this.headers }
  }

  /**
   * Opens an upstream HTTP fetch for the requested byte offset, refreshing once on 401/403/410.
   *
   * @param {number} start
   * @param {AbortSignal} signal
   * @returns {Promise<Response>}
   */
  async #fetchRange(start, signal) {
    let forceRefresh = false
    for (let attempt = 0; attempt < 2; attempt++) {
      const { url, headers } = await this.ensureRemoteUrl(forceRefresh)
      const reqHeaders = { ...headers }
      if (start > 0) reqHeaders.Range = `bytes=${start}-`
      const res = await fetch(url, { headers: reqHeaders, signal })
      if ((res.status === 401 || res.status === 403 || res.status === 410) && attempt === 0) {
        try { await res.body?.cancel() } catch {}
        forceRefresh = true
        continue
      }
      if (!res.ok) {
        try { await res.body?.cancel() } catch {}
        throw new Error(`HTTP ${res.status} while streaming ${this.name}`)
      }
      return res
    }
    throw new Error(`Unable to open stream for ${this.name}`)
  }

  /**
   * Async byte-stream iterator consumed by `@rockinchaos/matroska-metadata`.
   *
   * @param {{ start?: number }} [options]
   * @returns {AsyncIterableIterator<Uint8Array>}
   */
  async * [Symbol.asyncIterator](options = {}) {
    if (this.destroyed) return
    const start = Math.max(0, Number(options?.start) || 0)
    const controller = new AbortController()
    this.#activeControllers.add(controller)

    /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
    let reader = null
    try {
      const res = await this.#fetchRange(start, controller.signal)
      if (!res.body) return
      reader = res.body.getReader()
      let skipBytes = res.status === 200 && start > 0 ? start : 0

      while (!this.destroyed && !controller.signal.aborted) {
        const timer = setTimeout(() => controller.abort(), STREAM_CHUNK_TIMEOUT_MS)
        let chunk
        try {
          chunk = await reader.read()
        } finally {
          clearTimeout(timer)
        }
        if (chunk.done) break
        let data = chunk.value
        if (!data || !data.byteLength) continue
        if (skipBytes > 0) {
          if (data.byteLength <= skipBytes) {
            skipBytes -= data.byteLength
            continue
          }
          data = data.subarray(skipBytes)
          skipBytes = 0
        }
        yield data
      }
    } catch (err) {
      if (!this.destroyed && !controller.signal.aborted) throw err
    } finally {
      this.#activeControllers.delete(controller)
      try { await reader?.cancel() } catch {}
      controller.abort()
    }
  }

  /**
   * Reads the complete file into an ArrayBuffer (used for external subtitle and font files).
   *
   * @returns {Promise<ArrayBuffer>}
   */
  async arrayBuffer() {
    const controller = new AbortController()
    this.#activeControllers.add(controller)
    try {
      const res = await this.#fetchRange(0, controller.signal)
      return await res.arrayBuffer()
    } finally {
      this.#activeControllers.delete(controller)
    }
  }

  destroy() {
    this.destroyed = true
    for (const controller of this.#activeControllers) {
      try { controller.abort() } catch {}
    }
    this.#activeControllers.clear()
  }
}

export class DebridManager extends EventEmitter {
  /** @type {{ infoHash: string, name: string, providerId: string, providerName: string, torrentId: string | number, files: DebridFile[], media?: any } | null} */
  activeTorrent = null
  /** @type {DebridFile | null} */
  currentFile = null
  /** @type {Map<string, { resolve: (value: { url: string, headers?: Record<string, string> }) => void, reject: (err: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
  #pendingUrls = new Map()
  /** @type {Map<string, Promise<{ url: string, headers?: Record<string, string> }>>} */
  #inflightResolutions = new Map()
  /** @type {((req: any) => void) | null} */
  #urlResolver = null
  /** @type {number} */
  #nextRequestId = 1

  /**
   * Registers an external callback that resolves lazy file stream URLs on demand.
   *
   * @param {((req: any) => void) | null} fn
   */
  setUrlResolver(fn) {
    this.#urlResolver = typeof fn === 'function' ? fn : null
  }

  /**
   * Requests a direct CDN stream URL from the renderer for a lazy file inside the active torrent.
   *
   * @param {DebridFile} file
   * @param {boolean} [forceRefresh=false]
   * @returns {Promise<{ url: string, headers?: Record<string, string> }>}
   */
  requestFileUrl(file, forceRefresh = false) {
    const cacheKey = `${file.infoHash}:${file.path}:${forceRefresh ? 'refresh' : 'get'}`
    const existing = this.#inflightResolutions.get(cacheKey)
    if (existing) return existing

    const requestId = `tb_${this.#nextRequestId++}`
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingUrls.delete(requestId)
        reject(new Error(`Timed out resolving debrid stream URL for ${file.name}`))
      }, URL_REQUEST_TIMEOUT_MS)
      this.#pendingUrls.set(requestId, { resolve, reject, timer })
      const reqPayload = {
        requestId,
        infoHash: file.infoHash,
        path: file.path,
        providerId: file.providerId,
        torrentId: file.torrentId,
        fileId: file.id,
        forceRefresh
      }
      if (this.#urlResolver) this.#urlResolver(reqPayload)
      else this.emit('needUrl', reqPayload)
    }).finally(() => {
      this.#inflightResolutions.delete(cacheKey)
    })

    this.#inflightResolutions.set(cacheKey, promise)
    return promise
  }

  /**
   * Fulfills a pending `needUrl` request or updates a file's remote stream URL.
   *
   * @param {{ requestId?: string, infoHash?: string, path?: string, url?: string, headers?: Record<string, string>, error?: string }} payload
   */
  setFileUrl(payload) {
    const { requestId, infoHash, path, url, headers, error } = payload || {}
    if (infoHash && path && url && this.activeTorrent?.infoHash === infoHash) {
      const file = this.activeTorrent.files.find(f => f.path === path)
      if (file) {
        file.remoteUrl = url
        if (headers) file.headers = headers
      }
    }
    if (requestId && this.#pendingUrls.has(requestId)) {
      const pending = this.#pendingUrls.get(requestId)
      this.#pendingUrls.delete(requestId)
      clearTimeout(pending.timer)
      if (error || !url) pending.reject(new Error(error || 'Missing stream URL'))
      else pending.resolve({ url, headers })
    }
  }

  /**
   * Loads a resolved Debrid torrent as the active virtual torrent and returns Shiru TorrentFile descriptors.
   *
   * @param {{
   *   providerId: string,
   *   providerName: string,
   *   torrentId: string | number,
   *   infoHash: string,
   *   torrentName: string,
   *   files: Array<{ id: string | number, name: string, path: string, length: number, remoteUrl?: string | null, headers?: Record<string, string> }>
   * }} payload
   * @param {number} serverPort
   */
  loadTorrent(payload, serverPort) {
    this.clear()
    const files = (payload.files || []).map(f => {
      const file = new DebridFile({
        id: f.id,
        name: f.name,
        path: f.path,
        length: f.length,
        infoHash: payload.infoHash,
        providerId: payload.providerId,
        providerName: payload.providerName,
        torrentId: payload.torrentId,
        torrentName: payload.torrentName,
        remoteUrl: f.remoteUrl,
        headers: f.headers,
        resolveUrl: (forceRefresh = false) => this.requestFileUrl(file, forceRefresh)
      })
      return file
    })

    this.activeTorrent = {
      infoHash: payload.infoHash,
      name: payload.torrentName,
      providerId: payload.providerId,
      providerName: payload.providerName,
      torrentId: payload.torrentId,
      files
    }

    return files.map(file => ({
      infoHash: payload.infoHash,
      fileHash: `${payload.infoHash}:${file.id}`,
      torrent_name: payload.torrentName,
      torrentName: payload.torrentName,
      name: file.name,
      type: resolveContentType(file.name, null),
      size: file.length,
      length: file.length,
      path: file.path,
      url: this.buildLocalUrl(serverPort, payload.infoHash, file.path),
      debrid: true,
      debridProvider: payload.providerId,
      debridProviderName: payload.providerName,
      debridTorrentId: payload.torrentId,
      debridFileId: file.id
    }))
  }

  /**
   * @param {number} serverPort
   * @param {string} infoHash
   * @param {string} filePath
   * @returns {string}
   */
  buildLocalUrl(serverPort, infoHash, filePath) {
    return `http://127.0.0.1:${serverPort}/debrid/${encodeURIComponent(infoHash)}/${encodeURIComponent(filePath)}`
  }

  /**
   * Finds a loaded DebridFile by infoHash and path.
   *
   * @param {string} infoHash
   * @param {string} path
   * @returns {DebridFile | null}
   */
  getFile(infoHash, path) {
    if (!this.activeTorrent || (infoHash && this.activeTorrent.infoHash !== infoHash)) return null
    return this.activeTorrent.files.find(f => f.path === path) || null
  }

  /**
   * Serves HTTP GET / HEAD / OPTIONS range requests for `/debrid/:infoHash/:encodedPath`.
   * Returns true if the request was handled by Debrid, false otherwise.
   *
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @returns {Promise<boolean>}
   */
  async handleHttpRequest(req, res) {
    const reqUrl = req.url || ''
    if (!reqUrl.startsWith('/debrid/')) return false

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type'
      })
      res.end()
      return true
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end('Method Not Allowed')
      return true
    }

    const cleanPath = reqUrl.split('?')[0].slice('/debrid/'.length)
    const slashIdx = cleanPath.indexOf('/')
    if (slashIdx === -1) {
      res.writeHead(404)
      res.end('Not Found')
      return true
    }

    const infoHash = decodeURIComponent(cleanPath.slice(0, slashIdx))
    const filePath = decodeURIComponent(cleanPath.slice(slashIdx + 1))
    const file = this.getFile(infoHash, filePath)
    if (!file) {
      res.writeHead(404)
      res.end('Debrid file not found')
      return true
    }

    const controller = new AbortController()
    let closed = false
    const onClose = () => {
      closed = true
      controller.abort()
    }
    req.once('close', onClose)
    res.once('close', onClose)

    try {
      const rangeHeader = req.headers.range
      let upstream = null
      let forceRefresh = false

      for (let attempt = 0; attempt < 2; attempt++) {
        const { url, headers } = await file.ensureRemoteUrl(forceRefresh)
        const fetchHeaders = { ...headers }
        if (rangeHeader) fetchHeaders.Range = String(rangeHeader)
        const candidate = await fetch(url, {
          method: req.method,
          headers: fetchHeaders,
          signal: controller.signal
        })
        if ((candidate.status === 401 || candidate.status === 403 || candidate.status === 410) && attempt === 0) {
          try { await candidate.body?.cancel() } catch {}
          forceRefresh = true
          continue
        }
        upstream = candidate
        break
      }

      if (closed || !upstream) return true

      if (!upstream.ok && upstream.status !== 206) {
        try { await upstream.body?.cancel() } catch {}
        res.writeHead(upstream.status || 502)
        res.end(upstream.statusText || 'Upstream error')
        return true
      }

      const outHeaders = {
        'Content-Type': resolveContentType(file.name, upstream.headers.get('content-type')),
        'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
      const contentLength = upstream.headers.get('content-length')
      if (contentLength) outHeaders['Content-Length'] = contentLength
      const contentRange = upstream.headers.get('content-range')
      if (contentRange) outHeaders['Content-Range'] = contentRange

      res.writeHead(upstream.status, outHeaders)
      if (req.method === 'HEAD' || !upstream.body) {
        try { await upstream.body?.cancel() } catch {}
        res.end()
        return true
      }

      const reader = upstream.body.getReader()
      try {
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read()
          if (done || closed || controller.signal.aborted) break
          if (value && value.byteLength) {
            if (!res.write(value)) {
              await new Promise(resolve => res.once('drain', resolve))
            }
          }
        }
      } finally {
        try { await reader.cancel() } catch {}
        if (!res.writableEnded) res.end()
      }
      return true
    } catch (err) {
      if (!closed) {
        if (!res.headersSent) res.writeHead(502)
        if (!res.writableEnded) res.end(err?.message || 'Stream error')
      }
      return true
    } finally {
      req.removeListener('close', onClose)
      res.removeListener('close', onClose)
    }
  }

  /**
   * Stops and clears the active Debrid stream session and pending URL requests.
   */
  clear() {
    if (this.activeTorrent) {
      for (const file of this.activeTorrent.files) file.destroy()
      this.activeTorrent = null
    }
    this.currentFile = null
    for (const [, pending] of this.#pendingUrls) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Debrid session cleared'))
    }
    this.#pendingUrls.clear()
    this.#inflightResolutions.clear()
  }
}
