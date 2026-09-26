import { writable } from 'simple-store-svelte'
import { SUPPORTS } from '@/modules/support.js'
import { ANDROID } from '@/modules/bridge.js'
import Debug from 'debug'
const debug = Debug('ui:pip')

export default class PiP {
  #resetImmerse = () => {}
  #destroyed = false
  #pip = writable(false)

  constructor(resetImmerse) {
    this.#resetImmerse = resetImmerse
    return Object.assign(this.#init.bind(this), {
      subscribe: this.subscribe.bind(this),
      togglePopout: this.togglePopout.bind(this),
      update: this.update.bind(this),
      destroy: this.destroy.bind(this)
    })
  }

  #init(video, { subs, deband, container, paused }) {
    this.#destroyed = false
    this.update(video, subs, deband, container, paused)
    this.leavePictureInPicture = () => {
      if (!this.cleanup) this.#pip.set(false)
    }
    video.addEventListener('leavepictureinpicture', this.leavePictureInPicture)
    let destroyed = false
    let pictureInPictureListener
    ANDROID.onPictureInPictureModeChanged?.(isInPictureInPictureMode => {
      if (destroyed) return
      this.#pip.set(isInPictureInPictureMode)
      if (!this.#pip.value && document.fullscreenElement) document.exitFullscreen()
    })?.then?.(listener => {
      if (destroyed) listener?.remove()
      else pictureInPictureListener = listener
    })
    this.removeListener = () => {
      destroyed = true
      pictureInPictureListener?.remove()
    }
    return {
      update: ({ subs, deband, container, paused }) => this.update(video, subs, deband, container, paused),
      destroy: () => this.destroy()
    }
  }

  #updatePiPState(paused) {
    const element = /** @type {HTMLVideoElement | undefined} */ (document.pictureInPictureElement)
    if (!element || element.id) return
    if (paused) element.pause()
    else element.play().catch(e => debug('Failed To Play Picture In Picture ' + e))
  }

  async #exitPictureInPicture(video) {
    if (document.pictureInPictureElement !== video) return
    try {
      await document.exitPictureInPicture()
    } catch (e) {
      if (!this.#destroyed) {
        this.#pip.set(!!document.pictureInPictureElement)
      }
      debug('Failed To Exit Picture In Picture ' + e)
    }
  }

  async #requestPictureInPicture(video) {
    const pipwindow = await video.requestPictureInPicture()
    if (this.#destroyed) {
      await this.#exitPictureInPicture(video)
      return null
    }
    return pipwindow
  }

  togglePopout() {
    if (this.#destroyed || !this.video?.readyState) return
    if (!this.subs?.renderer || SUPPORTS.isAndroid) {
      if (this.video !== document.pictureInPictureElement) {
        this.cleanup?.()
        this.#requestPictureInPicture(this.video).catch(e => {
          if (!this.#destroyed) {
            this.#pip.set(false)
          }
          debug('Failed To Enter Picture In Picture ' + e)
        })
        this.#resetImmerse()
        this.#pip.set(true)
      } else {
        this.#exitPictureInPicture(this.video)
        this.#pip.set(false)
      }
    } else {
      if (document.pictureInPictureElement && !document.pictureInPictureElement.id) {
        // only exit if pip is the custom one, else overwrite existing pip with custom
        this.#exitPictureInPicture(document.pictureInPictureElement)
        this.#pip.set(false)
      } else {
        this.cleanup?.()
        const canvasVideo = document.createElement('video')
        const { stream, destroy } = this.#getBurnIn()
        let cleaned = false
        let pipWindow = null
        const cleanup = () => {
          if (cleaned) return
          cleaned = true
          if (this.cleanup === cleanup) {
            this.cleanup = null
            this.#pip.set(false)
          }
          canvasVideo.onloadedmetadata = null
          canvasVideo.onleavepictureinpicture = null
          if (pipWindow) pipWindow.onresize = null
          destroy()
          canvasVideo.remove()
          this.#exitPictureInPicture(canvasVideo)
        }
        this.cleanup = cleanup
        this.#pip.set(true)
        this.#resetImmerse()
        canvasVideo.srcObject = stream
        canvasVideo.onloadedmetadata = () => {
          if (cleaned || this.#destroyed) return cleanup()
          canvasVideo.play().catch(e => debug('Failed To Play Picture In Picture ' + e))
          if (this.#pip.value) {
            if (this.paused) canvasVideo.pause()
            this.#requestPictureInPicture(canvasVideo).then(pipwindow => {
              if (!pipwindow || cleaned) {
                this.#exitPictureInPicture(canvasVideo)
                return cleanup()
              }
              pipWindow = pipwindow
              pipwindow.onresize = () => {
                if (cleaned || this.#destroyed) return
                const { width, height } = pipwindow
                if (isNaN(width) || isNaN(height)) return
                if (!isFinite(width) || !isFinite(height)) return
                this.subs?.renderer?.resize(width, height)
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

  #getBurnIn(noSubs) {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    let loop = null
    canvas.width = this.video.videoWidth
    canvas.height = this.video.videoHeight
    if (!noSubs) this.subs?.renderer?.resize(this.video.videoWidth, this.video.videoHeight)
    const renderFrame = () => {
      context.drawImage(this.deband ? this.deband.canvas : this.video, 0, 0)
      if (!noSubs && this.subs?.renderer?._canvas && canvas.width && canvas.height) context.drawImage(this.subs.renderer._canvas, 0, 0, canvas.width, canvas.height)
      loop = this.video.requestVideoFrameCallback(renderFrame)
    }
    renderFrame()
    const destroy = () => {
      if (!noSubs) this.subs?.renderer?.resize()
      this.video.cancelVideoFrameCallback(loop)
      canvas.remove()
    }
    this.container.append(canvas)
    return { stream: canvas.captureStream(), destroy }
  }

  subscribe(run) {
    return this.#pip.subscribe(run)
  }

  update(video, subs, deband, container, paused) {
    const pausedChanged = this.paused !== paused
    this.video = video ?? null
    this.subs = subs ?? null
    this.deband = deband ?? null
    this.container = container ?? null
    this.paused = paused
    if (pausedChanged) this.#updatePiPState(paused)
  }

  destroy() {
    this.#destroyed = true
    this.removeListener?.()
    this.video?.removeEventListener('leavepictureinpicture', this.leavePictureInPicture)
    this.cleanup?.()
    if (this.video) this.#exitPictureInPicture(this.video)
    this.#pip.set(false)
  }
}
