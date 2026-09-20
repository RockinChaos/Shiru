import { generateRandomHexCode } from '@/modules/util.js'
import { writable } from 'simple-store-svelte'

/**
 * @typedef {object} ToastData
 * @property {string} id
 * @property {'default'|'success'|'error'|'warning'|'info'|'loading'} type
 * @property {string} [title]
 * @property {string} [description]
 * @property {'top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-center'|'bottom-right'} position
 * @property {number} duration
 * @property {{label: string, onClick?: () => void}} [action]
 * @property {string} [dedupeKey]
 * @property {(id: string) => void} [onDismiss]
 * @property {boolean} force
 * @property {boolean} [respectLevel]
 * @property {number} updatedAt
 */

/**
 * @typedef {object} ToastMethods
 * @property {(options: Object) => string} show
 * @property {(id: string, options?: {silent?: boolean}) => void} dismiss
 * @property {(position?: string) => void} dismissAll
 * @property {(id: string, options: Object) => void} update
 * @property {(id: string) => void} pause
 * @property {(id: string) => void} resume
 * @property {(title: string, options?: Object) => string} success
 * @property {(title: string, options?: Object) => string} error
 * @property {(title: string, options?: Object) => string} warning
 * @property {(title: string, options?: Object) => string} info
 * @property {(title: string, options?: Object) => string} loading
 * @property {(work: Promise, messages?: {loading?: string, success?: string|((result: any) => string), error?: string|((error: any) => string), id?: string, position?: string}) => Promise} promise
 */

/** @type {number} Default auto-dismiss duration */
const DEFAULT_DURATION = 10_000
/** @type {'top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-center'|'bottom-right'} */
const DEFAULT_POSITION = 'top-right'
/** @type {number} If a matching toast has less than this many ms left, let it expire and show fresh instead of refreshing it */
const DEFAULT_DEDUPE_GRACE_MS = 800

/** id -> { timeoutId, expiresAt, remaining } */
const timers = new Map()

/**
 * Clears and removes a toast's auto-dismiss timer entry, if one exists.
 *
 * @param {string} id
 */
function clearTimer(id) {
  const timer = timers.get(id)
  if (timer?.timeoutId) clearTimeout(timer.timeoutId)
  timers.delete(id)
}

/**
 * Schedules a toast's auto-dismiss timer, replacing any existing one.
 *
 * @param {string} id
 * @param {number} duration ms, skipped entirely for falsy or Infinity durations
 */
function scheduleTimer(id, duration) {
  clearTimer(id)
  if (!duration || duration === Infinity) return
  const timeoutId = setTimeout(() => dismiss(id), duration)
  timeoutId.unref?.()
  timers.set(id, { timeoutId, expiresAt: Date.now() + duration, remaining: null })
}

/**
 * Gets how much time is left before a toast auto-dismisses.
 *
 * @param {string} id
 * @returns {number} ms remaining, or Infinity if the toast has no active timer
 */
function remainingTime(id) {
  const timer = timers.get(id)
  if (!timer) return Infinity
  return timer.remaining ?? timer.expiresAt - Date.now()
}

/**
 * Builds the identity key for a toast used for deduping, defaulting to type:title:description when no explicit key is given.
 *
 * @param {Object} options
 * @returns {string}
 */
function buildKey(options) {
  return options.dedupeKey ?? `${options.type ?? 'default'}:${options.title ?? ''}:${options.description ?? ''}`
}

/**
 * Shows a new toast, or refreshes/replaces a matching one when de-duping.
 *
 * @param {Object} options
 * @param {string} [options.id]
 * @param {'default'|'success'|'error'|'warning'|'info'|'loading'} [options.type]
 * @param {string} [options.title]
 * @param {string} [options.description]
 * @param {'top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-center'|'bottom-right'} [options.position]
 * @param {number} [options.duration] ms, Infinity to persist until dismissed
 * @param {boolean} [options.dedupe] suppress/refresh instead of stacking a duplicate
 * @param {string} [options.dedupeKey] explicit de-dupe identity, defaults to type+title+description
 * @param {number} [options.dedupeGrace] how close to expiry before a dupe is allowed to replace the old one
 * @param {boolean} [options.dedupeRefresh=true] whether a live duplicate resets the existing toast's timer/content or is just dropped
 * @param {{ label: string, onClick?: () => void }} [options.action]
 * @param {boolean} [options.force] shows even while the target Toaster is conditionally hidden
 * @param {boolean} [options.respectLevel=false] whether this toast is subject to the Toast Levels setting
 * @param {(id: string) => void} [options.onDismiss]
 * @returns {string} the toast id
 */
function show(options) {
  const position = options.position ?? DEFAULT_POSITION
  const duration = options.duration ?? DEFAULT_DURATION

  if (options.dedupe) {
    const dedupeKey = buildKey(options)
    const existing = toasts.value.find(toast => toast.dedupeKey === dedupeKey)
    if (existing) {
      if (remainingTime(existing.id) > (options.dedupeGrace ?? DEFAULT_DEDUPE_GRACE_MS)) {
        if (options.dedupeRefresh ?? true) {
          scheduleTimer(existing.id, duration)
          toasts.update(all => all.map(toast => (toast.id === existing.id ? { ...toast, ...options, id: existing.id, position, dedupeKey, updatedAt: Date.now() } : toast)))
        }
        return existing.id
      }
      dismiss(existing.id) // about to expire anyway, let a fresh one take its place
    }
  }

  const id = options.id ?? generateRandomHexCode(16)
  /** @type {ToastData} */
  const toast = {
    id,
    type: options.type ?? 'default',
    title: options.title,
    description: options.description,
    position,
    duration,
    action: options.action,
    dedupeKey: options.dedupe ? buildKey(options) : undefined,
    onDismiss: options.onDismiss,
    force: options.force ?? false,
    respectLevel: options.respectLevel ?? false,
    updatedAt: Date.now()
  }

  toasts.update(all => [...all, toast])
  scheduleTimer(id, duration)
  return id
}

/**
 * Dismisses a toast by id, clearing its timer and firing its onDismiss callback unless silenced.
 *
 * @param {string} id
 * @param {{silent?: boolean}} [options]
 */
function dismiss(id, { silent = false } = {}) {
  clearTimer(id)
  let dismissed
  toasts.update(all => {
    dismissed = all.find(toast => toast.id === id)
    return all.filter(toast => toast.id !== id)
  })
  if (!silent) dismissed?.onDismiss?.(id)
}

/**
 * Dismisses every toast, optionally scoped to a single position.
 *
 * @param {string} [position] if omitted, dismisses toasts in all positions
 */
function dismissAll(position) {
  for (const toast of toasts.value.filter(toast => !position || toast.position === position)) dismiss(toast.id)
}

/**
 * Updates an existing toast's fields in place and bumps its updatedAt timestamp.
 *
 * @param {string} id
 * @param {Object} options fields to merge into the existing toast
 */
function update(id, options) {
  toasts.update(all => all.map(toast => (toast.id === id ? { ...toast, ...options, updatedAt: Date.now() } : toast)))
  if (options.duration != null) scheduleTimer(id, options.duration)
}

/**
 * Pauses a toast's auto-dismiss timer, e.g. while the pointer is over it or dragging it.
 *
 * @param {string} id
 */
function pause(id) {
  const timer = timers.get(id)
  if (!timer?.timeoutId) return
  clearTimeout(timer.timeoutId)
  timer.remaining = timer.expiresAt - Date.now()
  timer.timeoutId = null
}

/**
 * Resumes a previously paused toast's auto-dismiss timer.
 *
 * @param {string} id
 */
function resume(id) {
  const timer = timers.get(id)
  if (!timer || timer.remaining == null) return
  timer.timeoutId = setTimeout(() => dismiss(id), timer.remaining)
  timer.timeoutId.unref?.()
  timer.expiresAt = Date.now() + timer.remaining
  timer.remaining = null
}

/**
 * Builds a type-preset shorthand function.
 *
 * @param {'default'|'success'|'error'|'warning'|'info'|'loading'} type
 * @returns {(title: string, options?: Object) => string}
 */
function buildShorthand(type) {
  return (title, options = {}) => show({ ...options, type, title })
}

/** @type {((title: string, options?: Object) => string) & ToastMethods} */
export const toast = Object.assign(buildShorthand('default'), {
  success: buildShorthand('success'),
  error: buildShorthand('error'),
  warning: buildShorthand('warning'),
  info: buildShorthand('info'),
  loading: buildShorthand('loading'),
  show,
  dismiss,
  dismissAll,
  update,
  pause,
  resume,

  /**
   * Ties a toast's lifecycle to a promise: shows a loading toast immediately, then flips it to success/error once it settles.
   *
   * @param {Promise} work
   * @param {{ loading?: string, success?: string|((result: any) => string), error?: string|((error: any) => string), description?: string, id?: string, position?: string }} [messages]
   * @returns {Promise} resolves/rejects with the original promise's result, after updating the toast
   */
  promise: (work, messages = {}) => {
    const id = show({ id: messages.id, position: messages.position, type: 'loading', title: messages.loading ?? 'Loading…', description: messages.description, duration: Infinity })
    return work.then(
      (result) => {
        update(id, { type: 'success', title: (typeof messages.success === 'function' ? messages.success(result) : messages.success) ?? 'Done', description: messages.description, duration: DEFAULT_DURATION })
        return result
      },
      (error) => {
        update(id, { type: 'error', title: (typeof messages.error === 'function' ? messages.error(error) : messages.error) ?? 'Something went wrong', description: messages.description, duration: DEFAULT_DURATION })
        throw error
      }
    )
  }
})

/** @type {import('simple-store-svelte').Writable<ToastData[]>} */
export const toasts = writable(/** @type {ToastData[]} */ ([]))