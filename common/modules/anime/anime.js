import { codes, DOMPARSER, getRandomInt, countdown, sleep } from '@/modules/util.js'
import { printError } from '@/modules/networking.js'
import { anilistClient } from '@/modules/anilist.js'
import _anitomyscript from 'anitomyscript'
import { toast } from 'svelte-sonner'
import SectionsManager, { search, key } from '@/modules/sections.js'
import { page } from '@/App.svelte'
import clipboard from '@/modules/clipboard.js'
import { playAnime } from '@/views/TorrentSearch/TorrentModal.svelte'
import { animeSchedule } from '@/modules/anime/animeschedule.js'
import { episodesList } from '@/modules/episodes.js'
import { settings } from '@/modules/settings.js'
import { cache, caches } from '@/modules/cache.js'
import { status } from '@/modules/networking.js'
import Helper from '@/modules/helper.js'
import Bottleneck from 'bottleneck'
import { Drama, BookHeart, MountainSnow, Laugh, Adult, Droplets, FlaskConical, Ghost, Skull, HeartPulse, Volleyball, Car, Brain, Footprints, Guitar, Bot, Sparkles, WandSparkles, Activity } from 'lucide-svelte'
import Debug from 'debug'
const debug = Debug('ui:anime')

const imageRx = /\.(jpeg|jpg|gif|png|webp)/i

clipboard.on('files', ({ detail }) => {
  for (const file of detail) {
    if (file.type.startsWith('image')) {
      toast.promise(traceAnime(file), {
        description: 'You can also paste an URL to an image.',
        loading: 'Looking up anime for image...',
        success: 'Found anime for image!',
        error: 'Couldn\'t find anime for specified image! Try to remove black bars, or use a more detailed image.'
      })
    }
  }
})

clipboard.on('text', ({ detail }) => {
  for (const { type, text } of detail) {
    let src = null
    if (type === 'text/html') {
      src = DOMPARSER(text, 'text/html').querySelectorAll('img')[0]?.src
    } else if (imageRx.exec(text)) {
      src = text
    }
    if (src) {
      toast.promise(traceAnime(src), {
        description: 'You can also paste an URL to an image.',
        loading: 'Looking up anime for image...',
        success: 'Found anime for image!',
        error: 'Couldn\'t find anime for specified image! Try to remove black bars, or use a more detailed image.'
      })
    }
  }
})

export async function traceAnime (image) { // WAIT lookup logic
  let options
  let url = `https://api.trace.moe/search?cutBorders&url=${image}`
  if (image instanceof Blob) {
    options = {
      method: 'POST',
      body: image,
      headers: { 'Content-type': image.type }
    }
    url = 'https://api.trace.moe/search'
  }
  const res = await fetch(url, options)
  const { result } = await res.json()

  if (result?.length) {
    const ids = result.map(({ anilist }) => anilist).filter(Boolean)
    search.value = {
      clearNow: true,
      clearNext: true,
      load: (page = 1, perPage = 50, variables = {}) => {
        const res = anilistClient.searchIDS({ page, perPage, id: ids, ...SectionsManager.sanitiseObject(variables) }).then(async res => {
          for (const index in res.data?.Page?.media) {
            const media = res.data.Page.media[index]
            const counterpart = result.find(({ anilist }) => anilist === media.id)
            res.data.Page.media[index] = {
              media,
              episode: counterpart.episode,
              similarity: counterpart.similarity,
              episodeData: {
                image: counterpart.image,
                video: counterpart.video,
                ...(await getEpisodeMetadataForMedia(media))?.[counterpart.episode]
              }
            }
          }
          res.data?.Page?.media.sort((a, b) => b.similarity - a.similarity)
          return res
        })
        return SectionsManager.wrapResponse(res, result.length, 'episode')
      }
    }
    key.value = {}
    page.value = 'search'
  } else {
    throw new Error('Search Failed \n Couldn\'t find anime for specified image! Try to remove black bars, or use a more detailed image.')
  }
}

function constructChapters (results, duration) {
  const chapters = results.map(result => {
    const diff = duration - result.episodeLength
    return {
      start: (result.interval.startTime + diff) * 1000,
      end: (result.interval.endTime + diff) * 1000,
      text: result.skipType.toUpperCase()
    }
  })
  const ed = chapters.find(({ text }) => text === 'ED')
  const recap = chapters.find(({ text }) => text === 'RECAP')
  if (recap) recap.text = 'Recap'

  chapters.sort((a, b) => a - b)
  if ((chapters[0].start | 0) !== 0) {
    chapters.unshift({ start: 0, end: chapters[0].start, text: chapters[0].text === 'OP' ? 'Intro' : 'Episode' })
  }
  if (ed) {
    if ((ed.end | 0) + 5000 - duration * 1000 < 0) {
      chapters.push({ start: ed.end, end: duration * 1000, text: 'Preview' })
    }
  } else if ((chapters[chapters.length - 1].end | 0) + 5000 - duration * 1000 < 0) {
    chapters.push({
      start: chapters[chapters.length - 1].end,
      end: duration * 1000,
      text: 'Episode'
    })
  }

  for (let i = 0, len = chapters.length - 2; i <= len; ++i) {
    const current = chapters[i]
    const next = chapters[i + 1]
    if ((current.end | 0) !== (next.start | 0)) {
      chapters.push({
        start: current.end,
        end: next.start,
        text: 'Episode'
      })
    }
  }

  chapters.sort((a, b) => a.start - b.start)

  return chapters
}

export async function getChaptersAniSkip (file, duration) {
  const resAccurate = await fetch(`https://api.aniskip.com/v2/skip-times/${file.media.media.idMal}/${file.media.episode}/?episodeLength=${duration}&types=op&types=ed&types=recap`)
  const jsonAccurate = await resAccurate.json()

  const resRough = await fetch(`https://api.aniskip.com/v2/skip-times/${file.media.media.idMal}/${file.media.episode}/?episodeLength=0&types=op&types=ed&types=recap`)
  const jsonRough = await resRough.json()

  const map = {}
  if (jsonAccurate?.statusCode === 500 || jsonRough?.statusCode === 500) return []
  for (const result of [...jsonAccurate.results, ...jsonRough.results]) {
    map[result.skipType] ||= result
  }

  const results = Object.values(map)
  if (!results.length) return []
  return constructChapters(results, duration)
}

export function getMediaMaxEp (media, playable) {
  if (!media) return 0
  else if (playable) return media.nextAiringEpisode?.episode - 1 || lastAired(media.airingSchedule?.nodes)?.episode || (media.status === 'NOT_YET_RELEASED' ? 0 : media.episodes) || (media.status === 'RELEASING' ? (media.mediaListEntry?.progress ?? 1) : 0)
  else return Math.max(media.airingSchedule?.nodes?.[media.airingSchedule?.nodes?.length - 1]?.episode || 0, media.airingSchedule?.nodes?.length || 0, (!media.streamingEpisodes || (media.status === 'FINISHED' && media.episodes) ? 0 : media.streamingEpisodes?.filter((ep) => { const match = (/Episode (\d+(\.\d+)?) - /).exec(ep.title); return match ? Number.isInteger(parseFloat(match[1])) : false}).length), media.episodes || 0, media.nextAiringEpisode?.episode || 0) || (media.status === 'RELEASING' ? (media.mediaListEntry?.progress ?? 1) : 0)
}

// utility method for correcting anitomyscript woes for what's needed
export async function anitomyscript (...args) {
  // @ts-ignore
  const res = await _anitomyscript(...args)
  const parseObjs = Array.isArray(res) ? res : [res]
  debug('AnitoMyScript found titles:', JSON.stringify(parseObjs))

  for (const obj of parseObjs) {
    obj.anime_title ??= ''
    const seasonMatch = obj.anime_title.match(/S(\d{2})E(\d{2})|S(\d{2})|season-(\d+)/i)
    if (seasonMatch) {
      if (seasonMatch[1] && seasonMatch[2]) {
        obj.anime_season = seasonMatch[1]
        obj.episode_number = seasonMatch[2]
        obj.anime_title = obj.anime_title.replace(/S(\d{2})E(\d{2})/, '')
      } else if (seasonMatch[3]) {
        obj.anime_season = Number(seasonMatch[3])
        obj.anime_title = obj.anime_title.replace(/S\d{2}/, '')
      } else if (seasonMatch[4]) {
        obj.anime_season = seasonMatch[4]
        obj.anime_title = obj.anime_title.replace(/season-\d+/i, '')
      }
    } else if (Array.isArray(obj.anime_season)) {
      obj.anime_season = obj.anime_season[0]
    }
    const yearMatch = obj.anime_title.match(/ (19[5-9]\d|20\d{2})/)
    if (yearMatch && Number(yearMatch[1]) <= (new Date().getUTCFullYear() + 1)) {
      obj.anime_year = yearMatch[1]
      obj.anime_title = obj.anime_title.replace(/ (19[5-9]\d|20\d{2})/, '')
    }
    obj.anime_title = obj.anime_title.replace(/(?<=\s)-\s*|\s*-(?=\s)/g, '')
    if (Number(obj.anime_season) > 1) obj.anime_title += ' S' + Number(obj.anime_season)
    if ((!obj.anime_type || ((Array.isArray(obj.anime_type) ? obj.anime_type[0] : obj.anime_type).toUpperCase()).includes('OAV')) && obj.anime_title.match(/\s*\(?oav\)?\s*$/i)) {
      obj.anime_title = obj.anime_title.replace(/\s*\(?oav\)?\s*$/i, '')
      addAnimeType(obj, 'OAV')
    }
    if (obj.file_name?.match(/(^|[\s()[\]\-_])NCED($|[\s()[\]\-_])/i)) addAnimeType(obj, 'NCED')
    if (obj.file_name?.match(/(^|[\s()[\]\-_])NCOP($|[\s()[\]\-_])/i)) addAnimeType(obj, 'NCOP')
    if (obj.file_name && /(^|\s|[[(-_])trailer(?=$|\s|[\]))-_])/i.test(obj.file_name)) addAnimeType(obj, 'Trailer')
  }
  debug('AnitoMyScript corrected titles:', JSON.stringify(parseObjs))
  return parseObjs
}

function addAnimeType(obj, newType) {
  if (!obj.anime_type) obj.anime_type = newType
  else if (Array.isArray(obj.anime_type) && !obj.anime_type.some(type => type.toUpperCase() === newType.toUpperCase())) obj.anime_type.push(newType)
  else if (typeof obj.anime_type === 'string' && obj.anime_type.toUpperCase() !== newType.toUpperCase()) obj.anime_type = [obj.anime_type, newType]
}

/**
 * Checks if a series has a zero episode.
 *
 * @param media
 * @param existingMappings
 * @returns {Promise<[unknown]|[{title: (string|string|*), thumbnail, length, summary, airingAt: *}]|null>}
 */
export async function hasZeroEpisode(media, existingMappings) { // really wish they could make fetching zero episodes less painful.
  if (!media) return null
  const mappings = existingMappings || (await getAniMappings(media.id)) || {}
  const hasZeroEpisode = media.streamingEpisodes?.filter((ep) => { const match = (/Episode (\d+(\.\d+)?) - /).exec(ep.title); return match ? Number.isInteger(parseFloat(match[1])) && Number(parseFloat(match[1])) === 0 : false})
  const zeroAsFirstEpisode = /episode\s*0/i.test(mappings?.episodes?.[1]?.title?.en || mappings?.episodes?.[1]?.title?.jp) // The first episode is titled as Episode 0 so this is likely a Prologue, fixes issues with series like `Fate/stay night: Unlimited Blade Works`
  // no clue what fixed Mushoku but this initial part seems to allow 'Episode 0 : Guardian Fits' to properly be mapped to season 2 part 1, ensure when making changes this doesn't appear on season 1 part 1.
  if (hasZeroEpisode?.length > 0 && ((media.episodes >= media.streamingEpisodes?.length) || zeroAsFirstEpisode)) {
    return [{...hasZeroEpisode[0], title: hasZeroEpisode[0]?.title?.replace('Episode 0 - ', '')}]
  } else if (!(media.episodes && media.episodes === mappings?.episodeCount && media.status === 'FINISHED')) {
    const special = (mappings?.episodes?.S0 || mappings?.episodes?.s0 || mappings?.episodes?.S1 || mappings?.episodes?.s1)
    if (mappings?.specialCount > 0 && special?.airedBeforeEpisodeNumber > 0) { // very likely it's a zero episode, streamingEpisodes were likely just empty...
      return [{title: special.title?.en, thumbnail: special.image, length: special.length, summary: special.summary, airingAt: special.airDateUtc}]
    }
  }
  return null
}

export const durationMap = { // guesstimate durations based off format type.
  TV: 25,
  TV_SHORT: 5,
  MOVIE: 90,
  SPECIAL: 45,
  OVA: 25,
  ONA: 25,
  MUSIC: 5,
  undefined: 5,
  null: 5,
}

export const formatMap = {
  TV: 'TV Series',
  TV_SHORT: 'TV Short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
  undefined: 'N/A',
  null: 'N/A'
}

export const statusColorMap = {
  CURRENT: 'var(--current-color)',
  PLANNING: 'var(--planning-color)',
  COMPLETED: 'var(--completed-color)',
  PAUSED: 'var(--paused-color)',
  REPEATING: 'var(--repeating-color)',
  DROPPED: 'var(--dropped-color)'
}

export const genreIcons = {
  'Action': Activity,
  'Adventure': MountainSnow,
  'Comedy': Laugh,
  'Drama': Drama,
  'Ecchi': Droplets,
  'Fantasy': WandSparkles,
  'Hentai': Adult,
  'Horror': Skull,
  'Mahou Shoujo': Sparkles,
  'Mecha': Bot,
  'Music': Guitar,
  'Mystery': Footprints,
  'Psychological': Brain,
  'Romance': BookHeart,
  'Sci-Fi': FlaskConical,
  'Slice of Life': Car,
  'Sports': Volleyball,
  'Supernatural': Ghost,
  'Thriller': HeartPulse
}

export const genreList = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  ...(settings.value.adult === 'hentai' ? ['Hentai'] : []),
  'Horror',
  'Mahou Shoujo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller'
]

export const tagList = [
  'Chuunibyou',
  'Demons',
  'Food',
  'Heterosexual',
  'Isekai',
  'Iyashikei',
  'Josei',
  'Magic',
  'Yuri',
  'Love Triangle',
  'Female Harem',
  'Male Harem',
  'Mixed Gender Harem',
  'Arranged Marriage',
  'Marriage',
  'Martial Arts',
  'Military',
  'Nudity',
  'Parody',
  'Reincarnation',
  'Satire',
  'School',
  'Seinen',
  'Shoujo',
  'Shounen',
  'Slavery',
  'Space',
  'Super Power',
  'Superhero',
  'Teens\' Love',
  'Unrequited Love',
  'Vampire',
  'Kids',
  'Gender Bending',
  'Body Swapping',
  'Boys\' Love',
  'Cute Boys Doing Cute Things',
  'Cute Girls Doing Cute Things',
  '4-koma',
  'Achromatic',
  'Achronological Order',
  'Acrobatics',
  'Acting',
  'Adoption',
  'Advertisement',
  'Afterlife',
  'Age Gap',
  'Age Regression',
  'Agriculture',
  'Agender',
  'Airsoft',
  'Alchemy',
  'Aliens',
  'Alternate Universe',
  'American Football',
  'Amnesia',
  'Amputation',
  'Ancient China',
  'Animals',
  'Angels',
  'Anthropomorphism',
  'Anthology',
  'Anti-Hero',
  'Anachronism',
  'Archery',
  'Artificial Intelligence',
  'Aromantic',
  'Assassins',
  'Astronomy',
  'Asexual',
  'Athletics',
  'Augmented Reality',
  'Autobiographical',
  'Aviation',
  'Badminton',
  'Band',
  'Bar',
  'Baseball',
  'Basketball',
  'Battle Royale',
  'Biographical',
  'Bisexual',
  'Blackmail',
  'Board Game',
  'Boarding School',
  'Body Horror',
  'Body Image',
  'Bowling',
  'Boxing',
  'Bullying',
  'Butler',
  'Calligraphy',
  'Cars',
  'Cannibalism',
  'Chibi',
  'Cosmic Horror',
  'Creature Taming',
  'Crossover',
  'CGI',
  'Centaur',
  'Cheerleading',
  'Chimera',
  'Class Struggle',
  'Classic Literature',
  'Classical Music',
  'Cohabitation',
  'College',
  'Coming of Age',
  'Conspiracy',
  'Cosplay',
  'Cowboys',
  'Crime',
  'Criminal Organization',
  'Crossdressing',
  'Cult',
  'Cultivation',
  'Curses',
  'Cyberpunk',
  'Cyborg',
  'Cycling',
  'Dancing',
  'Death Game',
  'Delinquents',
  'Denpa',
  'Desert',
  'Detective',
  'Disability',
  'Dinosaurs',
  'Drawing',
  'Dragons',
  'Drugs',
  'Dullahan',
  'Dungeon',
  'Dystopian',
  'E-Sports',
  'Eco-Horror',
  'Economics',
  'Educational',
  'Elderly Protagonist',
  'Elf',
  'Ensemble Cast',
  'Environmental',
  'Episodic',
  'Ero Guro',
  'Estranged Family',
  'Espionage',
  'Exhibitionism',
  'Exorcism',
  'Fairy',
  'Fairy Tale',
  'Fake Relationship',
  'Family Life',
  'Fashion',
  'Femboy',
  'Female Protagonist',
  'Fencing',
  'Filmmaking',
  'Firefighters',
  'Fishing',
  'Fitness',
  'Flash',
  'Football',
  'Foreign',
  'Found Family',
  'Full CGI',
  'Full Color',
  'Fugitive',
  'Gambling',
  'Gangs',
  'Ghost',
  'Gods',
  'Goblin',
  'Golf',
  'Gore',
  'Guns',
  'Gyaru',
  'Handball',
  'Henshin',
  'Hikikomori',
  'Hip-hop Music',
  'Historical',
  'Homeless',
  'Horticulture',
  'Human Pet',
  'Ice Skating',
  'Idol',
  'Incest',
  'Indigenous Cultures',
  'Inn',
  'Jazz Music',
  'Judo',
  'Kaiju',
  'Kemonomimi',
  'Kingdom Management',
  'Konbini',
  'Kuudere',
  'Language Barrier',
  'Lacrosse',
  'LGBTQ+ Themes',
  'Long Strip',
  'Lost Civilization',
  'Maids',
  'Makeup',
  'Male Protagonist',
  'Mafia',
  'Matriarchy',
  'Matchmaking',
  'Medicine',
  'Medieval',
  'Memory Manipulation',
  'Mermaid',
  'Meta',
  'Metal Music',
  'Mixed Media',
  'Mopeds',
  'Monster Boy',
  'Monster Girl',
  'Motorcycles',
  'Mountaineering',
  'Musical Theater',
  'Mythology',
  'Natural Disaster',
  'Necromancy',
  'Nekomimi',
  'Ninja',
  'No Dialogue',
  'Noir',
  'Non-fiction',
  'Nun',
  'Office',
  'Office Lady',
  'Oiran',
  'Ojou-sama',
  'Omegaverse',
  'Orphan',
  'Otaku Culture',
  'Outdoor Activities',
  'Pandemic',
  'Parkour',
  'Parenthood',
  'Photography',
  'Pirates',
  'Philosophy',
  'Police',
  'Politics',
  'Polyamorous',
  'POV',
  'Post-Apocalyptic',
  'Primarily Adult Cast',
  'Primarily Animal Cast',
  'Primarily Child Cast',
  'Primarily Female Cast',
  'Primarily Male Cast',
  'Primarily Teen Cast',
  'Pregnancy',
  'Prison',
  'Primarily Animal Cast',
  'Primarily Child Cast',
  'Primarily Teen Cast',
  'Proxy Battle',
  'Psychosexual',
  'Puppetry',
  'Rakugo',
  'Rape',
  'Real Robot',
  'Rehabilitation',
  'Religion',
  'Rescue',
  'Restaurant',
  'Revenge',
  'Robots',
  'Rock Music',
  'Rotoscoping',
  'Royal Affairs',
  'Rural',
  'Rugby',
  'Sadism',
  'Samurai',
  'School Club',
  'Scuba Diving',
  'Shapeshifting',
  'Ships',
  'Shrine Maiden',
  'Skateboarding',
  'Skeleton',
  'Slapstick',
  'Software Development',
  'Snowscape',
  'Space Opera',
  'Spearplay',
  'Stop Motion',
  'Steampunk',
  'Succubus',
  'Suicide',
  'Sumo',
  'Surfing',
  'Super Robot',
  'Surreal Comedy',
  'Survival',
  'Sweat',
  'Swordplay',
  'Swimming',
  'Table Tennis',
  'Tanks',
  'Tanned Skin',
  'Teacher',
  'Tennis',
  'Terrorism',
  'Time Loop',
  'Time Manipulation',
  'Time Skip',
  'Tokusatsu',
  'Tomboy',
  'Torture',
  'Tragedy',
  'Trains',
  'Transgender',
  'Travel',
  'Triads',
  'Tsundere',
  'Twins',
  'Urban',
  'Urban Fantasy',
  'Veterinarian',
  'Video Games',
  'Vikings',
  'Villainess',
  'Virtual World',
  'Vocal Synth',
  'Volleyball',
  'VTuber',
  'War',
  'Watersports',
  'Werewolf',
  'Witch',
  'Wilderness',
  'Work',
  'Wrestling',
  'Writing',
  'Wuxia',
  'Yakuza',
  'Yandere',
  'Youkai',
  'Zombie',
  'Vertical Video',
  ...(settings.value.adult === 'hentai' ? [
  'Ahegao',
  'Anal Sex',
  'Armpits',
  'Ashikoki',
  'Asphyxiation',
  'Bondage',
  'Boobjob',
  'Cervix Penetration',
  'Cheating',
  'Cumflation',
  'Cunnilingus',
  'Deepthroat',
  'Defloration',
  'DILF',
  'Double Penetration',
  'Erotic Piercings',
  'Facial',
  'Feet',
  'Fellatio',
  'Femdom',
  'Fisting',
  'Flat Chest',
  'Futanari',
  'Group Sex',
  'Hair Pulling',
  'Handjob',
  'Hypersexuality',
  'Inseki',
  'Irrumatio',
  'Lactation',
  'Large Breasts',
  'Male Pregnancy',
  'Masochism',
  'Masturbation',
  'Mating Press',
  'MILF',
  'Nakadashi',
  'Netorare',
  'Netorase',
  'Netori',
  'Pet Play',
  'Prostitution',
  'Public Sex',
  'Rimjob',
  'Scat',
  'Scissoring',
  'Sex Toys',
  'Shimaidon',
  'Squirting',
  'Sumata',
  'Tentacles',
  'Threesome',
  'Virginity',
  'Vore',
  'Voyeur',
  'Zoophilia'
  ] : [])
]

export async function playMedia (media) {
  const zeroEpisode = await hasZeroEpisode(media)
  let ep = zeroEpisode ? 0 : 1
  if (media.mediaListEntry) {
    const { status, progress } = media.mediaListEntry
    if (progress) {
      if (status === 'COMPLETED') {
        await setStatus('REPEATING', { episode: 0 }, media)
      } else {
        ep = Math.min(getMediaMaxEp(media, true) || (progress + (zeroEpisode ? 0 : 1)), progress + (zeroEpisode ? 0 : 1)) - (zeroEpisode ? 1 : 0)
      }
    }
  }
  playAnime(media, ep)
  media = null
}

export function setStatus (status, other = {}, media) {
  const fuzzyDate = Helper.getFuzzyDate(media, status)
  const variables = {
    id: media.id,
    idMal: media.idMal,
    status,
    score: media.mediaListEntry?.score ? Helper.isAniAuth() ? (media.mediaListEntry?.score * 10) : media.mediaListEntry?.score : 0, // AniList score scale is out of 100, others use a scale of 10,
    repeat: media.mediaListEntry?.repeat || 0,
    ...fuzzyDate,
    ...other
  }
  return Helper.entry(media, variables)
}

// TODO: If data exists from ani.zip but we are lacking some important info, pull from kitsu and merge.
const episodeMetadataMap = new Map()
export async function getEpisodeMetadataForMedia (media) {
  if (episodeMetadataMap.has(`${media?.id}`)) return episodeMetadataMap.get(`${media?.id}`)
  const promiseData = (async () => {
    const aniMappings = (await getAniMappings(media?.id) || {})?.episodes
    if (!aniMappings || !Object.keys(aniMappings).length) return kitsuToAniEpisodes(await episodesList.getKitsuEpisodes(media?.id))
    else return aniMappings
  })()
  episodeMetadataMap.set(`${media?.id}`, promiseData)
  return promiseData
}

function kitsuToAniEpisodes(data) {
  if (!data?.data) return {}
  const episodes = {}
  data.data.forEach((episode) => {
    const attributes = episode.attributes
    const episodeNumber = attributes.number
    if (!episodeNumber) return
    episodes[episodeNumber] = {
      episode: episodeNumber.toString(),
      seasonNumber: attributes.seasonNumber || 1,
      episodeNumber: episodeNumber,
      absoluteEpisodeNumber: episodeNumber,
      title: {
        en: attributes.canonicalTitle || attributes.titles?.en || null,
        ja: attributes.titles?.ja || null,
        "x-jat": attributes.titles?.["x-jat"] || attributes.titles?.ja_jp || null
      },
      airDate: attributes.airdate || null,
      airdate: attributes.airdate || null,
      length: attributes.length || null,
      runtime: attributes.length || null,
      overview: attributes.synopsis || attributes.description || null,
      summary: attributes.description || attributes.synopsis || null,
      image: attributes.thumbnail?.original || attributes.thumbnail?.large || null,
      kitsuId: episode.id
    }
  })
  return episodes
}

export function getAiringInfo(airingAt) {
  if (!airingAt) return null
  if (airingAt.delayedIndefinitely) return { time: 'Suspended', episode: airingAt.episode }
  const airingIn = (airingAt.time.getTime() - Date.now()) / 1000
  return { time: countdown(airingIn), episode: airingAt.episode.replace('{suffix}', (airingIn <= 0 ? 'out for' : 'in')) }
}

export function episode(media, variables) {
  const entry = variables?.hideSubs && animeSchedule.dubAiring.value?.find(entry => entry.media?.media?.id === media.id)
  const nodes = variables?.hideSubs ? entry?.media?.media?.airingSchedule?.nodes : media?.airingSchedule?.nodes

  if (!nodes || nodes.length === 0) return `Episode 1 {suffix}`
  if (entry?.delayedIndefinitely && nodes[0]) return `Episode ${nodes[0].episode} is`
  if (nodes.length === 1) return `Episode ${nodes[0].episode} {suffix}`

  const firstEpisode = nextAiring(nodes, variables)?.episode
  const firstAiring = nodes.find(node => node.episode === firstEpisode)
  const matchingNodes = nodes.filter(node => new Date(variables?.hideSubs ? node.airingAt : node.airingAt * 1000).getTime() === new Date(variables?.hideSubs ? firstAiring.airingAt : firstAiring.airingAt * 1000).getTime())
  const lastEpisode = Math.max(...matchingNodes.map(node => node.episode))
  return `Episode ${firstEpisode === lastEpisode ? `${firstEpisode}` : `${firstEpisode} ~ ${lastEpisode}`} {suffix}`
}

export function airingAt(media, variables) {
  if (variables?.hideSubs) {
    const entry = animeSchedule.dubAiring.value.find((entry) => entry.media?.media?.id === media.id)
    if (entry?.delayedIndefinitely) return { delayedIndefinitely: true, time: 'Suspended', episode: episode(media, variables) }
    const airingAt = nextAiring(entry?.media?.media?.airingSchedule?.nodes, variables)?.airingAt
    return airingAt ? { time: new Date(airingAt), episode: episode(media, variables) } : null
  }
  const airingAt = nextAiring(media.airingSchedule?.nodes, variables)?.airingAt
  return airingAt ? { time: new Date(airingAt * 1000), episode: episode(media, variables) } : null
}

export function nextAiring(nodes, variables) {
  const currentTime = new Date()
  return nodes?.filter(node => new Date(variables?.hideSubs ? node.airingAt : (node.airingAt * 1000)) > currentTime)?.sort((a, b) => a.airingAt - b.airingAt)?.shift()
}

export function lastAired(nodes, variables) {
  const currentTime = new Date()
  return nodes?.filter(node => new Date(variables?.hideSubs ? node.airingAt : (node.airingAt * 1000)) < currentTime)?.sort((a, b) => {
      const timeDiff = b.airingAt - a.airingAt
      if (timeDiff !== 0) return timeDiff
      return (b.episode || 0) - (a.episode || 0)
    })?.shift()
}

export async function isSubbedProgress(media) {
  if (!media) return true
  if (media.status === 'NOT_YET_RELEASED') return false
  await Helper.getClient().userLists.value
  const progress = media.mediaListEntry?.progress ?? media.my_list_status?.num_episodes_watched ?? 0
  if (progress === 0) return false
  const dubbedEntry = (await animeSchedule.dubAiringLists.value)?.find(entry => entry?.media?.media?.id === media.id || entry?.media?.media?.idMal === media.idMal)
  const dubbedEpisodes = dubbedEntry?.media?.media?.airingSchedule?.nodes
  if (!dubbedEpisodes?.length) {
    const airedEntries = (await animeSchedule.dubAiredLists.value)?.filter(entry => entry.id === media.id || entry.idMal === media.idMal)
    if (!airedEntries?.length) return true
    const airedNumbers = airedEntries.map(entry => entry.episode?.aired ?? 0)
    const hasZeroEpisode = airedNumbers.includes(0)
    const maxAired = Math.max(...airedNumbers)
    return progress > (hasZeroEpisode ? maxAired + 1 : maxAired)
  }
  const last = dubbedEpisodes[dubbedEpisodes.length > 1 ? dubbedEpisodes.length - 1 : 0]
  return (progress - (dubbedEntry?.media?.media?.zeroEpisode ? 1 : 0)) > (last?.episode - ((new Date(last?.airingAt) <= new Date()) ? 0 : 1))
}

const concurrentRequests = new Map()
export async function getKitsuMappings(anilistID) { // TODO: Likely need to make this the primary mappings over ani mappings as there appears to be zero rate limit or concurrency limit when testing.
  if (!anilistID) return
  const cachedEntry = cache.cachedEntry(caches.MAPPINGS, `kitsu-${anilistID}`, status.value === 'offline')
  if (cachedEntry) return cachedEntry
  else if (status.value === 'offline') return
  if (concurrentRequests.has(`kitsu-${anilistID}`)) return concurrentRequests.get(`kitsu-${anilistID}`)
  const requestPromise = (async () => {
    try {
      let res = {}
      try {
        res = await fetch(`https://kitsu.app/api/edge/mappings?filter[externalSite]=anilist/anime&filter[externalId]=${anilistID}&include=item`)
      } catch (e) {
        if (!res || res.status !== 404) throw e
      }
      if (!res.ok && (res.status === 429 || res.status === 500)) {
        throw res
      }
      let json = null
      try {
        json = await res.json()
      } catch (error) {
        if (res.ok) checkError(error, 'kitsu')
      }
      if (!res.ok) {
        if (json) {
          for (const error of json?.errors || []) {
            checkError(error, 'kitsu')
          }
        } else {
          checkError(res, 'kitsu')
        }
      }
      return cache.cacheEntry(caches.MAPPINGS, `kitsu-${anilistID}`, {}, json, Date.now() + getRandomInt(480, 1440) * 60 * 1000)
    } catch (e) {
      const cachedEntry = cache.cachedEntry(caches.MAPPINGS, `kitsu-${anilistID}`, true)
      if (cachedEntry) {
        debug(`Failed to request Kitsu Mappings for ${anilistID}, this is likely due to an outage... falling back to cached data.`)
        return cachedEntry
      }
      else throw e
    }
  })().finally(() => {
    concurrentRequests.delete(`kitsu-${anilistID}`)
  })
  concurrentRequests.set(`kitsu-${anilistID}`, requestPromise)
  return requestPromise
}

let aniRateLimitPromise = null
const aniLimiter = new Bottleneck({
  reservoir: 200,
  reservoirRefreshAmount: 200,
  reservoirRefreshInterval: 30_000,
  maxConcurrent: 15,
  minTime: 80
})
aniLimiter.on('failed', async (error) => {
  if (status.value === 'offline') throw new Error('Failed making request to api.ani.zip, network is offline... not retrying')
  if (error.status === 500) return 1
  if (!error.statusText) {
    if (!aniRateLimitPromise) aniRateLimitPromise = sleep(10 * 1000).then(() => { aniRateLimitPromise = null })
    return 10 * 1000
  }
  const time = (Number((error.headers.get('retry-after') || 10)) + 1) * 1000
  if (!aniRateLimitPromise) aniRateLimitPromise = sleep(time).then(() => { aniRateLimitPromise = null })
  return time
})

export async function getAniMappings(anilistID) {
  if (!anilistID) return
  const cachedEntry = cache.cachedEntry(caches.MAPPINGS, `ani-${anilistID}`, status.value === 'offline')
  if (cachedEntry) return cachedEntry
  else if (status.value === 'offline') return
  if (concurrentRequests.has(`ani-${anilistID}`)) return concurrentRequests.get(`ani-${anilistID}`)
  const requestPromise = aniLimiter.wrap(async () => {
    await aniRateLimitPromise
    try {
      let res = {}
      try {
        res = await fetch(`https://api.ani.zip/mappings?anilist_id=${anilistID}`)
      } catch (e) {
        if (!res || res.status !== 404) throw e
      }
      if (!res.ok && (res.status === 429 || res.status === 500)) {
        throw res
      }
      let json = null
      try {
        json = await res.json()
      } catch (error) {
        if (res.ok) checkError(error, 'ani')
      }
      if (!res.ok) {
        if (json) {
          for (const error of json?.errors || []) {
            checkError(error, 'ani')
          }
        } else {
          checkError(res, 'ani')
        }
      }
      return cache.cacheEntry(caches.MAPPINGS, `ani-${anilistID}`, {}, json, Date.now() + getRandomInt(480, 1440) * 60 * 1000)
    } catch (e) {
      const cachedEntry = cache.cachedEntry(caches.MAPPINGS, `ani-${anilistID}`, true)
      if (cachedEntry) {
        debug(`Failed to request Anilist Mappings for ${anilistID}, this is likely due to an outage... falling back to cached data.`)
        return cachedEntry
      }
      else throw e
    }
  })().finally(() => {
    concurrentRequests.delete(`ani-${anilistID}`)
  })
  concurrentRequests.set(`ani-${anilistID}`, requestPromise)
  return requestPromise
}

function checkError(error, type) {
  if (!error || error.status === 404 || error.status === 521) { // api is likely down, we don't need to spam the user with toasts.
    debug(`Error (API Down): ${error.status || 429} - ${error.message || codes[error.status || 429]}`)
    return
  }
  printError('Search Failed', `Failed to fetch the ${type} anime mappings!`, error)
}