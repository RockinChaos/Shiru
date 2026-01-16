import { cache, caches } from '@/modules/cache.js'
import { loadedTorrent, completedTorrents, seedingTorrents, stagingTorrents } from '@/modules/torrent.js'
import { writable } from 'simple-store-svelte'

// The cache is structured as an array of objects with the following properties: { hash, mediaId, episodeRange: { first, last }, episode, season, parseObject, files: [{ mediaId, episodeRange: { first, last }, episode, season, parseObject, fileHash, cachedAt, updatedAt, locked, failed }], cachedAt, updatedAt, locked, failed }
const hashes = writable(cache.getEntry(caches.HISTORY, 'animeResolvedHash') || [])

function write (data) {
    cache.setEntry(caches.HISTORY, 'animeResolvedHash', data)
}

function pushFiles(files, data) {
    files.push({
        fileHash: data.fileHash,
        mediaId: data.mediaId,
        ...(data.episodeRange ? { episodeRange: data.episodeRange } : {}),
        ...(data.episode || data.episode === 0 ? { episode: Number.isFinite(Number(data.episode)) ? Number(data.episode) : data.episode } : {}),
        ...(data.season ? { season: Number(data.season) || data.season } : {}),
        parseObject: data.parseObject,
        ...(data.locked ? { locked: data.locked } : {}),
        ...(data.failed && !data.locked ? { failed: data.failed } : {}),
        cachedAt: Date.now(),
        updatedAt: Date.now()
    })
}

export function setHash(hash, data) {
    const existing = hashes.value.find(item => item.hash === hash)
    if (existing) {
        if (data.fileHash) {
            const files = existing.files || []
            const existingFile = files.find(item => item.fileHash === data.fileHash)
            if (existingFile) {
                Object.assign(existingFile, {
                    mediaId: data.mediaId,
                    ...(data.episodeRange ? { episodeRange: data.episodeRange } : {}),
                    ...(data.episode || data.episode === 0 ? { episode: Number.isFinite(Number(data.episode)) ? Number(data.episode) : data.episode } : {}),
                    ...(data.season ? { season: Number(data.season) || data.season } : {}),
                    parseObject: data.parseObject,
                    ...(data.locked ? { locked: data.locked } : {}),
                    ...(data.failed && !data.locked ? { failed: data.failed } : {}),
                    updatedAt: Date.now()
                })
                if ((data.locked || !data.failed) && existingFile.failed) delete existingFile.failed
            } else pushFiles(files, data)
            existing.files = files
            if (!data.failed || data.locked) {
                existing.mediaId = data.mediaId
                existing.updatedAt = Date.now()
            }
            if ((data.locked || !data.failed) && existing.failed) delete existing.failed
        } else {
            Object.assign(existing, {
                hash,
                mediaId: data.mediaId,
                ...(data.episodeRange ? { episodeRange: data.episodeRange } : {}),
                ...(data.episode || data.episode === 0 ? { episode: Number.isFinite(Number(data.episode)) ? Number(data.episode) : data.episode } : {}),
                ...(data.season ? { season: Number(data.season) || data.season } : {}),
                parseObject: data.parseObject,
                ...(data.locked ? { locked: data.locked } : {}),
                ...(data.failed && !data.locked ? { failed: data.failed } : {}),
                updatedAt: Date.now()
            })
            if ((data.locked || !data.failed) && existing.failed) delete existing.failed
        }
    } else {
        const files = []
        if (data.fileHash) pushFiles(files, data)
        hashes.value.push({
            hash,
            mediaId: data.mediaId,
            ...(!files?.length ? {
                ...(data.episodeRange ? { episodeRange: data.episodeRange } : {}),
                ...(data.episode || data.episode === 0 ? { episode: Number.isFinite(Number(data.episode)) ? Number(data.episode) : data.episode } : {}),
                ...(data.season ? { season: Number(data.season) || data.season } : {}),
                parseObject: data.parseObject,
                ...(data.locked ? { locked: data.locked } : {}),
                ...(data.failed && !data.locked ? { failed: data.failed } : {})
            } : {}),
            cachedAt: Date.now(),
            updatedAt: Date.now(),
            files
        })
    }
    write(hashes.value)
}

export function getHash(mediaId, data, ignoreCached = false, ignoreExpiry = false, allHashes = false) {
  const loadedHash = loadedTorrent.value?.infoHash
  const seedingHashes = new Set(seedingTorrents.value.map(torrent => torrent.infoHash).filter(Boolean))
  const stagingHashes = new Set(stagingTorrents.value.map(torrent => torrent.infoHash).filter(Boolean))
  const completedHashes = new Set(completedTorrents.value.map(torrent => torrent.infoHash).filter(Boolean))
  const availableHashes = ignoreCached ? null : new Set([...completedHashes, ...stagingHashes, ...seedingHashes, loadedHash].filter(Boolean))
  const getPriority = (hash) => {
    if (hash === loadedHash) return 0
    if (seedingHashes.has(hash)) return 1
    if (stagingHashes.has(hash)) return 2
    if (completedHashes.has(hash)) return 3
    return 4
  }

  const foundHashes = []
  const cacheDuration = cache.getMedia(mediaId)?.status === 'FINISHED' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  const filtered = ignoreCached ? hashes.value : hashes.value.filter(item => availableHashes.has(item.hash) || (item.files?.length && item.files.some(file => availableHashes.has(file.fileHash))))
  for (const item of filtered) {
    let matchFound = false
    if (item.mediaId === mediaId && item.episode === (Number.isFinite(Number(data.episode)) ? Number(data.episode) : data.episode) && (item.parseObject || data.client) && (ignoreExpiry || item.locked || (item.updatedAt >= Date.now() - cacheDuration))) matchFound = true // Root match
    else if (Array.isArray(item.files) && item.files?.length) {
      const semiMatch = item.files.find(file => item.mediaId === mediaId && file.episode === (Number.isFinite(Number(data.episode)) ? Number(data.episode) : data.episode) && (item.parseObject || data.client)) // Semi file-level match: item-level mediaId
      if (semiMatch && (ignoreExpiry || item.locked || (item.updatedAt >= Date.now() - cacheDuration))) matchFound = true
      else {
        const fullMatch = item.files.find(file => file.mediaId === mediaId && file.episode === (Number.isFinite(Number(data.episode)) ? Number(data.episode) : data.episode) && (file.parseObject || data.client)) // Full file-level match: file-level mediaId
        if (fullMatch && (ignoreExpiry || fullMatch.locked || (fullMatch.updatedAt >= Date.now() - cacheDuration))) matchFound = true
      }
    } else if (data.batchGuess && item.mediaId === mediaId && !item.episode && item.episode !== 0 && (item.parseObject || data.client) && (ignoreExpiry || item.locked || (item.updatedAt >= Date.now() - cacheDuration))) matchFound = true
    if (matchFound) foundHashes.push(item.hash)
  }

  if (foundHashes.length === 0) return allHashes ? [] : null
  if (allHashes) return foundHashes.sort((hashA, hashB) => getPriority(hashA) - getPriority(hashB))
  return foundHashes.reduce((best, current) => getPriority(current) < getPriority(best) ? current : best)
}

export function getId(hash, data, ignoreExpiry = false) {
    const item = hashes.value.find(entry => entry.hash === hash || entry.files?.some(file => file.fileHash === hash))
    if (!item) return null
    if (!data.fileHash && (ignoreExpiry || item.locked || (item.updatedAt >= Date.now() - (cache.getMedia(item.mediaId)?.status === 'FINISHED' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000)))) return item // No fileHash: use top-level match
    else if (Array.isArray(item.files)) { // fileHash exists: try to find matching file
        const file = item.files.find(file => file.fileHash === data.fileHash)
        if (file && (ignoreExpiry || file.locked || (file.updatedAt >= Date.now() - (cache.getMedia(file.mediaId)?.status === 'FINISHED' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000)))) return file
    }
    return null
}