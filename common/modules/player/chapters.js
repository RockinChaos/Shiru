import { settings } from '@/modules/settings.js'
import { writable } from 'simple-store-svelte'
import { TORRENT } from '@/modules/bridge.js'

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

async function getChaptersAniSkip (file, duration) {
  const resAccurate = await fetch(`https://api.aniskip.com/v2/skip-times/${file.media.media.idMal}/${file.media.episode}/?episodeLength=${duration}&types=op&types=ed&types=recap`)
  if (!resAccurate?.ok) return []
  const jsonAccurate = await resAccurate.json()

  const resRough = await fetch(`https://api.aniskip.com/v2/skip-times/${file.media.media.idMal}/${file.media.episode}/?episodeLength=0&types=op&types=ed&types=recap`)
  const jsonRough = await resRough.json()

  const map = {}
  for (const result of [...(jsonAccurate.results || []), ...(jsonRough.results || [])]) {
    map[result.skipType] ||= result
  }

  const results = Object.values(map)
  if (!results.length) return []
  return constructChapters(results, duration)
}

export default class Chapters {
  #data = []
  #embedded = []
  #store = writable([])

  constructor() {
    TORRENT.onChapters(this.setEmbedded.bind(this))
  }

  #set(_chapters) {
    this.#data = _chapters
    this.#store.set(_chapters)
  }

  #mergeMicroSkippable(_chapters) {
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

  // remaps chapters to what the seekbar uses and adds potentially missing chapters
  sanitise (_chapters, safeduration) {
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

    this.#mergeMicroSkippable(_chapters)
    if (JSON.stringify(this.#data) !== JSON.stringify(_chapters)) this.#set(_chapters)

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

  isChapterSkippable(chapter) {
    if (((chapter.end - chapter.start) / 1_000) > MAX_TOTAL_SKIP_TIME) return null // Anything longer than 180s (3m) is likely invalid, skipping this chapter would be a mistake!
    for (const [name, regex] of skippableChaptersRx) {
      if (/** @type {RegExp} */ chapter.text && (regex).test(chapter.text.trim())) {
        return name
      }
    }
    return null
  }

  findChapter (time) {
    if (!this.#data.length) return null
    for (const chapter of this.#data) {
      if (time < (chapter.end / 1_000) && time >= (chapter.start / 1_000)) return chapter
    }
  }

  useEmbedded() {
    this.#set(this.#embedded)
  }

  setEmbedded(_chapters) {
    if (_chapters.length) {
      this.#embedded = _chapters
      if (settings.value.playerChapterSkip === 'embedded') this.#set(_chapters)
    }
  }

  async load(current, safeduration) {
    if ((!this.#data.length || settings.value.playerChapterSkip.match(/aniskip/i)) && current?.media?.media) {
      const source = settings.value.playerChapterSkip
      const _chapters = await getChaptersAniSkip(current, safeduration)
      if (_chapters?.length && settings.value.playerChapterSkip === source && (source === 'aniskip' || !this.#embedded.length)) this.#set(_chapters)
    }
  }

  subscribe(run) {
    return this.#store.subscribe(run)
  }

  clear() {
    this.#set([])
    this.#embedded = []
  }

  destroy() {
    TORRENT.offChapters()
    this.clear()
  }
}
