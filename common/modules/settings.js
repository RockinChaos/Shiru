import { cache, caches } from '@/modules/cache.js'
import { writable } from 'simple-store-svelte'
import { defaults } from '@/modules/util.js'
import { toast } from 'svelte-sonner'
import { IPC } from '@/modules/bridge.js'
import Debug from 'debug'
const debug = Debug('ui:settings')

/** @type {{viewer: import('./al').Query<{Viewer: import('./al').Viewer}>, token: string} | null} */
export let alToken = JSON.parse(localStorage.getItem('ALviewer')) || null
/** @type {{viewer: import('./mal').Query<{Viewer: import('./mal').Viewer}>, token: string, refresh: string, refresh_in: number, reauth: boolean} | null} */
export let malToken = JSON.parse(localStorage.getItem('MALviewer')) || null

/**
 * Ensures that the webtorrent service is reloaded when the app is reloaded.
 * This is triggered by a `location.reload()` or force reload event.
 */
const _onbeforeunload = window.onbeforeunload
window.onbeforeunload = function (event) {
  IPC.emit('webtorrent-reload')
  if (typeof _onbeforeunload === 'function') {
    const result = _onbeforeunload(event)
    if (typeof result === 'string') return result
  }
}

let storedSettings = cache.getEntry(caches.GENERAL, 'settings')
let scopedDefaults
try {
  setDefaults()
} catch (e) {
  resetSettings()
}

function setDefaults() {
  scopedDefaults = {
    homeSections: [...(storedSettings.rssFeedsNew || defaults.rssFeedsNew).map(([title]) => [title, ['N/A'], ['N/A']]), ...(storedSettings.customSections || defaults.customSections).map(([title]) => [title, 'TRENDING_DESC', ['TV', 'MOVIE']]), ['Subbed Releases', 'N/A', ['TV', 'MOVIE', 'OVA', 'ONA']], ['Dubbed Releases', 'N/A', ['TV', 'MOVIE', 'OVA', 'ONA']], ['Continue Watching', 'UPDATED_TIME_DESC',  []], ['Sequels You Missed', 'POPULARITY_DESC',  []], ['Planning List', 'POPULARITY_DESC',  []], ['Popular This Season', 'N/A', ['TV', 'MOVIE']], ['Trending Now', 'N/A', ['TV', 'MOVIE']], ['All Time Popular', 'N/A', ['TV', 'MOVIE']]]
  }
}

/** @type {import('simple-store-svelte').Writable<number[]>} */
export const sync = writable(cache.getEntry(caches.GENERAL, 'sync') || [])

sync.subscribe(value => {
  cache.setEntry(caches.GENERAL, 'sync', value)
})

/** @type {import('simple-store-svelte').Writable<typeof defaults>} */
export const settings = writable({ ...defaults, ...scopedDefaults, ...storedSettings })

settings.subscribe(value => {
  cache.setEntry(caches.GENERAL, 'settings', value)
})

function resetSettings () {
  storedSettings = { ...defaults }
  setDefaults()
  settings.value = { ...defaults, ...scopedDefaults, ...storedSettings }
}

/** @type {import('simple-store-svelte').Writable<typeof defaults>} */
export const profiles = writable(JSON.parse(localStorage.getItem('profiles')) || [])

profiles.subscribe(value => {
  localStorage.setItem('profiles', JSON.stringify(value))
})

export function isAuthorized() {
  return alToken || malToken
}

window.addEventListener('paste', ({ clipboardData }) => {
  if (clipboardData.items?.[0]) {
    if (clipboardData.items[0].type === 'text/plain' && clipboardData.items[0].kind === 'string') {
      clipboardData.items[0].getAsString(text => {
        if (text.includes('access_token=')) { // is an AniList token
          let token = text.split('access_token=')?.[1]?.split('&token_type')?.[0]
          if (token) {
            if (token.endsWith('/')) token = token.slice(0, -1)
            handleToken(token)
          }
        } else if (text.includes('code=') && text.includes('&state')) { // is a MyAnimeList authorization
          let code = text.split('code=')[1].split('&state')[0]
          let state = text.split('&state=')[1]
          if (code && state) {
            if (code.endsWith('/')) code = code.slice(0, -1)
            if (state.endsWith('/')) state = state.slice(0, -1)
            if (state.includes('%')) state = decodeURIComponent(state)
            // remove linefeed characters from the state
            code = code.replace(/(\r\n|\n|\r)/gm, '')
            state = state.replace(/(\r\n|\n|\r)/gm, '')
            handleMalToken(code, state)
          }
        } else {
          const anilistRegex = /(?:https?:\/\/)?anilist\.co\/anime\/(\d+)/
          const malRegex = /(?:https?:\/\/)?myanimelist\.net\/anime\/(\d+)/
          const anilistMatch = text.match(anilistRegex)
          const malMatch = text.match(malRegex)
          let protocol = text
          if (anilistMatch) {
            protocol = `shiru://anime/${anilistMatch[1]}`
          } else if (malMatch) {
            protocol = `shiru://malanime/${malMatch[1]}`
          }
          IPC.emit('handle-protocol', protocol)
        }
      })
    }
  }
})
IPC.on('altoken', handleToken)
async function handleToken (token) {
  const { anilistClient } = await import('./anilist.js')
  const viewer = await anilistClient.viewer({token})
  if (!viewer.data?.Viewer) {
    toast.error('Failed to sign in with AniList. Please try again.', {description: JSON.stringify(viewer)})
    debug('Failed to sign in with AniList:', JSON.stringify(viewer))
    return
  }
  await swapProfiles({token, viewer}, true)
}

IPC.on('maltoken', handleMalToken)
async function handleMalToken (code, state) {
  const { clientID, malClient } = await import('./myanimelist.js')
  if (!state || !code) {
    toast.error('Failed to sign in with MyAnimeList. Please try again.')
    debug(`Failed to get the state and code from MyAnimeList.`)
    return
  }
  const response = await fetch('https://myanimelist.net/v1/oauth2/token', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
        client_id: clientID,
        grant_type: 'authorization_code',
        code: code,
        code_verifier: sessionStorage.getItem(state)
    })
  })
  if (!response.ok) {
    toast.error('Failed to sign in with MyAnimeList. Please try again.', { description: JSON.stringify(response.status) })
    debug('Failed to get MyAnimeList User Token:', JSON.stringify(response))
    return
  }
  const oauth = await response.json()
  const viewer = await malClient.viewer(oauth.access_token)
  if (!viewer?.data?.Viewer?.id) {
    toast.error('Failed to sign in with MyAnimeList. Please try again.', { description: JSON.stringify(viewer) })
    debug('Failed to sign in with MyAnimeList:', JSON.stringify(viewer))
    return
  }
  await swapProfiles({ token: oauth.access_token, refresh: oauth.refresh_token, refresh_in: Math.floor((Date.now() + 14 * 24 * 60 * 60 * 1000) / 1000), reauth: false, viewer }, true)
}

export async function refreshMalToken (token) {
  const { clientID } = await import('./myanimelist.js')
  const currentProfile = malToken?.token === token
  const refresh = currentProfile ? malToken.refresh : profiles.value.find(profile => profile.token === token)?.refresh
  debug(`Attempting to refresh authorization token ${token} with the refresh token ${refresh}`)
  let response
  if (refresh && refresh.length > 0) {
    response = await fetch('https://myanimelist.net/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientID,
        grant_type: 'refresh_token',
        refresh_token: refresh
      })
    })
  }
  if (!refresh || refresh.length <= 0 || !response?.ok) {
    if (currentProfile && !malToken.reauth) {
      toast.error('Failed to re-authenticate with MyAnimeList. You will need to log in again.', {description: JSON.stringify(response?.status || response)})
    }
    debug(`Failed to refresh MyAnimeList User Token ${ !refresh || refresh.length <= 0 ? 'as the refresh token could not be fetched!' : 'the refresh token has likely expired: ' + JSON.stringify(response)}`)
    if (currentProfile) {
      malToken.reauth = true
      localStorage.setItem('MALviewer', JSON.stringify(malToken))
    } else {
      profiles.update(profiles => profiles.map(profile => profile.token === token ? { ...profile, reauth: true } : profile))
    }
    return
  }
  const oauth = await response.json()
  const { malClient } = await import('./myanimelist.js')
  const viewer = await malClient.viewer(oauth.access_token)
  const refresh_in = Math.floor((Date.now() + 14 * 24 * 60 * 60 * 1000) / 1000)
  if (malToken?.token === token) {
    malToken = { viewer: viewer, token: oauth.access_token, refresh: oauth.refresh_token, refresh_in: refresh_in, reauth: false }
    localStorage.setItem('MALviewer', JSON.stringify(malToken))
  } else {
    profiles.update(profiles =>
        profiles.map(profile => {
          if (profile.token === token) {
            return { viewer: viewer, token: oauth.access_token, refresh: oauth.refresh_token, refresh_in: refresh_in, reauth: false }
          }
          return profile
        })
    )
  }
  debug(`Successfully refreshed authorization token, updated to token ${oauth.access_token} with the refresh token ${oauth.refresh_token}`)
  return oauth
}

export async function swapProfiles(profile, newProfile) {
  const currentProfile = isAuthorized()
  if (!isAuthorized() && profile != null) await cache.abandon(profile.viewer.data.Viewer.id)

  if (profile == null && profiles.value.length > 0) {
    let firstProfile
    profiles.update(profiles => {
        firstProfile = profiles[0]
        setViewer(firstProfile)
        return profiles.slice(1)
    })
  } else if (profile != null) {
    if (profile?.viewer?.data?.Viewer?.id === currentProfile?.viewer?.data?.Viewer?.id && newProfile) {
      localStorage.setItem(alToken ? 'ALviewer' : 'MALviewer', JSON.stringify(profile))
    } else if (profiles.value.some(p => p.viewer?.data?.Viewer?.id === profile?.viewer?.data?.Viewer?.id && newProfile)) {
      profiles.update(profiles => profiles.map(p => p.viewer?.data?.Viewer?.id === profile?.viewer?.data?.Viewer?.id ? profile : p))
    } else {
      if (currentProfile) profiles.update(currentProfiles => [currentProfile, ...currentProfiles])
      setViewer(profile)
      profiles.update(profiles => profiles.filter(p => p.viewer?.data?.Viewer?.id !== profile.viewer?.data?.Viewer?.id))
    }
  } else {
    await cache.abandon('default')
    localStorage.removeItem(alToken ? 'ALviewer' : 'MALviewer')
    alToken = null
    malToken = null
  }
  location.reload()
}

function setViewer (profile) {
  localStorage.removeItem(alToken ? 'ALviewer' : 'MALviewer')
  if (profile?.viewer?.data?.Viewer?.avatar) {
    alToken = profile
    malToken = null
  } else {
    malToken = profile
    alToken = null
  }
  localStorage.setItem(profile.viewer?.data?.Viewer?.avatar ? 'ALviewer' : 'MALviewer', JSON.stringify(profile))
}
