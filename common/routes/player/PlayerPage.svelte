<script>
  import { settings } from '@/modules/settings.js'
  import { cache, caches, mediaCache } from '@/modules/cache.js'
  import { page, modal, playPage } from '@/modules/navigation.js'
  import { getAnimeProgress, setAnimeProgress } from '@/modules/anime/animeprogress.js'
  import { playAnime } from '@/modals/torrent/TorrentModal.svelte'
  import { anilistClient } from '@/modules/providers/anilist/anilist.js'
  import { episodesList } from '@/modules/episodes.js'
  import AnimeResolver from '@/modules/anime/animeresolver.js'
  import { durationMap, getMediaMaxEp } from '@/modules/anime/anime.js'
  import { createEventDispatcher, onMount } from 'svelte'
  import Subtitles from '@/modules/player/subtitles.js'
  import PiP from '@/modules/player/pip.js'
  import HoldSpeed from '@/modules/player/holdspeed.js'
  import Thumbnails from '@/modules/player/thumbnails.js'
  import Chapters from '@/modules/player/chapters.js'
  import Volume from '@/modules/player/volume.js'
  import { updateDiscordRPC, screenshot, trackLabel } from '@/modules/player/util.js'
  import { toTS, matchPhrase, videoRx, isValidNumber, debounce } from '@/modules/util.js'
  import { toast } from '@/modules/lib/toast.js'
  import Seekbar from '@/routes/player/components/Seekbar.svelte'
  import Stats, { stats, toggleStats } from '@/routes/player/components/Stats.svelte'
  import TorrentStats from '@/routes/player/components/TorrentStats.svelte'
  import { click } from '@/modules/lib/click.js'
  import VideoDeband from 'video-deband'
  import NestedDropdown from '@/components/overlays/NestedDropdown.svelte'
  import Helper from '@/modules/providers/helper.js'

  import { w2gEmitter, state } from '@/routes/w2g/WatchTogetherPage.svelte'
  import ManagerModal from '@/modals/manager/ManagerModal.svelte'
  import Keybinds, { loadWithDefaults, condition } from 'svelte-keybinds'
  import { SUPPORTS } from '@/modules/support.js'
  import 'rvfc-polyfill'
  import { ELECTRON, ANDROID, TORRENT } from '@/modules/bridge.js'
  import { unload } from '@/modules/torrent.js'
  import { Settings, Gauge, Timer, X, Minus, Captions, CaptionsOff, CircleHelp, Contrast, FastForward, Keyboard, EllipsisVertical, SquareArrowOutUpRight, List, Eye, FilePlus2, ListMusic, ListVideo, Maximize, Minimize, Pause, PictureInPicture, PictureInPicture2, Play, Proportions, RefreshCcw, Rewind, RotateCcw, RotateCw, ScreenShare, SkipBack, SkipForward, Volume1, Volume2, VolumeX, SlidersVertical, SquarePen, Milestone, ClockArrowDown, ClockArrowUp } from 'lucide-svelte'
  import Debug from 'debug'
  const debug = Debug('ui:player')

  const emit = createEventDispatcher()

  w2gEmitter.addEventListener('playerupdate', ({ detail }) => {
    currentTime = detail.time
    paused = detail.paused
  })
  w2gEmitter.addEventListener('setindex', ({ detail }) => {
    playFile(detail)
  })

  export function playFile (file) {
    if (isValidNumber(file)) handleCurrent(videos?.[file])
    else handleCurrent(file)
  }

  function updatew2g () {
    saveAnimeProgress()
    w2gEmitter.dispatchEvent(new CustomEvent('player', { detail: { time: Math.floor(currentTime), paused } }))
  }

  export let miniplayer = false
  $: viewAnime = $modal[modal.ANIME_DETAILS]
  $condition = () => SUPPORTS.keybinds && $page === page.PLAYER && (((!miniplayer && (!$modal || !modal.length) && !document.querySelector('.modal.show') && (!SUPPORTS.isAndroid || immersed))) || viewAnime)

  export let files = []
  export let playableFiles = []
  export let updateCurrent
  export let paused = true
  export let miniplayerShelved = false
  $: updateFiles(files)
  let src = null
  let video = null
  let container = null
  let current = null
  const errorToasts = new Set()
  let subs = null
  let chapters = null
  let duration = 0.1
  let wasPaused = null
  let videos = []
  let immersed = false
  let buffering = false
  let immerseTimeout = null
  let bufferTimeout = null
  let subHeaders = null
  let appActive = true
  let isFullscreen = false
  let ended = false
  let playbackRate = 1
  let externalPlayerReady = false
  let launchedExternal = false
  $: externalPlayback = ($settings.enableExternal || launchedExternal) && (SUPPORTS.isAndroid || $settings.playerPath)
  $: safeduration = externalPlayback ? ((current?.media?.media?.duration || (current?.media?.media?.format && durationMap[current?.media?.media?.format]) || 24) * 60) : (isFinite(duration) ? duration : currentTime)
  $: {
    if (hidden) setDiscordRPC(media, video?.currentTime)
    else setDiscordRPC(media, (paused && ($page !== page.PLAYER)))
  }
  function setDiscordRPC (np = media, browsing) {
    updateDiscordRPC(np, browsing, { hidden, safeduration, targetTime, paused, w2g: state.value?.code })
  }

  const pictureInPicture = new PiP(resetImmerse)
  const holdSpeed = new HoldSpeed(playPause)
  const thumbnails = new Thumbnails()
  const volume = new Volume()

  window.addEventListener('fileEdit', () => {
    if (current) {
      debug('Detected a user update to the parsed file(s), now updating the media...')
      const index = videos.indexOf(current)
      updateCurrent({ detail: current })
      current = videos[index]
    }
  })

  function dismissErrorToasts() {
    for (const id of errorToasts) toast.dismiss(id, { silent: true })
    errorToasts.clear()
  }

  function checkAudio () {
    volume.restore(video, media)
    if ('audioTracks' in HTMLVideoElement.prototype) {
      if (src && !video.audioTracks.length) {
        errorToasts.add(toast.error('Audio Codec Unsupported', {
          description: "This torrent's audio codec is not supported, try a different release by disabling Autoplay Torrents in RSS settings.",
          force: true
        }))
      } else if (src && video.audioTracks.length > 1) {
        const preferredTrack = [...video.audioTracks].find(({ language }) => language === $settings.audioLanguage)
        if (preferredTrack) return selectAudio(preferredTrack.id)

        const japaneseTrack = [...video.audioTracks].find(({ language }) => language === 'jpn')
        if (japaneseTrack) return selectAudio(japaneseTrack.id)
      }
    }
  }

  const updateSubs = debounce((delayChanged = false) => {
    if (!subs?.renderer) return
    subs.renderer.resize()
    if (delayChanged) subs.renderer._timeupdate({ type: 'seeking' })
  }, 200) // stupid fix (resize) because video metadata doesn't update for multiple frames
  function setLastSubtitle(label) {
    cache.setEntry(caches.HISTORY, 'lastSubtitle', { ...(cache.getEntry(caches.HISTORY, 'lastSubtitle') || {}), [media?.media?.id || media?.title || media?.parseObject?.title || media?.parseObject?.file_name]: label })
  }
  function checkSubtitle() {
    const lastSubtitle = cache.getEntry(caches.HISTORY, 'lastSubtitle')?.[`${media?.media?.id || media?.title || media?.parseObject?.title || media?.parseObject?.file_name}`]
    if (subHeaders?.length && lastSubtitle) {
      if (lastSubtitle === 'OFF') {
        subs.selectCaptions(-1)
        updateSubs()
      } else {
        for (const track of subHeaders) {
          if (!track) continue
          const trackName = trackLabel(track, subHeaders)
          if (matchPhrase(lastSubtitle, trackName, trackName?.length > 10 ? 3 : 2, true) && track?.number) {
            subs.selectCaptions(track.number)
            updateSubs()
            break
          }
        }
      }
    }
  }

  // document.fullscreenElement isn't reactive
  let orientationLockable = true // might as well stop trying to lock the orientation when the device doesn't support it.
  document.addEventListener('fullscreenchange', () => {
    isFullscreen = !!document.fullscreenElement
    if (document.fullscreenElement && orientationLockable) {
      if (SUPPORTS.isAndroid) window.AndroidFullScreen?.immersiveMode()
      screen.orientation.lock('landscape').then(success => debug(success), failure => { if (!failure?.toString()?.includes('NotSupportedError')) { debug(failure) } else { orientationLockable = false } })
    } else if (orientationLockable) {
      if (SUPPORTS.isAndroid) {
        window.AndroidFullScreen?.showSystemUI()
        ANDROID.hideStatusBar()
      }
      screen.orientation.unlock()
    }
  })

  function handleHeaders () {
    subHeaders = subs?.headers
  }

  function updateFiles (files) {
    if (files?.length) {
      videos = files.filter(file => videoRx.test(file.name))
      if (videos?.length) {
        if (subs) {
          subs.files = files || []
        }
      }
    } else {
      dismissErrorToasts()
      holdSpeed.reset()
      src = ''
      buffering = true
      current = null
      currentTime = 0
      targetTime = 0
      if (subs) {
        subs.destroy()
        subs = null
      }
      if (chapters) {
        chapters.destroy()
        chapters = null
      }
    }
  }

  /**
   * @type {VideoDeband}
   */
  let deband

  function loadDeband (load, video) {
    if (!video) return
    if (load && !deband) {
      deband = new VideoDeband(video)
      deband.canvas.classList.add('deband-canvas')
      video.before(deband.canvas)
    } else if (!load && deband) {
      deband.destroy()
      deband.canvas.remove()
      deband = null
    }
  }
  $: loadDeband($settings.playerDeband, video)

  async function handleCurrent (file) {
    dismissErrorToasts()
    holdSpeed.reset()
    paused = true
    canPlay = false
    video?.pause?.()
    externalPlayerReady = false
    showBuffering()
    if (file) {
      thumbnails.clear()
      currentTime = 0
      targetTime = 0
      skipNextProgress = false
      currentSkippable = null
      completed = false
      subDelay = 0
      subDelayText = ''
      if (subs) {
        subs.destroy()
        subs = null
      }
      if (chapters) {
        chapters.destroy()
        chapters = null
      }
      current = file
      setCurrent(file)
    }
  }

  async function setCurrent(file, launchExternal = false) {
    if ((externalPlayback || launchExternal) && document.fullscreenElement) document.exitFullscreen()
    if (!externalPlayback) {
      src = file.url
      if (!launchExternal) {
        chapters = new Chapters()
        subs = new Subtitles(video, files, current, handleHeaders)
        video.load()
        await loadAnimeProgress()
      } else video.load()
    } else externalPlaying = false
    emit('current', current) // #handleCurrent in MediaHandler
    if (externalPlayback) {
      TORRENT.onExternalReady(() => {
        hideBuffering()
        externalPlayerReady = true
        setTimeout(() => {
          if (externalPlayerReady && !externalPlaying) autoPlay()
        }, 1_500)
      })
    }
    paused = true
    if (!launchExternal) {
      currentTime = 0
      targetTime = 0
    }
    launchedExternal = launchExternal
    TORRENT.setPlayback(file, settings.value.enableExternal || launchExternal)
  }

  export let media

  $: checkAvail(media, current)
  let hasNext = false
  let hasLast = false
  function checkAvail (media, current) {
    if ((((media?.media?.nextAiringEpisode?.episode - 1 || getMediaMaxEp(media?.media)) - (media?.zeroEpisode ? 1 : 0)) > media?.episode) || ((media?.media && !media.media.nextAiringEpisode?.episode && !media.media.airingSchedule?.nodes?.[0]?.episode && !media.media.episodes))) hasNext = true
    else hasNext = videos.indexOf(current) !== videos.length - 1
    if (media?.media && (media?.episode > 1 || (media?.zeroEpisode && media?.episode === 1))) hasLast = true
    else hasLast = videos.indexOf(current) > 0
  }

  async function loadAnimeProgress () {
    let animeProgress
    if (!current?.media?.media?.id || !isValidNumber(current?.media?.episode) || current?.media?.failed || !media?.media?.id || !isValidNumber(media?.episode)) animeProgress = await getAnimeProgress({ name: current?.media?.parseObject?.anime_title ? (current?.media?.parseObject?.anime_title + ((media?.season || current?.media?.parseObject?.anime_season ? ` S${media?.season || current?.media?.parseObject?.anime_season}` : '') + ((media?.episode || current?.media?.parseObject?.episode_number ? ` E${media?.episode || current?.media?.parseObject?.episode_number}` : '')))) : current?.name })
    else animeProgress = await getAnimeProgress({ name: current?.media?.parseObject?.anime_title ? (current?.media?.parseObject?.anime_title + ((media?.season || current?.media?.parseObject?.anime_season ? ` S${media?.season || current?.media?.parseObject?.anime_season}` : '') + ((media?.episode || current?.media?.parseObject?.episode_number ? ` E${media?.episode || current?.media?.parseObject?.episode_number}` : '')))) : current?.name, mediaId: current.media.media.id, episode: current.media.episode })
    if (!animeProgress) return

    skipNextProgress = true
    const currentTime = Math.max(animeProgress.currentTime - 5, 0) // Load 5 seconds before
    seek(currentTime - video.currentTime)
  }

  let skipNextProgress = false
  function saveAnimeProgress (error = false) {
    if (!error && (buffering || video.readyState < 4)) return
    if (skipNextProgress) {
      skipNextProgress = false
      return
    }
    if (error) {
      currentTime = 0
      targetTime = 0
      video.currentTime = targetTime
    }
    if (!current?.media?.media?.id || !isValidNumber(current?.media?.episode) || current?.media?.failed || !media?.media?.id || !isValidNumber(media?.episode)) setAnimeProgress({ name: current?.media?.parseObject?.anime_title ? (current?.media?.parseObject?.anime_title + ((media?.season || current?.media?.parseObject?.anime_season ? ` S${media?.season || current?.media?.parseObject?.anime_season}` : '') + ((media?.episode || current?.media?.parseObject?.episode_number ? ` E${media?.episode || current?.media?.parseObject?.episode_number}` : '')))) : current?.name, currentTime: video.currentTime, safeduration })
    else setAnimeProgress({ mediaId: current.media.media.id, episode: current.media.episode, currentTime: video.currentTime, safeduration })
  }
  setInterval(() => {
    if (!paused) saveAnimeProgress()
  }, 10_000)

  function cycleSubtitles () {
    if (current && subs?.headers) {
      const tracks = subs.headers.filter(header => header)
      const index = tracks.indexOf(subs.headers[subs.current]) + 1
      const newIndex = index >= tracks.length ? -1 : subs.headers.indexOf(tracks[index])
      subs.selectCaptions(newIndex)
      updateSubs()
      setLastSubtitle(newIndex === -1 ? 'OFF' : trackLabel(subs.headers[newIndex], subs.headers))
    }
  }

  let subDelay = 0
  let subDelayText = ''
  let subDelayVisible = false
  let subDelayTimeout
  $: updateDelay(subDelay)
  function updateDelay(delay) {
    if (subs?.renderer) {
      subs.renderer.timeOffset = Number(delay)
      updateSubs(true)
    }
  }
  function setSubDelay(delay) {
    subDelay = delay
    subDelayText = subDelay > 0 ? `+${subDelay}s` : `${subDelay}s`;
    subDelayVisible = true;
    clearTimeout(subDelayTimeout);
    subDelayTimeout = setTimeout(() => (subDelayVisible = false), 600)
  }

  let currentTime = 0
  let targetTime = 0
  $: targetTime = (!paused && currentTime) || targetTime
  function handleMouseDown ({ detail }) {
    if (wasPaused == null) {
      wasPaused = paused
      paused = true
    }
    targetTime = detail / 100 * safeduration
  }
  function handleMouseUp () {
    paused = wasPaused
    wasPaused = null
    currentTime = targetTime
  }
  $: pagePause($page, $playPage, $modal)
  let pagePaused = 0
  function pagePause(_page, _playPage, _modal) {
    if (externalPlayback) return
    if (buffer === 0 && pagePaused) {
      pagePaused = 1
      return
    }
    const updateRequest = _modal[modal.UPDATE_PROMPT]
    const playerPage = _page === page.PLAYER || (!_playPage && updateRequest)
    const playPage = _playPage || updateRequest
    const viewDetails = Object.keys(_modal).length === 1 && _modal[modal.ANIME_DETAILS]
    const overlayCount = Object.keys(_modal).length
    if (!video?.ended) {
      if ((!playerPage || viewDetails || updateRequest) && !paused && playPage && !$pictureInPicture) {
        pagePaused = 2
        playPause()
      } else if (playerPage && paused && pagePaused === 2 && !overlayCount && playPage && !$pictureInPicture) {
        pagePaused = 1
        playPause()
      } else if (overlayCount && ((!viewDetails && !updateRequest && !playerPage) || overlayCount > 1) && !paused && !playPage && !$pictureInPicture) {
        pagePaused = 2
        playPause()
      } else if ((!overlayCount || viewDetails || updateRequest) && paused && pagePaused === 2 && !playPage && !$pictureInPicture) {
        pagePaused = 1
        playPause()
      } else if ((!playerPage || overlayCount) && paused && pagePaused && pagePaused !== 2) {
        pagePaused = 3
      }
    }
    if (!pagePaused) pagePaused = 1
  }
  async function promptFiller () {
    emit('duration', { current, duration })
    const fillerEpisode = await episodesList.getSingleEpisode(media?.media?.idMal, media?.episode)
    filler = fillerEpisode?.filler && 'Filler'
    recap = fillerEpisode?.recap && 'Recap'
    resolvePrompt = current?.failed || current?.media?.failed || current?.parseObject?.failed
    skipPrompt = filler || recap
  }
  async function autoPlay (promptSkip = false) {
    if (!promptSkip) await promptFiller()
    if ((($page === page.PLAYER && modal.length === 0) || $pictureInPicture) && !resolvePrompt && !skipPrompt) {
      if (externalPlayback) playPause()
      else if (!hidden) {
        video.play()
        resetImmerse()
        updateSubs()
      }
    } else if (!externalPlayback) video.pause()
  }

  let externalPlaying = false
  function playPause () {
    if (hidden) return
    if (externalPlayback) {
      const duration = current.media?.media?.duration || durationMap[current.media?.media?.format]
      if (duration) {
        TORRENT.onExternalWatched(watchTime => {
          const watchDuration = duration * 60
          checkCompletionByTime(watchTime, watchDuration)
          currentTime = watchTime > watchDuration ? watchDuration : watchTime
          targetTime = watchTime > watchDuration ? watchDuration : watchTime
          launchedExternal = false
        })
      }
      externalPlaying = true
      if (SUPPORTS.isAndroid) {
        TORRENT.onAndroidExternal(url => {
          const startTime = Date.now()
          const externalWatched = () => {
            const watchTime = (Date.now() - startTime) / 1_000
            const watchDuration = duration * 60
            checkCompletionByTime(watchTime, watchDuration)
            currentTime = watchTime > watchDuration ? watchDuration : watchTime
            targetTime = watchTime > watchDuration ? watchDuration : watchTime
            launchedExternal = false
          }
          ANDROID.launchExternal?.(url)?.then?.(() => externalWatched())
        })
      }
      TORRENT.launchExternal(current)
    } else paused = !paused
    resetImmerse()
    updateSubs()
  }
  let hidden = false
  let visibilityPaused = true
  const handleVisibility = visible => {
    if ($settings.playerPause && !$pictureInPicture) {
      hidden = !visible
      if (!video?.ended) {
        if (hidden) {
          holdSpeed.cancelHold()
          visibilityPaused = paused
          paused = true
        } else if (!visibilityPaused) paused = false
      }
    }
  }
  ELECTRON.isMinimized().then(isMinimized => {
    handleVisibility(!isMinimized)
    ELECTRON.onMinimize(handleVisibility)
  })
  function tryPlayNext () {
    currentSkippable = null
    if ($settings.playerAutoplay && !state.value) playNext()
  }
  function playNext () {
    if (hasNext) {
      const index = videos.indexOf(current)
      if (index + 1 < videos.length) {
        const target = (index + 1) % videos.length
        handleCurrent(videos[target])
        w2gEmitter.dispatchEvent(new CustomEvent('index', { detail: target }))
      } else if (media?.media?.nextAiringEpisode?.episode - 1 || ((media?.media?.episodes || getMediaMaxEp(media?.media)) > media?.episode)) {
        playAnime(media.media, media.episode + 1)
      }
    }
  }
  function playLast () {
    if (hasLast) {
      const index = videos.indexOf(current)
      if (index > 0) {
        handleCurrent(videos[index - 1])
        w2gEmitter.dispatchEvent(new CustomEvent('index', { detail: index - 1 }))
      } else if (media?.episode > 1 || (media?.zeroEpisode && media?.episode === 1)) {
        playAnime(media.media, media.episode - 1)
      }
    }
  }
  function handleWheel(event) {
    const onPlayerPage = $page === page.PLAYER
    const onDropdown = event.target?.closest('.dropdown') || event.target?.closest('.nd-panel') // checks for dropdowns like subtitles or audio tracks as they can be scrollable.
    const onOverflow = event.target?.closest('.overflow-auto') || event.target?.closest('.overflow-y-auto') || event.target?.closest('.overflow-y-scroll') // checks for potentially scrollable containers
    const hasFileModal = modal.exists(modal.FILE_MANAGER) || modal.exists(modal.FILE_EDITOR)
    if (onPlayerPage ? hasFileModal || onDropdown || onOverflow || (modal.length && miniplayerShelved) : !miniplayer || miniplayerShelved) return
    event.preventDefault()
    volume.handleWheel(event, video, media)
  }
  function toggleFullscreen () {
    if (!externalPlayback) document.fullscreenElement ? document.exitFullscreen() : document.querySelector('.content-wrapper').requestFullscreen()
  }
  function skip () {
    const current = chapters?.findChapter(currentTime)
    if (current) {
      if (!chapters?.isChapterSkippable(current) && ((current.end - current.start) / 1_000) > 100) {
        currentTime = currentTime + 85
      } else {
        const endtime = current.end / 1_000
        if ((safeduration - endtime | 0) === 0 && hasNext && settings.value.playerAutoplay) return playNext()
        currentTime = endtime
        currentSkippable = null
      }
    } else if (currentTime < 10) {
      currentTime = 90
    } else if (safeduration - currentTime < 90) {
      currentTime = safeduration
    } else {
      currentTime = currentTime + 85
    }
    targetTime = currentTime
    video.currentTime = targetTime
  }
  function seek (time) {
    if (externalPlayback) return
    currentTime = currentTime + time
    targetTime = currentTime
    video.currentTime = targetTime
  }
  function forward () {
    seek(settings.value.playerSeek)
  }
  function rewind () {
    seek(-settings.value.playerSeek)
  }
  function selectAudio (id) {
    if (id != null) {
      if (Array.from(video.audioTracks).find(track => track.enabled)?.id === id) return
      for (const track of video.audioTracks) track.enabled = track.id === id
      seek(-0.2) // stupid fix because video freezes up when changing tracks
    }
  }
  function selectVideo (id) {
    if (id != null) {
      if (Array.from(video.videoTracks).find(track => track.selected)?.id === id) return
      for (const track of video.videoTracks) track.selected = track.id === id
      updateSubs()
    }
  }
  let fitWidth = settings.value.playerCoverVideo ?? false
  function toggleFitWidth(value = fitWidth) {
    fitWidth = !value
    $settings.playerCoverVideo = fitWidth
    return value
  }

  function handlePlayerClick(event) {
    if (holdSpeed.consumeClick(event.currentTarget)) return
    if ($page === page.PLAYER && modal.length === 0) playPause()
    else if (!miniplayerShelved) page.navigateTo(page.PLAYER)
  }

  function handleMobilePlayerClick(event) {
    if (holdSpeed.consumeClick(event.currentTarget)) return
    toggleImmerse()
  }

  function handleMiniplayerClick(event) {
    if (holdSpeed.consumeClick(event.currentTarget)) return
    page.navigateTo(page.PLAYER)
  }

  let showKeybinds = false
  loadWithDefaults({
    KeyX: {
      fn: () => !viewAnime && screenshot(video, subs),
      id: 'screenshot_monitor',
      icon: ScreenShare,
      type: 'icon',
      desc: 'Save Screenshot to Clipboard'
    },
    KeyI: {
      fn: () => !viewAnime && toggleStats(),
      icon: List,
      id: 'list',
      type: 'icon',
      desc: 'Toggle Stats'
    },
    KeyO: {
      fn: () => { if (media?.media) modal.toggle(modal.ANIME_DETAILS, media.media) },
      icon: Eye,
      id: 'eye',
      type: 'icon',
      desc: 'Toggle Now Playing'
    },
    KeyH: {
      fn: () => {
        if (!viewAnime) {
          resolvePrompt = false
          modal.toggle(modal.FILE_MANAGER)
        }
      },
      icon: SquarePen,
      id: 'squarepen',
      type: 'icon',
      desc: 'Toggle File Manager'
    },
    Backquote: {
      fn: () => !viewAnime && (showKeybinds = !showKeybinds),
      id: 'help_outline',
      icon: CircleHelp,
      type: 'icon',
      desc: 'Toggle Keybinds'
    },
    Space: {
      fn: event => !viewAnime && holdSpeed.handleKeyDown(event),
      id: 'play_arrow',
      icon: Play,
      type: 'icon',
      desc: 'Play/Pause / Hold to Speed Up'
    },
    KeyN: {
      fn: () => !viewAnime && playNext(),
      id: 'skip_next',
      icon: SkipForward,
      type: 'icon',
      desc: 'Next Episode'
    },
    KeyB: {
      fn: () => !viewAnime && playLast(),
      id: 'skip_previous',
      icon: SkipBack,
      type: 'icon',
      desc: 'Previous Episode'
    },
    KeyA: {
      fn: () => !viewAnime && ($settings.playerDeband = !$settings.playerDeband),
      id: 'deblur',
      icon: Contrast,
      type: 'icon',
      desc: 'Toggle Video Debanding'
    },
    KeyM: {
      fn: () => !viewAnime && volume.toggleMute() && volume.showTemporarily(),
      id: 'volume_off',
      icon: VolumeX,
      type: 'icon',
      desc: 'Toggle Mute'
    },
    KeyP: {
      fn: () => !viewAnime && pictureInPicture.togglePopout(),
      id: 'picture_in_picture',
      icon: PictureInPicture2,
      type: 'icon',
      desc: 'Toggle Picture in Picture'
    },
    KeyF: {
      fn: () => !viewAnime && toggleFullscreen(),
      id: 'fullscreen',
      icon: Maximize,
      type: 'icon',
      desc: 'Toggle Fullscreen'
    },
    KeyS: {
      fn: () => !viewAnime && skip(),
      id: '+90',
      desc: 'Skip Intro/90s'
    },
    KeyW: {
      fn: () => !viewAnime && toggleFitWidth(),
      id: 'fit_width',
      icon: Proportions,
      type: 'icon',
      desc: 'Toggle Video Cover'
    },
    KeyC: {
      fn: () => !viewAnime && cycleSubtitles(),
      id: 'subtitles',
      icon: Captions,
      type: 'icon',
      desc: 'Cycle Subtitles'
    },
    KeyV: {
      fn: () => !viewAnime && volume.toggleGain(video, media) && volume.showTemporarily(),
      id: 'toggle_gain',
      icon: SlidersVertical,
      type: 'icon',
      desc: 'Toggle Volume Limit Increase'
    },
    ArrowLeft: {
      fn: e => {
        if (viewAnime) return
        e.stopImmediatePropagation()
        e.preventDefault()
        rewind()
      },
      id: 'fast_rewind',
      icon: Rewind,
      type: 'icon',
      desc: 'Rewind'
    },
    ArrowRight: {
      fn: e => {
        if (viewAnime) return
        e.stopImmediatePropagation()
        e.preventDefault()
        forward()
      },
      id: 'fast_forward',
      icon: FastForward,
      type: 'icon',
      desc: 'Seek'
    },
    ArrowUp: {
      fn: e => {
        if (viewAnime) return
        e.stopImmediatePropagation()
        e.preventDefault()
        volume.adjust(0.05, media)
      },
      id: 'volume_up',
      icon: Volume2,
      type: 'icon',
      desc: 'Volume Up'
    },
    ArrowDown: {
      fn: e => {
        if (viewAnime) return
        e.stopImmediatePropagation()
        e.preventDefault()
        volume.adjust(-0.05, media)
      },
      id: 'volume_down',
      icon: Volume1,
      type: 'icon',
      desc: 'Volume Down'
    },
    BracketLeft: {
      fn: () => !viewAnime && !externalPlayback && (playbackRate = (video.defaultPlaybackRate = Math.max(0.1, Number((video.defaultPlaybackRate - 0.1).toFixed(1))))),
      id: 'history',
      icon: RotateCcw,
      type: 'icon',
      desc: 'Decrease Playback Rate'
    },
    BracketRight: {
      fn: () => !viewAnime && !externalPlayback && (playbackRate = (video.defaultPlaybackRate = Math.min(16, Number((video.defaultPlaybackRate + 0.1).toFixed(1))))),
      id: 'update',
      icon: RotateCw,
      type: 'icon',
      desc: 'Increase Playback Rate'
    },
    Backslash: {
      fn: () => !viewAnime && !externalPlayback && (playbackRate = (video.defaultPlaybackRate = 1)),
      icon: RefreshCcw,
      id: 'schedule',
      type: 'icon',
      desc: 'Reset Playback Rate'
    },
    Comma: {
      fn: (e) => !viewAnime && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA' && setSubDelay(Number((Number(subDelay) + (e.shiftKey ? -1.0 : -0.1)).toFixed(1))),
      id: 'sub_delay_decrease',
      icon: ClockArrowDown,
      type: 'icon',
      desc: 'Subtitle Delay -0.1s / -1.0s'
    },
    Period: {
      fn: (e) => !viewAnime && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA' && setSubDelay(Number((Number(subDelay) + (e.shiftKey ? 1.0 : 0.1)).toFixed(1))),
      id: 'sub_delay_increase',
      icon: ClockArrowUp,
      type: 'icon',
      desc: 'Subtitle Delay +0.1s / +1.0s'
    }
  })

  function immersePlayer () {
    if ((safeduration - currentTime) !== 0) {
      immersed = true
      immerseTimeout = undefined
    }
  }

  let immerseToken = 0
  function resetImmerse() {
    clearTimeout(immerseTimeout)
    const token = ++immerseToken
    const wasImmersed = immersed
    setTimeout(() => {
      if (token !== immerseToken || wasImmersed !== immersed) return
      immersed = false
      if (!paused || miniplayer) {
        immerseTimeout = setTimeout(() => {
          if (token === immerseToken) immersePlayer()
        }, (paused ? 5 : 1.5) * 1_000)
      }
    })
  }

  function toggleImmerse () {
    if (immersed) resetImmerse()
    else {
      clearTimeout(immerseTimeout)
      immersed = !immersed
    }
  }

  let canPlay = !!src
  function hideBuffering () {
    canPlay = !!src
    if (bufferTimeout) {
      clearTimeout(bufferTimeout)
      bufferTimeout = null
    }
    buffering = false
  }

  function showBuffering (skipCheck = false) {
    if (bufferTimeout) clearTimeout(bufferTimeout)
    bufferTimeout = setTimeout(() => {
      if (((skipCheck || video?.readyState < 3) && !externalPlayback) || (externalPlayback && !externalPlayerReady)) {
        buffering = true
        resetImmerse()
      }
    }, 150)
  }
  $: navigator.mediaSession?.setPositionState({
    duration: Math.max(0, safeduration || 0),
    playbackRate: 1,
    position: Math.max(0, Math.min(safeduration || 0, currentTime || 0))
  })
  $: updateAndroidMediaSession(media, !!src && !externalPlayback && (((!$playPage || $page === page.PLAYER) && appActive) || $pictureInPicture), paused, safeduration, playbackRate, hasLast, hasNext)

  function updateAndroidMediaSession(np = media, active = !!src && !externalPlayback && (((!$playPage || $page === page.PLAYER) && appActive) || $pictureInPicture), isPaused = paused, mediaDuration = safeduration, rate = playbackRate, last = hasLast, next = hasNext) {
    ANDROID.setMediaSession?.({
      active,
      playing: active && !isPaused,
      title: np?.title || 'Shiru',
      subtitle: np?.media?.format === 'MOVIE' && (np.media?.episodes ?? 0) <= 1 ? 'The Movie' : [np?.episode === 0 || np?.episode ? `Episode ${np.episode}${np.media?.episodes ? ` of ${np.media.episodes}` : ''}` : '', np?.episodeTitle].filter(Boolean).join(' - ') || 'Streaming the Universe',
      artwork: np?.artwork || np?.thumbnail || '',
      position: currentTime,
      duration: mediaDuration,
      playbackRate: rate || 1,
      hasLast: last,
      hasNext: next
    })
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', playPause)
    navigator.mediaSession.setActionHandler('pause', playPause)
    navigator.mediaSession.setActionHandler('nexttrack', playNext)
    navigator.mediaSession.setActionHandler('previoustrack', playLast)
    navigator.mediaSession.setActionHandler('seekforward', forward)
    navigator.mediaSession.setActionHandler('seekbackward', rewind)
  }
  let filler = null
  let recap = null
  let skipPrompt = false
  function skipResponse (skip) {
    skipPrompt = false
    if (skip) playNext()
    else autoPlay(true)
  }
  let resolvePrompt = false
  function resolveResponse (resolve) {
    resolvePrompt = false
    if (resolve) modal.open(modal.FILE_MANAGER)
    else autoPlay(true)
  }
  let buffer = 0
  TORRENT.onProgress(progress => {
    buffer = progress * 100
  })

  let currentSkippable = null
  function checkSkippableChapters () {
    const current = chapters?.findChapter(currentTime)
    currentSkippable = current ? chapters?.isChapterSkippable(current) : null
    if (currentSkippable && $settings.playerAutoSkip) skip()
  }

  let completed = false
  function checkCompletion () {
    if (!completed && $settings.playerAutocomplete) {
      checkCompletionByTime(currentTime, safeduration)
    }
  }

  function checkCompletionByTime (currentTime, safeduration) {
    let threshold = $settings.playerAutocompleteThreshold / 100
    if (externalPlayerReady && threshold > 0.7) threshold = 0.7 // accommodates skipping op/ed in external player.
    if (safeduration && currentTime && (video?.readyState || externalPlayerReady) && (currentTime >= safeduration * threshold) && (media?.media?.episodes || (media?.media?.nextAiringEpisode?.episode >= (media.episodeRange?.last || media.episode)))) {
      debug(`Marking current episode as completed as it has met the ${$settings.playerAutocompleteThreshold}% threshold.`)
      completed = true
      externalPlayerReady = false
      const _media = media.episodeRange ? structuredClone(media) : media
      if (media.episodeRange) _media.episode = media.episodeRange.last
      Helper.updateEntry(_media)
      if (externalPlayback) tryPlayNext()
    }
  }
  function checkError ({ target }) {
    // nothing is playing... skip showing a toast.
    if (!current || !src) {
      debug('Ignoring video error after playback was cleared.', target.error)
      return
    }
    // video playback failed - show a message saying why
    let toastId
    switch (target.error?.code) {
      case target.error.MEDIA_ERR_ABORTED:
        debug('You aborted the video playback.')
        break
      case target.error.MEDIA_ERR_NETWORK:
        debug('A network error caused the video download to fail part-way.', target.error)
        saveAnimeProgress(true)
        toastId = toast.error('Video Network Error', {
          description: 'A network error caused the video download to fail part-way. Dismiss this toast to reload the video.',
          duration: Infinity,
          force: true,
          onDismiss: () => {
            errorToasts.delete(toastId)
            target.load()
          }
        })
        break
      case target.error.MEDIA_ERR_DECODE:
        debug('The video playback was aborted due to a corruption problem or because the video used features your browser did not support.', target.error)
        saveAnimeProgress(true)
        toastId = toast.error('Video Decode Error', {
          description: 'The video playback was aborted due to a corruption problem. Dismiss this toast to reload the video.',
          duration: Infinity,
          force: true,
          onDismiss: () => {
            errorToasts.delete(toastId)
            target.load()
          }
        })
        break
      case target.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
        if (target.error.message !== 'MEDIA_ELEMENT_ERROR: Empty src attribute') {
          debug('The video could not be loaded, either because the server or network failed or because the format is not supported.', target.error)
          saveAnimeProgress(true)
          errorToasts.add(toast.error('Video Codec Unsupported', {
            description: 'The video could not be loaded, either because the server or network failed or because the format is not supported. Try a different release by disabling Autoplay Torrents in RSS settings.',
            duration: 30_000,
            force: true
          }))
        }
        break
      default:
        debug('An unknown video playback error occurred.')
        break
    }
    if (toastId) errorToasts.add(toastId)
  }

  function handleSeekbarKey (e) {
    if (e.key === 'ArrowLeft') {
      e.stopPropagation()
      e.stopImmediatePropagation()
      e.preventDefault()
      rewind()
    } else if (e.key === 'ArrowRight') {
      e.stopPropagation()
      e.stopImmediatePropagation()
      e.preventDefault()
      forward()
    } else if (e.key === 'ArrowDown') {
      e.stopPropagation()
      e.stopImmediatePropagation()
      e.preventDefault()
      document.querySelector('[data-name=\'toggleFullscreen\']')?.focus()
    }
  }

  let fileInput
  function handleFile(event) {
    const file = event.target.files[0]
    if (!file) return
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer }))
  }

  onMount(() => {
    let destroyed = false
    let mediaActionListener
    let appStateListener
    ANDROID.onAppStateChange?.(isActive => (appActive = isActive))?.then?.(listener => {
      if (destroyed) listener?.remove()
      else appStateListener = listener
    })
    ANDROID.onMediaAction?.((action, position) => {
      if (!src || externalPlayback) return
      if (action === 'last') playLast()
      else if (action === 'next') playNext()
      else if (action === 'seek' && isValidNumber(position)) {
        currentTime = Math.max(0, Math.min(safeduration || position, position))
        targetTime = currentTime
        video.currentTime = targetTime
        updateAndroidMediaSession()
      }
      else if ((action === 'play' && paused) || (action === 'pause' && !paused)) playPause()
    })?.then?.(listener => {
      if (destroyed) listener?.remove()
      else mediaActionListener = listener
    })
    return () => {
      destroyed = true
      appStateListener?.remove()
      mediaActionListener?.remove()
      ANDROID.setMediaSession?.({ active: false })
    }
  })
</script>

<div
  class='player w-full h-full d-flex flex-column overflow-hidden position-relative'
  class:ratio-16-9={!canPlay || !src || externalPlayback}
  class:pointer={miniplayer}
  class:rounded-top-10={miniplayer}
  class:miniplayer
  class:pip={$pictureInPicture && !SUPPORTS.isAndroid}
  class:immersed={immersed}
  class:buffering={($page === page.PLAYER || miniplayer) && buffering}
  class:fitWidth
  bind:this={container}
  role='none'
  on:mousemove={resetImmerse}
  on:touchmove={resetImmerse}
  on:keypress={resetImmerse}
  on:keydown={resetImmerse}
  on:mouseleave={immersePlayer}
  on:wheel={handleWheel}>
  {#if showKeybinds && !miniplayer}
    <div class='position-absolute bg-tp w-full h-full z-10 font-size-12 p-20 d-flex align-items-center justify-content-center' on:pointerup|self={() => (showKeybinds = false)} tabindex='-1' role='button'>
      <Keybinds let:prop={item} autosave={true} clickable={true}>
        {#if item?.type}
          <div class='bind icon' title={item?.desc} style='pointer-events: all !important;'>
            {#if item?.icon}
              <svelte:component this={item.icon} size='2rem' />
            {/if}
          </div>
        {:else}
          <div class='bind font-weight-normal' title={item?.desc} style='pointer-events: all !important;'>{item?.id || ''}</div>
        {/if}
      </Keybinds>
    </div>
  {/if}
  <video
    crossorigin='anonymous'
    class='position-absolute h-full w-full'
    preload='auto'
    {src}
    bind:this={video}
    use:pictureInPicture={{ subs, deband, container, paused }}
    use:holdSpeed={{ src, externalPlayback, miniplayer }}
    use:thumbnails={{ current, safeduration, externalPlayback, buffer }}
    bind:volume={$volume.level}
    bind:duration
    bind:currentTime
    bind:paused
    bind:ended
    bind:muted={$volume.muted}
    bind:playbackRate
    on:error={checkError}
    on:pause={updatew2g}
    on:pause={holdSpeed.stopHold}
    on:play={updatew2g}
    on:seeked={updatew2g}
    on:seeked={() => updateAndroidMediaSession()}
    on:timeupdate={() => thumbnails.capture()}
    on:timeupdate={checkCompletion}
    on:timeupdate={checkSkippableChapters}
    on:waiting={showBuffering}
    on:loadeddata={hideBuffering}
    on:pause={() => { immersed = false }}
    on:canplay={hideBuffering}
    on:playing={hideBuffering}
    on:loadedmetadata={hideBuffering}
    on:ended={holdSpeed.stopHold}
    on:ended={tryPlayNext}
    on:loadedmetadata={thumbnails.start}
    on:loadedmetadata={() => chapters?.load(current, safeduration)}
    on:loadedmetadata={() => autoPlay()}
    on:loadedmetadata={checkAudio}
    on:loadedmetadata={checkSubtitle}
    on:loadedmetadata={loadAnimeProgress}
  ><track kind='captions' src='' srclang='en' label='English'/></video>
  <div class='buffering-position position-absolute top-0 left-0 w-full h-full d-none align-items-center justify-content-center pointer-events-none z-10' class:d-flex={SUPPORTS.isAndroid && $pictureInPicture}>
    <div class='bufferingDisplay'/>
  </div>
  <Stats {video} {paused} {miniplayer} {current} {playableFiles} {playFile} />
  <ManagerModal playing={current} files={playableFiles} {playFile} />
  <div class='top z-40 row d-title' class:justify-content-center={!$settings.playerTitleTop} class:align-items-center={!$settings.playerTitleTop}>
    {#if $settings.playerTitleTop && (!SUPPORTS.isAndroid || !$pictureInPicture)}
      <div class='stats pl-20 col-4 d-title'>
        <div class='font-weight-bold overflow-hidden text-truncate font-scale-23'>
          {#if media?.title}
            {media?.title}
          {:else if media?.media?.title} <!-- useful when a torrent is EXTREMELY slow at loading... -->
            {anilistClient.title(media?.media)}
          {:else if current}
            {AnimeResolver.cleanFileName(current?.name)}
          {/if}
        </div>
        <div class='font-weight-normal overflow-hidden text-truncate text-muted font-scale-16'>
          {#if (media?.episode === 0 || media?.episode) && media?.media?.episodes !== 1 && media?.media?.format !== 'MOVIE' && (!media?.episodeTitle || !new RegExp(`(?<![\\d.])${media.episode}(?![\\d.])`).test(media.episodeTitle))}
            {@const maxEpisodes = getMediaMaxEp(media.media) - (media.zeroEpisode ? 1 : 0)}
            Episode {media.episodeRange ? `${media.episodeRange.first} ~ ${media.episodeRange.last}` : media.episode}
            {#if maxEpisodes && (Number(maxEpisodes) > 1)} of {maxEpisodes}{:else if !maxEpisodes && videos && (videos.length > 1)} of {videos.length}{/if} <!-- for when the media fails to resolve, we can predict that the file length is likely the episode count. -->
          {:else if current && (videos?.length > 1)}
            Episode {videos.indexOf(current) + 1} of {videos.length} <!-- fallback for when the media fails to resolve and we also fail to resolve the episode numbers, best to indicate what file we are currently on. -->
          {/if}
          {#if (media?.episode === 0 || media?.episode) && media?.media?.format !== 'MOVIE' && (media?.episodeTitle && !new RegExp(`(?<![\\d.])${media.episode}(?![\\d.])`).test(media.episodeTitle) && media?.media?.episodes !== 1)} - {/if}
          {#if media?.episodeTitle}{media.episodeTitle}{/if}
        </div>
      </div>
    {/if}
    <div class='d-flex justify-content-center bottom-0 d-title d-filler' class:col-4={$settings.playerTitleTop}>
      <TorrentStats visible={!SUPPORTS.isAndroid || !$pictureInPicture} />
      {#if resolvePrompt}
        <div class='position-absolute text-monospace rounded skipPrompt d-flex flex-column align-items-center text-center bg-dark-light p-20 z-50 mt-60' class:w-500={SUPPORTS.isAndroid}>
          <div class='skipFont'>
            Failed to <b>identify</b> the media from the file name, would you like to fix it?
          </div>
          <div class='d-flex justify-content-center mt-20'>
            <button class='btn btn-primary mx-2 mr-20 d-flex align-items-center justify-content-center' type='button' use:click={() => resolveResponse(true)}>
              <span>Yes</span>
            </button>
            <button class='btn btn-secondary mx-2 ml-20 d-flex align-items-center justify-content-center' type='button' use:click={() => resolveResponse(false)}>
              <span>No</span>
            </button>
          </div>
        </div>
      {:else if skipPrompt}
        <div class='position-absolute text-monospace rounded skipPrompt d-flex flex-column align-items-center text-center bg-dark-light p-20 z-50 mt-60' class:w-500={SUPPORTS.isAndroid}>
          <div class='skipFont'>
            This episode has been marked as a <b>{filler || recap}</b>, do you want to skip?
          </div>
          <div class='d-flex justify-content-center mt-20'>
            <button class='btn btn-primary mx-2 mr-20 d-flex align-items-center justify-content-center' type='button' use:click={() => skipResponse(true)}>
              <span>Yes</span>
            </button>
            <button class='btn btn-secondary mx-2 ml-20 d-flex align-items-center justify-content-center' type='button' use:click={() => skipResponse(false)}>
              <span>No</span>
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
  <div class='middle d-flex align-items-center justify-content-center flex-grow-1 position-relative'>
    <div aria-hidden='true' class='w-full h-full position-absolute toggle-fullscreen' on:dblclick={toggleFullscreen} use:holdSpeed on:click|self={handlePlayerClick} />
    <div aria-hidden='true' class='w-full h-full position-absolute toggle-immerse d-none' on:dblclick={toggleFullscreen} use:holdSpeed on:click|self={handleMobilePlayerClick} />
    <div aria-hidden='true' class='w-full h-full position-absolute mobile-focus-target d-none' use:holdSpeed on:click|self={handleMiniplayerClick} />
    <span aria-hidden='true' class='icon ctrl align-items-center justify-content-end w-150 mw-full mr-auto' class:hidden={externalPlayback || (SUPPORTS.isAndroid && $pictureInPicture)} class:mb-50={!miniplayer} on:click={rewind}><Rewind size='3rem' /></span>
    <!-- miniplayer buttons -->
    {#if miniplayer && !miniplayerShelved}
      <span class='position-absolute rounded-10 top-0 right-0 m-10 btn-shadow button' class:ctrl={!SUPPORTS.isAndroid} class:mr-40={!SUPPORTS.isAndroid} class:mr-50={SUPPORTS.isAndroid} title='Minimize' data-name='playPause' use:click={() => (playPage.set(!playPage.value))}>
        <Minus size='1.9rem' strokeWidth='3'/>
      </span>
      <span class='position-absolute rounded-10 top-0 right-0 m-10 btn-shadow button' class:ctrl={!SUPPORTS.isAndroid} title='Exit' data-name='playPause' use:click={() => { unload(null, null, true); if ($page === page.PLAYER) page.navigateTo(page.HOME)}}>
        <X size='1.9rem' strokeWidth='3'/>
      </span>
    {/if}
    {#if !miniplayer || !miniplayerShelved}
      <div class='d-flex align-items-center position-relative' class:mb-50={!miniplayer} style='width: 100%;' title='Play/Pause'>
        <div class='position-absolute bufferingDisplay' style='left: 50%; margin-left: -2.5rem;' class:d-none={SUPPORTS.isAndroid && $pictureInPicture}/>
        <span class='icon ctrl position-absolute rounded-10 text-white' style={externalPlayback ? `left: 5%` : `left: 15%`} title='{hasLast ? `Last` : `No Previous Episode`}' data-name='playPause' disabled={!hasLast} class:not-allowed={!hasLast} class:text-very-muted={!hasLast} class:hidden={SUPPORTS.isAndroid && $pictureInPicture} use:click={playLast}>
          <SkipBack size='3rem' fill='currentColor' />
        </span>
        <span class='icon ctrl position-absolute rounded-10 text-white' data-name='playPause' style='left: 50%; margin-left: -3rem;' class:hidden={SUPPORTS.isAndroid && $pictureInPicture} use:click={playPause}>
          {#if ended}
            <RotateCw size='3rem' />
          {:else}
            {#if paused}
              <Play size='3rem' fill='currentColor' />
            {:else}
              <Pause size='3rem' fill='currentColor' />
            {/if}
          {/if}
        </span>
        <span class='ui-volume position-absolute z-10 font-weight-bold font-scale-40 rounded-10 pointer-events-none bg-blur py-6px opacity-90 opacity-ts-3' style='left: 50%; margin-left: -3rem;' class:transparent={!$volume.visible} class:text-white={$volume.boosted || !$volume.boostCount} class:boosting={!$volume.boosted && $volume.boostCount} class:muted={$volume.level === 0}>{$volume.text}</span>
        {#if subDelayText}
          <span class='position-absolute z-10 font-weight-bold font-scale-40 text-white rounded-10 pointer-events-none bg-blur py-6px opacity-90 opacity-ts-3' style='left: 50%; margin-left: -3rem;' class:transparent={!subDelayVisible}>{subDelayText}</span>
        {/if}
        <span class='playback-rate-display position-absolute z-10 font-weight-bold font-scale-40 text-white rounded-10 pointer-events-none bg-blur py-6px opacity-90 opacity-ts-3' style='left: 50%; margin-left: -3rem;' class:transparent={!$holdSpeed}>{$holdSpeed}</span>
        <span class='icon ctrl position-absolute rounded-10 text-white' style={externalPlayback ? `right: 5%` : `right: 15%`} title='{hasNext ? `Next` : `No Next Episode`}' data-name='playPause' disabled={!hasNext} class:not-allowed={!hasNext} class:text-very-muted={!hasNext} class:hidden={SUPPORTS.isAndroid && $pictureInPicture} use:click={playNext}>
            <SkipForward size='3rem' fill='currentColor' />
          </span>
      </div>
      <span aria-hidden='true' class='icon ctrl align-items-center w-150 mw-full ml-auto' class:hidden={externalPlayback || (SUPPORTS.isAndroid && $pictureInPicture)} class:mb-50={!miniplayer} on:click={forward}><FastForward size='3rem' /></span>
      {#if currentSkippable}
        <button type='button' class='skip btn text-dark position-absolute bottom-0 right-0 mr-20 mb-5 font-weight-bold z-30 d-flex align-items-center justify-content-center' class:hidden={SUPPORTS.isAndroid && $pictureInPicture} use:click={skip}>
          <FastForward size='1.8rem' fill='currentColor' /><span class='ml-5'>Skip {currentSkippable}</span>
        </button>
      {/if}
    {/if}
  </div>
  <div class='bottom d-flex z-40 flex-column px-20' class:hidden={SUPPORTS.isAndroid && $pictureInPicture}>
    {#if !$settings.playerTitleTop}
      <div class='stats pl-5 d-title'>
        <div class='font-weight-bold overflow-hidden text-truncate font-scale-23'>
          {#if media?.title}
            {media?.title}
          {:else if media?.media?.title} <!-- useful when a torrent is EXTREMELY slow at loading... -->
            {anilistClient.title(media?.media)}
          {:else if current}
            {AnimeResolver.cleanFileName(current?.name)}
          {/if}
        </div>
        <div class='font-weight-normal overflow-hidden text-truncate text-muted font-scale-16'>
          {#if (media?.episode === 0 || media?.episode) && media?.media?.episodes !== 1 && media?.media?.format !== 'MOVIE' && (!media?.episodeTitle || !new RegExp(`(?<![\\d.])${media.episode}(?![\\d.])`).test(media.episodeTitle))}
            {@const maxEpisodes = getMediaMaxEp(media.media) - (media.zeroEpisode ? 1 : 0)}
            Episode {media.episodeRange ? `${media.episodeRange.first} ~ ${media.episodeRange.last}` : media.episode}
            {#if maxEpisodes && (Number(maxEpisodes) > 1)} of {maxEpisodes}{:else if !maxEpisodes && videos && (videos.length > 1)} of {videos.length}{/if} <!-- for when the media fails to resolve, we can predict that the file length is likely the episode count. -->
          {:else if current && (videos?.length > 1)}
            Episode {videos.indexOf(current) + 1} of {videos.length} <!-- fallback for when the media fails to resolve and we also fail to resolve the episode numbers, best to indicate what file we are currently on. -->
          {/if}
          {#if (media?.episode === 0 || media?.episode) && media?.media?.format !== 'MOVIE' && (media?.episodeTitle && !new RegExp(`(?<![\\d.])${media.episode}(?![\\d.])`).test(media.episodeTitle) && media?.media?.episodes !== 1)} - {/if}
          {#if media?.episodeTitle}{media.episodeTitle}{/if}
        </div>
      </div>
    {/if}
    <div class='w-full d-flex align-items-center h-20 mb-5 seekbar' tabindex='0' role='button' on:keydown={handleSeekbarKey}>
      <Seekbar
        accentColor='{completed || (media?.media && ((($mediaCache[media.media.id] || media.media)?.mediaListEntry?.progress - (media?.zeroEpisode ? 1 : 0)) >= (media.episodeRange ? media.episodeRange.last : media.episode))) ? `var(--completed-color-dim)` : `var(--accent-color)`}'
        class='font-size-20'
        length={safeduration}
        {buffer}
        progress={currentTime / safeduration * 100}
        on:seeking={handleMouseDown}
        on:seeked={handleMouseUp}
        chapters={chapters?.sanitise($chapters, safeduration) || []}
        getThumbnail={thumbnails.get}
      />
    </div>
    <div class='d-flex'>
      <span class='icon ctrl m-5 text-white' title='Play/Pause [Space]' data-name='playPause' use:click={playPause}>
        {#if ended}
          <RotateCw size='2rem' />
        {:else}
          {#if paused}
            <Play size='2rem' fill='currentColor' />
          {:else}
            <Pause size='2rem' fill='currentColor' />
          {/if}
        {/if}
      </span>
      <button type='button' class='icon ctrl m-5 d-btn text-white bg-transparent border-0 no-scale' title='{hasLast ? `Last [B]` : `No Previous Episode`}' disabled={!hasLast} class:not-allowed={!hasLast} class:text-very-muted={!hasLast} use:click={playLast}>
        <SkipBack size='2rem' fill='currentColor' />
      </button>
      <button type='button' class='icon ctrl m-5 d-btn text-white bg-transparent border-0 no-scale' title='{hasNext ? `Next [N]` : `No Next Episode`}' disabled={!hasNext} class:not-allowed={!hasNext} class:text-very-muted={!hasNext} use:click={playNext}>
        <SkipForward size='2rem' fill='currentColor' />
      </button>
      <div class='d-none w-auto volume' class:d-flex={!externalPlayback}>
        <span class='icon ctrl m-5 text-white' title='Mute [M]' data-name='toggleMute' use:click={() => volume.toggleMute()}>
          {#if $volume.muted}
            <VolumeX size='2rem' fill='currentColor' />
          {:else}
            <Volume2 size='2rem' fill='currentColor' />
          {/if}
        </span>
        {#if !$volume.boosted}
          <input class='ctrl h-full custom-range' tabindex='-1' type='range' min='0' max='1' step='any' data-name='setVolume' bind:value={$volume.level} />
        {:else}
          <input class='ctrl h-full custom-range' class:boost-color={$volume.gain > 1} tabindex='-1' type='range' min='0' max='3' step='any' data-name='setVolume' bind:value={$volume.gain} on:input={event => volume.setGain(event, media)}/>
        {/if}
        {#if ($volume.level === 1) || $volume.boosted}
          <span class='icon ctrl boost p-0 mt-15 d-flex align-items-center justify-content-center text-white' class:boost-color={$volume.boosted} title='Increase Volume Limit [V]' data-name='toggleGain' use:click={() => volume.toggleGain(video, media)}>
            <SlidersVertical size='1.4rem' fill='currentColor' />
          </span>
        {/if}
      </div>
      <div class='ts font-scale-20' class:mr-auto={playbackRate === 1}>{toTS(targetTime, safeduration > 3600 ? 2 : 3)} / {toTS(safeduration - targetTime, safeduration > 3600 ? 2 : 3)}</div>
      {#if playbackRate !== 1}
        <div class='ts mr-auto font-scale-20'>{playbackRate.toFixed(1)}x</div>
      {/if}
      <input type='file' class='d-none' id='search-subtitle' accept='.srt,.vtt,.ass,.ssa,.sub,.txt' on:input|preventDefault|stopPropagation={handleFile} bind:this={fileInput}/>
      <NestedDropdown direction='top' panelHeightPadding={6} panelColor='var(--dark-color-glass)' containerEl={container} items={[
          ...(!externalPlayback ? [{
            icon: Gauge,
            label: 'Playback speed',
            value: playbackRate === 1 ? 'Normal' : `${playbackRate.toFixed(1)}x`,
            children: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8].map(rate => ({
              label: rate === 1 ? 'Normal' : `${rate}x`,
              value: playbackRate === rate ? '✓' : undefined,
              valueCSS: 'text-primary font-size-18 font-weight-very-bold',
              onSelect: () => (playbackRate = (video.defaultPlaybackRate = rate))
            }))
          }] : []),
          ...(!externalPlayback ? [{
            icon: Milestone,
            label: 'Chapter Source',
            value: $settings.playerChapterSkip === 'embedded' ? 'Embedded' : 'Aniskip',
            children: [
              {
                label: 'Embedded',
                value: $settings.playerChapterSkip === 'embedded' ? '✓' : undefined,
                valueCSS: 'text-primary font-size-18 font-weight-very-bold',
                onSelect: () => { $settings.playerChapterSkip = 'embedded'; chapters?.useEmbedded(); }
              },
              {
                label: 'Aniskip',
                value: $settings.playerChapterSkip === 'aniskip' ? '✓' : undefined,
                valueCSS: 'text-primary font-size-18 font-weight-very-bold',
                onSelect: () => { $settings.playerChapterSkip = 'aniskip'; chapters?.load(current, safeduration); }
              }
            ]
          }] : []),
          ...(!externalPlayback ? [{
            icon: Proportions,
            label: 'Video Fit',
            value: fitWidth ? 'Fill' : 'Best fit',
            children: [
              {
                label: 'Fill',
                value: fitWidth ? '✓' : undefined,
                valueCSS: 'text-primary font-size-18 font-weight-very-bold',
                onSelect: () => { toggleFitWidth(false) }
              },
              {
                label: 'Best fit',
                value: !fitWidth ? '✓' : undefined,
                valueCSS: 'text-primary font-size-18 font-weight-very-bold',
                onSelect: () => { toggleFitWidth(true) }
              }
            ]
          }] : []),
          ...(!externalPlayback ? [{
            icon: FilePlus2,
            label: 'Add Subtitles',
            close: true,
            onSelect: () => fileInput.click()
          }] : []),
          ...(!externalPlayback ? [{
            icon: ScreenShare,
            label: 'Screenshot',
            onSelect: () => screenshot(video, subs)
          }] : []),
          {
            icon: SquarePen,
            label: 'File Manager',
            close: true,
            onSelect: () => { resolvePrompt = false; modal.toggle(modal.FILE_MANAGER) }
          },
          ...((!externalPlayback || launchedExternal) && (SUPPORTS.isAndroid || $settings.playerPath) ? [{
            icon: SquareArrowOutUpRight,
            label: 'External Player',
            close: true,
            onSelect: () => setCurrent(current, true)
          }] : []),
          ...(!externalPlayback ? [{
            icon: Contrast,
            label: 'Video Debanding',
            value: $settings.playerDeband ? 'On' : 'Off',
            onSelect: () => { $settings.playerDeband = !$settings.playerDeband }
          }] : []),
          {
            icon: List,
            label: 'Stats',
            value: $stats ? 'On' : 'Off',
            onSelect: () => toggleStats()
          }
        ]}>
        <span class='icon text-white ctrl d-flex align-items-center h-full' title='More'>
          <EllipsisVertical size='2.5rem' strokeWidth={2.5} />
        </span>
      </NestedDropdown>
      <span class='icon text-white ctrl d-flex align-items-center keybinds' title='Keybinds [`]' use:click={() => (showKeybinds = true)}>
        <Keyboard size='2.5rem' strokeWidth={2.5} />
      </span>
      {#if $playPage && media?.media}
        <span class='icon text-white ctrl d-flex align-items-center' title='Now Playing [O]' use:click={() => modal.toggle(modal.ANIME_DETAILS, media.media)}>
          <Eye size='2.5rem' strokeWidth={2.5} />
        </span>
      {/if}
      {#if 'audioTracks' in HTMLVideoElement.prototype && video?.audioTracks?.length > 1 && !externalPlayback}
        <NestedDropdown title='Audio Tracks' direction='top' panelWidth={25} panelHeightPadding={6} panelColor='var(--dark-color-glass)' containerEl={container} items={Object.values(video.audioTracks).map((track, _, allTracks) => ({
          label: trackLabel(track, allTracks, 'label'),
          value: track.enabled ? '✓' : undefined,
          valueCSS: 'text-primary font-size-18 font-weight-very-bold',
          onSelect: () => selectAudio(track.id)
        }))}>
          <span class='icon text-white ctrl d-flex align-items-center h-full' title='Audio Tracks'>
            <ListMusic size='2.5rem' strokeWidth={2.5} />
          </span>
        </NestedDropdown>
      {/if}
      {#if 'videoTracks' in HTMLVideoElement.prototype && video?.videoTracks?.length > 1 && !externalPlayback}
        <NestedDropdown title='Video Tracks' direction='top' panelWidth={25} panelHeightPadding={6} panelColor='var(--dark-color-glass)' containerEl={container} items={Object.values(video.videoTracks).map((track, _, allTracks) => ({
          label: trackLabel(track, allTracks, 'label'),
          value: track.selected ? '✓' : undefined,
          valueCSS: 'text-primary font-size-18 font-weight-very-bold',
          onSelect: () => selectVideo(track.id)
        }))}>
          <span class='icon text-white ctrl d-flex align-items-center h-full' title='Video Tracks'>
            <ListVideo size='2.5rem' strokeWidth={2.5} />
          </span>
        </NestedDropdown>
      {/if}
      {#if subHeaders?.length && !externalPlayback}
        <NestedDropdown title='Subtitles/CC' direction='top' panelWidth={25} panelHeightPadding={3} panelColor='var(--dark-color-glass)' containerEl={container} items={[
            {
              icon: Settings,
              label: 'Options',
              children: [
                {
                  type: 'input',
                  icon: Timer,
                  label: 'Offset',
                  inputmode: 'numeric',
                  pattern: '-?[0-9]*.?[0-9]*',
                  step: '0.1',
                  min: -9999,
                  max: 9999,
                  value: subDelay,
                  onInput: (/** @type {number} */ value) => (subDelay = value)
                },
                {
                  icon: FilePlus2,
                  label: 'Add Subtitles',
                  close: true,
                  onSelect: () => fileInput.click()
                }
              ]
            },
            {
              label: 'Off',
              icon: CaptionsOff,
              value: subHeaders && subs?.current === -1 ? '✓' : undefined,
              valueCSS: 'text-primary font-size-18 font-weight-very-bold',
              onSelect: () => {
                subs.selectCaptions(-1)
                updateSubs()
                setLastSubtitle('OFF')
              }
            },
            { type: 'separator' },
            ...subHeaders.map(track => {
              if (!track) return null
              const label = trackLabel(track, subHeaders)
              return {
                label,
                value: track.number === subs.current ? '✓' : undefined,
                valueCSS: 'text-primary font-size-18 font-weight-very-bold',
                onSelect: () => {
                  subs.selectCaptions(track.number)
                  updateSubs()
                  setLastSubtitle(label)
                }
              }
            }).filter(Boolean)
          ]}>
          <span class='icon text-white ctrl d-flex align-items-center h-full' title='Subtitles [C]'>
            <Captions size='2.5rem' strokeWidth={2.5} />
          </span>
        </NestedDropdown>
      {/if}
      {#if 'pictureInPictureEnabled' in document}
        <span class='icon text-white ctrl d-none align-items-center' class:d-flex={!externalPlayback} title='Popout Window [P]' data-name='togglePopout' use:click={pictureInPicture.togglePopout}>
          {#if $pictureInPicture}
            <PictureInPicture size='2.5rem' strokeWidth={2.5} />
          {:else}
            <PictureInPicture2 size='2.5rem' strokeWidth={2.5} />
          {/if}
        </span>
      {/if}
      <span class='icon text-white ctrl d-none align-items-center' class:d-flex={!externalPlayback} title='Fullscreen [F]' data-name='toggleFullscreen' use:click={toggleFullscreen}>
        {#if isFullscreen}
          <Minimize size='2.5rem' strokeWidth={2.5} />
        {:else}
          <Maximize size='2.5rem' strokeWidth={2.5} />
        {/if}
      </span>
    </div>
  </div>
</div>

<style>
  :global(.deband-canvas) {
    max-width: 100%;
    max-height: 100%;
    width: 100% !important;
    height: 100% !important;
    top: 50%;
    left: 50%;
    position: absolute;
    transform: translate(-50%, -50%);
    pointer-events: none;
    object-fit: contain;
  }
  :global(.deband-canvas) ~ video {
    opacity: 0;
  }
  .fitWidth video, .fitWidth :global(.deband-canvas) {
    object-fit: cover !important;
  }
  .custom-range {
    color: var(--accent-color);
    --thumb-height: 0px;
    --track-height: 3px;
    --track-color: hsla(var(--white-color-hsl), 0.2);
    --brightness-hover: 120%;
    --brightness-down: 80%;
    --clip-edges: 2px;
    --target-height: max(var(--track-height), var(--thumb-height));
    position: relative;
    background: hsla(var(--white-color-hsl), 0);
    overflow: hidden;
    transition: all ease 100ms;
    appearance: none;
  }
  .custom-range:hover {
    --thumb-height: 12px;
  }

  .custom-range:active {
    cursor: grabbing;
  }
  .custom-range::-webkit-slider-runnable-track {
    height: var(--target-height);
    position: relative;
        background: linear-gradient(var(--track-color) 0 0) scroll no-repeat center /
      100% calc(var(--track-height));
  }

  .custom-range::-webkit-slider-thumb {
    position: relative;
    height: var(--thumb-height);
    width: var(--thumb-width, var(--thumb-height));
    -webkit-appearance: none;
    --thumb-radius: calc((var(--target-height) * 0.5) - 1px);
    --clip-top: calc((var(--target-height) - var(--track-height)) * 0.5);
    --clip-bottom: calc(var(--target-height) - var(--clip-top));
    --clip-further: calc(100% + 1px);
    --box-fill: calc(-100vmax - var(--thumb-width, var(--thumb-height))) 0 0
      100vmax currentColor;

    background: linear-gradient(currentColor 0 0) scroll no-repeat left center /
      50% calc(var(--track-height) + 1px);
    background-color: currentColor;
    box-shadow: var(--box-fill);
    border-radius: var(--thumb-width, var(--thumb-height));

    filter: brightness(100%);
    clip-path: polygon(
      100% -1px,
      var(--clip-edges) -1px,
      0 var(--clip-top),
      -100vmax var(--clip-top),
      -100vmax var(--clip-bottom),
      0 var(--clip-bottom),
      var(--clip-edges) 100%,
      var(--clip-further) var(--clip-further)
    );
  }

  .custom-range:hover::-webkit-slider-thumb {
    filter: brightness(var(--brightness-hover));
    cursor: grab;
  }

  .custom-range:active::-webkit-slider-thumb {
    filter: brightness(var(--brightness-down));
    cursor: grabbing;
  }

  .custom-range:focus {
    outline: none;
  }

  .bind {
    font-size: 1.8rem;
    font-weight: bold;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
  }
  .stats {
    font-size: 2.3rem;
    padding-top: 1.5rem;
    white-space: nowrap;
    font-weight: 600;
    font-family: Roboto, Arial, Helvetica, sans-serif;
  }
  .skipPrompt {
    margin-top: 10rem;
    font-family: Roboto, Arial, Helvetica, sans-serif;
  }
  .skipFont {
    font-size: 1.8rem !important;
  }
  .miniplayer {
    height: auto !important;
    cursor: pointer !important;
  }
  .miniplayer .top,
  .miniplayer .bottom, .miniplayer .skip {
    display: none !important;
  }
  .miniplayer video {
    position: relative !important;
  }
  .bg-tp {
    background: hsla(var(--black-color-hsl), 0.73);
    backdrop-filter: blur(10px);
  }

  video {
    transition: margin-top 0.2s ease;
  }
  .player {
    user-select: none;
    font-family: Roboto, Arial, Helvetica, sans-serif;
    background: var(--black-color);
  }

  .pip :global(canvas:not(.w-full)) {
    width: 1px !important;
    height: 1px !important;
  }

  .icon {
    font-size: 2.8rem;
    padding: 1.5rem;
    display: flex;
  }

  .immersed {
    cursor: none;
  }

  .immersed .middle .ctrl,
  .immersed .top,
  .immersed .bottom, .immersed .skip {
    pointer-events: none;
    opacity: 0;
  }
  .pip video {
    opacity: 0.1%;
  }

  .bufferingDisplay {
    border: 4px solid hsla(var(--white-color-hsl), 0);
    border-top: 4px solid var(--white-color);
    border-radius: 50%;
    width: 40px;
    height: 40px;
    animation: spin 1s linear infinite;
    will-change: transform;
    opacity: 0;
    visibility: hidden;
    transition: 0.2s opacity ease 0s;
    filter: drop-shadow(0 0 8px var(--black-color));
  }

  .buffering .bufferingDisplay {
    opacity: 1 !important;
    visibility: visible !important;
  }
  .pip .bufferingDisplay {
    display: none;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }

    100% {
      transform: rotate(360deg);
    }
  }

  .middle .ctrl {
    font-size: 4rem;
    z-index: 3;
    display: none;
  }
  :fullscreen {
    background: var(--black-color) !important;
  }

  @media (pointer: none), (pointer: coarse) {
    .middle .ctrl {
      display: flex;
    }
  }
  .miniplayer .middle {
    transition: background 0.2s ease;
    position: absolute !important;
    width: 100%;
    height: 100%;
  }
  .miniplayer .middle .ctrl[data-name='playPause'] {
    display: flex;
    font-size: 2.8rem;
  }
  .miniplayer .middle .ctrl[data-name='playPause'] {
    font-size: 5.625rem;
  }
  .miniplayer:hover .middle {
    background: hsla(var(--black-color-hsl), 0.4);
  }
  .middle .ctrl[data-name='playPause'] {
    font-size: 6.75rem;
  }

  .middle .ctrl,
  .bottom .ctrl:hover,
  .bottom .ts:hover,
  .bottom .hover .ts {
    filter: drop-shadow(0 0 8px var(--black-color));
  }
  .skip {
    transition: 0.2s opacity ease 0s;
    background: hsla(var(--white-color-hsl), 0.92);
  }
  .skip:hover {
    background-color: var(--lm-button-bg-color-hover);
  }

  .bottom {
    background: linear-gradient(to top, hsla(var(--black-color-hsl), 0.8), hsla(var(--black-color-hsl), 0.6) 25%, hsla(var(--black-color-hsl), 0.4) 50%, hsla(var(--black-color-hsl), 0.1) 75%, transparent);
    transition: 0.2s opacity ease 0s;
  }
  .top {
    background: linear-gradient(to bottom, hsla(var(--black-color-hsl), 0.8), hsla(var(--black-color-hsl), 0.4) 25%, hsla(var(--black-color-hsl), 0.2) 50%, hsla(var(--black-color-hsl), 0.1) 75%, transparent);
    transition: 0.2s opacity ease 0s;
  }
  .mr-50 {
    margin-right: 5rem !important;
  }
  .mb-50 {
    margin-bottom: 5rem !important;
  }

  .ctrl {
    cursor: pointer;
  }

  .boost-color {
    color: var(--octonary-color) !important;
  }

  .bottom .volume:hover .boost,
  .bottom .volume:focus-within .boost{
    width: 3rem;
    height: 3rem;
  }

  .bottom .volume .boost {
    width: 0;
    height: 0;
    transition: width 0.1s ease, height 0.1s ease;
  }

  .bottom .volume:hover .custom-range,
  .bottom .volume:focus-within .custom-range {
    width: 5vw;
    display: inline-block;
    margin-right: 1.125rem;
  }

  .bottom .volume .custom-range {
    width: 0;
    transition: width 0.1s ease;
    height: 100%;
  }

  .h-20 {
    height: 2rem;
  }
  .rounded-10 {
    border-radius: 1rem;
  }

  @keyframes boostPulse {
    0%, 100% { color: var(--white-color); }
    50% { color: var(--octonary-color); }
  }
  .ui-volume.muted, .ui-volume.boosting {
    transition: opacity .3s ease-in-out, color .7s ease-in-out !important;
  }
  .ui-volume.boosting {
    animation: boostPulse 1.5s ease-in-out infinite !important;
  }
  .ui-volume.muted {
    color: var(--paused-color) !important;
  }

  .btn-shadow {
    filter: drop-shadow(0rem 0rem 0.5rem hsla(var(--black-color-hsl), 0.9));
  }

  .bottom .ts {
    color: hsla(var(--white-color-hsl), 0.92);
    white-space: nowrap;
    align-self: center;
    line-height: var(--base-line-height);
    padding: 0 1.56rem;
    font-weight: 600;
  }

  .seekbar {
    font-size: 2rem !important;
  }
  .miniplayer .mobile-focus-target {
    display: block !important;
  }
  .miniplayer .mobile-focus-target:focus-visible {
    background: hsla(209, 100%, 55%, 0.3);
  }

  @media (max-width: 30rem) {
    .d-btn {
      display: none !important;
    }
  }

  @media (max-width: 60rem) {
    .d-title {
      display: block !important;
      max-width: none !important;
      grid-row: unset !important;
      grid-column: unset !important;
    }
    .d-filler {
      display: flex !important;
    }
    .mt-60 {
      margin-top: 6rem !important;
    }
  }

  @media (pointer: none), (pointer: coarse) {
    .bottom .ctrl[data-name='playPause'],
    .bottom .volume,
    .bottom .keybinds {
      display: none !important;
    }
    @media (orientation: portrait) {
      .top  {
        padding-top: var(--safe-area-top) !important;
      }
    }
    .middle .ctrl {
      display: flex !important;
    }
    .miniplayer .middle .ctrl {
      display: none !important;
    }
    .toggle-immerse {
      display: block !important;
    }
    .toggle-fullscreen {
      display: none !important;
    }
  }
</style>
