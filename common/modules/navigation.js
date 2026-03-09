import { files } from '@/components/MediaHandler.svelte'
import { SUPPORTS } from '@/modules/support.js'
import { writable } from 'simple-store-svelte'
import { settings } from '@/modules/settings.js'
import Debug from 'debug'
const debug = Debug('ui:history')

/**
 * @typedef {Object} PageStore
 * @property {function(function): function} subscribe Subscribe to page changes
 * @property {function(string): void} set Set page value
 * @property {function(string): void} navigateTo Navigate to a page (clears modals and logs history)
 * @property {string} value Current page value
 * @property {string} HOME
 * @property {string} SEARCH
 * @property {string} SCHEDULE
 * @property {string} SETTINGS
 * @property {string} PLAYER
 * @property {string} TORRENT_MANAGER
 * @property {string} WATCH_TOGETHER
 */

/**
 * @typedef {Object} ModalStore
 * @property {function(function): function} subscribe Subscribe to modal changes
 * @property {function(Object): void} set Set modal state
 * @property {function(string, any): void} open Open a modal (closes conflicting modals)
 * @property {function(string): void} close Close a specific modal
 * @property {function(string, any): void} toggle Toggle a modal open/closed
 * @property {function(): void} clear Clear all modals
 * @property {function(string): boolean} exists Check if modal exists
 * @property {string|null} focused Get the highest priority open modal
 * @property {number} length Number of open modals
 * @property {Object} value Current modal state object
 * @property {string} MINIMIZE_PROMPT
 * @property {string} UPDATE_PROMPT
 * @property {string} FILE_EDITOR
 * @property {string} FILE_MANAGER
 * @property {string} NOTIFICATIONS
 * @property {string} PROFILE
 * @property {string} TORRENT_MENU
 * @property {string} TRAILER
 * @property {string} ANIME_DETAILS
 */

/** @type {import('simple-store-svelte').Writable<boolean>} */
export const playPage = writable(settings.value.disableMiniplayer || false)
playPage.subscribe((value) => {
  const currentSettings = settings.value
  currentSettings.disableMiniplayer = value
  settings.value = currentSettings
})

/** @type {PageStore} */
export const page = (() => {
  const store = writable('home')
  const { subscribe, set } = store
  const PAGES = {
    HOME: 'home',
    SEARCH: 'search',
    SCHEDULE: 'schedule',
    SETTINGS: 'settings',
    PLAYER: 'player',
    TORRENT_MANAGER: 'torrent_manager',
    WATCH_TOGETHER: 'watch_together'
  }
  return {
    set,
    subscribe,
    ...Object.fromEntries(Object.entries(PAGES).map(([key, value]) => [key, value])),
    /**
     * Navigate to a page (clears modals and logs history)
     * @param {string} pageValue Page value to navigate to
     */
    navigateTo: (pageValue) => {
      if (historyManager.initialized) historyManager.navigatePage(pageValue)
      else set(pageValue)
    },
    /**
     * Get the current page value
     * @returns {string} Current page value
     */
    get value() {
      return store.value
    }
  }
})()

/** @type {ModalStore} */
export const modal = (() => {
  const store = writable({})
  const { subscribe, update, set } = store
  const MODALS = {
    MINIMIZE_PROMPT: {
      id: 'minimize_prompt',
      priority: 1,
      get siblings() {
        return [MODALS.UPDATE_PROMPT, MODALS.FILE_EDITOR, MODALS.FILE_MANAGER, MODALS.NOTIFICATIONS, MODALS.PROFILE, MODALS.TORRENT_MENU, MODALS.TRAILER, MODALS.ANIME_DETAILS]
      }
    },
    UPDATE_PROMPT: {
      id: 'update_prompt',
      priority: 2,
      get siblings() {
        return [MODALS.MINIMIZE_PROMPT, MODALS.FILE_EDITOR, MODALS.FILE_MANAGER, MODALS.NOTIFICATIONS, MODALS.PROFILE, MODALS.TORRENT_MENU, MODALS.TRAILER, MODALS.ANIME_DETAILS]
      }
    },
    FILE_EDITOR: {
      id: 'file_editor',
      priority: 3,
      get siblings() {
        return [MODALS.FILE_MANAGER]
      }
    },
    FILE_MANAGER: {
      id: 'file_manager',
      priority: 4,
      get siblings() {
        return [MODALS.FILE_EDITOR]
      }
    },
    NOTIFICATIONS: {
      id: 'notifications',
      priority: 5,
      get siblings() {
        return [MODALS.ANIME_DETAILS, MODALS.TORRENT_MENU]
      }
    },
    PROFILE: {
      id: 'profiles',
      priority: 6,
      get siblings() {
        return [MODALS.ANIME_DETAILS, MODALS.TORRENT_MENU]
      }
    },
    TORRENT_MENU: {
      id: 'torrent_menu',
      priority: 7,
      get siblings() {
        return [MODALS.NOTIFICATIONS, MODALS.PROFILE, MODALS.ANIME_DETAILS]
      }
    },
    TRAILER: {
      id: 'trailer',
      priority: 8,
      get siblings() {
        return [MODALS.ANIME_DETAILS]
      }
    },
    ANIME_DETAILS: {
      id: 'anime_details',
      priority: 9,
      get siblings() {
        return []
      }
    }
  }
  return {
    set,
    subscribe,
    ...Object.fromEntries(Object.entries(MODALS).map(([key, value]) => [key, value.id])),
    /**
     * Opens a modal and closes conflicting modals based on siblings list
     * @param {string} type Modal ID to open
     * @param {any} data Data to pass to the modal
     */
    open: (type, data) => {
      update(modals => {
        const siblings = Object.values(MODALS).find(modal => modal.id === type)?.siblings.map(modal => modal.id) || []
        return { ...Object.fromEntries(Object.entries(modals).filter(([key]) => siblings.includes(key))), [type]: { type, data, openedAt: Date.now() } }
      })
    },
    /**
     * Closes a specific modal
     * @param {string} type Modal ID to close
     */
    close: (type) => {
      update(modals => {
        const { [type]: _, ...rest } = modals
        return rest
      })
    },
    /**
     * Toggles a modal open or closed
     * @param {string} type Modal ID to toggle
     * @param {any} data Data to pass if opening
     */
    toggle: (type, data) => {
      update(modals => {
        if (type in modals) {
          const { [type]: _, ...rest } = modals
          return rest
        }
        const siblings = Object.values(MODALS).find(modal => modal.id === type)?.siblings.map(modal => modal.id) || []
        return { ...Object.fromEntries(Object.entries(modals).filter(([key]) => siblings.includes(key))), [type]: { type, data, openedAt: Date.now() } }
      })
    },
    /**
     * Get the highest priority modal currently open
     * @returns {string|null} Modal ID with the highest priority (lowest number), or null if none open
     */
    get focused() {
      const keys = Object.keys(store.value)
      if (keys.length === 0) return null
      return keys.reduce((highest, current) => (Object.values(MODALS).find(modal => modal.id === current)?.priority || 100) < (Object.values(MODALS).find(modal => modal.id === highest)?.priority || 100) ? current : highest)
    },
    /**
     * Get the number of currently open modals
     * @returns {number} Number of open modals
     */
    get length() {
      return Object.keys(store.value).length
    },
    /**
     * Get the current modal state object
     * @returns {Object} Current modal state
     */
    get value() {
      return store.value
    },
    /**
     * Check if a modal is currently open
     * @param {string} type Modal ID to check
     * @returns {boolean}
     */
    exists: (type) => type in store.value,
    /** Closes all modals */
    clear: () => update(() => ({}))
  }
})()

/**
 * Manages navigation history for back/forward movement.
 * * TODO: Change the settings tabs have page routes to support history navigation.
 */
class HistoryManager {
  /** @type {Array<{ type: string, value: any, timestamp: number, parentPage?: string, isTemp?: boolean}>} */
  history = []
  /** @type {number} */
  currentIndex = -1
  /** @type {boolean} */
  ignoreNext = false
  /** @type {boolean} */
  initialized = false
  /** @type {Array<() => void>} */
  unsubscribers = []
  /** @type {boolean} */
  isNavigating = false
  /** @type {boolean} */
  navigationLocked = false
  /** @type {Writable<boolean>} */
  canGoBack = writable(false)
  /** @type {Writable<boolean>} */
  canGoForward = writable(false)

  constructor() {
    if (SUPPORTS.isAndroid) {
      let minimizeApp = null
      window.Capacitor.Plugins.App.addListener('backButton', () => {
        debug('Android back button pressed', JSON.stringify({ canGoBack: canGoBack.value, minimizeApp: minimizeApp, currentIndex: this.currentIndex, historyLength: this.history.length }))
        if (canGoBack.value) this.goBack()
        else if (minimizeApp) {
          debug('Second back press detected, minimizing app')
          clearTimeout(minimizeApp)
          minimizeApp = null
          window.Capacitor.Plugins.App.minimizeApp()
        } else {
          debug('First back press, setting minimize timeout')
          minimizeApp = setTimeout(() => {
            debug('Resetting minimize timeout it has been 1000ms')
            minimizeApp = null
          }, 1_000)
          minimizeApp?.unref?.()
        }
      })
    }
    window.addEventListener('mouseup', (event) => {
      if (event.button === 3) {
        debug('Mouse back button pressed')
        event.preventDefault()
        this.goBack()
      } else if (event.button === 4) {
        debug('Mouse forward button pressed')
        event.preventDefault()
        this.goForward()
      }
    })
  }

  /**
   * Initializes the HistoryManager, subscribing to stores and adding the initial page entry.
   */
  initialize() {
    if (this.initialized) return
    this.initialized = true
    debug('Initializing HistoryManager')
    const storeMap = { page, modal }
    for (const [type, store] of Object.entries(storeMap)) {
      this.unsubscribers.push(
        store.subscribe(value => {
          debug('Store change detected', type, JSON.stringify(value))
          this.handleChange(type, value)
        })
      )
    }
    this.addHistoryEntry('page', 'home')
    this.syncState()
  }

  /**
   * Navigate to a page (clears modals and sets page)
   * @param {string} pageValue The page to navigate to
   */
  navigatePage(pageValue) {
    debug('navigatePage called', pageValue)
    const filteredModals = { ...modal.value }
    delete filteredModals[modal.MINIMIZE_PROMPT]
    delete filteredModals[modal.UPDATE_PROMPT]
    if (Object.keys(filteredModals).length > 0) {
      debug('Page navigation with open modals, logging modal state first', JSON.stringify(filteredModals))
      this.addHistoryEntry('modal', filteredModals)
    }
    if (modal.length) this.setIgnoreNext(() => modal.clear())
    page.set(pageValue)
  }

  /**
   * Moves back one step in history if possible.
   * @param {boolean} [skipLock=false] Ignores navigation lock and skips locking navigation
   */
  goBack(skipLock = false) {
    debug('goBack called', JSON.stringify({ currentIndex: this.currentIndex }))
    if (!skipLock) {
      if (this.navigationLocked) {
        debug('goBack ignored, navigation cooldown active')
        return
      }
      this.lockNavigation()
    }
    if (modal.exists(modal.UPDATE_PROMPT) || modal.exists(modal.MINIMIZE_PROMPT)) {
      debug('goBack ignored, fixed modal prompts are open')
      return
    }
    const current = this.history[this.currentIndex]
    let skipNavigation = false
    if (current) {
      if (current.type === 'modal') {
        const differs = JSON.stringify(modal.value) !== JSON.stringify(current.value)
        if (differs && this.currentIndex === this.history.length - 1 && !current.isTemp) {
          const tempState = { type: 'modal', value: modal.value, timestamp: Date.now(), isTemp: true }
          this.history.splice(this.currentIndex + 1, 0, tempState)
          debug('Temp entry added for forward navigation', JSON.stringify(tempState))
          this.setIgnoreNext(() => modal.set(current.value))
          skipNavigation = true
          debug('Modal restored without moving history', current.value)
        }
      }
    }
    if (this.currentIndex > 0 && !skipNavigation) {
      this.navigateTo(this.currentIndex - 1, true)
      this.syncState()
      debug('goBack finished', JSON.stringify({ currentIndex: this.currentIndex, historyLength: this.history.length }))
    }
  }

  /**
   * Moves forward one step in history if possible.
   * @param {boolean} [skipLock=false] Ignores navigation lock and skips locking navigation
   */
  goForward(skipLock = false) {
    debug('goForward called', JSON.stringify({ currentIndex: this.currentIndex }))
    if (!skipLock) {
      if (this.navigationLocked) {
        debug('goForward ignored, navigation cooldown active')
        return
      }
      this.lockNavigation()
    }
    if (this.currentIndex < this.history.length - 1) {
      let next = this.history[this.currentIndex + 1]
      if (next?.isTemp) {
        debug('Navigating to temp forward entry', JSON.stringify(next))
        if (next.type === 'modal') {
          if (JSON.stringify(modal.value) !== JSON.stringify(next.value)) this.navigateTo(this.currentIndex + 1)
          else this.currentIndex++
        }
        return
      }
      if (next) {
        debug('Navigating forward to next history entry', JSON.stringify(next))
        this.navigateTo(this.currentIndex + 1)
      }
    }
  }

  /**
   * Navigates to a specific history index and restores state.
   * @param {number} index Index to navigate to
   * @param {boolean} [back=false] If navigating backward
   */
  navigateTo(index, back = false) {
    debug('navigateTo called', JSON.stringify({ index, back }))
    if (index < 0 || index >= this.history.length) return
    this.isNavigating = true
    this.currentIndex = index
    const state = this.history[index]
    if (document.fullscreenElement) document.exitFullscreen()
    this.ignoreNext = true
    try {
      switch (state.type) {
        case 'page':
          this.restorePage(state.value, back)
          break
        case 'modal':
          this.restoreModal(state.value)
          break
      }
    } finally {
      this.ignoreNext = false
    }
    this.isNavigating = false
    this.syncState()
    debug('Navigated to index', index, 'state', JSON.stringify(state))
  }

  /**
   * Adds a new history entry for the given type and value.
   * @param {string} type The type of history entry (e.g., 'page', 'modal')
   * @param {any} value The value to store for this entry
   */
  addHistoryEntry(type, value) {
    if (this.ignoreNext || this.isNavigating) {
      debug(`Skipping addHistoryEntry due to ${this.ignoreNext ? 'ignoreNext' : 'isNavigating'}`, type, JSON.stringify(value))
      this.ignoreNext = false
      return
    }
    const previousEntry = this.history[this.currentIndex]
    if (previousEntry && previousEntry.type === type && JSON.stringify(previousEntry.value) === JSON.stringify(value)) {
      debug('Duplicate consecutive entry ignored', type, JSON.stringify(value))
      return
    }
    const state = { type, value, timestamp: Date.now() }
    if (type === 'modal') state.parentPage = page.value
    this.history = this.history.slice(0, this.currentIndex + 1)
    this.history.push(state)
    this.currentIndex = this.history.length - 1
    debug('History added', JSON.stringify(state), 'currentIndex', this.currentIndex, 'historyLength', this.history.length)
    this.syncState()
  }

  /**
   * Handles store changes and determines whether to add them to history.
   * @param {string} type Store type
   * @param {any} value New store value
   */
  handleChange(type, value) {
    if (type === 'page') {
      debug('Page change detected, adding history entry', JSON.stringify(value))
      this.addHistoryEntry(type, value)
    } else if (type === 'modal') {
      const filteredValue = { ...value }
      delete filteredValue[modal.MINIMIZE_PROMPT]
      delete filteredValue[modal.UPDATE_PROMPT]
      const previousEntry = this.history[this.currentIndex]
      const previousValue = previousEntry?.type === 'modal' ? { ...previousEntry.value } : {}
      if (previousEntry?.type === 'modal' && JSON.stringify(filteredValue) === JSON.stringify(previousValue)) {
        debug('Modal state unchanged after filtering (minimize/update prompt), skipping')
        this.ignoreNext = false
        return
      }
      if ((Object.keys(filteredValue).length > 0) || (Object.keys(previousValue).length > 0)) {
        debug('Modal state changed, adding history entry', JSON.stringify(filteredValue))
        this.addHistoryEntry('modal', filteredValue)
      } else {
        debug('Skipping empty modal state (no previous modals or only excluded modals)')
        this.ignoreNext = false
      }
    }
  }

  /**
   * Restores parent page for modals.
   * @param {{parentPage?: string}} state Object containing optional parentPage to restore
   */
  restoreParents(state) {
    if (state.parentPage && page.value !== state.parentPage && !(state.parentPage === 'player' && (!files?.value || files?.value?.length === 0))) {
      this.setIgnoreNext(() => page.set(state.parentPage))
      debug('Restoring parent page', state.parentPage)
    }
  }

  /**
   * Resets modals.
   */
  resetModals() {
    if (!modal.length) return
    this.setIgnoreNext(() => modal.clear())
    debug('Modals reset')
  }

  /**
   * Restores a page state.
   * @param {string} value The page name to restore
   * @param {boolean} [back=false] Whether this restore is triggered by backward navigation
   */
  restorePage(value, back = false) {
    debug('restorePage called', value, back)
    if (value === 'player' && (!files?.value || files?.value?.length === 0)) back ? this.goBack(true) : this.goForward(true)
    else {
      this.resetModals()
      this.setIgnoreNext(() => page.set(value))
    }
  }

  /**
   * Restores the entire modal state
   * @param {any} value The complete modal state object
   */
  restoreModal(value) {
    debug('restoreModal called', JSON.stringify(value))
    const state = this.history[this.currentIndex]
    this.restoreParents(state)
    this.setIgnoreNext(() => modal.set(value))
  }

  /**
   * Updates the writable states for canGoBack and canGoForward.
   */
  syncState() {
    this.canGoBack.set(this.currentIndex > 0)
    this.canGoForward.set(this.currentIndex < this.history.length - 1)
    debug('Navigation state updated', JSON.stringify({ canGoBack: this.currentIndex > 0, canGoForward: this.currentIndex < this.history.length - 1 }))
  }

  /**
   * Temporarily locks navigation actions (back/forward) to prevent rapid repeated input.
   * This helps avoid inconsistent state updates caused by users spamming navigation.
   */
  lockNavigation() {
    this.navigationLocked = true
    setTimeout(() => this.navigationLocked = false, 150).unref?.()
  }

  /**
   * Executes a callback while ignoring the next history addition.
   * @param {() => void} cb The callback function to execute
   */
  setIgnoreNext(cb) {
    this.ignoreNext = true
    cb()
  }

  /**
   * Returns debug information about current history and navigation state.
   * @returns {{currentIndex: number, historyLength: number, canGoBack: boolean, canGoForward: boolean, history: Array}}
   */
  getDebugInfo() {
    return {
      currentIndex: this.currentIndex,
      historyLength: this.history.length,
      canGoBack: this.currentIndex > 0,
      canGoForward: this.currentIndex < this.history.length - 1,
      history: this.history
    }
  }

  /**
   * Destroys the history manager, unsubscribing from all stores.
   */
  destroy() {
    this.unsubscribers.forEach(unsubscribe => unsubscribe())
    this.unsubscribers = []
    this.initialized = false
    debug('HistoryManager destroyed')
  }
}

/** @type {HistoryManager} */
const historyManager = new HistoryManager()
/** @type {import('simple-store-svelte').Writable<boolean>} */
export const canGoBack = historyManager.canGoBack
/** @type {import('simple-store-svelte').Writable<boolean>} */
export const canGoForward = historyManager.canGoForward
/** @type {() => void} Initializes history management and sets up store subscriptions. */
export const enableHistory = () => historyManager.initialize()
/** @type {() => void} Cleans up history manager and unsubscribes from all stores. */
export const destroyHistory = () => historyManager.destroy()
/** @type {() => void} Navigates back one step in history. */
export const goBack = () => historyManager.goBack()
/** @type {() => void} Navigates forward one step in history. */
export const goForward = () => historyManager.goForward()