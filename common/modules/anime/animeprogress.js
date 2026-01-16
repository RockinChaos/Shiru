import { writable, derived } from 'simple-store-svelte'
import { cache, caches } from '@/modules/cache.js'
import { isValidNumber } from '@/modules/util.js'

// Maximum number of entries to keep in the cache
// const maxEntries = 10000

// The cache is structured as an array of objects with the following properties:
// mediaId, episode, currentTime, safeduration, createdAt, updatedAt
function read () {
  return cache.getEntry(caches.HISTORY, 'animeEpisodeProgress') || []
}

function write (data) {
  cache.setEntry(caches.HISTORY, 'animeEpisodeProgress', data)
  animeProgressStore.set(data)
}

const animeProgressStore = writable(read())

// Return an object with the progress of each episode in percent (0-100), keyed by episode number
export function liveAnimeProgress (mediaId) {
  return derived(animeProgressStore, (data) => {
    if (!mediaId) return {}
    const results = data.filter(item => item.mediaId === mediaId)
    if (!results) return {}
    // Return an object with the episode as the key and the progress as the value
    return Object.fromEntries(results.map(result => [
      result.episode,
      Math.ceil(result.currentTime / result.safeduration * 100)
    ]))
  })
}

// Return an individual episode's progress in percent (0-100)
export function liveAnimeEpisodeProgress (mediaId, episode, completed) {
  if (completed) return null
  return derived(animeProgressStore, (data) => {
    if (!mediaId || !isValidNumber(episode)) return 0
    const result = data.find(item => item.mediaId === mediaId && item.episode === episode)
    if (!result) return 0
    return Math.ceil(result.currentTime / result.safeduration * 100)
  })
}

// Return an individual episode's record { name, mediaId, episode, currentTime, safeduration, createdAt, updatedAt }
export function getAnimeProgress ({ name, mediaId, episode }) {
  const data = read()
  const dataName = name && data.find(item => item.name === name)
  const dataId = mediaId && data.find(item => item.mediaId === mediaId && item.episode === episode)
  if (dataName && dataId && (dataName.updatedAt > dataId.updatedAt)) return dataName
  return dataId || dataName
}

// Set an individual episode's progress
export function setAnimeProgress ({ name, mediaId, episode, currentTime, safeduration }) {
  if ((!name && !mediaId) || (!name && !isValidNumber(episode)) || (!currentTime && currentTime !== 0) || !safeduration) return
  const data = read()
  // Update the existing entry or create a new one
  const existing = data.find(item => mediaId ? (item.mediaId === mediaId && item.episode === episode) : item.name === name)
  if (existing) {
    existing.currentTime = currentTime
    existing.safeduration = safeduration
    existing.updatedAt = Date.now()
  } else {
    data.push({ name, mediaId, episode, currentTime, safeduration, createdAt: Date.now(), updatedAt: Date.now() })
  }
  // Remove the oldest entries if we have too many
  // while (data.length > maxEntries) {
  //   const oldest = data.reduce((a, b) => a.updatedAt < b.updatedAt ? a : b)
  //   data.splice(data.indexOf(oldest), 1)
  // }
  write(data)
}