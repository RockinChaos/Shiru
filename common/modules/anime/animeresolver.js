import { anilistClient } from '@/modules/anilist.js'
import { cache } from '@/modules/cache.js'
import { anitomyscript, hasZeroEpisode } from '@/modules/anime/anime.js'
import { chunks, matchKeys } from '@/modules/util.js'
//import levenshtein from 'js-levenshtein'
import Debug from 'debug'
const debug = Debug('ui:animeresolver')

const postfix = {
  1: 'st', 2: 'nd', 3: 'rd'
}

export default new class AnimeResolver {
  // name: media cache from title resolving
  animeNameCache = {}

  /**
   * @param {import('anitomyscript').AnitomyResult} obj
   * @returns {string}
   */
  getCacheKeyForTitle (obj) {
    let key = obj.anime_title
    if (obj.anime_year) key += obj.anime_year
    if (obj.release_information) key += obj.release_information
    return key
  }

  /**
   * @param {string} title
   * @returns {string[]}
   */
  alternativeTitles (title) {
    const titles = new Set()

    let modified = title
    // preemptively change S2 into Season 2 or 2nd Season, otherwise this will have accuracy issues
    const seasonMatch = title.match(/ S(\d+)/)
    if (seasonMatch) {
      if (Number(seasonMatch[1]) === 1) { // if this is S1, remove the " S1" or " S01"
        modified = title.replace(/ S(\d+)/, '')
        titles.add(modified)
      } else {
        modified = title.replace(/ S(\d+)/, ` ${Number(seasonMatch[1])}${postfix[Number(seasonMatch[1])] || 'th'} Season`)
        titles.add(modified)
        titles.add(title.replace(/ S(\d+)/, ` Season ${Number(seasonMatch[1])}`))
      }
    } else {
      titles.add(title)
    }

    // remove - :
    const specialMatch = modified.match(/[-:]/g)
    if (specialMatch) {
      modified = modified.replace(/[-:]/g, '').replace(/[ ]{2,}/, ' ')
      titles.add(modified)
    }

    // remove (TV)
    const tvMatch = modified.match(/\(tv\)/i)
    if (tvMatch) {
      modified = modified.replace(/\(tv\)/i, '')
      titles.add(modified)
    }

    // Remove (Movie)
    const movieMatch = modified.match(/\(movie\)/i) || modified.match(/movie/i)
    if (movieMatch) {
      modified = modified.replace(/\(movie\)/i, '').replace(/movie/i, '')
      titles.add(modified)
    }

    // Remove (OVA)
    const ovaMatch = modified.match(/\(ova\)/i) || modified.match(/ova/i)
    if (ovaMatch) {
      modified = modified.replace(/\(ova\)/i, '').replace(/ova/i, '')
      titles.add(modified)
    }

    // Remove (OAV)
    const oavMatch = modified.match(/\(oav\)/i) || modified.match(/oav/i)
    if (oavMatch) {
      modified = modified.replace(/\(oav\)/i, '').replace(/oav/i, '')
      titles.add(modified)
    }

    // Remove (ONA)
    const onaMatch = modified.match(/\(ona\)/i) || modified.match(/ona/i)
    if (onaMatch) {
      modified = modified.replace(/\(ona\)/i, '').replace(/ona/i, '')
      titles.add(modified)
    }

    // Remove Episode Titles identified by -
    const splitMatch = title.match(/\s+-\s+/)
    if (splitMatch) {
      titles.add(title.split(/\s+-\s+/)[0].trim())
    }

    // Detect and add alternate title within parentheses
    const multiTitleMatch = modified.match(/^(.+?)\s*\((.+?)\)$/)
    if (multiTitleMatch) {
      const [_, mainTitle, altTitle] = multiTitleMatch
      titles.add(mainTitle.trim())
      titles.add(altTitle.trim())
    }

    // Remove numbers with spaces
    const numbersMatch = modified.match(/\s?\d{2,}(?:\s?\d{2,})*\s?/g, '')
    if (numbersMatch) {
      modified = modified.replace(/\s?\d{2,}(?:\s?\d{2,})*\s?/g, '')
      titles.add(modified)
    }
    return [...titles]
  }

/*  /!**
   * @param {import('../al.d.ts').Media} media
   * @param {string} name
   * @param {number} threshold (optional, percentage of title length)
   * @returns {boolean}
   *!/
  matchesTitle(media, name, threshold = 0.2) { // Decent but is still hit-miss, #isVerified is more accurate.
    if (!media) return false
    const target = name.toLowerCase()
    const maxDistance = Math.floor(target.length * threshold)
    for (const title of [ ...Object.values(media.title || {}), ...(media.synonyms || [])].filter(Boolean)) {
      if (levenshtein(title.toLowerCase(), target) <= maxDistance) return true
    }
    return false
  }*/

  /**
   * resolve anime name based on file name and store it
   * @param {import('anitomyscript').AnitomyResult[]} parseObjects
   */
  async findAnimesByTitle (parseObjects) {
    if (!parseObjects.length) return
    const titleObjects = parseObjects.flatMap(obj => {
      const key = this.getCacheKeyForTitle(obj)
      const titles = this.alternativeTitles(this.cleanFileName(obj.anime_title))
      const titleObjects = titles.flatMap(title => {
        const titleObject = { title, key, isAdult: false }
        const titleVariants = [{ ...titleObject }]
        if (obj.anime_year) titleVariants.unshift({ ...titleObject, year: obj.anime_year })
        if (obj.release_information?.length > 0) {
          if (obj.anime_year) titleVariants.unshift({...titleObject, title: title + ' ' + obj.release_information, year: obj.anime_year})
          titleVariants.unshift({...titleObject, title: title + ' ' + obj.release_information})
        }
        return titleVariants
      })
      titleObjects.push({ ...titleObjects.at(-1), isAdult: true })
      return titleObjects
    })
    debug(`Finding ${titleObjects?.length} titles: ${titleObjects?.map(obj => obj.title).join(', ')}`)

    const missingTitles = titleObjects
    // Works pretty well but has edge cases that cause it to choose incorrect media, primarily issues with sequel series like Shield Hero.
    // const missingTitles = []
    // for (const titleObj of titleObjects) {
    //   let foundInCache = false
    //   const candidates = []
    //   for (const media of Object.values(mediaCache.value)) {
    //     const scoredMedia = getDistanceFromTitle(media, titleObj.title)
    //     if (scoredMedia?.lavenshtein != null) candidates.push(scoredMedia)
    //   }
    //   candidates.sort((a, b) => a.lavenshtein - b.lavenshtein)
    //   for (const media of candidates.slice(0, 25)) {
    //     if (!this.animeNameCache?.[titleObj.key] && this.isVerified(media, { anime_title: titleObj.title, anime_year: titleObj.year }, ['title.userPreferred', 'title.english', 'title.romaji', 'title.native', 'synonyms'], titleObj.title.length > 15 ? 0.15 : titleObj.title.length > 9 ? 0.1 : 0.05)) {
    //       this.animeNameCache[titleObj.key] = media
    //       debug(`Cache hit: ${titleObj.title} -> ${media?.id}: ${media?.title?.userPreferred}`)
    //       foundInCache = true
    //       break
    //     }
    //   }
    //   if (!this.animeNameCache?.[titleObj.key] && !foundInCache) missingTitles.push(titleObj)
    // }

    if (missingTitles?.length > 0) debug(`Missing ${missingTitles?.length} titles as they were not found in the media cache, titles: ${missingTitles?.map(obj => obj.title).join(', ')}`)
    for (const chunk of chunks(missingTitles, 55)) {
      // single title has a complexity of 8.1, al limits complexity to 500, so this can be at most 62, undercut it to ~~60~~ 55, al pagination is 50, but at most we'll do 30 titles since isAdult duplicates each title
      const search = await anilistClient.alSearchCompound(chunk)
      if (!search || search?.errors) return
      for (const [key, media] of search) {
        if (!this.animeNameCache[key]) {
          debug(`Found ${key} as ${media?.id}: ${media?.title?.userPreferred}`)
          this.animeNameCache[key] = media
        } else {
          debug(`Duplicate key found ${key} as ${this.animeNameCache[key]?.id}: ${this.animeNameCache[key]?.title?.userPreferred}, skipping new value [${media?.id}: ${media?.title?.userPreferred}]`)
        }
      }
    }
  }

  /**
   * @param {number} id
   */
  async getAnimeById (id) {
    const cachedMedia = cache.getMedia(id)
    if (cachedMedia?.length) return cachedMedia
    const res = await anilistClient.searchIDSingle({ id })
    return res.data.Media
  }

  async findAndCacheTitle(fileName, findAnime = true) {
    const parseObjs = await anitomyscript(fileName)
    const TYPE_EXCLUSIONS = ['ED', 'ENDING', 'NCED', 'NCOP', 'OP', 'OPENING', 'PREVIEW', 'PV']

    /** @type {Record<string, import('anitomyscript').AnitomyResult>} */
    const uniq = {}
    for (const obj of parseObjs) {
      const key = this.getCacheKeyForTitle(obj)
      if (key in this.animeNameCache) continue // skip already resolved
      if (obj.anime_type && TYPE_EXCLUSIONS.includes((Array.isArray(obj.anime_type) ? obj.anime_type[0] : obj.anime_type).toUpperCase())) continue // skip non-episode media
      uniq[key] = obj
    }
    if (findAnime) await this.findAnimesByTitle(Object.values(uniq))
    return parseObjs
  }

  /**
   * Fixes issues with awful file names from groups like ToonsHub.
   * Because.They.Cant.Take.Two.Seconds.To.Design.A.Better.Name.Scheme.
   *
   * @param fileName Array or fileNames or a single fileName to be cleansed.
   * @returns {*}
   */
  cleanFileName(fileName) {
    const cleanName = (name) => {
      // Preserve specific patterns
      name = name
          .replace(/\b([A-Za-z]{3}\d)\.(\d)\b/g, '<<AUDIO_$1_$2>>')     // For AAC2.0, DDP2.0, etc.
          .replace(/\b(H|X)\.(\d{3})\b/g, '<<RES_$1_$2>>')              // For H.264, H.265, X.265, etc.
          .replace(/\b5\.1\b/g, '<<CHANNEL_5_1>>')                      // For 5.1 channels
          .replace(/\bFLAC5\.1\b/g, '<<AUDIO_FLAC_5_1>>')               // For FLAC5.1
          .replace(/\bVol\.(\d+)\b/g, '<<VOL_$1>>')                     // For Vol. followed by any digits

      // Remove file extensions and replace all remaining periods with spaces
      name = name.replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|mpeg|mpg|3gp|ogg|ogv)$/i, '').replace(/\./g, ' ')

      // Fix common naming issues, the unfortunate depression of horribly named releases. Please don't be like them, do better.
      name = name
          .replace('1-2', '1/2').replace('1_2', '1/2').replace('½', '1/2') // Ranma 1/2 fix.
          .replace(/\s*part\s*1\+2/i, '') // Primary Misfit of Demon King fix.
          .replace(/PANTY AND STOCKING/i, 'PANTY & STOCKING') // PANTY & STOCKING fix.
          .replace(/Link Click (Season\s*3|S\s*3|\s*03)/i, 'Link Click: Bridon Arc') // Link Click S3 fix.
          .replace(/Symphogear G (Season\s*2|S\s*2|\s*02)/i, 'Symphogear G') // Symphogear S2 fix. No you are not playing Season 2 of Symphogear G, why would you name it S2EXX but include the actual title.. that just makes it Season 1, aka "Symphogear G".
          .replace(/Symphogear GX (Season\s*3|S\s*3|\s*03)/i, 'Symphogear GX') // Symphogear S3 fix.... see above.
          .replace(/Symphogear AXZ (Season\s*4|S\s*4|\s*04)/i, 'Symphogear AXZ') // Symphogear S4 fix.... see above.
          .replace(/Symphogear XV (Season\s*5|S\s*5|\s*05)/i, 'Symphogear XV') // Symphogear S5 fix.... see above.
          .replace(/Kiss X Sis|KissXSis/i, 'Kiss×Sis') // Kiss X Sis fix, Anilist is weird using Unicode characters, not a release groups fault.
          .replace(/Steins_Gate|Steins Gate/i, 'Steins;Gate') // Fix for certain Steins;Gate series being strict about the semicolon.
          .replace(/Code Geass Movie 01|Code Geass Movie 1/i, 'Code Geass: Lelouch of the Rebellion I - Initiation') // Fix for bad Code Geass releases labeling Movie 1 as Rebellion I.
          .replace(/Code Geass Movie 02|Code Geass Movie 2/i, 'Code Geass: Lelouch of the Rebellion II - Transgression') // Fix for bad Code Geass releases labeling Movie 2 as Rebellion II.
          .replace(/Code Geass Movie 03|Code Geass Movie 3/i, 'Code Geass: Lelouch of the Rebellion III - Glorification') // Fix for bad Code Geass releases labeling Movie 3 as Rebellion III.
      if (name.match(/Steins;Gate/i) && name.match(/Movie/i)) name = (/Steins;Gate 0/i.test(name) ? name.replace(/Steins;Gate 0/i, 'Steins;Gate 0:') : name.replace(/Steins;Gate/i, 'Steins;Gate:')).replace(/The Movie/i, '').replace(/Movie/i, '') // Steins;Gate movies are very sensitive when resolving.
      if (name.match(/Steins;Gate/i) && name.match(/Divide|β|Beta/i)) name = name.replace(/23β|23 β|23\(β\)|23 \(β\)|β|23Beta|23 Beta|Open the Missing Link|Divide By Zero/i, 'Kyoukaimenjou No Missing Link - Divide By Zero').replace(/Episode 23|23|Episode/i, '') // Steins;Gate 23β incorrectly detects as Episode 23 of the main series, we need to use the full Romaji name.
      if (name.match(/Code Geass /i) && !name.match(/Lelouch|Dakkan|Dakken|Rozé|Roze|Rose|Movie|Akito|Recapture/i)) name = name.replace(/Code Geass/i, 'Code Geass: Hangyaku No Lelouch') // fixes the main series being detected as the Spin-off (alternative) series.
      if (name.match(/Yami Healer/i) && !name.match(/Isshun|Shiteita|Yakutatazu|Tsuihou|Sareta|Toshite|Tanoshiku/i)) name = name.replace(/Yami Healer/i, 'Isshun de Chiryou Shiteita no ni Yakutatazu to Tsuihou Sareta Tensai Chiyushi, Yami Healer Toshite Tanoshiku Ikiru') // stupid fix for a synonym that doesn't exist with The Brilliant Healer's New Life in the Shadows...
      if (name.match(/Kanchigai no Atelier Meister/i) && !name.match(/Mini|Short|Eiyuu|Party/i)) name = name.replace(/Kanchigai no Atelier Meister/i, 'The Unaware Atelier Meister') // stupid fix to prevent the Mini Anime from being fetched due to egregiously long romaji name in the TV series.
      if (name.match(/Prince/i) && name.match(/Tennis/i)) name = name.replace(/new /i, '') // Prince of Tennis fix.
      if (name.match(/Mugen Gacha/i) && !name.match(/Shinjiteita|Nakamatachi|Korosarekaketa|Fukushuu|Unlimited|Backstabbed|Backwater|Dungeon|Revenge/i)) name = name.replace(/Mugen Gacha/i, `My Gift Lvl 9999 Unlimited Gacha: Backstabbed in a Backwater Dungeon, I'm Out for Revenge!`) // My Gift Lvl 9999 Unlimited Gacha fix.
      if (name.match(/Gintama[: ]/i) && name.match(/3-nen|Z-gumi|Ginpachi/i) && !name.match(/Tuuuunnn/i)) name = name.replace(/Gintama[: ]?/i, '') // Mr. Ginpachi's Zany Class fix.
      if (name.match(/Mobile Suit Z /i)) name = name.replace(/ Z /i, ' Zeta ') // Mobile Suit Zeta Gundam fix.
      if (name.match(/Kaijuu 8-gou/i) && name.match(/Mission Recon/i)) name = name.replace(/- Mission Recon| -Mission Recon|Mission Recon/i, '').replace(/Kaijuu 8-gou/i, 'Kaiju No. 8: Mission Recon') // Kaiju No. 8: Mission Recon fix...
      if (name.match(/Living/i) && name.match(/Otaku/i) && name.match(/NEET Kunoichi/i)) name = name.replace(/ an /i, ' a ') // I'm Living With a Otaku NEET Kunoichi?! fix for release groups like ToonsHub using Engrish...
      if (name.match(/Seishun Buta Yarou wa Bunny Girl Senpai no Yume wo Minai|Rascal Does Not Dream of Bunny Girl Senpai|AoButa /i) && name.match(/Season\s*2|S\s*0?2/i)) name = name.replace(/Seishun Buta Yarou wa Bunny Girl Senpai no Yume wo Minai|Rascal Does Not Dream of Bunny Girl Senpai|AoButa /i, 'Rascal Does Not Dream of Santa Claus').replace(/Season\s*2|S\s*0?2/gi, '') // Stupid fix for primarily stupid English release groups, you should use the actual name of the series here not the parent name... this is technically not a season 2, it's a sequel to a movie.
      if (name.match(/Hero/i) && name.match(/Academia/i) && !name.match(/FINAL/i) && name.match(/S8|S08|Season 8|Season 08/i)) name = name.replace(/Academia/i, 'Academia FINAL SEASON').replace(/S8|S08|Season 8|Season 08/i, '') // My Hero Academia FINAL SEASON fix...
      if (name.match(/Intai Shitai (Part|Cour) 2/i)) name = name.replace(/Intai Shitai (Part|Cour) 2/i, 'Intai Shitai 2') // Let This Grieving Soul Retire Cour 2 fix...
      if (name.match(/Soul Retire Part 2/i)) name = name.replace(/Soul Retire Part 2/i, 'Soul Retire Cour 2') // Let This Grieving Soul Retire Cour 2 fix...

      // fix incorrect marker patterns to prevent them from being detected as episode count...
      name = name
          .replace(/H 264/i, 'H.264')
          .replace(/H 265/i, 'H.265')
          .replace(/MPEG 2/i, 'MPEG-2')
          .replace(/MPEG 4/i, 'MPEG-4')
          .replace(/AVC 1/i, 'AVC1')
          .replace(/\s*2\.0/i, '2.0')
          .replace(/\s*5\.0/i, '5.0')
          .replace(/\s*5\.1/i, '5.1')

      // Restore preserved patterns by converting markers back
      name = name
          .replace(/<<AUDIO_([A-Za-z]{3}\d)_(\d)>>/g, '$1.$2')          // For AAC2.0, DDP2.0, etc.
          .replace(/<<RES_([HX])_(\d{3})>>/g, '$1.$2')                  // For H.264, H.265, X.265, etc.
          .replace(/<<CHANNEL_5_1>>/g, '5.1')                           // For 5.1 channels
          .replace(/<<AUDIO_FLAC_5_1>>/g, 'FLAC5.1')                    // For FLAC5.1
          .replace(/<<VOL_(\d+)>>/g, 'Vol.$1')                          // For Vol. followed by any digits

      // Remove extra spaces (collapse multiple spaces into one)
      return name.replace(/\s+/g, ' ').trim()
    }
    return typeof fileName === 'string' ? cleanName(fileName) : fileName?.map(name => cleanName(name))
  }

  /**
   * Checks if any of the media titles matches the parsed anime title.
   *
   * @param {Object} parseObj - The parsed object containing details about the anime episode (e.g., title, episode number).
   * @param {Object} media - The media object that contains data about the anime (e.g., title, episodes, format).
   * @param {string[]} titleKeys - The list of title keys to match against when verifying media (e.g., 'title.english', 'title.userPreferred').
   * @param {number} threshold - The threshold value to use when comparing titles for similarity (0 to 1 scale).
   *
   * @returns {boolean} If any of the media titles matches the parsed anime title.
   */
  isVerified(media, parseObj, titleKeys, threshold) {
    // Edge case: prevent "Golden Time" movie from being misidentified as the TV series.
    if (String(parseObj?.episode_number).replace(/^0+/, '') === '1' && /Golden Time/i.test(parseObj?.anime_title) && media?.format === 'MOVIE') return false

    // Fail if the release year doesn't match (Must be the expected year or later)
    if (parseObj?.anime_year && media?.seasonYear < Number(parseObj?.anime_year)) return false

    // Fail if anime_type is ONA or OVA and the matched media isn't that format.
    if (parseObj.anime_type?.length) {
      const types = parseObj.anime_type ? (Array.isArray(parseObj.anime_type) ? parseObj.anime_type : [parseObj.anime_type]).map(type => String(type).toUpperCase()) : []
      if (types.includes('ONA') && media?.format !== 'ONA') return false
      if (types.includes('OVA') && media?.format !== 'OVA') return false
    }

    // Prepare title variations for matching
    const baseTitle = parseObj?.anime_title?.replace(/S\d+|season-\d+/gi, '')?.trim()
    const hasSeason = matchKeys(media, 'Season', titleKeys, threshold)
    const seasonNumber = Number(parseObj?.anime_season)
    const isMultiSeason = parseObj?.anime_season && (seasonNumber > 1)

    // Build title variations to check
    const titleVariations = []

    // Variation 1: Title with season if applicable
    if (!isMultiSeason || !hasSeason) titleVariations.push(parseObj?.anime_title)
    else titleVariations.push(`${baseTitle} Season ${seasonNumber}`)

    // Variation 2: Title with season (if season exists)
    const seasonSuffix = (hasSeason && parseObj?.anime_season) ? ` Season ${seasonNumber}` : ''
    titleVariations.push(`${baseTitle}${seasonSuffix}`)

    // Variation 3: Title with inline season number (relaxed threshold)... if prequel doesn't exist but sequel does there is something seriously wrong.
    if (isMultiSeason) {
      if (matchKeys(media, parseObj?.anime_title?.replace(/S\d+|season-\d+/gi, `Season ${seasonNumber}`), titleKeys, 0.3)) return true
      else if (!this.findEdge(media, 'PREQUEL')?.node && this.findEdge(media, 'SEQUEL')?.node) return false
    }

    // Check that anime_title "semi-loosely" exists in the resolved media.
    return titleVariations.some(title => matchKeys(media, title, titleKeys, threshold))
  }

  // ~~TODO~~ (LIKELY DONE VIA OUR NEW ZERO EPISODE HANDLING): anidb aka true episodes need to be mapped to anilist episodes a bit better, shit like mushoku offsets caused by episode 0's in between seasons
  // TODO: attempt to map series missing from anilist by searching myanimelist, example; 69: Itsuwari no Bishou
  /**
   * Resolves anime metadata from a given file name.
   * @param {string | string[]} fileName
   * @returns {Promise<any[]>}
   */
  async resolveFileAnime(fileName) {
    if (!fileName) return [{}]
    const parseObjs = await this.findAndCacheTitle(this.cleanFileName(fileName))
    const fileAnimes = []
    for (let parseObj of parseObjs) {
      let failed = false
      let episode
      let media = this.animeNameCache[this.getCacheKeyForTitle(parseObj)]
      const threshold = parseObj?.anime_title?.length > 15 ? 0.2 : parseObj?.anime_title?.length > 9 ? 0.15 : 0.1 // play nice with small anime titles
      const titleKeys = ['title.userPreferred', 'title.english', 'title.romaji', 'title.native', 'synonyms']
      let needsVerification = !media || !this.isVerified(media, parseObj, titleKeys, threshold)
      // resolve episode, if movie, dont.
      let zeroEpisode = await hasZeroEpisode(media)
      let maxep = (media?.nextAiringEpisode?.episode || media?.episodes) - (zeroEpisode ? 1 : 0)
      debug(`Resolving ${parseObj?.anime_title} ${parseObj?.episode_number} ${maxep} ${media?.title?.userPreferred} ${media?.format} verified:${!needsVerification}`)
      if ((media?.format !== 'MOVIE' || maxep) && parseObj.episode_number) {
        if (Array.isArray(parseObj.episode_number)) {
          // is an episode range
          if (parseInt(parseObj.episode_number[0]) === 1) {
            debug('Range starts at 1')
            // if it starts with #1 and overflows then it includes more than 1 season in a batch, cant fix this cleanly, name is parsed per-file basis so this shouldn't be an issue
            episode = `${Number(parseObj.episode_number[0])} ~ ${Number(parseObj.episode_number[1])}`
            if (needsVerification) {
              const mediaSearch = (await this.manualMediaSearch(parseObj, maxep, media, titleKeys, threshold))
              media = mediaSearch.media
              episode = mediaSearch.episode || episode
              failed = mediaSearch.failed
            }
          } else {
            if (maxep && parseInt(parseObj.episode_number[1]) > maxep) {
              const result = await this.findResult(parseObj, maxep, 0, media, titleKeys, threshold)
              parseObj = result.parseObj
              media = result.media
              episode = result.episode || episode
              failed = result.failed || failed
            } else {
              // cant find ep count or range seems fine
              episode = `${Number(parseObj.episode_number[0])} ~ ${Number(parseObj.episode_number[1])}`
              if (needsVerification) {
                const mediaSearch = (await this.manualMediaSearch(parseObj, maxep, media, titleKeys, threshold))
                media = mediaSearch.media
                episode = mediaSearch.episode || episode
                failed = mediaSearch.failed
              }
            }
          }
        } else {
          let offset = 0
          // media is missing! Likely a horribly named title for a sequel... try fetching the root.
          if (needsVerification) {
            debug(`Media failed to resolve, attempting to fetch root media for ${parseObj.anime_title}`)
            const parseNew = await this.findAndCacheTitle(parseObj.anime_title.replace(/S\d+(E\d+)?/, ''))
            media = this.animeNameCache[this.getCacheKeyForTitle(parseNew[0])]
            zeroEpisode = await hasZeroEpisode(media)
            maxep = (media?.nextAiringEpisode?.episode || media?.episodes) - (zeroEpisode ? 1 : 0)
            offset = (-(media?.episodes || media?.nextAiringEpisode?.episode)) || 0
          }
          if ((maxep && parseInt(parseObj.episode_number) > maxep) || (offset !== 0 && maxep && parseInt(parseObj.episode_number) <= maxep)) {
            const result = await this.findResult(parseObj, maxep, offset, media, titleKeys, threshold)
            parseObj = result.parseObj
            media = result.media
            episode = result.episode || episode
            failed = result.failed || failed
          } else {
            // cant find ep count or episode seems fine
            episode = Number(parseObj.episode_number)
            if (needsVerification) {
              const mediaSearch = (await this.manualMediaSearch(parseObj, maxep, media, titleKeys, threshold))
              media = mediaSearch.media
              episode = mediaSearch.episode || episode
              failed = mediaSearch.failed
            }
          }
        }
      } else if (needsVerification) {
        const mediaSearch = (await this.manualMediaSearch(parseObj, maxep, media, titleKeys, threshold))
        media = mediaSearch.media
        episode = mediaSearch.episode || episode
        failed = mediaSearch.failed
      }
      debug(`${failed || !(media?.title?.userPreferred) ? `Failed to resolve` : `Resolved`} ${parseObj.anime_title} ${parseObj.episode_number} ${episode} ${media?.id}:${media?.title?.userPreferred}`)
      fileAnimes.push({
        episode: episode || parseObj.episode_number || (media?.episodes === 1 ? 1 : media?.format === 'MOVIE' && (media?.episodes ?? 0) <= 1 ? 1 : null),
        ...(!media || media?.format !== 'MOVIE' || parseObj?.anime_season ? {season: parseObj?.anime_season ? Number(parseObj.anime_season) : 1} : {}),
        parseObject: parseObj,
        media,
        failed: failed || !(media?.title?.userPreferred)
      })
    }
    return fileAnimes
  }

  /**
   * Resolves and returns the appropriate media and episode details by checking for prequels and handling episode ranges.
   * Attempts to fetch the root media if necessary and verifies against the provided `parseObj` and `media`.
   *
   * @param {Object} parseObj - The parsed object containing details about the anime episode (e.g., title, episode number).
   * @param {number} maxep - The maximum episode number available for the media, used to validate episode range.
   * @param {number} offset - The offset to adjust for episode numbering discrepancies (e.g., for sequels or side stories).
   * @param {Object} media - The media object that contains data about the anime (e.g., title, episodes, format).
   * @param {string[]} titleKeys - The list of title keys to match against when verifying media (e.g., 'title.english', 'title.userPreferred').
   * @param {number} threshold - The threshold value to use when comparing titles for similarity (0 to 1 scale).
   *
   * @returns {Object} An object containing the resolved `parseObj`, `media`, `episode`, and a `failed` flag indicating resolution success or failure.
   */
  async findResult(parseObj, maxep, offset, media, titleKeys, threshold) {
    const prequel = await this.findPrequel(parseObj, offset, media, titleKeys, threshold)
    const defaults = { parseObj, media }
    if (prequel.result.failed) {
      const handleEp = await this.handleEpisode(parseObj, maxep, offset, media, prequel, titleKeys, threshold)
      defaults.parseObj = handleEp.parseObj
      defaults.media = handleEp.media
      defaults.episode = handleEp.episode
      prequel.result.ignore = !handleEp.failed
      prequel.result.failed = handleEp.failed
    }
    if (!prequel.result.ignore) {
      if (this.isVerified(prequel.result.rootMedia, parseObj, titleKeys, threshold)) {
        debug(`Found rootMedia for ${parseObj.anime_title}: ${prequel.result.rootMedia?.id}:${prequel.result.rootMedia?.title?.userPreferred} from ${media.id}:${media.title?.userPreferred}`)
        const episode = Array.isArray(parseObj.episode_number) ? `${Number(parseObj.episode_number[0] - (parseObj.episode_number[1] - prequel.result.episode))} ~ ${Number(prequel.result.episode)}` : (prequel.result.episode !== parseObj.episode_number && prequel.result.failed ? parseObj.episode_number : prequel.result.episode)
        const results = {
          parseObj,
          media: prequel.result.rootMedia,
          episode,
          failed: prequel.result.failed || false
        }
        if (results.failed) debug(`Failed to resolve ${parseObj.anime_title} ${parseObj.episode_number} ${media?.title?.userPreferred}`)
        return results
      } else return { parseObj, ...(await this.manualMediaSearch(parseObj, maxep, media, titleKeys, threshold)) }
    }
    return defaults
  }

  /**
   * Attempts to resolve the root media for an anime, starting at Season 1 (S1) instead of Season 2 or an OVA,
   * which may be caused by parsing errors or incorrect title usage.
   * This function checks for possible prequels or parent series to correctly identify the root media and adjust episode numbering accordingly.
   * If a season is already specified accurately, it avoids unnecessary prequel resolution.
   *
   * @param {Object} parseObj - The parsed object containing details about the anime episode (e.g., title, episode number).
   * @param {number} offset - The offset to adjust episode numbering (e.g., for sequels or side stories).
   * @param {Object} media - The media object that contains data about the anime (e.g., title, episodes, format).
   * @param {string[]} titleKeys - The list of title keys to match against when verifying media (e.g., 'title.english', 'title.userPreferred').
   * @param {number} threshold - The threshold value to use when comparing titles for similarity (0 to 1 scale).
   *
   * @returns {Object} An object containing the resolved media and episode details, along with an indication of whether a prequel was found.
   */
  async findPrequel(parseObj, offset, media, titleKeys, threshold) {
    const prequel = !parseObj.anime_season && (this.findEdge(media, 'PREQUEL')?.node || ((media.format === 'OVA' || media.format === 'ONA') && this.findEdge(media, 'PARENT')?.node))
    debug(`Prequel ${prequel?.id}:${prequel?.title?.userPreferred}`)
    const root = prequel && (await this.resolveSeason({ media: await this.getAnimeById(prequel.id), force: true, offset })).media
    debug(`Root ${root?.id}:${root?.title?.userPreferred}`)
    // check that anime_title is similar to the resolved media title, if it's not then we likely already are at the root level... resolves issues with niche series like MF GHOST.
    let isRoot = false
    if (!root || (root && !this.isVerified(root, parseObj, titleKeys, threshold))) {
      debug(`Detected incorrect Root for ${parseObj?.anime_title}, assuming the title is already root from ${media.id}:${media.title?.userPreferred}`)
      isRoot = true
    }
    // value bigger than episode count
    return { result: (await this.resolveSeason({ media: (!isRoot ? root : media) || media, episode: parseInt(Array.isArray(parseObj.episode_number) ? parseObj.episode_number[1] : parseObj.episode_number), increment: !parseObj.anime_season && !isRoot ? null : true, offset: !parseObj.anime_season && !isRoot ? 0 : offset })), isRoot, root }
  }

  /**
   * Handles the resolution of an episode, especially in cases where episode numbers are missing, invalid, or require adjustment.
   * Attempts to resolve the correct episode by checking if the episode number is out of range or if the media is part of a sequel.
   * Will fetch a new media or episode resolution if necessary, and uses manual search as a last resort.
   *
   * @param {Object} parseObj - The parsed object containing details about the anime episode (e.g., title, episode number).
   * @param {number} maxep - The maximum episode number available for the media, used to validate episode range.
   * @param {number} offset - The offset to adjust for episode numbering discrepancies (e.g., for sequels or side stories).
   * @param {Object} media - The media object that contains data about the anime (e.g., title, episodes, format).
   * @param {boolean} prequel - The prequel object contains isRoot indicating if the current media is the root (first season or main series), and the root media reference.
   * @param {string[]} titleKeys - The list of title keys to match against when verifying media (e.g., 'title.english', 'title.userPreferred').
   * @param {number} threshold - The threshold value to use when comparing titles for similarity (0 to 1 scale).
   *
   * @returns {Object} An object containing the resolved `media`, `parseObj`, `episode`, and a `failed` flag indicating resolution success or failure.
   */
  async handleEpisode(parseObj, maxep, offset, media, prequel, titleKeys, threshold) {
    debug(`Attempting last ditch effort for failed result ${parseObj.anime_title}: ${media?.id}:${media?.title?.userPreferred}.`)
    const episodeNumber = Array.isArray(parseObj.episode_number) ? parseObj.episode_number[1] : parseObj.episode_number
    if (parseObj.anime_season) {
      const result = await this.resolveSeason({ media: (!prequel.isRoot ? prequel.root : media) || media, episode: parseInt(episodeNumber), offset })
      if (!result.failed) return { ...result, parseObj }
    }
    if ((episodeNumber > maxep) || (episodeNumber < 0)) {
      debug(`Detected that the episode number ${episodeNumber} is ${(episodeNumber > maxep) ? `greater than the expect max ${maxep} episode(s)` : `is a negative number`} assuming the actual episode number is in the title for [${parseObj.anime_title}]...`)
      const parseNew = await this.findAndCacheTitle(parseObj.anime_title.replace(/S\d+(E\d+)?/, ''))
      const probeMedia = this.animeNameCache[this.getCacheKeyForTitle(parseNew[0])]
      if ((parseNew[0]?.episode_number < maxep) && probeMedia && this.isVerified(probeMedia, parseNew[0], titleKeys, threshold)) {
        debug(`Found media and proper episode for ${parseObj.anime_title}: ${probeMedia?.id}:${probeMedia?.title?.userPreferred}:E${parseNew[0]?.episode}, the episode title was likely being weird by starting with a numerical value.`)
        return { media: probeMedia, parseObj: parseNew[0], episode: Number(parseNew[0]?.episode_number) }
      }
    }
    return { ...(await this.manualMediaSearch(parseObj, maxep, media, titleKeys, threshold)), parseObj }
  }

  /**
   * Attempts to find alternate media titles through a manual search to resolve issues with episode numbers or media matching.
   * This is typically a last-ditch effort when automatic resolution fails, often resolving issues such as incorrect episode counts
   * or mismatched titles (e.g., for series like Misfit of a Demon King).
   *
   * @param {Object} parseObj - The parsed object containing details about the anime episode (e.g., title, episode number).
   * @param {number} maxep - The maximum episode number available for the media, used to validate episode range.
   * @param {Object} media - The media object that contains data about the anime (e.g., title, episodes, format).
   * @param {string[]} titleKeys - The list of title keys to match against when verifying media (e.g., 'title.english', 'title.userPreferred').
   * @param {number} threshold - The threshold value to use when comparing titles for similarity (0 to 1 scale).
   *
   * @returns {Object} An object containing the resolved `media` object, and a `failed` flag indicating whether the manual search was successful.
   */
  async manualMediaSearch(parseObj, maxep, media, titleKeys, threshold) {
    debug(`Attempting final attempt to manual search for failed result ${parseObj.anime_title}: ${media?.id}:${media?.title?.userPreferred}.`)
    const titles = new Set()
    const multiTitleMatch = parseObj.anime_title.match(/^(.+?)\s*\((.+?)\)$/)
    if (multiTitleMatch) {
      titles.add(multiTitleMatch[1].trim())
      titles.add(multiTitleMatch[2].trim())
    }
    titles.add(parseObj.anime_title)
    for (const title of titles) {
      const search = await anilistClient.search({ search: title, ...(media ? { id_not: media.id } : {}), ...(parseObj.anime_season ? { format_not: ['OVA', ...((Number(parseObj.anime_season) > 1) ? ['MOVIE'] : [])] } : { }) })
      if (search?.data?.Page?.media) {
        for (const searchMedia of search.data.Page.media) {
          if (this.isVerified(searchMedia, {...parseObj, anime_title: title}, titleKeys, threshold)) {
            debug(`Found media from manual search for ${parseObj.anime_title}:${parseObj.anime_season}:${parseObj.episode_number}: ${searchMedia?.id}:${searchMedia?.title?.userPreferred} while ignoring the original compound ${media?.id}:${media?.title?.userPreferred}, this is likely correct...`)
            if (parseObj.anime_season > 1) return { media: await this.resolveBySeason(searchMedia, parseObj) }
            else if (searchMedia.status === 'FINISHED' && parseObj.episode_number > searchMedia.episodes) return (await this.findPrequel(parseObj, 0, searchMedia, titleKeys, threshold))?.result
            else return { media: searchMedia }
          }
        }
      }
    }
    const episodeNumber = Array.isArray(parseObj.episode_number) ? parseObj.episode_number[1] : parseObj.episode_number
    return { media, failed: !((episodeNumber > maxep) && (media?.status === 'RELEASING')) }
  }

  /**
   * @param {import('../al.d.ts').Media} media
   * @param {string} type
   * @param {string[]} [formats]
   * @param {boolean} [skip]
   */
  findEdge (media, type, formats = ['TV', 'TV_SHORT'], skip) {
    let res = media.relations?.edges?.find(edge => {
      if (edge.relationType === type) {
        return formats.includes(edge.node.format)
      }
      return false
    })
    // this is hit-miss
    if (!res && !skip && type === 'SEQUEL') res = this.findEdge(media, type, formats = ['TV', 'TV_SHORT', 'ONA', 'OVA'], true)
    return res
  }

  // note: this doesn't cover anime which uses partially relative and partially absolute episode number, BUT IT COULD!
  /**
   * @param {{ media: import('../al.d.ts').Media , episode?:number, force?:boolean, increment?:boolean, offset?: number, rootMedia?: import('./al.js').Media }} opts
   * @returns {Promise<{ media: import('../al.d.ts').Media, episode: number, offset: number, increment: boolean, rootMedia: import('./al.js').Media, failed?: boolean }>}
   */
  async resolveSeason (opts) {
    // media, episode, increment, offset, force
    if (!opts.media || !(opts.episode || opts.force)) throw new Error('No episode or media for season resolve!')

    let { media, episode, increment, offset = 0, rootMedia = opts.media, force } = opts

    const zeroEpisode = await hasZeroEpisode(media)
    const rootHighest = (rootMedia.nextAiringEpisode?.episode || rootMedia.episodes) - (zeroEpisode ? 1 : 0)

    const prequel = !increment && this.findEdge(media, 'PREQUEL')?.node
    const sequel = !prequel && (increment || increment == null) && this.findEdge(media, 'SEQUEL')?.node
    const edge = prequel || sequel
    increment = increment ?? !prequel

    if (!edge) {
      const obj = { media, episode: episode - offset, offset, increment, rootMedia, failed: true }
      if (!force) debug(`Failed to resolve season ${media.id}:${media.title.userPreferred} ${episode} ${increment} ${offset} ${rootMedia.id}:${rootMedia.title.userPreferred}`)
      return obj
    }
    media = await this.getAnimeById(edge.id)

    const highest = media.nextAiringEpisode?.episode || media.episodes

    const diff = episode - (highest + offset)
    offset += increment ? rootHighest : highest
    if (increment) rootMedia = media

    // force marches till end of tree, no need for checks
    if (!force && diff <= rootHighest) {
      episode -= offset
      return { media, episode, offset, increment, rootMedia }
    }

    return this.resolveSeason({ media, episode, increment, offset, rootMedia, force })
  }

  /**
   * Attempts to get the ROOT of a series, then fetches the prequels until the desired anime season is reached.
   * This isn't great but there really isn't any other options to do this without eating up our limited queries, the manual search is a last resort so this shouldn't happen regularly.
   *
   * @param media - The current media that is being handled.
   * @param parseObj - The parsed object containing details about the anime episode (e.g., title, episode number).
   * @param sequelNumber - How far from root we are.
   * @param root - If we are calculating FROM root.
   * @returns {Promise<{media: import('../al.d.ts').Media}>}
   */
  async resolveBySeason(media, parseObj, sequelNumber = 0, root = false) {
    if (!parseObj?.anime_season) return media
    if (root) {
      const sequel = this.findEdge(media, 'SEQUEL')?.node
      return sequel && (Number(parseObj.anime_season) !== sequelNumber) ? await this.resolveBySeason(await this.getAnimeById(sequel.id), parseObj, sequelNumber + 1, true) : media
    } else {
      const prequel = this.findEdge(media, 'PREQUEL')?.node
      return prequel ? await this.resolveBySeason(await this.getAnimeById(prequel.id), parseObj, 0, false) : await this.resolveBySeason(media, parseObj, 1, true)
    }
  }
}()