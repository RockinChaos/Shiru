<script>
  import { settings } from '@/modules/settings.js'
  import { cache, caches } from '@/modules/cache.js'
  import { getAnimeProgress, setAnimeProgress } from '@/modules/anime/animeprogress.js'
  import { playAnime } from '@/views/TorrentSearch/TorrentModal.svelte'
  import { anilistClient } from '@/modules/anilist.js'
  import { episodesList } from '@/modules/episodes.js'
  import AnimeResolver from '@/modules/anime/animeresolver.js'
  import { durationMap, getMediaMaxEp } from '@/modules/anime/anime.js'
  import { writable } from 'simple-store-svelte'
  import { getContext, createEventDispatcher } from 'svelte'
  import Subtitles from '@/modules/subtitles.js'
  import { toTS, fastPrettyBytes, matchPhrase, videoRx, isValidNumber } from '@/modules/util.js'
  import { toast } from 'svelte-sonner'
  import { getChaptersAniSkip } from '@/modules/anime/anime.js'
  import { mediaCache } from '@/modules/cache.js'
  import Seekbar from 'perfect-seekbar'
  import { click } from '@/modules/click.js'
  import VideoDeband from 'video-deband'
  import Helper from '@/modules/helper.js'

  import { w2gEmitter, state } from '@/views/WatchTogether/WatchTogether.svelte'
  import FileManager, { managerView } from '@/views/Player/FileManager/FileManager.svelte'
  import Keybinds, { loadWithDefaults, condition } from 'svelte-keybinds'
  import { SUPPORTS } from '@/modules/support.js'
  import 'rvfc-polyfill'
  import { IPC, ELECTRON, ANDROID } from '@/modules/bridge.js'
  import WPC from '@/modules/wpc.js'
  import { X, Minus, ArrowDown, ArrowUp, Captions, CircleHelp, Contrast, FastForward, Keyboard, EllipsisVertical, SquareArrowOutUpRight, List, Eye, FilePlus2, ListMusic, ListVideo, Maximize, Minimize, Pause, PictureInPicture, PictureInPicture2, Play, Proportions, RefreshCcw, Rewind, RotateCcw, RotateCw, ScreenShare, SkipBack, SkipForward, Users, Volume1, Volume2, VolumeX, SlidersVertical, SquarePen, Milestone } from 'lucide-svelte'
  import Debug from 'debug'
  const debug = Debug('ui:player')

  const view = getContext('view')
  const emit = createEventDispatcher()

  w2gEmitter.on('playerupdate', detail => {
    currentTime = detail.time
    paused = detail.paused
  })
  w2gEmitter.on('setindex', detail => {
    playFile(detail)
  })

  export function playFile (file) {
    if (isValidNumber(file)) handleCurrent(videos?.[file])
    else handleCurrent(file)
  }

  function updatew2g () {
    saveAnimeProgress()
    w2gEmitter.emit('player', { time: Math.floor(currentTime), paused })
  }

  export let page
  export let overlay
  export let playPage
  export let miniplayer = false
  $: viewAnime = overlay.includes('viewanime')
  $condition = () => SUPPORTS.keybinds && page === 'player' && ((!miniplayer && !overlay.length && !document.querySelector('.modal.show')) || viewAnime)

  export let files = []
  export let playableFiles = []
  export let updateCurrent
  $: updateFiles(files)
  let src = null
  let video = null
  let container = null
  let current = null
  let subs = null
  let duration = 0.1
  let paused = true
  let muted = false
  let wasPaused = null
  let videos = []
  let immersed = false
  let buffering = false
  let immerseTimeout = null
  let bufferTimeout = null
  let subHeaders = null
  let pip = false
  // const presentationRequest = null
  // const presentationConnection = null
  // const canCast = false
  let isFullscreen = false
  let ended = false
  let gain = 0
  let volume = Number(cache.getEntry(caches.GENERAL, 'volume')) || 1
  let volumeBoosted = false
  let audioCtx = null
  let source = null
  let gainNode = null
  let playbackRate = 1
  let externalPlayerReady = false
  $: cache.setEntry(caches.GENERAL, 'volume', String(volume || 0))
  $: launchedExternal = false
  $: externalPlayback = ($settings.enableExternal || launchedExternal) && (SUPPORTS.isAndroid || $settings.playerPath)
  $: safeduration = externalPlayback ? ((current?.media?.media?.duration || (current?.media?.media?.format && durationMap[current?.media?.media?.format]) || 24) * 60) : (isFinite(duration) ? duration : currentTime)
  $: {
    if (hidden) setDiscordRPC(media, video?.currentTime)
    else setDiscordRPC(media, (paused && (page !== 'player')))
  }

  window.addEventListener('fileEdit', () => {
    if (current) {
      debug('Detected a user update to the parsed file(s), now updating the media...')
      const index = videos.indexOf(current)
      updateCurrent({ detail: current })
      current = videos[index]
    }
  })

  function setupAudio() {
    if (!audioCtx) {
      audioCtx = new AudioContext()
      source = audioCtx.createMediaElementSource(video)
      gainNode = audioCtx.createGain()
      source.connect(gainNode)
      gainNode.connect(audioCtx.destination)
    }
  }

  function checkAudio () {
    volumeBoosted = cache.getEntry(caches.HISTORY, 'lastBoosted')?.[`${media?.media?.id || media?.title || media?.parseObject?.title || media?.parseObject?.file_name}`]?.boosted || false
    if (volumeBoosted) {
      setupAudio()
      gain = cache.getEntry(caches.HISTORY, 'lastBoosted')?.[`${media?.media?.id || media?.title || media?.parseObject?.title || media?.parseObject?.file_name}`]?.gain || 0
      gainNode.gain.value = gain
    } else {
      if (gainNode?.gain) gainNode.gain.value = volume
      gain = 0
    }
    if ('audioTracks' in HTMLVideoElement.prototype) {
      if (!video.audioTracks.length) {
        toast.error('Audio Codec Unsupported', {
          description: "This torrent's audio codec is not supported, try a different release by disabling Autoplay Torrents in RSS settings."
        })
      } else if (video.audioTracks.length > 1) {
        const preferredTrack = [...video.audioTracks].find(({ language }) => language === $settings.audioLanguage)
        if (preferredTrack) return selectAudio(preferredTrack.id)

        const japaneseTrack = [...video.audioTracks].find(({ language }) => language === 'jpn')
        if (japaneseTrack) return selectAudio(japaneseTrack.id)
      }
    }
  }

  function checkSubtitle () {
    const lastSubtitle = cache.getEntry(caches.HISTORY, 'lastSubtitle')?.[`${media?.media?.id || media?.title || media?.parseObject?.title || media?.parseObject?.file_name}`]
    if (subHeaders?.length && lastSubtitle) {
      if (lastSubtitle === 'OFF') {
        subs.selectCaptions(-1)
        setTimeout(() => subs?.renderer?.resize(), 200) // stupid fix (resize) because video metadata doesn't update for multiple frames
      } else {
        for (const track of subHeaders) {
          const trackName = (track?.language || (!Object.values(subs?.headers).some(header => header?.language === 'eng' || header?.language === 'en') ? 'eng' : track?.type)) + (track?.name ? ' - ' + track?.name : '')
          if (matchPhrase(lastSubtitle, trackName, trackName?.length > 10 ? 3 : 2, true) && track?.number) {
            subs.selectCaptions(track.number)
            setTimeout(() => subs?.renderer?.resize(), 200) // stupid fix (resize) because video metadata doesn't update for multiple frames
            break
          }
        }
      }
    }
  }

  // if ('PresentationRequest' in window) {
  //   const handleAvailability = aval => {
  //     canCast = !!aval
  //   }
  //   presentationRequest = new PresentationRequest(['build/cast.html'])
  //   presentationRequest.addEventListener('connectionavailable', e => initCast(e))
  //   navigator.presentation.defaultRequest = presentationRequest
  //   presentationRequest.getAvailability().then(aval => {
  //     aval.onchange = e => handleAvailability(e.target.value)
  //     handleAvailability(aval.value)
  //   })
  // }

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
        window.Capacitor.Plugins.StatusBar.setOverlaysWebView({overlay: true})
        window.Capacitor.Plugins.StatusBar.hide()
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
      src = ''
      buffering = true
      current = null
      currentTime = 0
      targetTime = 0
      if (subs) {
        subs.destroy()
        subs = null
      }
    }
  }

  let loadInterval

  function clearLoadInterval () {
    clearInterval(loadInterval)
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

  let externalReadyListener
  async function handleCurrent (file) {
    paused = true
    canPlay = false
    video?.pause?.()
    externalPlayerReady = false
    showBuffering()
    if (file) {
      if (thumbnailData.video?.src) URL.revokeObjectURL(video?.src)
      Object.assign(thumbnailData, {
        thumbnails: [],
        interval: undefined,
        video: undefined
      })
      currentTime = 0
      targetTime = 0
      chapters = []
      embeddedChapters = []
      currentSkippable = null
      completed = false
      if (subs) {
        subs.destroy()
        subs = null
      }
      current = file
      setCurrent(file)
    }
  }

  async function setCurrent(file, launchExternal = false) {
    if (!externalPlayback) {
      src = file.url
      subs = new Subtitles(video, files, current, handleHeaders)
      video.load()
      await loadAnimeProgress()
    } else externalPlaying = false
    emit('current', current) // #handleCurrent in MediaHandler
    if (externalPlayback) {
      WPC.clear('externalReady', externalReadyListener)
      externalReadyListener = () => {
        hideBuffering()
        externalPlayerReady = true
        setTimeout(() => {
          if (externalPlayerReady && !externalPlaying) autoPlay()
        }, 1_500)
      }
      WPC.listen('externalReady', externalReadyListener)
    }
    launchedExternal = launchExternal
    WPC.send('current', { current: file, external: settings.value.enableExternal || launchExternal })
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

    const currentTime = Math.max(animeProgress.currentTime - 5, 0) // Load 5 seconds before
    seek(currentTime - video.currentTime)
  }

  function saveAnimeProgress (error = false) {
    if (!error && (buffering || video.readyState < 4)) return
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
      subs.selectCaptions(index >= tracks.length ? -1 : subs.headers.indexOf(tracks[index]))
      setTimeout(() => subs?.renderer?.resize(), 200) // stupid fix because video metadata doesn't update for multiple frames
    }
  }

  let subDelay = 0
  $: updateDelay(subDelay)
  function updateDelay (delay) {
    if (subs?.renderer) subs.renderer.timeOffset = Number(delay)
  }

  let currentTime = 0
  $: progress = currentTime / safeduration * 100
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
  $: pagePause(page, playPage, overlay)
  let pagePaused = 0
  function pagePause(page, _playPage, overlay) {
    if (externalPlayback) return
    if (buffer === 0 && pagePaused) {
      pagePaused = 1
      return
    }
    const updateRequest = overlay.includes('updateRequest')
    const playerPage = page === 'player' || (!_playPage && updateRequest)
    const playPage = _playPage || updateRequest
    const viewDetails = overlay.length === 1 && overlay.includes('viewanime')
    const overlayCount = overlay.length
    if (!video?.ended) {
      if ((!playerPage || viewDetails || updateRequest) && !paused && playPage && !pip) {
        pagePaused = 2
        playPause()
      } else if (playerPage && paused && pagePaused === 2 && !overlayCount && playPage && !pip) {
        pagePaused = 1
        playPause()
      } else if (overlayCount && ((!viewDetails && !updateRequest && !playerPage) || overlayCount > 1) && !paused && !playPage && !pip) {
        pagePaused = 2
        playPause()
      } else if ((!overlayCount || viewDetails || updateRequest) && paused && pagePaused === 2 && !playPage && !pip) {
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
  async function autoPlay () {
    await promptFiller()
    if ((((page === 'player') && (!overlay || overlay.length === 0)) || pip) && !resolvePrompt && !skipPrompt) {
      if (externalPlayback) playPause()
      else if (!hidden) {
        video.play()
        resetImmerse()
        setTimeout(() => subs?.renderer?.resize(), 200) // stupid fix because video metadata doesn't update for multiple frames
      }
    } else if (!externalPlayback) video.pause()
  }

  let watchedListener
  let androidListener
  let externalPlaying = false
  function playPause () {
    if (hidden) return
    if (externalPlayback) {
      const duration = current.media?.media?.duration || durationMap[current.media?.media?.format]
      if (duration) {
        WPC.clear('externalWatched', watchedListener)
        watchedListener = (detail) => {
          checkCompletionByTime(detail, duration * 60)
          currentTime = detail
          targetTime = detail
          launchedExternal = false
        }
        WPC.listen('externalWatched', watchedListener)
      }
      externalPlaying = true
      if (SUPPORTS.isAndroid) {
        WPC.clear('androidExternal', androidListener)
        androidListener = (url) => {
          const startTime = Date.now()
          const externalWatched = () => {
            const watchTime = (Date.now() - startTime) / 1_000
            checkCompletionByTime(watchTime, duration * 60)
            currentTime = watchTime
            targetTime = watchTime
            launchedExternal = false
          }
          ANDROID.launchExternal?.(url)?.then?.(() => externalWatched())
        }
        WPC.listen('androidExternal', androidListener)
      }
      WPC.send('externalPlay', { current })
    } else paused = !paused
    resetImmerse()
    setTimeout(() => subs?.renderer?.resize(), 200) // stupid fix because video metadata doesn't update for multiple frames
  }
  let hidden = false
  let visibilityPaused = true
  const handleVisibility = visible => {
    if ($settings.playerPause && !pip) {
      hidden = !visible
      if (!video?.ended) {
        if (hidden) {
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
        w2gEmitter.emit('index', { index: target })
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
        w2gEmitter.emit('index', { index: index - 1 })
      } else if (media?.episode > 1 || (media?.zeroEpisode && media?.episode === 1)) {
        playAnime(media.media, media.episode - 1)
      }
    }
  }
  function setGain(event) {
    let value = parseFloat(event.target.value)
    if (value <= 1) {
      gainNode.gain.value = 1
      volume = value
    } else {
      volume = 1
      gainNode.gain.value = value
    }
    gain = value
    cache.setEntry(caches.HISTORY, 'lastBoosted', { ...(cache.getEntry(caches.HISTORY, 'lastBoosted') || {}), [media?.media?.id || media?.title || media?.parseObject?.title || media?.parseObject?.file_name]: { boosted: volumeBoosted, gain } })
  }
  function toggleGain () {
    setupAudio()
    if (volumeBoosted) {
      volume = gain <= 1 ? gain : 1
      gain = 1
      if (audioCtx) gainNode.gain.value = 1
    } else setGain({ target: { value: volume } })
    volumeBoosted = !volumeBoosted
    cache.setEntry(caches.HISTORY, 'lastBoosted', { ...(cache.getEntry(caches.HISTORY, 'lastBoosted') || {}), [media?.media?.id || media?.title || media?.parseObject?.title || media?.parseObject?.file_name]: { boosted: volumeBoosted, gain } })
  }
  function toggleMute () {
    muted = !muted
  }
  function toggleFullscreen () {
    if (!externalPlayback) document.fullscreenElement ? document.exitFullscreen() : document.querySelector('.content-wrapper').requestFullscreen()
  }
  function skip () {
    const current = findChapter(currentTime)
    if (current) {
      if (!isChapterSkippable(current) && ((current.end - current.start) / 1_000) > 100) {
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
      for (const track of video.audioTracks) {
        track.enabled = track.id === id
      }
      seek(-0.2) // stupid fix because video freezes up when changing tracks
    }
  }
  function selectVideo (id) {
    if (id != null) {
      for (const track of video.videoTracks) {
        track.selected = track.id === id
      }
      setTimeout(() => subs?.renderer?.resize(), 200) // stupid fix because video metadata doesn't update for multiple frames
    }
  }
  // function toggleCast () {
  //   if (video.readyState) {
  //     if (presentationConnection) {
  //       presentationConnection?.terminate()
  //     } else {
  //       presentationRequest.start()
  //     }
  //   }
  // }
  async function screenshot () {
    if ('clipboard' in navigator && video.readyState) {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      context.drawImage(video, 0, 0)
      if (subs?.renderer) {
        subs.renderer.resize(video.videoWidth, video.videoHeight)
        await new Promise(resolve => setTimeout(resolve, 500)) // this is hacky, but TLDR wait for canvas to update and re-render, in practice this will take at MOST 100ms, but just to be safe
        context.drawImage(subs.renderer._canvas, 0, 0, canvas.width, canvas.height)
        subs.renderer.resize(0, 0, 0, 0) // undo resize
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
  function updatePiPState (paused) {
    const element = /** @type {HTMLVideoElement | undefined} */ (document.pictureInPictureElement)
    if (!element || element.id) return
    if (paused) element.pause()
    else element.play()
  }
  $: updatePiPState(paused)
  function togglePopout () {
    if (video.readyState) {
      if (!subs?.renderer) {
        if (video !== document.pictureInPictureElement) {
          video.requestPictureInPicture()
          resetImmerse()
          pip = true
        } else {
          document.exitPictureInPicture()
          pip = false
        }
      } else {
        if (document.pictureInPictureElement && !document.pictureInPictureElement.id) {
          // only exit if pip is the custom one, else overwrite existing pip with custom
          document.exitPictureInPicture()
          pip = false
        } else {
          const canvasVideo = document.createElement('video')
          const { stream, destroy } = getBurnIn()
          const cleanup = () => {
            pip = false
            destroy()
            canvasVideo.remove()
          }
          pip = true
          resetImmerse()
          canvasVideo.srcObject = stream
          canvasVideo.onloadedmetadata = () => {
            canvasVideo.play()
            if (pip) {
              if (paused) canvasVideo.pause()
              canvasVideo.requestPictureInPicture().then(pipwindow => {
                pipwindow.onresize = () => {
                  const { width, height } = pipwindow
                  if (isNaN(width) || isNaN(height)) return
                  if (!isFinite(width) || !isFinite(height)) return
                  subs.renderer.resize(width, height)
                }
              }).catch(e => {
                cleanup()
                debug('Failed To Burn In Subtitles ' + e)
              })
            } else {
              cleanup()
            }
          }
          canvasVideo.onleavepictureinpicture = cleanup
        }
      }
    }
  }
  let fitWidth = false
  let showKeybinds = false
  loadWithDefaults({
    KeyX: {
      fn: () => !viewAnime && screenshot(),
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
      fn: () => ($view = $view ? null : media?.media),
      icon: Eye,
      id: 'eye',
      type: 'icon',
      desc: 'Toggle Now Playing'
    },
    KeyH: {
      fn: () => {
        if (!viewAnime) {
          resolvePrompt = false
          $managerView = !$managerView
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
      fn: () => !viewAnime && playPause(),
      id: 'play_arrow',
      play: Play,
      type: 'icon',
      desc: 'Play/Pause'
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
      fn: () => !viewAnime && (muted = !muted),
      id: 'volume_off',
      icon: VolumeX,
      type: 'icon',
      desc: 'Toggle Mute'
    },
    KeyP: {
      fn: () => !viewAnime && togglePopout(),
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
      fn: () => !viewAnime && (fitWidth = !fitWidth),
      id: 'fit_width',
      icon: Proportions,
      type: 'icon',
      desc: 'Toggle Video Cover'
    },
    // KeyD: {
    //   fn: () => !viewAnime && toggleCast(),
    //   id: 'cast',
    //   icon: Cast,
    //   type: 'icon',
    //   desc: 'Toggle Cast [broken]'
    // },
    KeyC: {
      fn: () => !viewAnime && cycleSubtitles(),
      id: 'subtitles',
      icon: Captions,
      type: 'icon',
      desc: 'Cycle Subtitles'
    },
    KeyV: {
      fn: () => !viewAnime && toggleGain(),
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
        if (volumeBoosted) setGain({ target: { value: Math.min(3, gain + 0.05) } })
        else volume = Math.min(1, volume + 0.05)
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
        if (volumeBoosted) setGain({ target: { value: Math.max(0, gain - 0.05) } })
        else volume = Math.max(0, volume - 0.05)
      },
      id: 'volume_down',
      icon: Volume1,
      type: 'icon',
      desc: 'Volume Down'
    },
    BracketLeft: {
      fn: () => !viewAnime && !externalPlayback && (playbackRate = video.defaultPlaybackRate -= 0.1),
      id: 'history',
      icon: RotateCcw,
      type: 'icon',
      desc: 'Decrease Playback Rate'
    },
    BracketRight: {
      fn: () => !viewAnime && !externalPlayback && (playbackRate = video.defaultPlaybackRate += 0.1),
      id: 'update',
      icon: RotateCw,
      type: 'icon',
      desc: 'Increase Playback Rate'
    },
    Backslash: {
      fn: () => !viewAnime && !externalPlayback && (playbackRate = video.defaultPlaybackRate = 1),
      icon: RefreshCcw,
      id: 'schedule',
      type: 'icon',
      desc: 'Reset Playback Rate'
    }
  })

  function getBurnIn (noSubs) {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    let loop = null
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    if (!noSubs) subs.renderer.resize(video.videoWidth, video.videoHeight)
    const renderFrame = () => {
      context.drawImage(deband ? deband.canvas : video, 0, 0)
      if (!noSubs && canvas.width && canvas.height) context.drawImage(subs.renderer?._canvas, 0, 0, canvas.width, canvas.height)
      loop = video.requestVideoFrameCallback(renderFrame)
    }
    renderFrame()
    const destroy = () => {
      if (!noSubs) subs.renderer.resize()
      video.cancelVideoFrameCallback(loop)
      canvas.remove()
    }
    container.append(canvas)
    return { stream: canvas.captureStream(), destroy }
  }

  // function initCast (event) {
  //   // these quality settings are likely to make cast overheat, oh noes!
  //   let peer = new Peer({
  //     polite: true,
  //     quality: {
  //       audio: {
  //         stereo: 1,
  //         'sprop-stereo': 1,
  //         maxaveragebitrate: 510000,
  //         maxplaybackrate: 510000,
  //         cbr: 0,
  //         useinbandfec: 1,
  //         usedtx: 1,
  //         maxptime: 20,
  //         minptime: 10
  //       },
  //       video: {
  //         bitrate: 2000000,
  //         codecs: ['VP9', 'VP8', 'H264']
  //       }
  //     }
  //   })

  //   presentationConnection = event.connection
  //   presentationConnection.addEventListener('terminate', () => {
  //     presentationConnection = null
  //     peer = null
  //   })

  //   peer.signalingPort.onmessage = ({ data }) => {
  //     presentationConnection.send(data)
  //   }

  //   presentationConnection.addEventListener('message', ({ data }) => {
  //     peer.signalingPort.postMessage(data)
  //   })

  //   peer.dc.onopen = () => {
  //     if (peer && presentationConnection) {
  //       const tracks = []
  //       const videostream = video.captureStream()
  //       if (true) {
  //         // TODO: check if cast supports codecs
  //         const { stream, destroy } = getBurnIn(!subs?.renderer)
  //         tracks.push(stream.getVideoTracks()[0], videostream.getAudioTracks()[0])
  //         presentationConnection.addEventListener('terminate', destroy)
  //       } else {
  //         tracks.push(videostream.getVideoTracks()[0], videostream.getAudioTracks()[0])
  //       }
  //       for (const track of tracks) {
  //         peer.pc.addTrack(track, videostream)
  //       }
  //       paused = false // video pauses for some reason
  //     }
  //   }
  // }

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
      buffering = false
    }
  }

  function showBuffering () {
    bufferTimeout = setTimeout(() => {
      buffering = true
      resetImmerse()
    }, 150)
  }
  $: navigator.mediaSession?.setPositionState({
    duration: Math.max(0, safeduration || 0),
    playbackRate: 1,
    position: Math.max(0, Math.min(safeduration || 0, currentTime || 0))
  })

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
    else {
      video.play()
      setTimeout(() => subs?.renderer?.resize(), 200) // stupid fix because video metadata doesn't update for multiple frames
    }
  }
  let resolvePrompt = false
  function resolveResponse (resolve) {
    resolvePrompt = false
    if (resolve) {
      $managerView = true
    } else {
      video.play()
      setTimeout(() => subs?.renderer?.resize(), 200) // stupid fix because video metadata doesn't update for multiple frames
    }
  }
  let stats = null
  let requestCallback = null
  function toggleStats () {
    if (requestCallback) {
      stats = null
      video.cancelVideoFrameCallback(requestCallback)
      requestCallback = null
    } else {
      requestCallback = video.requestVideoFrameCallback((a, b) => {
        stats = {}
        handleStats(a, b, b)
      })
      if (paused) seek(-0.001) // stupid hack because the initial request doesn't trigger canvas to re-render, stats won't appear unless the current time changes.
    }
  }
  async function handleStats (now, metadata, lastmeta) {
    if (stats) {
      const msbf = (metadata.mediaTime - lastmeta.mediaTime) / (metadata.presentedFrames - lastmeta.presentedFrames)
      const fps = (1 / msbf).toFixed(3)
      stats = {
        fps,
        presented: metadata.presentedFrames,
        dropped: video.getVideoPlaybackQuality()?.droppedVideoFrames,
        processing: metadata.processingDuration + ' ms',
        viewport: video.clientWidth + 'x' + video.clientHeight,
        resolution: videoWidth + 'x' + videoHeight,
        buffer: getBufferHealth(metadata.mediaTime) + ' s',
        speed: video.playbackRate || 1
      }
      setTimeout(() => video.requestVideoFrameCallback((n, m) => handleStats(n, m, metadata)), 200)
    }
  }
  function getBufferHealth (time) {
    for (let index = video.buffered.length; index--;) {
      if (time < video.buffered.end(index) && time >= video.buffered.start(index)) {
        return (video.buffered.end(index) - time) | 0
      }
    }
    return 0
  }
  let buffer = 0
  WPC.listen('progress', (detail) => {
    buffer = detail * 100
  })

  let chapters = []
  let embeddedChapters = []
  WPC.listen('chapters', (detail) => {
    if (detail.length) {
      chapters = detail
      embeddedChapters = detail
    }
  })
  async function findChapters () {
    if ((!chapters.length || settings.value.playerChapterSkip.match(/aniskip/i)) && current?.media?.media) {
      const _chapters = await getChaptersAniSkip(current, safeduration)
      if (_chapters?.length) chapters = _chapters
    }
  }

  let currentSkippable = null
  $: currentSkippable && $settings.playerAutoSkip && skip()
  function checkSkippableChapters () {
    const current = findChapter(currentTime)
    if (current) {
      currentSkippable = isChapterSkippable(current)
    }
  }
  const MAX_TOTAL_SKIP_TIME = 180
  const skippableChaptersRx = [
    ['Intro', /^intro$/mi],
    ['Opening', /^op$|opening$|title$|^ncop/mi],
    ['Outro', /^outro$/mi],
    ['Ending', /^ed$|ending$|^nced/mi],
    ['Credits', /credits/i],
    ['Preview', /^preview$|previews$|pv$|next$/mi],
    ['Recap', /recap/mi]
  ]
  function isChapterSkippable(chapter) {
    if (((chapter.end - chapter.start) / 1_000) > MAX_TOTAL_SKIP_TIME) return null // Anything longer than 180s (3m) is likely invalid, skipping this chapter would be a mistake!
    for (const [name, regex] of skippableChaptersRx) {
      if (/** @type {RegExp} */ chapter.text && (regex).test(chapter.text.trim())) {
        return name
      }
    }
    return null
  }
  function findChapter (time) {
    if (!chapters.length) return null
    for (const chapter of chapters) {
      if (time < (chapter.end / 1_000) && time >= (chapter.start / 1_000)) return chapter
    }
  }
  function mergeMicroSkippable(_chapters) {
    const isSkippable = (chapter) => chapter.text && skippableChaptersRx.some(([_, rx]) => rx.test(chapter.text.trim()))
    const isShort = (chapter) => ((chapter.end - chapter.start) / 1_000) < 10 // anything shorter than 10 seconds is just fluff... probably a mistake.
    const underMaxSkip = (chapter) => (chapter.end - chapter.start) / 1_000 <= MAX_TOTAL_SKIP_TIME
    for (let i = 0; i < _chapters.length - 1; i++) {
      const cur = _chapters[i]
      const next = _chapters[i + 1]
      if (isSkippable(cur) && isSkippable(next) && underMaxSkip(cur) && underMaxSkip(next)) {
        if (isShort(cur) && !isShort(next)) {
          next.start = cur.start
          _chapters.splice(i, 1)
          i--
        } else if (!isShort(cur) && isShort(next)) {
          cur.end = next.end
          _chapters.splice(i + 1, 1)
          i--
        } else if (isShort(cur) && isShort(next)) {
          cur.end = next.end
          _chapters.splice(i + 1, 1)
          i--
        }
      }
    }
    return _chapters
  }

  // remaps chapters to what perfect-seekbar uses and adds potentially missing chapters
  function sanitiseChapters (_chapters, safeduration) {
    if (!_chapters?.length) return []
    const first = _chapters[0]
    for (const chapter of _chapters) { // Fix negative values
      if (typeof chapter.start === 'number' && chapter.start < 0) chapter.start = -chapter.start // Fixes negative start values, likely was a mistake and is actually correct if positive.
      if (typeof chapter.end === 'number' && chapter.end < 0) chapter.end = -chapter.end // Fixes negative end values, likely was a mistake and is actually correct if positive.
    }
    if (first.start !== 0 && _chapters.some(ch => ch?.start === 0)) { // Fix incorrect order of chapters (when start === 0 is somewhere else)
      _chapters.sort((a, b) => (a?.start ?? 0) - (b?.start ?? 0))
    }
    const boundaryMatches = _chapters.map((ch, i) => ({ ch, i })).filter(({ ch }) => ch.start === first.end)
    if (boundaryMatches.length > 0) { // Fix overlapping chapters where valid chapter end time matches a valid chapter start time.
      boundaryMatches.sort((a, b) => (a.ch.end - a.ch.start) - (b.ch.end - b.ch.start))
      const boundaryIndex = boundaryMatches[0].i
      if (boundaryIndex > 1) _chapters.splice(1, boundaryIndex - 1)
    }
    _chapters = _chapters.map((chapter, index, arr) => {
      if (chapter.start === chapter.end) { // Fix chapters with incorrect start/end times which causes an invisible seekbar, this happens when the start and end time are identical
        const nextChapter = arr[index + 1] // We now assume each chapter is a bookmark and use the next chapters start time and the current chapters end time.
        return { ...chapter, end: nextChapter ? nextChapter.start : safeduration * 1_000 } // Use next chapter's start or ensure the entire safe duration of seekbar is visible.
      }
      return chapter
    })
    _chapters[_chapters.length - 1].end = safeduration * 1_000 // fix the final chapter so its duration actually reaches the end of the video...
    _chapters[0].start = 0

    mergeMicroSkippable(_chapters)
    if (JSON.stringify(chapters) !== JSON.stringify(_chapters)) chapters = _chapters

    const sanitised = []
    let chapterCounter = 1
    for (let { start, end, text } of _chapters) {
      if (start > safeduration * 1_000) continue
      if (end > safeduration * 1_000) end = safeduration * 1_000
      if (text && /^[\d:.\s]+$/.test(text)) { // Replace numerical/timestamp-like chapter names
        text = `Chapter ${chapterCounter}`
        chapterCounter++
      }
      sanitised.push({ size: (end / 10 / safeduration) - (start / 10 / safeduration), text })
    }
    return sanitised
  }

  const thumbCanvas = document.createElement('canvas')
  thumbCanvas.width = 200
  const thumbnailData = {
    thumbnails: [],
    canvas: thumbCanvas,
    context: thumbCanvas.getContext('2d'),
    interval: null,
    video: null
  }

  function getThumbnail (percent) {
    return thumbnailData.thumbnails[Math.floor(percent / 100 * safeduration / thumbnailData.interval)] || ' '
  }
  function createThumbnail (vid = video) {
    if (vid?.readyState >= 2) {
      const index = Math.floor(vid.currentTime / thumbnailData.interval)
      if (!thumbnailData.thumbnails[index]) {
        thumbnailData.context.fillRect(0, 0, 200, thumbnailData.canvas.height)
        thumbnailData.context.drawImage(vid, 0, 0, 200, thumbnailData.canvas.height)
        thumbnailData.thumbnails[index] = thumbnailData.canvas.toDataURL('image/jpeg')
      }
    }
  }
  let videoWidth, videoHeight
  function initThumbnails () {
    const height = 200 / (videoWidth / videoHeight)
    if (!isNaN(height)) {
      thumbnailData.interval = safeduration / 300 < 5 ? 5 : safeduration / 300
      thumbnailData.canvas.height = height
      generateThumbnails()
    }
  }
  let thumbnailProcess = null
  async function generateThumbnails() {
    debug('Starting thumbnail generation...')
    if (thumbnailProcess && thumbnailProcess.running) {
      debug('Detected a currently running thumbnail generation process, interrupting...')
      thumbnailProcess.videoDraw.remove()
      thumbnailProcess.running = false
      await new Promise(resolve => setTimeout(resolve, 5 * 1_000))
    }
    const t0 = performance.now()
    thumbnailProcess = { videoDraw: document.createElement('video'), running: true}
    const videoDraw = thumbnailProcess.videoDraw
    videoDraw.src = current.url
    videoDraw.preload = 'auto'
    videoDraw.volume = 0
    videoDraw.playbackRate = 0
    videoDraw.onloadeddata = () => {
      let index = 0
      let lastIndex = 0
      function captureThumbnail() {
        if (!thumbnailProcess.running) {
          debug('Thumbnail generation process was interrupted due to a change in the video url, exiting...')
          return
        }
        let dynamicDuration = (buffer / 100) * videoDraw.duration
        if (!isFinite(dynamicDuration)) {
          debug('Video is still loading... waiting to generate thumbnails...')
          setTimeout(() => captureThumbnail(), 1_000)
          return
        }
        while (thumbnailData.thumbnails[index]) index++
        const currentTime = index * thumbnailData.interval
        if (currentTime >= dynamicDuration && currentTime < videoDraw.duration) {
          if (lastIndex !== index) {
            lastIndex = index
            debug(`Reached currently downloaded video duration, current seek time is: ${currentTime}s (${index} of ${buffer}%), waiting for buffer update...`)
          }
          setTimeout(() => {
            if (currentTime < (buffer / 100) * videoDraw.duration) {
              lastIndex = 0
              debug('Detected a buffer change, continuing thumbnail generation...')
            }
            captureThumbnail()
          }, 1_000)
          return
        }

        if (currentTime >= videoDraw.duration) {
          debug('Thumbnail generation has successfully completed, took:', (toTS((performance.now() - t0) / 1_000)))
          videoDraw.remove()
          return
        } else if (isFinite(currentTime) && currentTime >= 0 && currentTime <= dynamicDuration) {
          videoDraw.currentTime = currentTime
        } else {
          debug('Something went wrong calculating the current time for the thumbnails video, calculated:', currentTime, dynamicDuration, buffer)
          return
        }

        videoDraw.onseeked = () => {
          if (!thumbnailProcess.running) {
            debug('Thumbnail generation process was interrupted due to a change in the video url, exiting...')
            return
          }
          thumbnailData.context.fillRect(0, 0, 200, thumbnailData.canvas.height)
          thumbnailData.context.drawImage(videoDraw, 0, 0, 200, thumbnailData.canvas.height)
          thumbnailData.thumbnails[index] = thumbnailData.canvas.toDataURL('image/jpeg')
          captureThumbnail()
        }
      }
      captureThumbnail()
    }
    videoDraw.onerror = (e) => {
      debug('Error loading video for thumbnail generation:', e)
      videoDraw.remove()
    }
  }

  // const isWindows = navigator.appVersion.includes('Windows')
  // let innerWidth, innerHeight
  const menubarOffset = 0
  // $: calcMenubarOffset(innerWidth, innerHeight, videoWidth, videoHeight)
  // function calcMenubarOffset (innerWidth, innerHeight, videoWidth, videoHeight) {
  //   // outerheight resize and innerheight resize is mutual, additionally update on metadata and app state change
  //   if (videoWidth && videoHeight) {
  //     // so windows is very dumb, and calculates windowed mode as if it was window XP, with the old bars, but not when maximised
  //     const isMaximised = screen.availWidth === window.outerWidth && screen.availHeight === window.outerHeight
  //     const menubar = Math.max(0, isWindows && !isMaximised ? window.outerHeight - innerHeight - 8 : window.outerHeight - innerHeight)
  //     // element ratio calc
  //     const videoRatio = videoWidth / videoHeight
  //     const { offsetWidth, offsetHeight } = video
  //     const elementRatio = offsetWidth / offsetHeight
  //     // video is shorter than element && has space for menubar offset
  //     if (!document.fullscreenElement && menubar && elementRatio <= videoRatio && offsetHeight - offsetWidth / videoRatio > menubar) {
  //       menubarOffset = (menubar / 2) * -1
  //     } else {
  //       menubarOffset = 0
  //     }
  //   }
  // }

  const showOptions = writable(false)
  function toggleDropdown ({ target }) {
    target.classList.toggle('active')
    target.closest('.dropdown').classList.toggle('show')
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
  const torrent = {}
  WPC.listen('stats', updateStats)
  function updateStats (detail) {
    torrent.peers = detail.numPeers || 0
    torrent.up = detail.uploadSpeed || 0
    torrent.down = detail.downloadSpeed || 0
  }
  function checkError ({ target }) {
    // video playback failed - show a message saying why
    switch (target.error?.code) {
      case target.error.MEDIA_ERR_ABORTED:
        debug('You aborted the video playback.')
        break
      case target.error.MEDIA_ERR_NETWORK:
        debug('A network error caused the video download to fail part-way.', target.error)
        saveAnimeProgress(true)
        toast.error('Video Network Error', {
          description: 'A network error caused the video download to fail part-way. Dismiss this toast to reload the video.',
          duration: Infinity,
          onDismiss: () => target.load()
        })
        break
      case target.error.MEDIA_ERR_DECODE:
        debug('The video playback was aborted due to a corruption problem or because the video used features your browser did not support.', target.error)
        saveAnimeProgress(true)
        toast.error('Video Decode Error', {
          description: 'The video playback was aborted due to a corruption problem. Dismiss this toast to reload the video.',
          duration: Infinity,
          onDismiss: () => target.load()
        })
        break
      case target.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
        if (target.error.message !== 'MEDIA_ELEMENT_ERROR: Empty src attribute') {
          debug('The video could not be loaded, either because the server or network failed or because the format is not supported.', target.error)
          saveAnimeProgress(true)
          toast.error('Video Codec Unsupported', {
            description: 'The video could not be loaded, either because the server or network failed or because the format is not supported. Try a different release by disabling Autoplay Torrents in RSS settings.',
            duration: 30_000
          })
        }
        break
      default:
        debug('An unknown video playback error occurred.')
        break
    }
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

  function setDiscordRPC (np = media, browsing) {
    if ((!np || Object.keys(np).length === 0) && !browsing) return
    if (hidden) {
      IPC.emit('discord-clear')
      return
    }
    let activity
    if (!browsing) {
      const w2g = state.value?.code
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
            url: 'https://github.com/RockinChaos/Shiru/releases/latest'
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
          large_text: 'https://github.com/RockinChaos/Shiru',
          small_image: 'searching',
          small_text: 'Browsing anime on Shiru',
        },
        buttons: [
          {
            label: 'Download Shiru',
            url: 'https://github.com/RockinChaos/Shiru/releases/latest'
          }
        ],
        instance: true,
        type: 3
      }
    }
    IPC.emit('discord', { activity })
  }
</script>

<div
  class='player w-full h-full d-flex flex-column overflow-hidden position-relative'
  class:ratio-16-9={!canPlay || !src || externalPlayback}
  class:pointer={miniplayer}
  class:rounded-top-10={miniplayer}
  class:miniplayer
  class:pip
  class:immersed={immersed}
  class:buffering={(page === 'player' || miniplayer) && buffering}
  class:fitWidth
  bind:this={container}
  role='none'
  on:mousemove={resetImmerse}
  on:touchmove={resetImmerse}
  on:keypress={resetImmerse}
  on:keydown={resetImmerse}
  on:mouseleave={immersePlayer}>
  {#if showKeybinds && !miniplayer}
    <div class='position-absolute bg-tp w-full h-full z-50 font-size-12 p-20 d-flex align-items-center justify-content-center pointer' on:pointerup|self={() => (showKeybinds = false)} tabindex='-1' role='button'>
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
    style={`margin-top: ${menubarOffset}px`}
    preload='auto'
    {src}
    bind:videoHeight
    bind:videoWidth
    bind:this={video}
    bind:volume
    bind:duration
    bind:currentTime
    bind:paused
    bind:ended
    bind:muted
    bind:playbackRate
    on:error={checkError}
    on:pause={updatew2g}
    on:play={updatew2g}
    on:seeked={updatew2g}
    on:timeupdate={() => createThumbnail()}
    on:timeupdate={checkCompletion}
    on:timeupdate={checkSkippableChapters}
    on:waiting={showBuffering}
    on:loadeddata={hideBuffering}
    on:pause={() => { immersed = false }}
    on:canplay={hideBuffering}
    on:playing={hideBuffering}
    on:loadedmetadata={hideBuffering}
    on:ended={tryPlayNext}
    on:loadedmetadata={initThumbnails}
    on:loadedmetadata={findChapters}
    on:loadedmetadata={autoPlay}
    on:loadedmetadata={checkAudio}
    on:loadedmetadata={checkSubtitle}
    on:loadedmetadata={clearLoadInterval}
    on:loadedmetadata={loadAnimeProgress}
    on:leavepictureinpicture={() => { pip = false }}
  ><track kind='captions' src='' srclang='en' label='English'/></video>
  {#if stats && !miniplayer}
    <div class='position-absolute top-0 bg-tp p-10 ml-20 mt-100 text-monospace rounded z-50'>
      <button class='close btn btn-square mt-5' type='button' use:click={toggleStats}>
        <X size='1.4rem' strokeWidth='3'/>
      </button>
      <div>FPS: {stats.fps}</div>
      <div>Presented frames: {stats.presented}</div>
      <div>Dropped frames: {stats.dropped}</div>
      <div>Frame time: {stats.processing}</div>
      <div>Viewport: {stats.viewport}</div>
      <div>Resolution: {stats.resolution}</div>
      <div>Buffer health: {stats.buffer}</div>
      <div>Playback speed: x{stats.speed?.toFixed(1)}</div>
      <div>Name: {current.name || ''}</div>
      {#if playableFiles?.length > 1}
        <div class='mt-10'>All files in this batch:</div>
        <div class='overflow-auto ml-10 mt-5' style='max-height: 200px;'>
          {#each playableFiles as file}
            <div class='ctrl rounded-10 pl-5 pr-5 pbf' title={file.name} use:click={() => playFile(file)}>
              {file.name || 'UNK'}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
  <FileManager playing={current} files={playableFiles} {playFile} bind:overlay/>
  <div class='top z-40 row d-title'>
    <div class='stats pl-20 col-4 d-title'>
      <div class='font-weight-bold overflow-hidden text-truncate font-scale-23'>
        {#if media?.title}
          {media?.title}
        {:else if media?.media?.title} <!-- useful when a torrent is EXTREMELY slow at loading... -->
          {anilistClient.title(media?.media)}
        {:else if current}
          {AnimeResolver.cleanFileName(current.name)}
        {/if}
      </div>
      <div class='font-weight-normal overflow-hidden text-truncate text-muted font-scale-16'>
        {#if (media?.episode === 0 || media?.episode) && media?.media?.format !== 'MOVIE' && (!media?.episodeTitle || !new RegExp(`(?<![\\d.])${media.episode}(?![\\d.])`).test(media.episodeTitle))}
          {@const maxEpisodes = getMediaMaxEp(media.media) - (media.zeroEpisode ? 1 : 0)}
          Episode {media.episodeRange ? `${media.episodeRange.first} ~ ${media.episodeRange.last}` : media.episode}
          {#if maxEpisodes && (Number(maxEpisodes) > 1)} of {maxEpisodes}{:else if !maxEpisodes && videos && (videos.length > 1)} of {videos.length}{/if} <!-- for when the media fails to resolve, we can predict that the file length is likely the episode count. -->
        {:else if current && (videos?.length > 1)}
          Episode {videos.indexOf(current) + 1} of {videos.length} <!-- fallback for when the media fails to resolve and we also fail to resolve the episode numbers, best to indicate what file we are currently on. -->
        {/if}
        {#if (media?.episode === 0 || media?.episode) && media?.media?.format !== 'MOVIE' && (media?.episodeTitle && !new RegExp(`(?<![\\d.])${media.episode}(?![\\d.])`).test(media.episodeTitle))}{' - '}{/if}
        {#if media?.episodeTitle}{media.episodeTitle}{/if}
      </div>
    </div>
    <div class='d-flex justify-content-center bottom-0 col-4 d-title d-filler'>
      <span class='icon'><Users class='pt-5 block-scale-30' strokeWidth={3} /> </span>
      <span class='stats font-scale-24'>{torrent.peers || 0}</span>
      <span class='icon'><ArrowDown class='block-scale-30' /></span>
      <span class='stats font-scale-24'>{fastPrettyBytes(torrent.down)}/s</span>
      <span class='icon'><ArrowUp class='block-scale-30' /></span>
      <span class='stats font-scale-24'>{fastPrettyBytes(torrent.up)}/s</span>
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
    <div aria-hidden='true' class='w-full h-full position-absolute toggle-fullscreen' on:dblclick={toggleFullscreen} on:click|self={() => { if (page === 'player' && ((overlay.length === 0) || overlay.includes('player'))) playPause(); page = 'player'; window.dispatchEvent(new Event('overlay-check')) }} />
    <div aria-hidden='true' class='w-full h-full position-absolute toggle-immerse d-none' on:dblclick={toggleFullscreen} on:click|self={toggleImmerse} />
    <div class='w-full h-full position-absolute mobile-focus-target d-none' use:click={() => { page = 'player'; window.dispatchEvent(new Event('overlay-check')) }} />
    <span aria-hidden='true' class='icon ctrl align-items-center justify-content-end w-150 mw-full mr-auto' class:hidden={externalPlayback} class:mb-50={!miniplayer} on:click={rewind}><Rewind size='3rem' /></span>
    <!-- miniplayer buttons -->
    {#if miniplayer}
      <span class='position-absolute rounded-10 top-0 right-0 m-10 btn-shadow button' class:ctrl={!SUPPORTS.isAndroid} class:mr-40={!SUPPORTS.isAndroid} class:mr-50={SUPPORTS.isAndroid} title='Minimize' data-name='playPause' use:click={() => (playPage = !playPage)}>
        <Minus size='1.9rem' strokeWidth='3'/>
      </span>
      <span class='position-absolute rounded-10 top-0 right-0 m-10 btn-shadow button' class:ctrl={!SUPPORTS.isAndroid} title='Exit' data-name='playPause' use:click={() => { window.dispatchEvent(new CustomEvent('torrent-unload')); if (page === 'player') page = 'home'}}>
        <X size='1.9rem' strokeWidth='3'/>
      </span>
    {/if}
    <div class='d-flex align-items-center position-relative' class:mb-50={!miniplayer} style='width: 100%;' title='Play/Pause'>
      {#if hasLast}
        <span class='icon ctrl position-absolute rounded-10 text-white' style={externalPlayback ? `left: 5%` : `left: 15%`} title='Last' data-name='playPause' use:click={playLast}>
          <SkipBack size='3rem' fill='currentColor' />
        </span>
      {/if}
        <span class='icon ctrl position-absolute rounded-10 text-white' data-name='playPause' style='left: 50%; margin-left: -3rem;' use:click={playPause}>
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
      {#if hasNext}
        <span class='icon ctrl position-absolute rounded-10 text-white' style={externalPlayback ? `right: 5%` : `right: 15%`} title='Next' data-name='playPause' use:click={playNext}>
          <SkipForward size='3rem' fill='currentColor' />
        </span>
      {/if}
    </div>
    <span aria-hidden='true' class='icon ctrl align-items-center w-150 mw-full ml-auto' class:hidden={externalPlayback} class:mb-50={!miniplayer} on:click={forward}><FastForward size='3rem' /></span>
    <div class='position-absolute bufferingDisplay' class:bufferingPos={SUPPORTS.isAndroid && !miniplayer}/>
    {#if currentSkippable}
      <button class='skip btn text-dark position-absolute bottom-0 right-0 mr-20 mb-5 font-weight-bold z-30 d-flex align-items-center justify-content-center' use:click={skip}>
        <FastForward size='1.8rem' fill='currentColor' /><span class='ml-5'>Skip {currentSkippable}</span>
      </button>
    {/if}
  </div>
  <div class='bottom d-flex z-40 flex-column px-20'>
    <div class='w-full d-flex align-items-center h-20 mb-5 seekbar' tabindex='-1' role='button' on:keydown={handleSeekbarKey}>
      <Seekbar
        accentColor='{completed || (media?.media && (($mediaCache[media.media.id] || media.media)?.mediaListEntry?.progress === (media.episodeRange ? media.episodeRange.last : media.episode))) ? `var(--completed-color-dim)` : `var(--accent-color)`}'
        class='font-size-20'
        length={safeduration}
        {buffer}
        bind:progress={progress}
        on:seeking={handleMouseDown}
        on:seeked={handleMouseUp}
        chapters={sanitiseChapters(chapters, safeduration)}
        {getThumbnail}
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
      {#if hasLast}
        <span class='icon ctrl m-5 d-btn text-white' title='Last [B]' use:click={playLast}>
          <SkipBack size='2rem' fill='currentColor' />
        </span>
      {/if}
      {#if hasNext}
        <span class='icon ctrl m-5 d-btn text-white' title='Next [N]' use:click={playNext}>
          <SkipForward size='2rem' fill='currentColor' />
        </span>
      {/if}
      <div class='d-none w-auto volume' class:d-flex={!externalPlayback}>
        <span class='icon ctrl m-5 text-white' title='Mute [M]' data-name='toggleMute' use:click={toggleMute}>
          {#if muted}
            <VolumeX size='2rem' fill='currentColor' />
          {:else}
            <Volume2 size='2rem' fill='currentColor' />
          {/if}
        </span>
        {#if !volumeBoosted}
          <input class='ctrl h-full custom-range' tabindex='-1' type='range' min='0' max='1' step='any' data-name='setVolume' bind:value={volume} />
        {:else}
          <input class='ctrl h-full custom-range' class:boost-color={gain > 1} tabindex='-1' type='range' min='0' max='3' step='any' data-name='setVolume' bind:value={gain} on:input={setGain}/>
        {/if}
        {#if (volume === 1) || volumeBoosted}
          <span class='icon ctrl boost p-0 mt-15 d-flex align-items-center justify-content-center text-white' class:boost-color={volumeBoosted} title='Increase Volume Limit [V]' data-name='toggleGain' use:click={toggleGain}>
            <SlidersVertical size='1.4rem' fill='currentColor' />
          </span>
        {/if}
      </div>
      <div class='ts font-scale-20' class:mr-auto={playbackRate === 1}>{toTS(targetTime, safeduration > 3600 ? 2 : 3)} / {toTS(safeduration - targetTime, safeduration > 3600 ? 2 : 3)}</div>
      {#if playbackRate !== 1}
        <div class='ts mr-auto font-scale-20'>x{playbackRate.toFixed(1)}</div>
      {/if}
      <input type='file' class='d-none' id='search-subtitle' accept='.srt,.vtt,.ass,.ssa,.sub,.txt' on:input|preventDefault|stopPropagation={handleFile} bind:this={fileInput}/>
      <div class='dropdown dropleft with-arrow' use:click={() => { showOptions.set(!$showOptions) }}>
        <span class='icon text-white ctrl d-flex align-items-center h-full' title='More'><EllipsisVertical size='2.5rem' strokeWidth={2.5} /></span>
        <div class='position-absolute hm-40 text-capitalize text-nowrap bg-dark rounded dr-arrow' style='margin-top: {launchedExternal ? -14 : externalPlayback ? -10.3 : SUPPORTS.isAndroid || $settings.playerPath ? -21 : -17.5}rem !important; margin-left: {launchedExternal ? -11.1 : externalPlayback ? -9.8 : -11.4}rem !important; transition: opacity 0.1s ease-in;' class:hidden={!$showOptions}>
          <div role='button' aria-label='Add External Subtitles' class='pointer d-none align-items-center justify-content-center font-size-16 bd-highlight py-5 px-10 rounded-top option' class:d-flex={!externalPlayback} title='Add External Subtitles' use:click={() => { fileInput.click(); showOptions.set(false) }}>
            <FilePlus2 size='2rem' strokeWidth={2.5} /> <div class='ml-10'>Add Subtitles</div>
          </div>
          <div class='dropdown dropleft with-arrow pointer bg-dark option font-size-16 bd-highlight' class:d-none={externalPlayback}>
            <div role='button' class='d-flex align-items-center justify-content-center py-5 px-10' aria-label='Change the Source of the Video Chapters' title='Change the Source of the Video Chapters' use:click={toggleDropdown}><Milestone size='2rem' strokeWidth={2.5}  /><span class='ml-10'>Chapter Source</span></div>
            <div class='dropdown-menu dropdown-menu-right text-capitalize text-nowrap rounded'>
              <div class='custom-radio overflow-hidden pt-5 pl-5'>
                <input name='chapter-embed-set' type='radio' id='chapter-embed-radio' tabindex='-1' value='embedded' checked={$settings.playerChapterSkip === 'embedded'} />
                <label for='chapter-embed-radio' use:click={(target) => { $settings.playerChapterSkip = 'embedded'; chapters = embeddedChapters; setTimeout(() => { toggleDropdown(target); showOptions.set(false); }) }} class='pb-5'>Embedded</label>
                <input name='chapter-aniskip-set' type='radio' id='chapter-aniskip-radio' tabindex='-1' value='aniskip' checked={$settings.playerChapterSkip === 'aniskip'} />
                <label for='chapter-aniskip-radio' use:click={(target) => { $settings.playerChapterSkip = 'aniskip'; findChapters(); setTimeout(() => { toggleDropdown(target); showOptions.set(false); }) }} class='pb-5'>Aniskip</label>
              </div>
            </div>
          </div>
          <div role='button' aria-label='Play the Current Video in an External Player' class='pointer d-none align-items-center justify-content-center font-size-16 bd-highlight py-5 px-10 option' class:d-flex={(!externalPlayback || launchedExternal) && (SUPPORTS.isAndroid || $settings.playerPath)} title='Play the Current Video in an External Player' use:click={() => { setCurrent(current, true); showOptions.set(false) }}>
            <SquareArrowOutUpRight size='2rem' strokeWidth={2.5} /> <div class='ml-10'>External Player</div>
          </div>
          <div role='button' aria-label='Modify Existing Files or Change to a New File' class='pointer d-flex align-items-center justify-content-center font-size-16 bd-highlight py-5 px-10 rounded-bottom option' class:rounded-top={externalPlayback && !launchedExternal} title='Modify Existing Files or Change to a New File' use:click={() => { resolvePrompt = false; $managerView = !$managerView; showOptions.set(false) }}>
            <SquarePen size='2rem' strokeWidth={2.5} /> <div class='ml-10'>File Manager</div>
          </div>
        </div>
      </div>
      <span class='icon text-white ctrl mr-5 d-flex align-items-center keybinds' title='Keybinds [`]' use:click={() => (showKeybinds = true)}>
        <Keyboard size='2.5rem' strokeWidth={2.5} />
      </span>
      {#if playPage}
        <span class='icon text-white ctrl mr-5 d-flex align-items-center' title='Now Playing [O]' use:click={() => ($view = media?.media)}>
          <Eye size='2.5rem' strokeWidth={2.5} />
        </span>
      {/if}
      {#if 'audioTracks' in HTMLVideoElement.prototype && video?.audioTracks?.length > 1}
        <div class='dropdown dropup with-arrow' use:click={toggleDropdown}>
          <span class='icon text-white ctrl mr-5 d-flex align-items-center h-full' title='Audio Tracks'>
            <ListMusic size='2.5rem' strokeWidth={2.5} />
          </span>
          <div class='dropdown-menu dropdown-menu-right ctrl p-10 pb-0 mr-15 text-capitalize text-nowrap'>
            <div class='custom-radio overflow-y-auto overflow-x-hidden hm-400'>
              {#each video.audioTracks as track}
                <input name='audio-radio-set' type='radio' id='audio-{track.id}-radio' value={track.id} checked={track.enabled} />
                <label for='audio-{track.id}-radio' use:click={() => selectAudio(track.id)} class='pb-5'>
                  {(track.language || (!Object.values(video.audioTracks).some(track => track.language === 'eng' || track.language === 'en') ? 'eng' : track.label)) + (track.label ? ' - ' + track.label : '')}
                </label>
              {/each}
              <div class='mb-5 invisible'></div>
            </div>
          </div>
        </div>
      {/if}
      {#if 'videoTracks' in HTMLVideoElement.prototype && video?.videoTracks?.length > 1}
        <div class='dropdown dropup with-arrow' use:click={toggleDropdown}>
          <span class='icon text-white ctrl mr-5 d-flex align-items-center h-full' title='Video Tracks'>
            <ListVideo size='2.5rem' strokeWidth={2.5} />
          </span>
          <div class='dropdown-menu dropdown-menu-right ctrl p-10 pb-0 mr-15 text-capitalize text-nowrap'>
            <div class='custom-radio overflow-y-auto overflow-x-hidden hm-400'>
              {#each video.videoTracks as track}
                <input name='video-radio-set' type='radio' id='video-{track.id}-radio' value={track.id} checked={track.selected} />
                <label for='video-{track.id}-radio' use:click={() => selectVideo(track.id)} class='pb-5'>
                  {(track.language || (!Object.values(video.videoTracks).some(track => track.language === 'eng' || track.language === 'en') ? 'eng' : track.label)) + (track.label ? ' - ' + track.label : '')}
                </label>
              {/each}
              <div class='mb-5 invisible'></div>
            </div>
          </div>
        </div>
      {/if}
      {#if subHeaders?.length && !externalPlayback}
        <div class='subtitles dropdown dropup with-arrow' use:click={toggleDropdown}>
          <span class='icon text-white ctrl mr-5 d-flex align-items-center h-full' title='Subtitles [C]'>
            <Captions size='2.5rem' strokeWidth={2.5} />
          </span>
          <div class='dropdown-menu dropdown-menu-right ctrl p-10 pb-5 mr-15 text-capitalize text-nowrap'>
            <div class='custom-radio overflow-y-auto overflow-x-hidden hm-400'>
              <input name='subtitle-radio-set' type='radio' id='subtitle-off-radio' value='off' checked={subHeaders && subs?.current === -1} />
              <label for='subtitle-off-radio' use:click={() => { subs.selectCaptions(-1); setTimeout(() => subs?.renderer?.resize(), 200); cache.setEntry(caches.HISTORY, 'lastSubtitle', { ...(cache.getEntry(caches.HISTORY, 'lastSubtitle') || {}), [media?.media?.id || media?.title || media?.parseObject?.title || media?.parseObject?.file_name]: 'OFF' }) }} class='pb-5'> OFF </label> <!-- stupid fix (resize) because video metadata doesn't update for multiple frames -->
              {#each subHeaders as track}
                {#if track}
                  {@const trackName = (track.language || (!Object.values(subs.headers).some(header => header.language === 'eng' || header.language === 'en') ? 'eng' : track.type)) + (track.name ? ' - ' + track.name : '')}
                  <input name='subtitle-radio-set' type='radio' id='subtitle-{track.number}-radio' value={track.number} checked={track.number === subs.current} />
                  <label for='subtitle-{track.number}-radio' use:click={() => { subs.selectCaptions(track.number); setTimeout(() => subs?.renderer?.resize(), 200); cache.setEntry(caches.HISTORY, 'lastSubtitle', { ...(cache.getEntry(caches.HISTORY, 'lastSubtitle') || {}), [media?.media?.id || media?.title || media?.parseObject?.title || media?.parseObject?.file_name]: trackName }) }} class='pb-5'> <!-- stupid fix (resize) because video metadata doesn't update for multiple frames -->
                    {trackName}
                  </label>
                {/if}
              {/each}
              <div class='mb-5 invisible'></div>
              <div class='subtitle-offset'>
                <div role='button' aria-label='Add External Subtitles' class='position-absolute not-reactive' title='Add External Subtitles' style='margin-left: 0.1rem !important; margin-top: 0.3rem !important' use:click={(target) => { fileInput.click(); toggleDropdown(target) }}>
                  <FilePlus2 size='2rem' strokeWidth={2.5} />
                </div>
                <input type='text' inputmode='numeric' pattern='-?[0-9]*.?[0-9]*' step='0.1' title='Subtitle Offset' bind:value={subDelay} on:click|stopPropagation class='form-control text-right form-control-sm not-reactive' />
              </div>
            </div>
          </div>
        </div>
      {/if}
      <!--{#if 'PresentationRequest' in window && canCast && current}-->
      <!--  <span class='icon text-white ctrl mr-5 d-flex align-items-center text-white' title='Cast Video [D]' data-name='toggleCast' use:click={toggleCast}>-->
      <!--    {#if presentationConnection}-->
      <!--      <Cast size='2.5rem' fill='currentColor' strokeWidth={0} />-->
      <!--    {:else}-->
      <!--      <Cast size='2.5rem' strokeWidth={2.5} />-->
      <!--    {/if}-->
      <!--  </span>-->
      <!--{/if}-->
      {#if 'pictureInPictureEnabled' in document}
        <span class='icon text-white ctrl mr-5 d-none align-items-center' class:d-flex={!externalPlayback} title='Popout Window [P]' data-name='togglePopout' use:click={togglePopout}>
          {#if pip}
            <PictureInPicture size='2.5rem' strokeWidth={2.5} />
          {:else}
            <PictureInPicture2 size='2.5rem' strokeWidth={2.5} />
          {/if}
        </span>
      {/if}
      <span class='icon text-white ctrl mr-5 d-none align-items-center' class:d-flex={!externalPlayback} title='Fullscreen [F]' data-name='toggleFullscreen' use:click={toggleFullscreen}>
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
  .bg-tp .close {
    position: absolute;
    top: 0;
    right: 0;
    cursor: pointer;
    color: inherit;
    padding: var(--alert-close-padding);
    line-height: var(--alert-close-line-height);
    font-size: var(--alert-close-font-size);
    background-color: transparent;
    border-color: transparent;
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
  /*:fullscreen .ctrl[data-name='toggleCast'] {*/
  /*  display: none !important;*/
  /*}*/

  .pip video {
    opacity: 0.1%;
  }

  .middle .bufferingDisplay {
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

  .middle .bufferingPos {
    margin-bottom: 5rem;
  }

  .buffering .middle .bufferingDisplay {
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
  .pbf:hover {
    background: var(--tertiary-color);
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

  .mt-100 {
    margin-top: 10rem !important;
  }
  .h-20 {
    height: 2rem;
  }
  .rounded-10 {
    border-radius: 1rem;
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
        padding-top: max(var(--safe-area-top), env(safe-area-inset-top, 0)) !important;
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
