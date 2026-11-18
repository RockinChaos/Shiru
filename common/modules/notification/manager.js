import { sort, dedupe, upsert, splitLocalAndSystem, markAsRead, getFlags } from '@/modules/notification/util.js'
import { debounce } from '@/modules/util.js'
import { cache, caches, mediaCache } from '@/modules/cache.js'
import { derived, writable } from 'simple-store-svelte'
import { COMMON, ELECTRON } from '@/modules/bridge.js'

/** @type {import('simple-store-svelte').Writable<any[]>} */
export const localNotifications = writable(cache.getEntry(caches.NOTIFICATIONS, 'notifications') || [])
/** @type {import('simple-store-svelte').Readable<number>} */
export const unreadCount = derived(localNotifications, _notifications => _notifications?.filter?.(notification => notification.read !== true)?.length)

/** Debounced batch processor for queued notifications */
const debounceNotify = debounce(processNotifications, 15_000)
/** Debounced trigger for marking watched notifications as read */
const debounceMarkRead = debounce(markWatchedAsRead, 2_500)
mediaCache.subscribe(debounceMarkRead)
/**
 * Temporary buffer for incoming notifications before processing
 * @type {Object[]}
 */
const incomingNotifications = cache.getEntry(caches.NOTIFICATIONS, 'incomingNotifications') || []
/**
 * Debounced persistence and updates unread count.
 * Writes to cache and updates Electron badge count.
 */
const debounceAsBatch = debounce(() => {
  cache.setEntry(caches.NOTIFICATIONS, 'notifications', localNotifications.value)
  setTimeout(() => ELECTRON.setUnreadCount(unreadCount.value), 50).unref?.()
}, 1_500)
localNotifications.subscribe(debounceAsBatch)

/** Marks watched notifications as read by checking media progress */
async function markWatchedAsRead() {
  const updates = []
  for (const { notification, media } of await Promise.all(localNotifications.value.filter((n) => !n.read).map((notification) => cache.requestMedia(notification.id).then((media) => ({ notification, media }))))) {
    if (getFlags(notification, media).completed) updates.push(`${notification.id}-${notification.episode}`)
  }
  if (updates.length > 0) {
    localNotifications.update((n) =>
      sort(n.map((existing) => {
        if (updates.includes(`${existing.id}-${existing.episode}`)) existing.read = true
        return existing
      })))
  }
}

/**
 * Processes queued notifications in a single batch.
 * Deduplicates incoming, applies local updates, and dispatches system notifications.
 */
function processNotifications() {
  if (!incomingNotifications.length) return
  const { localNotifications: local, systemNotifications } = splitLocalAndSystem(dedupe(incomingNotifications), localNotifications.value)
  for (const notification of local) localNotifications.update((n) => upsert(n, notification))
  systemNotifications.forEach((notification, i) => setTimeout(() => COMMON.notify(notification), 5 * (i + 1)).unref?.())
  cache.setEntry(caches.NOTIFICATIONS, 'incomingNotifications', [])
  incomingNotifications.length = 0
}

/**
 * Mark a notification as read based on media progress
 *
 * @param {{ id: number, episode: number, episodes: number }} media
 */
export const readNotification = (media) => localNotifications.update((n) => markAsRead(n, media))

/**
 * Queue a notification for batched processing
 *
 * @param {Object} notification Notification payload
 */
export function queueNotification(notification) {
  incomingNotifications.push(notification)
  cache.setEntry(caches.NOTIFICATIONS, 'incomingNotifications', incomingNotifications)
  debounceNotify()
}

/** Clears all local and incoming notifications */
export function resetNotifications() {
  cache.resetNotifications()
  localNotifications.set([])
  incomingNotifications.length = 0
}

ELECTRON.setUnreadCount(unreadCount.value)