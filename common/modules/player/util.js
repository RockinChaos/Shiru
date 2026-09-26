import { ELECTRON } from '@/modules/bridge.js'
import { toast } from '@/modules/lib/toast.js'

export function languageName(code) {
  if (!code) return null
  const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })
  try {
    return displayNames.of(code.toLowerCase()) ?? null
  } catch {
    return null
  }
}

export function trackLabel(track, allTracks, nameKey = 'name') {
  const validTracks = allTracks.filter(Boolean)
  const trackPosition = validTracks.indexOf(track) + 1
  const trackName = track?.[nameKey]
  const languageLabel = languageName(track?.language)
  return !languageLabel ? `Track ${trackPosition}` + (trackName ? ` (${trackName})` : '')
    : trackName ? `${languageLabel} (${trackName})`
    : allTracks.filter(other => !other?.[nameKey] && languageName(other?.language) === languageLabel).length > 1 ? `${languageLabel} (Track ${trackPosition})`
    : languageLabel
}

export async function screenshot (video, subs) {
  if ('clipboard' in navigator && video.readyState) {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const renderer = subs?.renderer
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    context.drawImage(video, 0, 0)
    if (renderer) {
      const subtitleCanvas = renderer._canvas
      const top = Number.parseFloat(subtitleCanvas.style.top) || 0
      const left = Number.parseFloat(subtitleCanvas.style.left) || 0
      const overlay = document.createElement('canvas')
      overlay.width = subtitleCanvas.width
      overlay.height = subtitleCanvas.height
      overlay.getContext('2d').drawImage(subtitleCanvas, 0, 0)
      overlay.className = subtitleCanvas.className
      overlay.style.cssText = subtitleCanvas.style.cssText
      subtitleCanvas.parentElement.append(overlay)
      try {
        renderer.resize(video.videoWidth, video.videoHeight, top, left)
        await new Promise(resolve => setTimeout(resolve, 200))
        context.drawImage(subtitleCanvas, 0, 0, canvas.width, canvas.height)
      } finally {
        renderer.resize(0, 0, 0, 0)
        await new Promise(resolve => setTimeout(resolve, 200))
        overlay.remove()
      }
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve))
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ])
    canvas.remove()
    toast.success('Screenshot', {
      description: 'Saved screenshot to clipboard.'
    })
  }
}

export function updateDiscordRPC(np, browsing, { hidden, safeduration, targetTime, paused, w2g }) {
  if ((!np || Object.keys(np).length === 0) && !browsing) return
  if (hidden) {
    ELECTRON.clearPresence()
    return
  }
  let activity
  if (!browsing) {
    const details = np.title || undefined
    const timeLeft = safeduration - targetTime
    const timestamps = !paused ? {
      start: Date.now() - (targetTime > 0 ? targetTime * 1_000 : 0),
      end: Date.now() + timeLeft * 1_000
    } : undefined
     activity = {
      details,
      state: (details && (np.media?.format === 'MOVIE' && (np.media?.episodes ?? 0) <= 1 ? 'The Movie' : (np.episode ? 'Episode: ' + np.episode + (np.media?.episodes ? ' of ' + np.media.episodes : '') : 'Streaming the Universe'))),
      timestamps,
      party: {
        size: (np.episode && np.media?.episodes && [np.episode, np.media.episodes]) || undefined
      },
      assets: {
        large_text: np.title,
        large_image: np.thumbnail,
        small_image: !paused ? 'playing' : 'paused',
        small_text: !paused ? 'Playing' : 'Paused'
      },
      instance: true,
      type: 3
    }
    // cannot have buttons and secrets at once
    if (w2g) {
      activity.secrets = {
        join: w2g,
        match: w2g + 'm'
      }
      activity.party.id = w2g + 'p'
    } else {
      activity.buttons = [
        {
          label: 'Watch on Shiru',
          url: `shiru://anime/${np.media?.id}`
        },
        {
          label: 'Download Shiru',
          url: 'https://latest.shiru.app/'
        }
      ]
    }
  } else {
    activity = {
      timestamps: { start: Date.now() },
      details: 'Streaming anime instantly',
      state: 'Exploring the anime library...',
      assets: {
        large_image: 'icon',
        large_text: 'https://shiru.app/',
        small_image: 'searching',
        small_text: 'Browsing anime on Shiru',
      },
      buttons: [
        {
          label: 'Download Shiru',
          url: 'https://latest.shiru.app/'
        }
      ],
      instance: true,
      type: 3
    }
  }
  ELECTRON.setPresence({ activity })
}
