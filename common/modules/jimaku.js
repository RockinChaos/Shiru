import { settings } from '@/modules/settings.js'
import Debug from 'debug'

const debug = Debug('ui:jimaku')
const BASE_URL = 'https://jimaku.cc/api/'

export const jimakuClient = new class JimakuClient {
  /**
   * Helper to perform fetch requests with authentication
   * @param {string} endpoint
   * @param {object} options
   */
  async _fetch(endpoint, options = {}) {
    const key = settings.value.jimakuKey
    if (!key) {
      debug('No API key configured')
      throw new Error('No Jimaku API key configured')
    }

    const url = new URL(endpoint, BASE_URL)
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null) url.searchParams.append(k, v)
      }
    }

    const headers = {
      'Authorization': key,
      'Content-Type': 'application/json',
      ...options.headers
    }

    try {
      const res = await fetch(url.toString(), { ...options, headers })
      
      if (res.status === 429) {
        debug('Rate limited')
        throw new Error('Jimaku API Rate Limited')
      }

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }))
        debug(`API Error ${res.status}: ${error.error || error.message}`)
        throw new Error(error.error || error.message || `API Error ${res.status}`)
      }

      return await res.json()
    } catch (err) {
      debug('Request failed:', err)
      throw err
    }
  }

  /**
   * Get entry details by ID
   * @param {number} id 
   */
  async getEntry(id) {
    return this._fetch(`entries/${id}`)
  }

  /**
   * Get files for an entry
   * @param {number} id 
   * @param {object} opts
   * @param {number} [opts.episode]
   */
  async getFiles(id, { episode } = {}) {
    return this._fetch(`entries/${id}/files`, {
      query: { episode }
    })
  }

  /**
   * Search for entries
   * @param {object} params
   * @param {string} [params.query]
   * @param {number} [params.anilist_id]
   * @param {string} [params.tmdb_id]
   * @param {boolean} [params.anime]
   */
  async search(params) {
    return this._fetch('entries/search', {
      query: { ...params }
    })
  }
}();
