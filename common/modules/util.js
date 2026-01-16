import { SUPPORTS } from '@/modules/support.js'
import { writable, derived } from 'simple-store-svelte'
import { cubicOut, cubicIn } from 'svelte/easing'
import levenshtein from 'js-levenshtein'
import Fuse from 'fuse.js'

export const codes = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  406: 'Not Acceptable',
  408: 'Request Time-out',
  409: 'Conflict',
  410: 'Gone',
  412: 'Precondition Failed',
  413: 'Request Entity Too Large',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Time-out',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  509: 'Bandwidth Limit Exceeded',
  510: 'Not Extended',
  511: 'Network Authentication Required',
  521: 'Web Server Is Down'
}

/**
 * Checks whether a value is a valid finite number.
 *
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a finite number.
 */
export function isValidNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Gets the Hex Color of the String input.
 * @param {string} str
 * @returns {string} The full hex color of the string input.
 */
export function stringToHex(str) {
  if (!str) return 'var(--highlight-color)'
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash
  }
  return `#${[(hash >> 16) & 0xff, (hash >> 8) & 0xff, hash & 0xff].map(x => x.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Creates a deferred promise that can be resolved manually.
 * @returns {{ promise: Promise<boolean>, resolve: (value?: boolean) => void }}
 */
export function createDeferred() {
  let resolveFn
  const promise = new Promise((resolve) => {
    resolveFn = resolve
  })
  if (typeof resolveFn !== 'function') {
    throw new Error('Failed to create deferred promise')
  }
  return { promise, resolve: resolveFn }
}

/**
 * Converts a number of seconds into a human-readable countdown string.
 *
 * The output includes:
 * - Days (`d`) if present
 * - Hours (`h`) if days or hours are present
 * - Minutes (`m`) if days, hours, or minutes are present
 *
 * Examples:
 * - countdown(3661) → '1h 1m'
 * - countdown(86461) → '1d 0h 1m'
 *
 * @param {number} s - The number of seconds (can be negative for a reverse countdown)
 * @returns {string} A formatted time string like '2h 5m'
 */
export function countdown(s) {
  s = Math.floor(Math.abs(s))
  const d = Math.floor(s / 86400)
  s -= d * 86400
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  const tmp = []
  if (d) tmp.push(`${d}d`)
  if (d || h) tmp.push(`${h}h`)
  if (d || h || m) tmp.push(`${m}m`)
  if (!d && !h && !m) tmp.push('1m') // Best not to show seconds if we don't update the time every second.
  return tmp.join(' ')
}

const formatter = (typeof Intl !== 'undefined') && new Intl.RelativeTimeFormat('en')
const formatterShort = (typeof Intl !== 'undefined') && new Intl.RelativeTimeFormat('en', { style: 'short' })
const ranges = {
  years: 3600 * 24 * 365,
  months: 3600 * 24 * 30,
  weeks: 3600 * 24 * 7,
  days: 3600 * 24,
  hours: 3600,
  minutes: 60,
  seconds: 1
}

/**
 * @template T
 * @param {T[]} arr
 * @param {number} n
 */
export function * chunks (arr, n) {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n)
  }
}

/** @param {Date} date */
export function since (date) {
  const secondsElapsed = (date.getTime() - Date.now()) / 1000
  for (const key in ranges) {
    if (ranges[key] < Math.abs(secondsElapsed)) {
      const delta = secondsElapsed / ranges[key]
      // @ts-ignore
      return formatter.format(Math.round(delta), key)
    }
  }
}

/** @param {Date} date */
export function eta(date) {
  const secondsElapsed = (date.getTime() - Date.now()) / 1000
  if (!isFinite(secondsElapsed)) return '∞'
  for (const key in ranges) {
    const seconds = ranges[key]
    if (Math.abs(secondsElapsed) >= seconds) {
      const delta = secondsElapsed / seconds
      return formatterShort.format(Math.round(delta), key)
    }
  }
  return formatterShort.format(1, 'second')
}

/**
 * @param {Date} episodeDate
 * @param {number} weeks The number of weeks past the episodeDate
 * @param {boolean} skip Add the specified number of weeks regardless of the episodeDate having past.
 * @returns {Date}
 */
export function past(episodeDate, weeks = 0, skip) {
  if (episodeDate < new Date() || skip) {
    episodeDate.setDate(episodeDate.getDate() + (7 * weeks))
  }
  return episodeDate
}

/**
 * @param {Date} date
 * @param {boolean} year
 */
export function monthDay(date, year = false) {
  const day = date.getDate()
  if (year) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric'
    }).format(date)
  }
  return (new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(date)) + (day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th')
}

const units = [' B', ' kB', ' MB', ' GB', ' TB']
export function fastPrettyBytes (num) {
  if (isNaN(num)) return '0 B'
  if (num < 1) return num + ' B'
  const exponent = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1)
  return Number((num / Math.pow(1000, exponent)).toFixed(2)) + units[exponent]
}

/** @type {DOMParser['parseFromString']} */
export const DOMPARSER = (typeof DOMParser !== 'undefined') && DOMParser.prototype.parseFromString.bind(new DOMParser())

export const sleep = t => new Promise(resolve => setTimeout(resolve, t).unref?.())

export function toTS (sec, full) {
  if (isNaN(sec) || sec < 0) {
    switch (full) {
      case 1:
        return '0:00:00.00'
      case 2:
        return '0:00:00'
      case 3:
        return '00:00'
      default:
        return '0:00'
    }
  }
  const hours = Math.floor(sec / 3600)
  /** @type {any} */
  let minutes = Math.floor(sec / 60) - hours * 60
  /** @type {any} */
  let seconds = full === 1 ? (sec % 60).toFixed(2) : Math.floor(sec % 60)
  if (minutes < 10 && (hours > 0 || full)) minutes = '0' + minutes
  if (seconds < 10) seconds = '0' + seconds
  return (hours > 0 || full === 1 || full === 2) ? hours + ':' + minutes + ':' + seconds : minutes + ':' + seconds
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
export function base32toHex(base32) {
  let bits = ''
  for (const char of base32.toLowerCase()) {
    const val = BASE32_ALPHABET.indexOf(char)
    if (val === -1) throw new Error(`Invalid base32 character: ${char}`)
    bits += val.toString(2).padStart(5, '0')
  }
  bits = bits.slice(0, bits.length - (bits.length % 4))
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

export function generateRandomHexCode (len) {
  let hexCode = ''
  while (hexCode.length < len) hexCode += (Math.round(Math.random() * 15)).toString(16)
  return hexCode
}

export function generateRandomString(length) {
  let string = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  for (let i = 0; i < length; i++) string += possible.charAt(Math.floor(Math.random() * possible.length))
  return string
}

export function getRandomInt(min, max) {
  min = Math.ceil(min)
  max = Math.floor(max)
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Retrieves a nested value from an object using a dot-separated path.
 * @param {Object} obj - The object to retrieve the value from.
 * @param {string} path - The dot-separated path (e.g., 'title.userPreferred').
 * @returns {*} - The value at the specified path or undefined.
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => acc && acc[key], obj)
}

/**
 * Sets a nested value in an object using a dot-separated path.
 * @param {Object} obj - The object to modify.
 * @param {string} path - The dot-separated path (e.g., 'title.userPreferred').
 * @param {*} value - The value to set.
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.')
  let current = obj
  while (keys.length > 1) {
    const key = keys.shift()
    if (!current[key] || typeof current[key] !== 'object') current[key] = {}
    current = current[key]
  }
  current[keys[0]] = value
}

function replaceSeasonWithWords(text) {
  const numberWords = {
    1: 'One',
    2: 'Two',
    3: 'Three',
    4: 'Four',
    5: 'Five',
    6: 'Six',
    7: 'Seven',
    8: 'Eight',
    9: 'Nine',
    10: 'Ten',
    11: 'Eleven',
    12: 'Twelve',
    13: 'Thirteen',
    14: 'Fourteen',
    15: 'Fifteen',
    16: 'Sixteen',
    17: 'Seventeen',
    18: 'Eighteen',
    19: 'Nineteen',
    20: 'Twenty'
  }
  return text.replace(/Season (\d{1,2})/gi, (match, num) => {
    const word = numberWords[Number(num)]
    return word ? `Season ${word}` : match
  })
}

const regex = !SUPPORTS.isAndroid ? new RegExp('[^\\p{L}\\p{N}\\p{Zs}\\p{Pd}]', 'gu') : /[^a-zA-Z0-9\s\-\u00C0-\u024F\u0400-\u04FF\u0370-\u03FF\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF]/g
function cleanText(text) {
  if (typeof text !== 'string') return ''
  return replaceSeasonWithWords(text.replace(regex, ''))
}

/**
 * @param {Object} nest The nested Object to use for looking up the keys.
 * @param {String} phrase The key phrase to look for.
 * @param {Array} keys Add the specified number of weeks regardless of the episodeDate having past.
 * @param {number} threshold The allowed tolerance, typically for misspellings.
 * @returns {boolean} If the target phrase has been found.
 */
export function matchKeys(nest, phrase, keys, threshold = 0.4) {
  if (!phrase) return true
  if (!nest) return false
  const cleanedNest = {}
  const cleanedPhrase = cleanText(phrase)
  for (const key of keys) {
    const value = getNestedValue(nest, key)
    if (typeof value === 'string') setNestedValue(cleanedNest, key, cleanText(value))
    else if (Array.isArray(value)) {
      const cleanedArray = value.filter(v => typeof v === 'string').map(cleanText)
      if (cleanedArray.length) setNestedValue(cleanedNest, key, cleanedArray)
    }
  }
  if (new Fuse([cleanedNest], { includeScore: true, threshold, keys: keys }).search(cleanedPhrase).length > 0) return true
  const fuse = new Fuse([cleanedPhrase], { includeScore: true, threshold })
  return keys.some((key) => {
    const valueToMatch = cleanedNest[key]
    if (valueToMatch) return fuse.search(valueToMatch).length > 0
    return false
  })
}

/**
 * Matches a search phrase against a given phrase or list of phrases using exact matching,
 * substring inclusion, and Levenshtein distance for fuzzy matching.
 *
 * @param {string} search - The input string to search within.
 * @param {string | string[]} phrase - The phrase or array of phrases to match against.
 * @param {number} threshold - The maximum Levenshtein distance allowed for a match.
 * @param {boolean} [strict=false] - If true, only considers whole phrase similarity instead of checking individual words or inclusion.
 * @param {boolean} [soft=false] - If true, and initial match fails, it will do a final check using a Fuse search ignoring word location.
 * @returns {boolean} - Returns true if a match is found, otherwise false.
 */
export function matchPhrase(search, phrase, threshold, strict = false, soft = false) {
  if (!search || !phrase) return false
  const normalizedSearch = search.toString().toLowerCase().replace(regex, '')
  phrase = Array.isArray(phrase) ? phrase : [phrase]
  for (let p of phrase) {
    if (p) {
      const normalizedPhrase = p.toLowerCase().replace(regex, '')
      if (strict) {
        if (levenshtein(normalizedSearch, normalizedPhrase) <= threshold) return true
      } else {
        if (normalizedSearch.includes(normalizedPhrase)) return true
        const searchWords = normalizedSearch.split(/\s+/)
        if (!soft) {
          for (let word of searchWords) {
            if (levenshtein(word, normalizedPhrase) <= threshold) return true
          }
        } else return new Fuse([normalizedPhrase], { includeScore: true, threshold, ignoreLocation: true, useExtendedSearch: true, isCaseSensitive: false }).search(normalizedSearch)?.length > 0
      }
    }
  }
  return false
}

/**
 * Returns a derived store that only updates when the value changes deeply.
 * Suppresses updates if the new value is equal to the previous one.
 *
 * @param {Readable<any>} store - The original Svelte store.
 * @returns {Readable<any>} A derived store emitting distinct deep values.
 */
export function uniqueStore(store) {
  let last
  return derived(store, ($value, set) => {
    if (last !== $value) {
      last = $value
      set($value)
    }
  })
}

export function capitalize(str) {
  return str?.replace(/\b\w/g, char => char.toUpperCase())
}

export function toFlags(code) {
  return code.toUpperCase().split('').map(letter => String.fromCodePoint(0x1F1E6 + letter.charCodeAt(0) - 'A'.charCodeAt(0))).join('')
}

export function throttle (fn, time) {
  let wait = false
  return (...args) => {
    if (!wait) {
      fn(...args)
      wait = true
      setTimeout(() => {
        fn(...args)
        wait = false
      }, time).unref?.()
    }
  }
}

export function debounce (fn, time) {
  let timeout
  return (...args) => {
    const later = () => {
      timeout = null
      fn(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, time)
    timeout.unref?.()
  }
}

/**
 * Fade in a node with vertical translation and scaling.
 *
 * @param {HTMLElement} node The DOM node to apply the transition to.
 * @param {Object} [options] Configuration options for the transition.
 * @param {number} [options.delay=0] Delay in milliseconds before the transition starts.
 * @param {number} [options.duration=300] Duration of the transition in milliseconds.
 * @param {number} [options.y=1.2] Vertical translation distance.
 * @param {number} [options.startScale=0.95] Initial scale at the start of the transition.
 * @param {function} [options.easing=cubicOut] Easing function for the transition.
 * @returns {Object} Svelte transition object with delay, duration, easing, and css function.
 */
export function fadeIn(node, { delay = 0, duration = 300, y = 1.2, startScale = 0.95, easing = cubicOut } = {}) {
  return {
    delay,
    duration,
    easing,
    css: (t, u) => `
      opacity: ${t};
      transform: translateY(${u * y}rem) scale(${startScale + (1 - startScale) * t});
      transform-origin: bottom center;
      will-change: transform, opacity;`
  }
}

/**
 * Fade out a node with vertical translation and scaling.
 *
 * @param {HTMLElement} node The DOM node to apply the transition to.
 * @param {Object} [options] Configuration options for the transition.
 * @param {number} [options.delay=0] Delay in milliseconds before the transition starts.
 * @param {number} [options.duration=200] Duration of the transition in milliseconds.
 * @param {number} [options.y=1.2] Vertical translation distance.
 * @param {number} [options.endScale=0.95] Final scale at the end of the transition.
 * @param {function} [options.easing=cubicIn] Easing function for the transition.
 * @returns {Object} Svelte transition object with delay, duration, easing, and css function.
 */
export function fadeOut(node, { delay = 0, duration = 200, y = 1.2, endScale = 0.95, easing = cubicIn } = {}) {
  return {
    delay,
    duration,
    easing,
    css: (t, u) => `
        opacity: ${t};
        transform: translateY(${u * y}rem) scale(${1 + (endScale - 1) * u});
        transform-origin: bottom center;
        will-change: transform, opacity;`
  }
}

/**
 * General work-around for preventing the reactive animations for specific classes when they are not needed.
 * Importing this and adding {$reactive ? `` : `not-reactive`} will disable reactivity for the added element when a trigger class is clicked.
 *
 * @param {[string]} triggerClasses The classes which need to be clicked to prevent reactivity.
 * @returns { { reactive: Writable<boolean>, init: (create: boolean, boundary?: boolean) => void } } The initializer and reactive listener.
 */
export function createListener(triggerClasses = []) {
  const reactive = writable(true)
  let lastPointerType = null
  let pointerTimeout = null
  let handling = false
  let bounds = false
  let pending = null

  function handleDown(event) {
    const pointerType = event.pointerType ?? (event.type === 'touchstart' ? 'touch' : 'mouse')
    if (!lastPointerType) {
      lastPointerType = pointerType
      if (pointerTimeout) clearTimeout(pointerTimeout)
      pointerTimeout = setTimeout(() => {
        lastPointerType = null
        pointerTimeout = null
      }, 5_000)
    }
    if (pointerType !== lastPointerType) return
    if (triggerClasses.some(className => event.target.closest(`.${className}`))) reactive.set(bounds)
    else if (bounds) {
      pending = null
      reactive.set(false)
      if (upTimeout) clearTimeout(upTimeout)
    }
  }

  let upTimeout = null
  function handleUp(event) {
    const pointerType = event.pointerType ?? (event.type === 'touchend' ? 'touch' : 'mouse')
    if (pointerType !== lastPointerType) return
    const handle = Symbol()
    pending = handle
    if (upTimeout) clearTimeout(upTimeout)
    upTimeout = setTimeout(() => {
      if (pending && pending === handle) reactive.set(true)
    }, pointerType !== 'touch' ? 20 : 500)
  }

  function addListeners() {
    document.addEventListener('mousedown', handleDown, true)
    document.addEventListener('touchstart', handleDown, true)
    if (!bounds) {
      document.addEventListener('mouseup', handleUp, true)
      document.addEventListener('touchend', handleUp, true)
    }
    handling = true
  }

  function removeListeners() {
    document.removeEventListener('mousedown', handleDown, true)
    document.removeEventListener('touchstart', handleDown, true)
    if (!bounds) {
      document.removeEventListener('mouseup', handleUp, true)
      document.removeEventListener('touchend', handleUp, true)
    }
    handling = false
  }

  function init(create, boundary = false) {
    bounds = boundary
    if (create && !handling) addListeners()
    else if (handling) removeListeners()
  }

  return { reactive, init }
}

export const defaults = {
  volume: 1,
  uiScale: 1,
  presetTheme: 'default-dark',
  playerAutoplay: true,
  playerPause: true,
  playerAutocomplete: true,
  playerAutocompleteThreshold: 85,
  playerDeband: false,
  preferDubs: false,
  adult: 'none',
  hentaiBanner: false,
  rssAutoplay: true,
  rssAutofile: true,
  rssQuality: '1080',
  rssFeedsNew: [],
  rssNotify: ['CURRENT', 'PLANNING'],
  systemNotify: true,
  aniNotify: 'all',
  releasesNotify: [],
  subAnnounce: 'none',
  dubAnnounce: 'none',
  hentaiAnnounce: 'none',
  customSections: [['Romance', ['Romance'], [], [], []], ['Isekai Comedy', ['Comedy'], ['Isekai'], [], []]],
  torrentSpeed: 5,
  torrentPersist: false,
  torrentDHT: false,
  torrentPeX: false,
  torrentUTP: false,
  disableStartupTorrent: SUPPORTS.isAndroid,
  torrentPort: 0,
  torrentStreamedDownload: true,
  torrentSort: 'seeders',
  seedingLimit: !SUPPORTS.isAndroid ? 5 : 2,
  dhtPort: 0,
  missingFont: true,
  maxConns: 50,
  subtitleRenderHeight: SUPPORTS.isAndroid ? '720' : '0',
  subtitleLanguage: 'eng',
  audioLanguage: 'jpn',
  torrentProvider: [],
  enableDoH: false,
  doHURL: 'https://cloudflare-dns.com/dns-query',
  disableSubtitleBlur: SUPPORTS.isAndroid,
  enableRPC: 'full',
  cards: 'small',
  cardPreview: true,
  cardAudio: false,
  toggleList: !SUPPORTS.isAndroid,
  titleLang: 'romaji',
  hideMyAnime: false,
  toasts: 'All',
  closeAction: 'Prompt',
  queryComplexity: 'Complex',
  expandingSidebar: false,
  torrentPathNew: undefined,
  donate: true,
  font: undefined,
  angle: 'default',
  sourcesNew: {},
  extensionsNew: {},
  extensionSources: {},
  disableMiniplayer: false,
  enableExternal: false,
  playerPath: '',
  playerSeek: 2,
  playerSkip: false,
  playerChapterSkip: 'embedded'
}

/**
 * @typedef {Object} GeneralDefaults
 * @property {string} theme
 * @property {number} volume
 * @property {string} posMiniplayer
 * @property {string} widthMiniplayer
 * @property {Array<any>} sync
 * @property {typeof defaults} settings
 * @property {any} [loadedTorrent]
 * @property {any} [stagingTorrents]
 * @property {any} [seedingTorrents]
 * @property {any} [completedTorrents]
 */
export const generalDefaults = {
  theme: '',
  volume: 1,
  posMiniplayer: 'bottom right',
  widthMiniplayer: '0px',
  sync: [],
  settings: defaults,
  loadedTorrent: undefined,
  stagingTorrents: [],
  seedingTorrents: [],
  completedTorrents: []
}

/**
 * @typedef {Object} HistoryDefaults
 * @property {any} [lastMagnet]
 * @property {any} [lastBoosted]
 * @property {any} [lastSubtitle]
 * @property {any} [lastSearched]
 * @property {any} [lastSchedule]
 * @property {any} [animeResolvedHash]
 * @property {any} [animeEpisodeProgress]
 */
export const historyDefaults = {
  lastMagnet: undefined,
  lastBoosted: undefined,
  lastSubtitle: undefined,
  lastSearched: undefined,
  lastSchedule: undefined,
  animeResolvedHash: [],
  animeEpisodeProgress: []
}

/**
 * @typedef {Object} QueryDefaults
 * @property {Record<string, any>} recommendations
 * @property {Record<string, any>} notifications
 * @property {Record<string, any>} following
 * @property {Record<string, any>} episodes
 * @property {Record<string, any>} search
 * @property {Record<string, any>} searchIDS
 * @property {Record<string, any>} compound
 * @property {Record<string, any>} extensions
 * @property {Record<string, any>} rss
 */
export const queryDefaults = {
  recommendations: {},
  notifications: {},
  following: {},
  episodes: {},
  search: {},
  searchIDS: {},
  compound: {},
  extensions: {},
  rss: {}
}

/**
 * @typedef {Object} NotifyDefaults
 * @property {Record<string, any>} lastRSS
 * @property {number} lastAni
 * @property {number} lastDub
 * @property {number} lastSub
 * @property {number} lastHentai
 * @property {any[]} delayedDubs
 * @property {any[]} announcedDubs
 * @property {any[]} announcedSubs
 * @property {any[]} announcedHentais
 * @property {any[]} notifications
 */
export const notifyDefaults = {
  lastRSS: {},
  lastAni: 0,
  lastDub: 0,
  lastSub: 0,
  lastHentai: 0,
  delayedDubs: [],
  announcedDubs: [],
  announcedSubs: [],
  announcedHentais: [],
  notifications: []
}

export const subtitleExtensions = ['srt', 'vtt', 'ass', 'ssa', 'sub', 'txt']
export const subRx = new RegExp(`.(${subtitleExtensions.join('|')})$`, 'i')

export const videoExtensions = ['3g2', '3gp', 'asf', 'avi', 'dv', 'flv', 'gxf', 'm2ts', 'm4a', 'm4b', 'm4p', 'm4r', 'm4v', 'mkv', 'mov', 'mp4', 'mpd', 'mpeg', 'mpg', 'mxf', 'nut', 'ogm', 'ogv', 'swf', 'ts', 'vob', 'webm', 'wmv', 'wtv']
export const videoRx = new RegExp(`.(${videoExtensions.join('|')})$`, 'i')

// freetype supported
export const fontExtensions = ['ttf', 'ttc', 'woff', 'woff2', 'otf', 'cff', 'otc', 'pfa', 'pfb', 'pcf', 'fnt', 'bdf', 'pfr', 'eot']
export const fontRx = new RegExp(`.(${fontExtensions.join('|')})$`, 'i')
