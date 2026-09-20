import { createHash } from 'crypto'
import { videoRx } from '@/modules/util.js'
import querystring from 'querystring'
import parseTorrent from 'parse-torrent'
import { stat } from 'fs/promises'
import { statSync } from 'fs'
import path from 'path'
import os from 'os'

/** @type {boolean} */
export const isFlatpak = !!process.env.FLATPAK_ID

/**
 * Temporary directory path for WebTorrent usage (used for fallback).
 */
export let TMP
try {
  const base = isFlatpak ? // flatpak "/tmp" gets wiped on every restart... so best to avoid it.
    (process.env.XDG_CACHE_HOME || path.join(typeof os.homedir === 'function' ? os.homedir() : '/', '.cache'))
    : '/tmp'
  TMP = path.join(statSync(base) && base, 'webtorrent')
} catch (err) {
  try {
    TMP = path.join(statSync('/tmp') && '/tmp', 'webtorrent')
  } catch (err) {
    TMP = path.join(typeof os.tmpdir === 'function' ? os.tmpdir() : '/', 'webtorrent')
  }
}

/**
 * Converts an object into a URL query string with safe encoding for special characters.
 * @param {Object} obj - Object to convert.
 * @returns {string} Encoded query string.
 */
export const stringifyQuery = obj => {
  let ret = querystring.stringify(obj, null, null, { encodeURIComponent: escape })
  ret = ret.replace(/[@*/+]/g, char => // `escape` doesn't encode the characters @*/+ so we do it manually
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return ret
}

/**
 * Calculates progress and total size from a cached torrent.
 * @param {Object} cache - Cached torrent object.
 * @param {Uint8Array} cache._bitfield - Bitfield indicating completed pieces.
 * @returns {Promise<{progress: number, size: number} | null>}
 */
export async function getProgressAndSize(cache) {
  if (!cache) return null
  try {
    if (!cache?.pieces?.length || !cache._bitfield) return { progress: 0, size: cache?.length || 0 }
    const bits = new Uint8Array(cache._bitfield)
    let pieces = 0
    for (let i = 0; i < cache.pieces.length; i++) {
      if (bits[i >> 3] & (1 << (7 - (i & 7)))) pieces++
    }
    return { progress: (pieces / cache.pieces.length) || 0, size: cache.length || 0 }
  } catch {
    return { progress: 0, size: 0}
  }
}

/**
 * Checks whether all video files in a torrent are fully downloaded and match expected sizes.
 * @param {Object} cache - Cached torrent object.
 * @param {string} torrentPath - Path to downloaded torrent content.
 * @returns {Promise<boolean|null>} True if complete, false if incomplete, null if invalid input.
 */
export async function hasIntegrity(cache, torrentPath) {
  if (!cache || torrentPath == null) return null
  try {
    if (cache.files && cache.files.length) {
      for (const file of cache.files.filter(file => videoRx.test(file.name))) {
        const stats = await stat(path.join(torrentPath, file.path))
        if (stats.size !== file.length) return false
      }
    }
    return true
  } catch {
    return false
  }
}

/**
 * Converts an Error/Event/unknown value into a human-readable string.
 * @param {any} e - Error, Event, or any value.
 * @returns {string} String representation of the error.
 */
export function errorToString (e) {
  if (typeof Event !== 'undefined' && e instanceof Event) {
    if (e.error) return errorToString(e.error)
    if (e.message) return errorToString(e.message)
    if (e.reason) return errorToString(e.reason)
    return JSON.stringify(e)
  }
  if (typeof Error !== 'undefined' && e instanceof Error) {
    if (e.message) return errorToString(e.message)
    if (e.cause) return errorToString(e.cause)
    if (e.reason) return errorToString(e.reason)
    if (e.name) return errorToString(e.name)
    return JSON.stringify(e)
  }
  if (typeof e !== 'string') return JSON.stringify(e)
  return e
}

/**
 * Creates a SHA-1 hash from the given data.
 * @param {ArrayBuffer|Uint8Array|string} data - Data to hash.
 * @returns {string} Hex-encoded SHA-1 hash.
 */
export function makeHash(data) {
  return createHash('sha1').update(data).digest('hex')
}

/**
 * Extracts or computes the info hash from a magnet URI, torrent URL, or torrent file buffer.
 * @param {string|Uint8Array|Buffer} input - Magnet link, torrent URL, or torrent file data.
 * @returns {Promise<string>} Hex-encoded info hash.
 * @throws {Error} If format is unsupported or data is invalid.
 */
export async function getInfoHash(input) {
  if (!input?.length) return null
  try {
    if (typeof input === 'string' && input.startsWith('http')) {
      const res = await fetch(input)
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`)
      input = new Uint8Array(await res.arrayBuffer())
    }
    const parsed = await parseTorrent(input)
    if (!parsed.infoHash) throw new Error('Invalid torrent data or magnet link')
    return parsed.infoHash.toLowerCase()
  } catch (error) {
    console.debug(error)
    return null
  }
}

/**
 * Builds a stats object for a torrent, used when sending updates to the renderer.
 * @param {import('webtorrent').Torrent|object} torrent - The torrent or cached torrent object
 * @param {boolean} [completed=false] - True if torrent is a completed/cached torrent.
 * @returns {object}
 */
export function getStats(torrent, completed = false) {
  const pieces = completed ? getPiecesFromBitfield(torrent?._bitfield, torrent?.info?.pieces ? torrent.info.pieces.length / 20 : 0) : getPieces(torrent)
  return {
    infoHash: torrent?.infoHash,
    name: torrent?.name,
    size: torrent?.length,
    current: torrent?.current,
    staging: torrent?.staging,
    seeding: torrent?.seeding,
    progress: torrent?.progress,
    downloaded: getDownloadedBytes(pieces, completed ? torrent?.info?.['piece length'] : torrent?.pieceLength, torrent?.length || torrent?.info?.length || (Array.isArray(torrent?.info?.files) ? torrent.info.files.reduce((sum, file) => sum + file.length, 0) : 0)),
    numSeeders: torrent?.wires?.filter(wire => wire.isSeeder).length || 0,
    totalSeeders: torrent?.seeders || 0,
    numLeechers: (torrent?.wires?.length - torrent?.wires?.filter(wire => wire.isSeeder).length) || 0,
    totalLeechers: torrent?.leechers || 0,
    numPeers: torrent?.numPeers || 0,
    downloadSpeed: torrent?.downloadSpeed || 0,
    uploadSpeed: torrent?.uploadSpeed || 0,
    magnetURI: torrent?.magnetURI,
    date: torrent?.date ?? new Date(Date.now() - 1_000).toUTCString(),
    ...(!torrent?.current && !torrent?.staging && !torrent?.seeding ? { incomplete: torrent?.incomplete || torrent?.progress < 1 } : {}),
    ...(torrent?.missing_pieces ? { missing_pieces: torrent.missing_pieces } : {}),
    eta: torrent?.timeRemaining,
    ratio: torrent?.ratio || (torrent && getRatio(torrent, torrent?.length, torrent?.progress)),
    pieces,
    cachedAt: torrent?.cachedAt ?? Date.now()
  }
}

/**
 * Gets ratio for a torrent from cache.
 * @param {object} cache - Cached torrent object.
 * @param {number} size - Total size of the torrent in bytes.
 * @param {number} progress - Progress of the torrent.
 * @returns {number}
 */
function getRatio(cache, size, progress) {
  return (cache?._uploaded || 0) / (((progress || 0) * (size || 0)) || size || 1)
}

/**
 * Sums the exact byte length of every verified piece, accounting for the shorter final piece.
 * @param {number[]|null} pieces - Piece states, where 2 means verified
 * @param {number} pieceLength - Standard piece size in bytes
 * @param {number} totalLength - Total torrent size in bytes
 * @returns {number}
 */
function getDownloadedBytes(pieces, pieceLength, totalLength) {
  if (!pieces?.length || !pieceLength || !totalLength) return 0
  const lastPieceLength = totalLength - pieceLength * (pieces.length - 1)
  return pieces.reduce((sum, state, index) => sum + (state === 2 ? (index === pieces.length - 1 ? lastPieceLength : pieceLength) : 0), 0)
}

/**
 * Returns piece states (2=verified, 0=missing) from a stored bitfield, or null if absent.
 * @param {Buffer|Uint8Array} bitfield
 * @param {number} pieceCount
 * @returns {number[]|null}
 */
function getPiecesFromBitfield(bitfield, pieceCount) {
  if (!bitfield || !pieceCount) return null
  const buffer = Buffer.isBuffer(bitfield) ? bitfield : Buffer.from(bitfield)
  return Array.from({ length: pieceCount }, (_, index) => (buffer[index >> 3] >> (7 - (index & 7))) & 1 ? 2 : 0)
}

/**
 * Returns piece states for an active torrent: 2 = verified, 1 = downloading, 0 = missing.
 * @param {import('webtorrent').Torrent} torrent
 * @returns {number[]|null}
 */
function getPieces(torrent) {
  if (!torrent?.pieces?.length) return null
  const downloading = new Set()
  for (const wire of (torrent.wires || [])) {
    for (const request of (wire.requests || [])) downloading.add(request.piece)
  }
  return torrent.pieces.map((piece, index) => {
    if (piece === null) return 2
    if (downloading.has(index)) return 1
    return 0
  })
}
