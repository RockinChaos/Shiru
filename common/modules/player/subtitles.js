import { toTS, subRx } from '@/modules/util.js'
import clipboard from '@/modules/lib/clipboard.js'
import { settings } from '@/modules/settings.js'
import { SUPPORTS } from '@/modules/support.js'
import { TORRENT } from '@/modules/bridge.js'
import JASSUB from 'jassub'

const defaultHeader = `[Script Info]
Title: English (US)
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default, ${settings.value.font?.name.toLowerCase() || 'Roboto Medium'},52,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2.6,0,2,20,20,46,1
[Events]

`
const cueEntities = { amp: '&', lt: '<', gt: '>', nbsp: '\\h' }

const isAssType = type => type === 'ass' || type === 'ssa'

function getStyleIndexes(header) {
  const styles = new Map([['Default', 0]])
  let inStyles = false
  let nameColumn = 0
  let index = 1
  for (const line of header.split(/[\r\n]+/)) {
    const value = line.trimStart()
    if (value.startsWith('[')) inStyles = /^\[V4\+? Styles]/i.test(value)
    if (!inStyles) continue
    if (value.startsWith('Format:')) {
      nameColumn = value.slice(7).split(',').findIndex(field => field.trim().toLowerCase() === 'name')
    } else if (value.startsWith('Style:')) {
      const name = value.slice(6).split(',')[nameColumn]?.trimStart().replace(/^\*+/, '') || 'Default'
      styles.set(name, index++)
    }
  }
  return styles
}

function formatCueText(text) {
  return text.replace(/<(\/?)([^\s>][^>]*)>/g, (tag, closing, name) =>
    /^[bius]$/i.test(name) ? '{\\' + name.toLowerCase() + (closing ? '0' : '1') + '}' : ''
  ).replace(/&(amp|lt|gt|nbsp);/g, (entity, name) => cueEntities[name]).replace(/\r?\n/g, '\\N')
}

export default class Subtitles {

  /**
   * Initializes subtitle delivery and loads tracks after playback is selected.
   * @param {HTMLVideoElement} video Video element used for subtitle rendering.
   * @param {object[]} files Available torrent files.
   * @param {object|null} selected Selected video file.
   * @param {(tracksChanged?: boolean) => void} onHeader Refreshes subtitle choices.
   */
  constructor(video, files, selected, onHeader) {
    this.video = video
    this.selected = selected || null
    this.files = files || []
    this.headers = []
    this.embeddedTracks = new Map()
    /** @type {{subtitle: any, trackNumber: number}[]} */
    this.pendingSubtitles = []
    /** @type {boolean} */
    this.tracksReady = false
    this.fonts = ['/Roboto.ttf', './NotoSansCJK.otf']
    this.useLocalFonts = settings.value.missingFont && typeof globalThis.queryLocalFonts === 'function'
    this.dropAllBlur = settings.value.disableSubtitleBlur
    this.renderer = null
    this.stream = null
    this.parser = null
    this.current = 0
    this.onHeader = onHeader
    this.timeout = null

    /** Registers a remotely exposed font file.
     * @param {{url: string}} detail Font attachment URL.
     * @returns {void}
     */
    this.handleFile = detail => {
      if (!this.selected || !detail?.url) return
      this.fonts.push(detail.url)
      this.renderer?.addFont(detail.url)
    }

    /** Buffers or renders a subtitle packet for its track.
     * @param {{subtitle: any, trackNumber: number}} packet Subtitle packet and track identifier.
     * @returns {void}
     */
    this.handleSubtitle = ({ subtitle, trackNumber }) => {
      if (!this.selected) return
      const track = this.embeddedTracks.get(trackNumber)
      if (!track) {
        if (!this.tracksReady) this.pendingSubtitles.push({ subtitle, trackNumber })
        return
      }
      const string = JSON.stringify(subtitle)
      if (track.seen.has(string)) return
      const event = this.constructSub(subtitle, track)
      track.seen.add(string)
      track.events.push(event)
      if (this.current === track.number) this.renderSubtitle(event)
    }

    /** Initializes track headers, drains queued packets, and selects a subtitle language.
     * @param {any[]} detail Parsed subtitle tracks.
     * @returns {void}
     */
    this.handleTracks = (detail) => {
      if (!this.selected) return
      for (const track of detail) {
        if (this.embeddedTracks.has(track.number)) continue
        const header = isAssType(track.type) ? track.header : defaultHeader
        if (!header?.trim()) continue
        // A sidecar can arrive before the MKV track numbers are known.
        const number = this.headers[track.number] ? this.headers.length : track.number
        const entry = { ...track, number, header, styles: getStyleIndexes(header), events: [], seen: new Set() }
        this.embeddedTracks.set(track.number, entry)
        this.headers[number] = entry
      }
      this.tracksReady = true
      for (const packet of this.pendingSubtitles.splice(0)) this.handleSubtitle(packet)
      if (this.headers.length) this.initSubtitleRenderer()
      this.onHeader(true)
      const tracks = this.headers.filter(Boolean)
      const language = settings.value.subtitleLanguage
      if (!this.current && tracks.length && language) {
        const wantedTrack = tracks.find(track => (track.language ?? 'eng') === language)
          || tracks.find(track => track.name?.toLowerCase().includes(language.toLowerCase()))
          || tracks.find(track => (track.language ?? 'eng') === 'eng')
          || tracks[0]
        this.selectCaptions(wantedTrack.number)
      }
    }

    this.handleClipboardText = ({ detail }) => {
      for (const { text, type } of detail) {
        if (text.startsWith('[Script Info]')) this.addSingleSubtitleFile(new File([text], 'Subtitle.ass', { type }))
      }
    }

    this.handleClipboardFiles = ({ detail }) => {
      for (const file of detail) {
        if (subRx.test(file.name)) this.addSingleSubtitleFile(file)
      }
    }

    this.handleSubtitleFile = async (detail) => {
      if (!this.selected) return
      try {
        const response = await fetch(detail.url)
        if (!response.ok) throw new Error('Subtitle attachment request failed: ' + response.status)
        const data = await response.arrayBuffer()
        await this.addSingleSubtitleFile(new File([data], detail.name), true)
      } catch (error) {
        if (this.selected) console.warn('Failed to load subtitle file', error)
      }
    }

    TORRENT.onSubtitles(this.handleSubtitle, this.handleFile, this.handleSubtitleFile)
      .catch(error => console.warn('Failed to subscribe to subtitles', error))
    TORRENT.getTracks().catch(error => {
      console.warn('Failed to read tracks', error)
      return []
    }).then(tracks => this.handleTracks(tracks ?? []))
      .catch(error => console.warn('Failed to initialize subtitle tracks', error))

    clipboard.addEventListener('text', this.handleClipboardText)
    clipboard.addEventListener('files', this.handleClipboardFiles)
  }

  async addSingleSubtitleFile(file, automatic = false) {
    if (!this.selected) return
    const dot = file.name.lastIndexOf('.')
    const type = dot < 0 ? '' : file.name.slice(dot + 1).toLowerCase()
    let subtitles
    try {
      subtitles = Subtitles.convertSubText(await file.text(), type)
    } catch (error) {
      if (this.selected) console.warn('Failed to load subtitle file', error)
      return
    }
    if (!this.selected || !subtitles?.length) return

    const index = Math.max(100, this.headers.length)
    const subname = dot < 0 ? file.name : file.name.slice(0, dot)
    // sub name could contain video name with or without extension, possibly followed by lang, or not.
    const name = subname.includes(this.selected.name)
      ? subname.replace(this.selected.name, '')
      : subname.replace(this.selected.name.slice(0, this.selected.name.lastIndexOf('.')), '')
    this.headers[index] = {
      header: typeof subtitles === 'string' ? subtitles : defaultHeader + subtitles.join('\n'),
      language: name.replace(/[,._-]/g, ' ').trim() || 'Track ' + index,
      number: index,
      type
    }
    this.onHeader(true)
    if (!this.current && (!automatic || (this.tracksReady && settings.value.subtitleLanguage))) {
      this.selectCaptions(index)
    }
  }

  initSubtitleRenderer() {
    if (!this.renderer) {
      const options = {
        video: this.video,
        subContent: defaultHeader,
        fonts: this.fonts,
        offscreenRender: SUPPORTS.offscreenRender,
        libassMemoryLimit: 1024,
        libassGlyphLimit: 80000,
        maxRenderHeight: parseInt(settings.value.subtitleRenderHeight) || 0,
        fallbackFont: settings.value.font?.name || 'roboto medium',
        availableFonts: {
          'roboto medium': './Roboto.ttf',
          'noto sans cjk regular': './NotoSansCJK.otf'
        },
        workerUrl: new URL('jassub/dist/jassub-worker.js', import.meta.url).toString(),
        wasmUrl: new URL('jassub/dist/jassub-worker.wasm', import.meta.url).toString(),
        legacyWasmUrl: SUPPORTS.isAndroid ? new URL('jassub/dist/jassub-worker.wasm.js', import.meta.url).toString() : undefined,
        modernWasmUrl: new URL('jassub/dist/jassub-worker-modern.wasm', import.meta.url).toString(),
        useLocalFonts: this.useLocalFonts,
        dropAllBlur: this.dropAllBlur
      }
      if (SUPPORTS.isAndroid) JASSUB._hasBitmapBug = true
      this.requestedFonts = new Set(Object.keys(options.availableFonts))
      this.renderer = new JASSUB(options)
      this.renderer.setDefaultFont('noto sans cjk regular')
    }
  }

  static convertSubText(text, type) {
    if (isAssType(type)) return text.trim() ? text : undefined

    const normalized = text.replace(/\r\n?/g, '\n')
    const srtRx = /^((?:\d+:)?\d{2}:\d{2}[.,]\d{2,3})[ \t]*-->[ \t]*((?:\d+:)?\d{2}:\d{2}[.,]\d{2,3})[^\n]*\n([\s\S]*)$/m
    const subRx = /^[{[](\d+)[}\]][{[](\d+)[}\]](.+)$/
    if (type === 'srt' || type === 'vtt' || (type !== 'sub' && srtRx.test(normalized))) {
      const assTime = value => {
        const [clock, fraction] = value.split(/[.,]/)
        const timestamp = clock + '.' + fraction.slice(0, 2)
        return timestamp.split(':').length === 2 ? '0:' + timestamp : timestamp
      }
      const subtitles = []
      for (const block of normalized.split(/\n[ \t]*\n/)) {
        const match = block.match(srtRx)
        if (!match) continue
        const [, start, end, text] = match
        subtitles.push('Dialogue: 0,' + assTime(start) + ',' + assTime(end) + ',Default,,0,0,0,,' + formatCueText(text.replace(/\n+$/, '')))
      }
      return subtitles
    }

    const cues = normalized.split('\n').map(line => line.match(subRx)).filter(Boolean)
    const first = cues[0]
    const fps = Number(first?.[3])
    const hasFps = first && first[1] === first[2] && Number(first[1]) <= 1 && Number.isFinite(fps) && fps > 0
    const secondsPerFrame = hasFps ? 1 / fps : 0.041708
    return cues.slice(hasFps ? 1 : 0).map(([, start, end, text]) =>
      'Dialogue: 0,' + toTS(Number(start) * secondsPerFrame, 1) + ',' + toTS(Number(end) * secondsPerFrame, 1) + ',Default,,0,0,0,,' + text.replaceAll('|', '\\N')
    )
  }

  constructSub(subtitle, track) {
    const style = (subtitle.style || '').trimStart().replace(/^\*+/, '').replace(/^default$/i, 'Default')
    const text = subtitle.text || ''
    const cue = isAssType(track.type) ? text : formatCueText(text)
    const readOrder = Number(subtitle.readOrder ?? 1)
    return {
      Start: subtitle.time,
      Duration: subtitle.duration,
      Style: track.styles.get(style) ?? track.styles.get('Default'),
      Name: subtitle.name || '',
      MarginL: Number(subtitle.marginL) || 0,
      MarginR: Number(subtitle.marginR) || 0,
      MarginV: Number(subtitle.marginV) || 0,
      Effect: subtitle.effect?.trimStart() || '',
      Text: this.dropAllBlur ? cue.replace(/\\blur(?:[0-9]+\.)?[0-9]+/g, '') : cue,
      ReadOrder: Number.isInteger(readOrder) ? readOrder : 1,
      Layer: Number(subtitle.layer) || 0
    }
  }

  renderSubtitle(subtitle) {
    if (!this.renderer) return
    // JASSUB only discovers inline fonts automatically when loading a whole script.
    if (this.useLocalFonts && subtitle.Text.includes('\\fn')) {
      for (const [, name] of subtitle.Text.matchAll(/\\fn([^\\}]+)/g)) {
        const font = name.trim().toLowerCase().replace(/^@/, '')
        if (!font || this.requestedFonts.has(font)) continue
        this.requestedFonts.add(font)
        this.renderer._getLocalFont({ font })
      }
    }
    this.renderer.createEvent(subtitle)
  }

  selectCaptions(trackNumber) {
    if (trackNumber == null || !this.headers) return
    const current = Number(trackNumber)
    if (current === this.current) return
    const track = this.headers[current]
    if (current !== -1 && !track) return
    this.current = current
    if (track) this.initSubtitleRenderer()
    this.renderer?.setTrack(track?.header || defaultHeader)
    for (const subtitle of track?.events ?? []) this.renderSubtitle(subtitle)
    this.onHeader()
  }

  destroy() {
    TORRENT.offSubtitles().catch(error => console.warn('Failed to stop subtitles', error))
    clipboard.removeEventListener('text', this.handleClipboardText)
    clipboard.removeEventListener('files', this.handleClipboardFiles)
    this.stream?.destroy()
    this.parser?.destroy()
    this.renderer?.destroy()
    this.files = null
    this.video = null
    this.selected = null
    this.pendingSubtitles = []
    this.embeddedTracks.clear()
    this.headers = null
    this.onHeader()
  }
}