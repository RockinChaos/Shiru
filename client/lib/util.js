import { createHash } from 'crypto'
import { videoRx } from '@/modules/util.js'
import querystring from 'querystring'
import parseTorrent from 'parse-torrent'
import { SUPPORTS } from '@/modules/support.js'
import { stat } from 'fs/promises'
import { statSync } from 'fs'
import path from 'path'
import os from 'os'

/**
 * Default list of tracker announce URLs (Base64-decoded).
 */
export const ANNOUNCE = [
  atob('d3NzOi8vdHJhY2tlci5vcGVud2VidG9ycmVudC5jb20='),
  atob('d3NzOi8vdHJhY2tlci53ZWJ0b3JyZW50LmRldg=='),
  atob('d3NzOi8vdHJhY2tlci5maWxlcy5mbTo3MDczL2Fubm91bmNl'),
  atob('d3NzOi8vdHJhY2tlci5idG9ycmVudC54eXov'),
  atob('dWRwOi8vb3Blbi5zdGVhbHRoLnNpOjgwL2Fubm91bmNl'),
  atob('aHR0cDovL255YWEudHJhY2tlci53Zjo3Nzc3L2Fubm91bmNl'),
  atob('dWRwOi8vdHJhY2tlci5vcGVudHJhY2tyLm9yZzoxMzM3L2Fubm91bmNl'),
  atob('dWRwOi8vZXhvZHVzLmRlc3luYy5jb206Njk2OS9hbm5vdW5jZQ=='),
  atob('dWRwOi8vdHJhY2tlci5jb3BwZXJzdXJmZXIudGs6Njk2OS9hbm5vdW5jZQ=='),
  atob('dWRwOi8vOS5yYXJiZy50bzoyNzEwL2Fubm91bmNl'),
  atob('dWRwOi8vdHJhY2tlci50b3JyZW50LmV1Lm9yZzo0NTEvYW5ub3VuY2U='),
  atob('aHR0cDovL29wZW4uYWNnbnh0cmFja2VyLmNvbTo4MC9hbm5vdW5jZQ=='),
  atob('aHR0cDovL2FuaWRleC5tb2U6Njk2OS9hbm5vdW5jZQ=='),
  atob('aHR0cDovL3RyYWNrZXIuYW5pcmVuYS5jb206ODAvYW5ub3VuY2U=')
]

/**
 * Temporary directory path for WebTorrent usage (used for fallback).
 */
export let TMP
try {
  TMP = path.join(statSync('/tmp') && '/tmp', 'webtorrent')
} catch (err) {
  TMP = path.join(typeof os.tmpdir === 'function' ? os.tmpdir() : '/', 'webtorrent')
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
 * Safely encodes the filename segment of a stream URL, preserving the path structure.
 * Encodes only the last path segment to ensure special characters in filenames are properly escaped for use in intents or URLs.
 * THIS IS VERY IMPORTANT FOR ANDROID!
 *
 * @param {string} streamURL - The stream URL containing the filename to encode.
 * @returns {string} The stream URL with the filename segment URI-encoded.
 */
export const encodeStreamURL = (streamURL) => {
  if (!streamURL?.length || !SUPPORTS.isAndroid) return streamURL
  return streamURL.replace(/\\/g, '/').split('/').map(segment => {
    if (!segment) return segment
    return encodeURIComponent(decodeURIComponent(segment))
      .replace(/%5B/g, '[')
      .replace(/%5D/g, ']')
      .replace(/%2C/g, ',')
      .replace(/%28/g, '(')
      .replace(/%29/g, ')')
      .replace(/%2A/g, '*')
      .replace(/%2B/g, '+')
      .replace(/%3B/g, ';')
      .replace(/%3D/g, '=')
      .replace(/%40/g, '@')
      .replace(/%21/g, '!')
      .replace(/%24/g, '$')
      .replace(/%26/g, '&')
      .replace(/%27/g, "'")
  }).join('/')
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
      for (const file of cache.files?.filter(file => videoRx.test(file.name))) {
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
    console.error(error)
    return null
  }
}