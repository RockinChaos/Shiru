import { SUPPORTS } from '@/modules/support.js'
import { toTS } from '@/modules/util.js'
import Debug from 'debug'
const debug = Debug('ui:thumbnails')

export default class Thumbnails {
  #data
  #process = null
  #destroyed = false

  constructor() {
    const canvas = document.createElement('canvas')
    canvas.width = 200
    this.#data = {
      thumbnails: [],
      canvas,
      context: canvas.getContext('2d'),
      interval: null,
      video: null
    }
    return Object.assign(this.#init.bind(this), {
      get: this.get.bind(this),
      capture: this.capture.bind(this),
      start: this.start.bind(this),
      clear: this.clear.bind(this),
      update: this.update.bind(this),
      destroy: this.destroy.bind(this)
    })
  }

  #init(video, options) {
    this.#destroyed = false
    this.update(video, options)
    return {
      update: options => this.update(video, options),
      destroy: () => this.destroy()
    }
  }

  async #generate() {
    if (this.externalPlayback || SUPPORTS.isAndroid) return // TODO: Generate and show thumbnails on android when seeking.
    debug('Starting thumbnail generation...')
    if (this.#process && this.#process.running) {
      debug('Detected a currently running thumbnail generation process, interrupting...')
      this.#process.videoDraw.remove()
      this.#process.running = false
      await new Promise(resolve => setTimeout(resolve, 5 * 1_000))
    }
    if (this.#destroyed || !this.current) return
    const t0 = performance.now()
    this.#process = { videoDraw: document.createElement('video'), running: true }
    const videoDraw = this.#process.videoDraw
    this.#data.video = videoDraw
    videoDraw.src = this.current.url
    videoDraw.preload = 'auto'
    videoDraw.volume = 0
    videoDraw.playbackRate = 0
    videoDraw.onloadeddata = () => {
      let index = 0
      let lastIndex = 0
      const captureNext = () => {
        if (!this.#process.running) {
          debug('Thumbnail generation process was interrupted due to a change in the video url, exiting...')
          return
        }
        const dynamicDuration = (this.buffer / 100) * videoDraw.duration
        if (!isFinite(dynamicDuration)) {
          debug('Video is still loading... waiting to generate thumbnails...')
          setTimeout(() => captureNext(), 1_000)
          return
        }
        while (this.#data.thumbnails[index]) index++
        const currentTime = index * this.#data.interval
        if (!this.externalPlayback && currentTime >= dynamicDuration && currentTime < videoDraw.duration) {
          if (lastIndex !== index) {
            lastIndex = index
            debug(`Reached currently downloaded video duration, current seek time is: ${currentTime}s (${index} of ${this.buffer}%), waiting for buffer update...`)
          }
          setTimeout(() => {
            if (currentTime < (this.buffer / 100) * videoDraw.duration) {
              lastIndex = 0
              debug('Detected a buffer change, continuing thumbnail generation...')
            }
            captureNext()
          }, 1_000)
          return
        }

        if (this.externalPlayback || currentTime >= videoDraw.duration) {
          debug('Thumbnail generation has successfully completed, took:', (toTS((performance.now() - t0) / 1_000)))
          this.#data.video = null
          videoDraw.remove()
          return
        } else if (isFinite(currentTime) && currentTime >= 0 && currentTime <= dynamicDuration) {
          videoDraw.currentTime = currentTime
        } else {
          debug('Something went wrong calculating the current time for the thumbnails video, calculated:', currentTime, dynamicDuration, this.buffer)
          return
        }

        videoDraw.onseeked = () => {
          if (this.externalPlayback || !this.#process.running) {
            debug('Thumbnail generation process was interrupted due to a change in the video url, exiting...')
            return
          }
          this.#data.context.drawImage(videoDraw, 0, 0, 200, this.#data.canvas.height)
          this.#data.canvas.toBlob(blob => {
            if (this.#destroyed) return
            this.#data.thumbnails[index] = URL.createObjectURL(blob)
            captureNext()
          }, 'image/jpeg')
        }
      }
      captureNext()
    }
    videoDraw.onerror = (e) => {
      debug('Error loading video for thumbnail generation:', e)
      this.#data.thumbnails.forEach(url => URL.revokeObjectURL(url))
      this.#data.thumbnails = []
      this.#data.video = null
      videoDraw.remove()
    }
  }

  start() {
    if (this.externalPlayback) return
    const height = 200 / (this.video.videoWidth / this.video.videoHeight)
    if (!isNaN(height)) {
      const duration = isFinite(this.video.duration) ? this.video.duration : this.video.currentTime
      this.#data.interval = duration / 300 < 5 ? 5 : duration / 300
      this.#data.canvas.height = height
      this.#generate()
    }
  }

  capture(video = this.video) {
    if (video?.readyState >= 2) {
      const index = Math.floor(video.currentTime / this.#data.interval)
      if (!this.#data.thumbnails[index]) {
        this.#data.context.drawImage(video, 0, 0, 200, this.#data.canvas.height)
        this.#data.canvas.toBlob(blob => {
          if (!this.#destroyed) this.#data.thumbnails[index] = URL.createObjectURL(blob)
        }, 'image/jpeg')
      }
    }
  }

  get(percent) {
    return this.#data.thumbnails[Math.floor(percent / 100 * this.safeduration / this.#data.interval)] || ' '
  }

  clear() {
    if (this.#data.video?.src) URL.revokeObjectURL(this.#data.video?.src)
    if (this.#data.thumbnails?.length) this.#data.thumbnails.forEach(url => URL.revokeObjectURL(url))
    Object.assign(this.#data, {
      thumbnails: [],
      interval: undefined,
      video: undefined
    })
  }

  update(video, { current, safeduration, externalPlayback, buffer }) {
    this.video = video
    this.current = current
    this.safeduration = safeduration
    this.externalPlayback = externalPlayback
    this.buffer = buffer
  }

  destroy() {
    this.#destroyed = true
    if (this.#process) {
      this.#process.running = false
      this.#process.videoDraw.remove()
    }
    this.clear()
    this.video = null
    this.current = null
  }
}
