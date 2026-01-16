<script context='module'>
  import { writable } from 'simple-store-svelte'
  import AnimeResolver from '@/modules/anime/animeresolver.js'
  import { setHash, getHash, getId } from '@/modules/anime/animehash.js'
  import { videoRx, matchPhrase, isValidNumber } from '@/modules/util.js'
  import { tick } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { anilistClient } from '@/modules/anilist.js'
  import { mediaCache } from '@/modules/cache.js'
  import { episodesList } from '@/modules/episodes.js'
  import { settings } from '@/modules/settings.js'
  import { getAniMappings, getKitsuMappings, hasZeroEpisode } from '@/modules/anime/anime.js'
  import Debug from 'debug'
  const debug = Debug('ui:mediahandler')

  const episodeRx = /Episode (\d+) - (.*)/
  const TYPE_EXCLUSIONS = ['ED', 'ENDING', 'NCED', 'NCOP', 'OP', 'OPENING', 'PREVIEW', 'PV', 'TRAILER']

  /**
   * This works pretty well now but isn't the most well designed, primarily this could be improved to decrease load times and the number of anilist queries by storing verified media mapped to their torrent.
   *
   * TODO: rewrite the MediaHandler, put less focus on "nowPlaying" and separately store verified (resolved) media.
   */
  export const nowPlaying = writable({})

  export const files = writable([])

  const processed = writable([])
  const processedFiles = writable([])

  const noop = () => {}

  let playFile

  function updateCurrent (current) {
    handleCurrent(current)
    processed.set(processed.value)
    processedFiles.set(processedFiles.value)
  }

  function handleCurrent ({ detail }) {
    const nextMedia = detail?.media
    debug('Handling current media:', JSON.stringify(nextMedia?.parseObject))
    if (nextMedia?.parseObject) handleMedia(nextMedia)
  }

  export function findInCurrent (obj) {
    if (!settings.value.rssAutofile) return false
    const oldNowPlaying = nowPlaying.value
    if ((oldNowPlaying.media?.id === obj.media?.id && oldNowPlaying.episode === obj.episode)) return false
    const fileList = sortFiles(processedFiles?.value?.length >= 1 ? processedFiles.value : files.value, oldNowPlaying)
    let targetFile = fileList.find(file => file.media?.media?.id === obj.media?.id && (Number(file.media?.parseObject?.episode_number || 0) === obj.episode || obj.media?.episodes === 1 || (!obj.media?.episodes && (obj.episode === 1 || !obj.episode) && (oldNowPlaying.episode === 1 || !oldNowPlaying.episode)))) // movie check
    if (!targetFile) targetFile = fileList.find(file => file.media?.media?.id === obj.media.id && (file.media?.episode === obj.episode || obj.media?.episodes === 1 || (!obj.media?.episodes && (obj.episode === 1 || !obj.episode) && (oldNowPlaying.episode === 1 || !oldNowPlaying.episode)))) // movie check
    if (!targetFile) {
      const resolvedHash = getHash(obj.media?.id, { episode: obj.episode, client: true, batchGuess: true }, false, true)
      if (resolvedHash) { // We have a cached and active hash with the requested media and episode, its predicted we should use this.
          window.dispatchEvent(new CustomEvent('add', { detail: { resolvedHash, search: { media: obj.media, episode: obj.episode } } }))
          return true
      }
      return false
    }
    if (oldNowPlaying?.media?.id !== obj?.media?.id) {
      handleMedia(obj, { media: obj.media, episode: obj.episode })
      handleFiles(fileList, targetFile).catch(e => {
            toast.error('File Error', {
                description: e?.message || String(e),
                duration: 30000
            })
          console.error(e)
        }) // targetFile is defined to force the targetFile media to load instead of the lowestUnwatched, lowestPlanning, or lowestCurrent
    } else {
      playFile(targetFile)
    }
    return true
  }

  const zeroEpisodes = new Map()
  export async function checkForZero(media) {
    if (zeroEpisodes.has(`${media?.id}`)) {
        return zeroEpisodes.get(`${media?.id}`)
    }
    const promiseData = (async () => await hasZeroEpisode(media))()
    zeroEpisodes.set(`${media?.id}`, promiseData)
    return promiseData
  }

  /**
   * Dynamically detects the number of episodes combined into a single video file.
   * This is useful for series like "I'm Living With a Otaku NEET Kunoichi?!", where two or more episodes are merged into one file.
   *
   * An episode range is displayed visually in the player, but for auto-completion, the highest episode number is used when the full video file is watched.
   * @param {Object} current - The currently playing video file.
   * @param {number} duration - The duration of the video in seconds.
   */
  async function handleRanged({ detail: { current, duration } }) {
      if (duration && (duration > 120) && nowPlaying.value?.episode && nowPlaying.value?.media?.duration && !nowPlaying.value?.episodeRange) {
          // We need check the mappings to verify that the episode isn't actually an ultra-long premiere episode like "Oshi No Ko", Anilist doesn't differentiate these so we need to manually check.
          const mappings = (!nowPlaying.value.media.episodes || !nowPlaying.value.media.episodes <= 100) && (await getAniMappings(nowPlaying.value.media.id) || {})?.episodes
          const episode = mappings && (mappings[nowPlaying.value.episode] || Object.values(mappings)?.find(episode => ((episode.episode || episode.episodeNumber) && Number((episode.episode || episode.episodeNumber))) === Number(nowPlaying.value.episode) && episode.length > 1))
          debug(`Duration of the current media has changed, checking for multiple episodes in the video file for: ${JSON.stringify(nowPlaying.value.parseObject)}`)
          const mediaDuration = (episode?.length && episode.length * 60) || (nowPlaying.value.media.duration * 60)
          if (duration > (mediaDuration + 360)) { // Add 6 minutes (360 second) buffer
              const episodeMultiplier = Math.round(duration / mediaDuration) // Round to nearest whole number
              const startingEpisode = (nowPlaying.value.episode * episodeMultiplier) - (episodeMultiplier - 1)
              const finalEpisode = nowPlaying.value.episode * episodeMultiplier
              if (startingEpisode !== finalEpisode) {
                  debug(`Multiple episodes have been detected in the video file for: ${JSON.stringify(nowPlaying.value.parseObject)}`)
                  current.media.episodeRange = {
                      first: startingEpisode,
                      last: finalEpisode
                  }
                  await handleMedia({
                      media: nowPlaying.value.media,
                      episode: nowPlaying.value.episode,
                      episodeRange: current.media.episodeRange,
                      parseObject: nowPlaying.value.parseObject,
                      failed: nowPlaying.failed,
                  })
                  setTimeout(() =>{
                      setHash(current.infoHash, {
                          fileHash: current.fileHash,
                          mediaId: current.media.media.id,
                          episodeRange: current.media.episodeRange,
                          episode: current.media.episode || current.media.parseObject.episode_number,
                          season: current.media.season || current.media.parseObject.anime_season,
                          parseObject: current.media.parseObject,
                          failed: current.media.failed || current.media.parseObject.failed
                      })
                  })
              }
          }
      }
  }

  async function handleMedia (opts, newPlaying) {
    if (opts?.media || opts?.episode || opts?.parseObject) {
      const { media, episode, episodeRange, parseObject } = opts
      const zeroEpisode = media && await checkForZero(media)
      const ep = (Number(episode || parseObject?.episode_number) === 0) || (zeroEpisode && !episode) ? 0 : (Number(episode || parseObject?.episode_number) || null)
      const streamingTitle = media?.streamingEpisodes?.find(episode => episodeRx.exec(episode.title) && Number(episodeRx.exec(episode.title)?.[1]) === ep)
      let streamingEpisode
      if (!newPlaying && (!streamingEpisode || !episodeRx.exec(streamingEpisode.title) || episodeRx.exec(streamingEpisode.title)[2].toLowerCase()?.trim()?.startsWith('episode') || media?.streamingEpisodes?.find(episode => episodeRx.exec(episode.title) && Number(episodeRx.exec(episode.title)[1]) === (media?.episodes + 1)))) {
        // better episode title fetching, especially for "two cour" anime releases like Dead Mount Play... shocker, the anilist database for streamingEpisodes can be wrong!
        const mappings = await getAniMappings(media?.id) || {}
          if (/episode\s*0/i.test(mappings?.episodes?.[1]?.title?.en || mappings?.episodes?.[1]?.title?.jp)) {
            delete mappings?.episodes?.[1]
            mappings.episodes = Object.keys(mappings.episodes).sort((a, b) => a - b).reduce((acc, key, index) => {
                acc[index + 1] = mappings.episodes?.[key]
                return acc
            }, {})
          }
        const { episodes, specialCount, episodeCount } = mappings
        let mappingsTitle = episode && episodes && episodes[Number(episode)]?.title?.en
        if (episode && (!mappingsTitle || mappingsTitle.length === 0)) {
          const kitsuMappings = (await getKitsuMappings(media?.id))?.data?.find(ep => ep?.attributes?.number === Number(episode))?.attributes
          mappingsTitle = kitsuMappings?.titles?.en_us || kitsuMappings?.titles?.en_jp || (episodes && episodes[Number(episode)]?.title?.jp)
        }
        const needsValidation = !(!specialCount || (media?.episodes === episodeCount && episodes && episodes[Number(episode)]))
        streamingEpisode = (!needsValidation && mappingsTitle && episodeRx.exec(`Episode ${Number(episode)} - ` + mappingsTitle)) ? {title: (`Episode ${Number(episode)} - ` + mappingsTitle)} : (needsValidation && media?.status === 'FINISHED') ? {title: (`Episode ${Number(episode)} - ` + (mappingsTitle || `Episode ${Number(episode)}`))} : streamingTitle
        if (!streamingEpisode || !episodeRx.exec(streamingEpisode.title) || episodeRx.exec(streamingEpisode.title)[2].toLowerCase()?.trim()?.startsWith('episode')) {
          const episodeTitle = await episodesList.getSingleEpisode(media?.idMal, Number(episode)) // animappings sometimes doesn't have all the data, so we can use an alternative api to fetch episode information.,
          if (episodeTitle && episodeTitle?.title) streamingEpisode = {title: (`Episode ${Number(episode)} - ` + episodeTitle.title)}
        }
      }
      if (!streamingEpisode) streamingEpisode = streamingTitle
      if (streamingEpisode?.title) {
        const titleParts = streamingEpisode.title.split(' - ')
        streamingEpisode.title = (titleParts?.[0]?.trim() === titleParts?.[1]?.trim()) ? titleParts?.[0]?.trim() : streamingEpisode.title
      }

      const details = {
        title: anilistClient.title(media) || parseObject?.anime_title || parseObject?.file_name,
        zeroEpisode,
        episode: ep,
        episodeRange,
        episodeTitle: (streamingEpisode && (episodeRx.exec(streamingEpisode.title)?.[2] || episodeRx.exec(streamingEpisode.title))) || ((media?.format === 'MOVIE' && (media?.episodes ?? 0) <= 1) ? 'The Movie' : ''),
        thumbnail: media?.coverImage?.extraLarge
      }

      nowPlaying.set({
          ...(newPlaying ? newPlaying : {}),
          media,
          parseObject,
          failed: opts.failed || parseObject?.failed,
          ...details
      })
      if (!newPlaying) setMediaSession(nowPlaying.value)
      debug(`Now playing as been set to: ${JSON.stringify(details)}`)
    } else nowPlaying.set({ failed: true }) // If the file exists, we should always play it.
  }

  // find the best media in batch to play
  // currently in progress or unwatched
  // tv, movie, ona, ova, special
  async function findPreferredPlaybackMedia (files, targetFile) {
    const videoFiles = targetFile ? (files.filter(file => file.media?.media?.id === targetFile?.media?.media?.id) || files) : files // force the requested target files to load.

    // force play the target file if we are specifically requesting it, but do need to validate it still exists.
    if (targetFile) {
        for (const { media } of videoFiles) {
            if ((media?.media?.id === targetFile?.media?.media?.id) && (media?.episode === targetFile?.media?.episode) && (!targetFile?.media?.season || (media?.season === targetFile?.media?.season))) return { media: (mediaCache.value[media?.media?.id] || media?.media), episode: media?.episode, season: media?.season }
        }
    }

    // watching
    for (const { media } of videoFiles) {
      const cachedMedia = mediaCache.value[media?.media?.id] || media?.media
      const zeroEpisode = await checkForZero(cachedMedia)
      if (cachedMedia?.mediaListEntry?.status === 'CURRENT') return { media: cachedMedia, episode: (cachedMedia.mediaListEntry.progress || 0) + (!zeroEpisode ? 1 : 0), season: media?.season }
    }

    // rewatching
    for (const { media } of videoFiles) {
      const cachedMedia = mediaCache.value[media?.media?.id] || media?.media
      const zeroEpisode = await checkForZero(cachedMedia)
      if (cachedMedia?.mediaListEntry?.status === 'REPEATING') return { media: cachedMedia, episode: (cachedMedia.mediaListEntry.progress || 0) + (!zeroEpisode ? 1 : 0), season: media?.season }
    }

    // paused
    for (const { media } of videoFiles) {
      const cachedMedia = mediaCache.value[media?.media?.id] || media?.media
      const zeroEpisode = await checkForZero(cachedMedia)
      if (cachedMedia?.mediaListEntry?.status === 'PAUSED') return { media: cachedMedia, episode: (cachedMedia.mediaListEntry.progress || 0) + (!zeroEpisode ? 1 : 0), season: media?.season }
    }

    // dropped
    for (const { media } of videoFiles) {
      const cachedMedia = mediaCache.value[media?.media?.id] || media?.media
      const zeroEpisode = await checkForZero(cachedMedia)
      if (cachedMedia?.mediaListEntry?.status === 'DROPPED') return { media: cachedMedia, episode: (cachedMedia.mediaListEntry.progress || 0) + (!zeroEpisode ? 1 : 0), season: media?.season }
    }

    // planning
    let lowestPlanning
    for (const { media } of videoFiles) {
      const cachedMedia = mediaCache.value[media?.media?.id] || media?.media
      if (cachedMedia?.mediaListEntry?.status === 'PLANNING' && (!lowestPlanning || (((Number(lowestPlanning.episode) >= Number(media?.episode)) || (media?.episode && !lowestPlanning.episode)) && Number(lowestPlanning.season) >= Number(media?.season)))) lowestPlanning = { media: cachedMedia, episode: media?.episode, season: media?.season }
    }
    if (lowestPlanning) return lowestPlanning

    // unwatched
    let lowestUnwatched
    // for (const format of ['TV', 'MOVIE', 'ONA', 'OVA', 'SPECIAL']) {
    //   for (const { media } of videoFiles) {
    //     const cachedMedia = mediaCache.value[media?.media?.id] || media?.media
    //     if (cachedMedia?.format === format && !cachedMedia.mediaListEntry && (!lowestUnwatched || (((Number(lowestUnwatched.episode) >= Number(media?.episode)) || (media?.episode && !lowestUnwatched.episode)) && ((Number(lowestUnwatched.season) >= Number(media?.season)) && (cachedMedia?.format !== 'SPECIAL' || (mediaCache.value[lowestUnwatched?.media?.id] || lowestUnwatched?.media)?.format === 'SPECIAL'))))) lowestUnwatched = { media: cachedMedia, episode: media?.episode, season: media?.season }
    //   }
    // }
    // Probably better to prefer the lowest media id as going by format is unreliable... ids of series should be sequential (in order of release) so this should be fine?
    for (const { media } of videoFiles) {
      const cachedMedia = mediaCache.value[media?.media?.id] || media?.media
      if (!cachedMedia || cachedMedia.mediaListEntry) continue
      const ep = media?.episode != null ? Number(media.episode) : Infinity
      const season = media?.season != null ? Number(media.season) : Infinity
      if (!lowestUnwatched) lowestUnwatched = { media: cachedMedia, episode: ep, season }
      else if (cachedMedia.id < lowestUnwatched.media?.id || (cachedMedia.id === lowestUnwatched.media?.id && (season < (lowestUnwatched.season != null ? Number(lowestUnwatched.season) : Infinity) || (season === (lowestUnwatched.season != null ? Number(lowestUnwatched.season) : Infinity) && ep < (lowestUnwatched.episode != null ? Number(lowestUnwatched.episode) : Infinity))))) lowestUnwatched = { media: cachedMedia, episode: ep, season }
    }
    if (lowestUnwatched) return lowestUnwatched

    // highest occurrence if all else fails - unlikely
    const max = highestOccurrence(videoFiles, file => file.media?.media?.id)?.media
    if (max?.media) {
      const zeroEpisode = await checkForZero(max?.media)
      return { media: max.media, episode: ((mediaCache.value[max.media?.id] || max.media).mediaListEntry?.progress + (!zeroEpisode ? 1 : 0) || (!zeroEpisode ? 1 : 0)) }
    }
  }

  function fileListToDebug (files) {
    return files?.map(({ name, media }) => `\n${name} ${media?.parseObject?.anime_title} ${media?.parseObject?.anime_season}:${media?.parseObject?.episode_number} ${media?.media?.id}:${media?.media?.title?.userPreferred} ${media?.season}:${media?.episode}`).join('')
  }

  /**
   * Attempts to fix any weird edge-cases with bad release groups (Judas).
   * The fact that this is even needed is extremely disappointing.
   *
   * @param videoFiles - The video files to be corrected.
   * @return The corrected video files.
   */
  function cleanFiles(videoFiles) {
    // Kiss X Sis fix, release group specified OVA and TV without the TV tag, making this unresolvable unless we correct.
    if (videoFiles.some(file => matchPhrase(AnimeResolver.cleanFileName(file.name), ['Kiss X Sis OVA', 'KissXSis OVA', 'Kiss×Sis OVA'], 0.3, false))
        && videoFiles.some(file => !matchPhrase(AnimeResolver.cleanFileName(file.name), ['Kiss X Sis OVA', 'KissXSis OVA', 'Kiss×Sis OVA'], 0.3, false && matchPhrase(AnimeResolver.cleanFileName(file.name), ['Kiss X Sis', 'KissXSis', 'Kiss×Sis'], 0.3, false)))) {
        videoFiles.forEach(file => {
            if (videoFiles.some(file => matchPhrase(AnimeResolver.cleanFileName(file.name), ['Kiss X Sis OVA', 'KissXSis OVA', 'Kiss×Sis OVA'], 0.3, false))) {
                file.name = file.name.replace(/Kiss[ ×]?X[ ×]?Sis[ ]?OVA/i, 'Kiss×Sis')
            } else if (matchPhrase(AnimeResolver.cleanFileName(file.name), ['Kiss X Sis', 'KissXSis', 'Kiss×Sis'], 0.3, false)) {
                file.name = file.name.replace(/Kiss[ ×]?X[ ×]?Sis(?!.*OVA)/i, 'Kiss×Sis (TV)')
            }
        })
        debug(`Detected Kiss×Sis, found OVA defined but additional files are missing it! Files have been corrected to remove OVA and specify TV.`, fileListToDebug(videoFiles))
    }
    return videoFiles
  }

  async function handleFiles (files, targetFile) {
    debug(`Got ${files?.length} files`, fileListToDebug(files))
    if (!files?.length) {
        processed.set(files)
        processedFiles.set(files)
        return
    }
    let videoFiles = []
    const otherFiles = []
    const torrentNames = []
    for (const file of files) {
      if (videoRx.test(file.name)) {
        videoFiles.push(file)
      } else {
        otherFiles.push(file)
      }
      if (file.torrent_name) torrentNames.push(file.torrent_name)
    }
    videoFiles = cleanFiles(videoFiles)

    // assign any resolved media to their video files that haven't failed to be resolved.
    let resolved = []
    for (const file of videoFiles) {
        const cached = getId(file.infoHash, { fileHash: file.fileHash })
        if (cached && cached.mediaId && mediaCache.value[cached.mediaId]) file.media = { ...cached, failed: cached.failed || cached.parseObject?.failed, media: mediaCache.value[cached.mediaId] }
    }

    let uncachedMedia = videoFiles.filter(file => !file.media)
    if (uncachedMedia?.length) {
        try {
            resolved = await AnimeResolver.resolveFileAnime(uncachedMedia.map(file => file.name))
        } catch (e) {
            debug(e)
        }
    }

    if (resolved?.length) {
        videoFiles.forEach((file) => {
            const parseObject = resolved.find(({parseObject}) => AnimeResolver.cleanFileName(file.name).includes(parseObject.file_name))
            if (parseObject && !parseObject.failed) {
                file.media = parseObject
                 setHash(file.infoHash, {
                     fileHash: file.fileHash,
                     mediaId: parseObject.media?.id,
                     episode: parseObject.episode,
                     season: parseObject.season,
                     parseObject: parseObject.parseObject,
                     failed: parseObject.failed
                 })
            }
        })
    }

    // Identify files that still need to be resolved, attempting again using the torrent name instead.
    let failedToResolve = videoFiles.filter(file => !file.media)
    if (failedToResolve.length) {
      debug('Some media files failed to resolve using the file name, trying again using the torrent name...')
      const torrentName = [...new Set(torrentNames)][0] // temporary, may need to handle multiple torrents in the future.
      let resolvedByName = []
      try {
        resolvedByName = await AnimeResolver.resolveFileAnime(failedToResolve.map(file => `${torrentName} ${file.name}`))
      } catch (e) { console.error(e) }
      failedToResolve.forEach((file) => {
        const parseObject = resolvedByName.find(({ parseObject }) => AnimeResolver.cleanFileName(`${torrentName} ${file.name}`).includes(parseObject.file_name))
        if (Object.keys(parseObject ?? {}).length) {
          const failedEntry = resolved.find(result => AnimeResolver.cleanFileName(result.parseObject.file_name) === AnimeResolver.cleanFileName(file.name))
          const animeType = failedEntry?.parseObject?.anime_type
          if (animeType) parseObject.parseObject.anime_type = animeType
          const failedEpisode = failedEntry?.episode || failedEntry?.parseObject?.episode_number
          const failedSeason = failedEntry?.season || failedEntry?.parseObject?.season_number
          if (failedEpisode) {
            parseObject.episode = failedEpisode
            if (parseObject.parseObject) parseObject.parseObject.episode_number = failedEpisode
          }
          if (failedSeason) {
            parseObject.season = failedSeason
            if (parseObject.parseObject) parseObject.parseObject.season_number = failedSeason
          }
          if (parseObject?.failed) { // hacky fix to remove the episode number when it failed to resolved, when using the torrent name + file name the resolver has a bias toward detecting the video resolution as the episode number.
            if (parseObject?.parseObject?.episode_number && (String(parseObject?.parseObject?.episode_number || '') === String(failedEntry?.parseObject?.video_resolution || '').replace('p', ''))) delete parseObject.parseObject.episode_number
            if (parseObject?.episode && (String(parseObject?.episode || '') === String(failedEntry?.parseObject?.video_resolution || '').replace('p', ''))) delete parseObject.episode
          }
          file.media = parseObject
          setHash(file.infoHash, {
            fileHash: file.fileHash,
            mediaId: parseObject.media?.id,
            episode: parseObject.episode,
            season: parseObject.season,
            parseObject: parseObject.parseObject,
            failed: parseObject.failed
          })
        }
      })
    }

    failedToResolve = videoFiles.filter(file => !file.media)
    if (failedToResolve.length) {
        resolved = await AnimeResolver.findAndCacheTitle(AnimeResolver.cleanFileName(videoFiles.map(file => file.name)), false)
        failedToResolve.forEach((file) => {
            const parseObject = resolved.find((parseObject) => AnimeResolver.cleanFileName(file.name).includes(parseObject?.file_name))
            if (parseObject) file.media = { parseObject: { ...parseObject }, ...(parseObject?.episode_number ? { episode: parseObject?.episode_number ? Number(parseObject.episode_number) : 1 } : {}), ...(parseObject?.anime_season ? { season: parseObject?.anime_season ? Number(parseObject.anime_season) : 1 } : {}), failed: true }
        })
    }
    videoFiles?.sort((a, b) => a.media?.media?.id - b.media?.media?.id) // group media ids together for easier readability.
    debug(`Resolved ${videoFiles?.length} video files`, fileListToDebug(videoFiles))

    const resolvedFiles = videoFiles?.length
    if (resolvedFiles > 1) { // Only filter if we are resolving a batch.
      videoFiles = videoFiles.filter(file => {
          if (typeof file.media?.parseObject?.anime_type === 'string') return !TYPE_EXCLUSIONS.includes(file.media?.parseObject?.anime_type.toUpperCase())
          else if (Array.isArray(file.media?.parseObject?.anime_type)) { // rare edge cases where the type is an array, only batches like a full season + movie + special.
              for (let animeType of file.media?.parseObject?.anime_type) {
                  if (TYPE_EXCLUSIONS.includes(animeType.toUpperCase())) return false
              }
          } else if (!file.media?.parseObject?.anime_type) { // Could be hit-miss but its really down to release groups using proper file names
              for (const exclusion of TYPE_EXCLUSIONS) {
                  if ((file.name.length - exclusion.length) <= 10 && file.name.toUpperCase().includes(exclusion)) return false
              }
          }
          return true
      })
      debug(`Removed matching type exclusions for ${resolvedFiles - videoFiles?.length} video files`, fileListToDebug(videoFiles))
    }

    const newPlaying = await findPreferredPlaybackMedia(videoFiles, targetFile)
    debug(`Found preferred playback media: ${newPlaying?.media?.id}:${newPlaying?.media?.title?.userPreferred} ${newPlaying?.episode}`)

    const filtered = newPlaying?.media && videoFiles.filter(file => (file.media?.media?.id && file.media?.media?.id === newPlaying?.media?.id) || !file.media?.media?.id)
    debug(`Filtered ${filtered?.length} files based on media`, fileListToDebug(filtered))

    let result
    if (filtered?.length) {
      result = filtered
    } else {
      const max = highestOccurrence(videoFiles, file => file.media?.parseObject?.anime_title)?.media?.parseObject?.anime_title
      if (max) {
          debug(`Highest occurrence anime title: ${max}`)
          result = videoFiles.filter(file => file.media?.parseObject?.anime_title === max)
      } else {
          result = remapByTitle(videoFiles)
          debug(`All occurrences were identical, guessing the episode and/or season and attaching to the files`, fileListToDebug(result))
      }
    }
    result = sortFiles(result, newPlaying)
    debug(`Sorted ${result.length} files`, fileListToDebug(result))

    processed.set([...result, ...otherFiles])
    processedFiles.set([...sortFiles(videoFiles, newPlaying)])
    await tick()
    const file = (newPlaying?.episode && (result.find(({ media }) => media.episode === newPlaying.episode) || result.find(({ media }) => media.episode === 1))) || result[0]
    if (!file) throw new Error('No playable files were detected in this torrent. Choose another release.')
    playFile(file || 0)
    await handleMedia(file?.media, newPlaying)
  }

  function sortFiles (result, newPlaying) {
      result = remapByTitle(result)
      if (newPlaying?.media?.id) {
          result.sort((a, b) => {
              const seasonA = a.media?.parseObject?.anime_season
              const seasonB = b.media?.parseObject?.anime_season
              if (!isValidNumber(seasonA) && !isValidNumber(seasonB)) return 0
              if (!isValidNumber(seasonA)) return 1
              if (!isValidNumber(seasonB)) return -1
              return seasonA - seasonB
          })
      } else result.sort((a, b) => Number(a.media?.parseObject?.episode_number ?? 1) - Number(b.media?.parseObject?.episode_number ?? 1)).sort((a, b) => Number(b.media?.parseObject?.anime_season ?? 1) - Number(a.media?.parseObject?.anime_season ?? 1))
      result.sort((a, b) => a.media?.episode - b.media?.episode)
      result.sort((a, b) => a.media?.media?.id - b.media?.media?.id)
      return result
  }

  // find element with most occurrences in array according to map function, if occurrences are identical return null.
  const highestOccurrence = (arr = [], mapfn = a => a) => {
      const result = arr.reduce((acc, el) => {
          const mapped = mapfn(el)
          acc.sums[mapped] = (acc.sums[mapped] || 0) + 1
          acc.max = (acc.max != null ? acc.sums[mapfn(acc.max)] : -1) > acc.sums[mapped] ? acc.max : el
          return acc
      }, { sums: {} })
      const occurrences = Object.values(result.sums)
      return occurrences.every(count => count === occurrences[0]) ? null : result.max
  }

  // map the episode and season by attempting to fetch them from the title, should only occur in when there is a severe error in media resolving.
  const remapByTitle = (arr = []) => {
      return arr.map((el) => {
          if (!el.media?.episode) {
              const matches = el.media?.parseObject?.anime_title?.match(/(\d{2})/g)
              if (matches && matches.length > 0) {
                  const seasonNumber = matches[0]
                  const episodeNumber = matches[matches.length - 1]
                  el.media.season = parseInt(seasonNumber)
                  el.media.episode = parseInt(episodeNumber)
                  el.media.parseObject.anime_title = el.media?.parseObject?.anime_title?.replace(seasonNumber, '').replace(episodeNumber, '').trim()
              }
          }
          return el
      })
  }

  files.subscribe(async (files = []) => {
      handleFiles(files).catch(e => {
          toast.error('File Error', {
              description: e?.message || String(e),
              duration: 30000
          })
          console.error(e)
      })
    return noop
  })

  function setMediaSession (nowPlaying) {
    if (typeof MediaMetadata === 'undefined') return
    const name = [nowPlaying.title, nowPlaying.episode, nowPlaying.episodeTitle, 'Shiru'].filter(i => i).join(' - ')

    navigator.mediaSession.metadata = nowPlaying.thumbnail
        ? new MediaMetadata({
            title: name,
            artwork: [
                {
                    src: nowPlaying.thumbnail,
                    sizes: '256x256',
                    type: 'image/jpg'
                }
            ]
        })
        : new MediaMetadata({ title: name })
  }
</script>

<script>
  import Player from '@/views/Player/Player.svelte'

  export let miniplayer = false
  export let page = 'home'
  export let overlay = []
  export let playPage = false
</script>

<Player files={$processed} playableFiles={$processedFiles} {miniplayer} media={$nowPlaying} bind:playFile bind:page bind:overlay bind:playPage on:current={handleCurrent} {updateCurrent} on:duration={handleRanged} />
