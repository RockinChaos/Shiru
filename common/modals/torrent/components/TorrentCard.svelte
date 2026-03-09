<script context='module'>
  import TorrentButton from '@/components/TorrentButton.svelte'
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import { click } from '@/modules/click.js'
  import { fastPrettyBytes, since, matchPhrase, createListener } from '@/modules/util.js'
  import { getEpisodeMetadataForMedia, getKitsuMappings } from '@/modules/anime/anime.js'
  import { copyToClipboard } from '@/modules/clipboard.js'
  import { malDubs } from '@/modules/anime/animedubs.js'
  import { Database, BadgeCheck, HardDrive, FileQuestion, AlertCircle, TriangleAlert } from 'lucide-svelte'

  const { reactive, init } = createListener(['torrent-button', 'torrent-safe-area'])
  init(true)

  /** @typedef {import('../../../../extensions').TorrentResult} Result */
  /** @typedef {import('anitomyscript').AnitomyResult} AnitomyResult */

  const termMapping = {}
  termMapping['5.1'] = { text: '5.1', color: 'var(--octonary-color)' }
  termMapping['5.1CH'] = termMapping[5.1]
  termMapping.TRUEHD = { text: 'TrueHD', color: 'var(--octonary-color)' }
  termMapping['TRUEHD5.1'] = { text: 'TrueHD 5.1', color: 'var(--octonary-color)' }
  termMapping['TRUEHD7.1'] = { text: 'TrueHD 7.1', color: 'var(--octonary-color)' }
  termMapping['TRUE-HD'] = termMapping.TRUEHD
  termMapping.MLP = termMapping.TRUEHD
  termMapping['MLP FBA'] = termMapping.TRUEHD
  termMapping.DTS = { text: 'DTS', color: 'var(--octonary-color)' }
  termMapping['DTS-HD'] = { text: 'DTS-HD', color: 'var(--octonary-color)' }
  termMapping.DTSHD = termMapping['DTS-HD']
  termMapping['DTS HD'] = termMapping['DTS-HD']
  termMapping['DTS-HD MA'] = { text: 'DTS-HD MA', color: 'var(--octonary-color)' }
  termMapping['DTSHDMA'] = termMapping['DTS-HD MA']
  termMapping['DTS-MA'] = termMapping['DTS-HD MA']
  termMapping.DTSMA = termMapping['DTS-HD MA']
  termMapping['DTS HD MA'] = termMapping['DTS-HD MA']
  termMapping['DTS-HD HRA'] = { text: 'DTS-HD HRA', color: 'var(--octonary-color)' }
  termMapping['DTSHD HRA'] = termMapping['DTS-HD HRA']
  termMapping['DTS HD HRA'] = termMapping['DTS-HD HRA']
  termMapping['DTS-X'] = { text: 'DTS:X', color: 'var(--octonary-color)' }
  termMapping.DTSX = termMapping['DTS-X']
  termMapping['DTS X'] = termMapping['DTS-X']
  termMapping['DTS5.1'] = { text: 'DTS 5.1', color: 'var(--octonary-color)' }
  termMapping['DTS 5.1'] = termMapping['DTS5.1']
  termMapping['DTS7.1'] = { text: 'DTS 7.1', color: 'var(--octonary-color)' }
  termMapping['DTS 7.1'] = termMapping['DTS7.1']
  termMapping['DTS-ES'] = { text: 'DTS-ES', color: 'var(--octonary-color)' }
  termMapping.DTSES = termMapping['DTS-ES']
  termMapping['AAC2.0'] = { text: 'AAC', color: 'var(--octonary-color)' }
  termMapping['AAC 2.0'] = termMapping['AAC2.0']
  termMapping.AAC = termMapping['AAC2.0']
  termMapping.AACX2 = termMapping.AAC
  termMapping.AACX3 = termMapping.AAC
  termMapping.AACX4 = termMapping.AAC
  termMapping['OPUS2.0'] = { text: 'Opus', color: 'var(--octonary-color)' }
  termMapping['OPUS 2.0'] = termMapping['OPUS2.0']
  termMapping.OPUS = termMapping['OPUS2.0']
  termMapping.EAC3 = { text: 'EAC3', color: 'var(--octonary-color)' }
  termMapping['E-AC-3'] = termMapping.EAC3
  termMapping['E-AC3'] = termMapping.EAC3
  termMapping.AC3 = { text: 'AC3', color: 'var(--octonary-color)' }
  termMapping['AC-3'] = termMapping.AC3
  termMapping['DDP2.0'] = { text: 'Dolby', color: 'var(--octonary-color)' }
  termMapping['DDP 2.0'] = termMapping['DDP2.0']
  termMapping.DDP = termMapping['DDP2.0']
  termMapping.FLAC = { text: 'FLAC', color: 'var(--octonary-color)' }
  termMapping.FLACX2 = termMapping.FLAC
  termMapping.FLACX3 = termMapping.FLAC
  termMapping.FLACX4 = termMapping.FLAC
  termMapping.BLURAY = { text: 'Blu-ray', color: 'var(--octonary-color)' }
  termMapping.VORBIS = { text: 'Vorbis', color: 'var(--octonary-color)' }
  termMapping['BDRIP'] = termMapping.BLURAY
  termMapping['BDREMUX'] = termMapping.BLURAY
  termMapping.BD = termMapping.BLURAY
  termMapping['10BIT'] = { text: '10 Bit', color: 'var(--tertiary-color)' }
  termMapping['10BITS'] = termMapping['10BIT']
  termMapping['10-BIT'] = termMapping['10BIT']
  termMapping['10-BITS'] = termMapping['10BIT']
  termMapping.HI10 = termMapping['10BIT']
  termMapping.HI10P = termMapping['10BIT']
  termMapping.HI444 = { text: 'HI444', color: 'var(--tertiary-color)' }
  termMapping.HI444P = termMapping.HI444
  termMapping.HI444PP = termMapping.HI444
  termMapping.AVC = { text: 'AVC', color: 'var(--tertiary-color)' }
  termMapping.H264 = termMapping.AVC
  termMapping['H.264'] = termMapping.AVC
  termMapping.X264 = termMapping.AVC
  termMapping.HEVC = { text: 'HEVC', color: 'var(--tertiary-color)' }
  termMapping.H265 = termMapping.HEVC
  termMapping['H.265'] = termMapping.HEVC
  termMapping.X265 = termMapping.HEVC
  termMapping.AV1 = { text: 'AV1', color: 'var(--tertiary-color)' }
  termMapping.MULTISUB = { text: 'Multi Sub', color: 'var(--octonary-color)' }
  termMapping['MULTISUBS'] = termMapping.MULTISUB
  termMapping['MULTI SUBS'] = termMapping.MULTISUB
  termMapping['MULTI-SUBS'] = termMapping.MULTISUB
  termMapping['MULTISUB'] = termMapping.MULTISUB
  termMapping['MULTI SUB'] = termMapping.MULTISUB
  termMapping['MULTI-SUB'] = termMapping.MULTISUB
  termMapping['MULTIPLE SUBTITLES'] = termMapping.MULTISUB
  termMapping['MULTIPLE SUBTITLE'] = termMapping.MULTISUB
  termMapping['SUBTITLES'] = termMapping.MULTISUB
  termMapping.DUALAUDIO = { text: 'Dual Audio', color: 'var(--octonary-color)' }
  termMapping.CHINESEAUDIO = { text: 'Chinese Audio', color: 'var(--octonary-color)' }
  termMapping.ENGLISHAUDIO = { text: 'English Audio', color: 'var(--octonary-color)' }
  termMapping['DUAL AUDIO'] = termMapping.DUALAUDIO
  termMapping['DUAL-AUDIO'] = termMapping.DUALAUDIO
  termMapping['MULTI AUDIO'] = termMapping.DUALAUDIO
  termMapping['MULTI-AUDIO'] = termMapping.DUALAUDIO
  termMapping['MULTI DUB'] = termMapping.DUALAUDIO
  termMapping['MULTI-DUB'] = termMapping.DUALAUDIO
  termMapping['CN AUDIO'] = termMapping.CHINESEAUDIO
  termMapping['CHINESE AUDIO'] = termMapping.CHINESEAUDIO
  termMapping['CHINESE DUB'] = termMapping.CHINESEAUDIO
  termMapping['CHI DUB'] = termMapping.CHINESEAUDIO
  termMapping['CN DUB'] = termMapping.CHINESEAUDIO
  termMapping['ENGLISH AUDIO'] = termMapping.ENGLISHAUDIO
  termMapping['ENGLISH DUBBED'] = termMapping.ENGLISHAUDIO
  termMapping['ENGLISH DUB'] = termMapping.ENGLISHAUDIO
  termMapping['ENG DUBBED'] = termMapping.ENGLISHAUDIO
  termMapping['ENG DUB'] = termMapping.ENGLISHAUDIO
  termMapping['EN DUB'] = termMapping.ENGLISHAUDIO
  termMapping['DUAL'] = termMapping.DUALAUDIO
  termMapping['DUBBED'] = termMapping.ENGLISHAUDIO
  termMapping['DUB'] = termMapping.ENGLISHAUDIO
  termMapping[' RAW '] = { text: 'Raw', color: 'var(--octonary-color)' }
  termMapping['RAW '] = termMapping[' RAW ']
  termMapping[' RAW'] = termMapping[' RAW ']
  termMapping['(RAW)'] = termMapping[' RAW ']
  termMapping['[RAW]'] = termMapping[' RAW ']
  termMapping.UNCENSORED = { text: 'Uncensored', color: 'var(--octonary-color)' }
  termMapping.UNCENSOR = termMapping.UNCENSORED

  /**
   * @param {Object} search
   * @param {AnitomyResult} param0
   */
  export async function sanitiseTerms (search, { video_term: vid, audio_term: aud, video_resolution: resolution, file_name: _fileName, release_group: group }) {
    const isEnglishDubbed = await malDubs.isDubMedia(search?.media)
    const video = !Array.isArray(vid) ? [vid] : vid
    const audio = !Array.isArray(aud) ? [aud] : aud

    // Preprocess fileName: remove titles from search.media.titles if they exist to prevent incorrect termMappings e.g; Synduality Noir being detected as Dual Audio (SynDUALity).
    let fileName = _fileName
    if (fileName && search?.media?.title) {
      for (const title of Object.values(search.media.title)) {
        if (title) {
          const words = title.split(/\s+/).filter(Boolean)
          for (let n = 3; n >= 1; n--) {
            if (words.length >= n) {
              const piece = words.slice(0, n).join(' ')
              if (piece.length >= 4) fileName = fileName.replace(new RegExp(piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
            }
          }
        }
      }
    }

    // Remove release group from fileName
    if (group) fileName = fileName.replace(new RegExp(String(group).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')

    let terms = [...new Set([...video, ...audio].map(term => {
      const key = term?.toUpperCase()
      const mappedTerm = termMapping[key]
      if (mappedTerm && fileName) fileName = fileName.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
      return mappedTerm ? { key, term: mappedTerm } : null
    }).filter(t => t))]

    if (resolution) {
      for (const res of Array.isArray(resolution) ? [...new Set(resolution)].flatMap(r => String(r).split(/[\/,|]+/).map(s => s.trim()).filter(Boolean)) : String(resolution).split(/[\/,|]+/).map(s => s.trim()).filter(Boolean)) {
        terms.unshift({ key: res, term: { text: res, color: 'var(--quaternary-color)' } })
      }
    }

    for (const key of Object.keys(termMapping)) {
      if (!fileName?.trim().replace(/[[\](){}]/g, '').trim()) break
      if (fileName && (isEnglishDubbed || termMapping[key] !== termMapping.ENGLISHAUDIO) && !terms.some(existingTerm => existingTerm.key === key)) {
        if (!fileName.toLowerCase().includes(key.toLowerCase())) {
          if (matchPhrase(key.toLowerCase(), fileName, 1)) {
            terms.push({ key, term: termMapping[key] })
            fileName = fileName.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
          }
        } else {
          terms.push({ key, term: termMapping[key] })
          fileName = fileName.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
        }
      }
    }

    // If the series has an English Dub and Other audio is detected like Chinese, we can't rely on "DUB" term alone as it could be an ONA with a Japanese Dub or a Chinese Dub.
    for (const dubKey of [...(terms.some(t => t.term === termMapping.CHINESEAUDIO) ? ['DUB'] : []), ...(terms.some(t => t.term === termMapping.DUALAUDIO) && /dual\s*track/i.test(fileName) ? ['DUAL'] : [])]) { // Remove these keys
      if (terms.some(t => t.key === dubKey && t.term === termMapping[dubKey])) {
        terms = terms.filter(t => !(t.key === dubKey && t.term === termMapping[dubKey]))
      }
    }

    return [...terms]
  }

  /**
   * @param {Object} search
   * @param {AnitomyResult} result
   */
  export async function simplifyFilename (search, result) {
    const { video_term: vid, audio_term: aud, video_resolution: resolution, file_name: name, release_group: group, file_checksum: checksum } = result
    const video = !Array.isArray(vid) ? [vid] : vid
    const audio = !Array.isArray(aud) ? [aud] : aud
    const resolutions = resolution ? (Array.isArray(resolution) ? resolution : [resolution]) : []
    const removeTerm = term => {
      if (term) simpleName = simpleName.replace(new RegExp(String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
    }

    // Preprocess simpleName: remove titles from search.media.titles if they exist to prevent incorrect termMappings e.g; Synduality Noir being detected as Dual Audio (SynDUALity).
    let simpleName = name
    const titleHolders = []
    if (simpleName && search?.media?.title) {
      for (const title of Object.values(search.media.title)) {
        if (title) {
          const words = title.split(/\s+/).filter(Boolean)
          for (let n = 3; n >= 1; n--) {
            if (words.length >= n) {
              const piece = words.slice(0, n).join(' ')
              if (piece.length >= 4) {
                const placeholder = `TITLE_PLACEHOLDER_${titleHolders.length}`
                titleHolders.push({placeholder, original: piece})
                simpleName = simpleName.replace(new RegExp(piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), placeholder)
              }
            }
          }
        }
      }
    }

    [group, checksum, ...resolutions, ...video, ...audio].forEach(removeTerm)
    const sanitized = (await sanitiseTerms(search, result))
    sanitized.forEach(term => removeTerm(term.key))

    // Clean file name...
    simpleName = simpleName

      // Normalize apostrophes and single quotes to standard '
      // Covers: ` ' ' ‛ ′ ‵ ʻ ʼ ʽ
      .replace(/[`''‛′‵ʻʼʽ]/g, "'")

      // Normalize double quotes to standard "
      // Covers: " " „ ‟ ″ ‶ «»
      .replace(/[""„‟″‶«»]/g, '"')

      // Normalize dashes to standard hyphen -
      // Covers: – — ‒ ‐ ‑ ⁃
      .replace(/[–—‒‐‑⁃]/g, '-')

      // Normalize weird commas and full-width punctuation
      // Covers: ， 、﹐﹑
      .replace(/[，、﹐﹑]/g, ',')

      // Normalize exclamation marks to standard !
      // Covers: ！﹗
      .replace(/[！﹗]/g, '!')

      // Remove commas (and any trailing spaces/commas) before closing brackets
      // Handles cases like 'word, , )' or 'word,)' -> 'word)'
      .replace(/,[\s,]*(?=[\])])/g, '')

      // Remove commas (and surrounding spaces) immediately after an opening bracket
      // Handles cases like '(, word' or '[ , word' -> '(word' / '[word'
      .replace(/([\[(])\s*,\s*/g, '$1')

      // Ensure exactly one space after every comma, including 'word,word' -> 'word, word'
      .replace(/,(?!\s)/g, ', ')

      // Collapse runs of multiple commas into one, e.g. ',,' -> ','
      .replace(/,[\s,]*/g, ',')

      // Collapse repeated separators (dashes, underscores, dots) into a single space
      .replace(/[-_.]{2,}/g, ' ')

      // Normalize ellipsis and multiple dots
      // Covers: … ‥
      .replace(/[…‥]/g, '...')

      // Remove any space(s) immediately after an opening bracket
      // e.g. '( word' -> '(word'
      .replace(/([\[(])\s+/g, '$1')

      // Remove any space(s) immediately before a closing bracket
      // e.g. 'word )' -> 'word)'
      .replace(/\s+([\])])/g, '$1')

      // Strip leading or trailing commas and whitespace from the whole string
      .replace(/^[,\s]+|[,\s]+$/g, '')

      // Remove leading dashes inside brackets e.g. '[-DL]' -> '[DL]'
      .replace(/([\[({])\s*-\s*/g, '$1')

      // Remove trailing dashes inside brackets e.g. '[DL-]' -> '[DL]'
      .replace(/\s*-\s*([\])}])/g, '$1')

      // Remove empty brackets or brackets containing only a dash, underscore, slash or comma
      // e.g. '[]', '()', '[-]', '( - )', '[_]', '[/]', '[\]', '[,]'
      .replace(/[\[{(]\s*[-_/\\,]?\s*[\]})]/g, '')

      // Remove unmatched closing brackets by counting openers before each closer
      // If there is no corresponding opener, the closing bracket is dropped
      .replace(/[\])}]/g, (match, offset, str) => {
        const open = match === ']' ? '[' : match === ')' ? '(' : '{'
        const before = str.slice(0, offset)
        return (before.match(new RegExp('\\' + open, 'g')) || []).length > (before.match(new RegExp('\\' + match, 'g')) || []).length ? match : ''
      })
      .trim()

    // Reintroduce placeholders e.g. series title.
    titleHolders.forEach(title => simpleName = simpleName.replace(new RegExp(title.placeholder, 'g'), title.original))

    // Clean name after restoring placeholders
    simpleName = simpleName

      // Fix titles with 'word,word' -> 'word, word'
      .replace(/,(\S)/g, ', $1')

      // Remove leading or trailing dashes
      .replace(/^[\s-]+|[\s-]+$/g, '')

      // Remove dashes preceded by a space e.g. 'WEB-DL -VARYG' -> 'WEB-DL VARYG'
      .replace(/ -(\S)/g, ' $1')

      // Collapse multiple spaces into one
      .replace(/  +/g, ' ')

      // Fix space-comma-space e.g. ' , ' -> ', '
      .replace(/ , /g, ', ')
      .trim()

    return simpleName
  }
</script>

<script>
  /** @type {Result & { parseObject: AnitomyResult }} */
  export let result

  /** @type {import('@/modules/al.d.ts').Media} */
  export let media

  export let episode

  /** @type {Function} */
  export let play = () => {}

  export let type = 'default'
  export let countdown = -1

  $: errorType = type === 'error' ? (result.title?.match(/no results/i) || result.title?.match(/extension is not enabled/i) ? 'warning' : 'error') : ''

  let card
  $: updateGlowColor(countdown)
  function updateGlowColor(value) {
    if (!card) return
    if (countdown < 0 || countdown > 4) {
      card.style.borderColor = ''
      card.style.removeProperty('color')
      return
    }
    let color = 'var(--warning-color)'
    if (value < 3) color = 'var(--danger-color-dim)'
    card.style.borderColor = color
    card.style.setProperty('color', color)
  }
</script>

<div class='card bg-dark p-15 d-flex mx-0 mb-10 mt-0 position-relative rounded-3' class:pointer={type !== 'error'} class:scale={type !== 'error'} class:not-reactive={!$reactive || type === 'error'} class:glow={countdown > -1} class:error-card={type === 'error'} role='button' tabindex='0' use:click={() => type !== 'error' && play(result)} on:contextmenu|preventDefault={() => type !== 'error' && copyToClipboard(result.link, 'magnet URL')} title={type === 'error' ? `${result.source?.name || 'Unknown Source'}: ${result.title}` : result.parseObject?.file_name}>
  <div class='position-absolute top-0 left-0 w-full h-full'>
    <div class='position-absolute w-full h-full overflow-hidden rounded-3 error-overlay z-5 pointer-events-none' class:d-none={type !== 'error'}/>
    <div class='position-absolute w-full h-full overflow-hidden rounded-3' class:image-border={type === 'default'} >
      <SmartImage class='img-cover w-full h-full' images={[
        () => getEpisodeMetadataForMedia(media).then(metadata => metadata?.[episode]?.image),
          media.bannerImage,
          ...(media.trailer?.id ? [
          `https://i.ytimg.com/vi/${media.trailer.id}/maxresdefault.jpg`,
          `https://i.ytimg.com/vi/${media.trailer.id}/hqdefault.jpg`] : []),
        () => getKitsuMappings(media.id).then(metadata =>
          [metadata?.included?.[0]?.attributes?.coverImage?.original,
          metadata?.included?.[0]?.attributes?.coverImage?.large,
          metadata?.included?.[0]?.attributes?.coverImage?.small,
          metadata?.included?.[0]?.attributes?.coverImage?.tiny])]}
      />
    </div>
    <div class='position-absolute rounded-3 opacity-transition-hack' style='background: var(--torrent-card-gradient);' />
  </div>
  <button type='button' tabindex='-1' class='position-absolute torrent-safe-area top-0 right-0 h-full w-50 bg-transparent border-0 shadow-none not-reactive z-1' class:d-none={type === 'error'} use:click={() => {}}/>
  <div class='d-flex pl-10 flex-column justify-content-between w-full h-auto position-relative' style='min-height: 10rem; min-width: 0;'>
    <div class='d-flex w-full'>
      {#if type === 'error'}
        <div class='d-flex align-items-center justify-content-center mr-10' class:text-warning-dim={errorType === 'warning'} class:text-danger-dim={errorType === 'error'} title='Extension Error'>
          <svelte:component this={errorType === 'warning' ? AlertCircle : TriangleAlert} size='2.5rem' />
        </div>
      {:else if result.accuracy === 'high'}
        <div class='d-flex align-items-center justify-content-center mr-10 text-success-light' title='High Accuracy'>
          <BadgeCheck size='2.5rem' />
        </div>
      {/if}
      <div class='font-size-22 font-weight-bold text-nowrap d-flex align-items-center' class:text-warning-dim={errorType === 'warning'} class:text-danger-dim={errorType === 'error'}>
        {#if type === 'error'}
          {result.source?.name || 'Unknown Source'}
        {:else}
          {result.parseObject?.release_group && result.parseObject.release_group.length < 20 ? result.parseObject.release_group : 'No Group'}
        {/if}
        {#if countdown > -1}
          <div class='ml-10'>[{countdown}]</div>
        {/if}
      </div>
      {#if type !== 'error' && result.type === 'batch'}
        <div class='d-flex ml-auto mr-10' title='Batch'><Database size='2.5rem'/></div>
      {/if}
      <div class='d-flex' class:ml-auto={type === 'error' || result.type !== 'batch'} >
        {#if result.source?.icon}
          <img class='wh-25' src={(!result.source.icon.startsWith('http') ? 'data:image/png;base64,' : '') + result.source.icon} alt={result.source.name} title={result.source.name}>
        {:else if result.source?.managed}
          <HardDrive size='2.5rem'/>
        {:else}
          <FileQuestion size='2.5rem' />
        {/if}
      </div>
    </div>
    <div class='py-5 font-size-14 d-flex align-items-center' class:text-warning-dim={errorType === 'warning'} class:text-danger-dim={errorType === 'error'} class:text-muted={type !== 'error'}>
      {#if type === 'error'}
        <span class='overflow-hidden text-truncate'>{result.title}</span>
      {:else}
        {#await simplifyFilename({ media, episode }, result.parseObject) then fileName}
          <span class='overflow-hidden text-truncate'>{fileName}</span>
        {/await}
        <span class='ml-auto mr-5 w-30 h-10 flex-shrink-0'/>
        <TorrentButton class='position-absolute btn btn-square shadow-none bg-transparent bd-highlight h-40 w-40 right-0 mr--8 z-1' hash={result.hash} torrentID={result.link} search={{ media, episode: (media?.format !== 'MOVIE' && result.type !== 'batch') && episode }} size={'2.5rem'} strokeWidth={'2.3'}/>
      {/if}
    </div>
    {#if type !== 'error'}
      <div class='metadata-container d-flex w-full align-items-start text-dark font-size-14' style='line-height: 1;'>
        <div class='primary-metadata py-5 d-flex flex-row'>
          <div class='text-light d-flex align-items-center text-nowrap'>{fastPrettyBytes(result.size)}</div>
          <div class='text-light d-flex align-items-center text-nowrap'>&nbsp;•&nbsp;</div>
          {#if !result.source?.managed || !result.source?.name?.match(/completed/i)}
            <div class='text-light d-flex align-items-center text-nowrap'>{result.seeders} Seeders</div>
            <div class='text-light d-flex align-items-center text-nowrap'>&nbsp;•&nbsp;</div>
          {/if}
          <div class='text-light d-flex align-items-center text-nowrap'>{since(new Date(result.date))}</div>
        </div>
        <div class='secondary-metadata d-flex flex-wrap ml-auto justify-content-end'>
          {#if result.type === 'best'}
            <div class='rounded px-15 py-5 border text-nowrap font-weight-bold d-flex align-items-center' style='background: var(--success-color-very-dim); border-color: var(--success-color-light) !important; color: var(--success-color-light); margin-top: 0.15rem'>
              Best Release
            </div>
          {:else if result.type === 'alt'}
            <div class='rounded px-15 py-5 border text-nowrap font-weight-bold d-flex align-items-center' style='background: var(--danger-color-very-dim); border-color: var(--danger-color) !important; color: var(--danger-color); margin-top: 0.15rem'>
              Alt Release
            </div>
          {/if}
          {#await sanitiseTerms({ media, episode }, result.parseObject) then termObjects}
            {@const terms = termObjects?.map(term => term.term).filter((term, index, self) => index === self.findLastIndex(_term => _term.text === term.text))}
            {#each terms as term, index}
              <div class='rounded px-15 py-5 bg-very-dark text-nowrap text-white d-flex align-items-center' class:ml-10={index !== 0 || result.type === 'best' || result.type === 'alt'} style='margin-top: 0.15rem;'>
                {term.text}
              </div>
            {/each}
          {/await}
        </div>
      </div>
    {/if}
  </div>
  <div bind:this={card} class='position-absolute rounded-3 bd-highlight opacity-transition-hack' class:border-best={type === 'best'} class:border-magnet={type === 'magnet'} class:border-warning-dim={errorType === 'warning'} class:border-danger-dim={errorType === 'error'} />
</div>

<style>
  .scale {
    transition: transform 0.2s ease;
  }
  .scale:hover {
    transform: scale(1.015);
  }
  .border-best {
    border: .1rem solid var(--tertiary-color);
  }
  .border-magnet {
    border: .1rem solid var(--quaternary-color);
  }
  .image-border {
    border-radius: 1.1rem;
  }
  .error-overlay {
    background: repeating-linear-gradient(-45deg, hsla(var(--black-color-hsl), 0.2), hsla(var(--black-color-hsl), 0.4) .5rem, transparent .5rem, transparent 1.25rem) !important;
  }
  .error-card {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .glow {
    border: .1rem solid;
    animation: glowPulse 1s ease-in-out infinite alternate;
    will-change: drop-shadow;
    transition: border-color 0.5s, drop-shadow 0.5s, transform 0.2s ease;
  }
  @keyframes glowPulse {
    from {
      filter: drop-shadow(0 0 .5rem currentColor);
    }
    to {
      filter: drop-shadow(0 0 .1rem currentColor);
    }
  }

  /* Behavior for narrow screens (mobile) */
  @media (max-width: 35rem) {
    .metadata-container {
      flex-direction: column !important;
    }
    .secondary-metadata {
      margin-left: 0 !important;
      justify-content: flex-start !important;
    }
  }
</style>