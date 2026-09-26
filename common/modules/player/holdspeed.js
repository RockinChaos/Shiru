import { writable } from 'simple-store-svelte'

export default class HoldSpeed {
  #playPause
  #removeListeners = () => {}
  #indicator = writable('')
  #playbackRateTimeout
  #holdTimer = null
  #holdRate = 1
  #holdWasPaused = false
  #holdActive = false
  #holdKeyCode = null
  #holdPointerId = null
  #holdPointerType = null
  #holdPointerTarget = null
  #suppressClick = false
  #suppressClickTarget = null
  #holdSession = 0

  constructor(playPause) {
    this.#playPause = playPause
    return Object.assign(this.#init.bind(this), {
      subscribe: this.subscribe.bind(this),
      consumeClick: this.consumeClick.bind(this),
      handleKeyDown: this.handleKeyDown.bind(this),
      cancelHold: this.cancelHold.bind(this),
      stopHold: this.stopHold.bind(this),
      reset: this.reset.bind(this),
      update: this.update.bind(this),
      destroy: this.destroy.bind(this)
    })
  }

  #init(video, options) {
    if (video.tagName !== 'VIDEO') return this.#listen(video)
    const { src, externalPlayback, miniplayer } = options
    this.update(video, src, externalPlayback, miniplayer)
    const handleKeyUp = this.#handleKeyUp.bind(this)
    const cancelHold = this.cancelHold.bind(this)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', cancelHold)
    this.#removeListeners = () => {
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', cancelHold)
    }
    return {
      update: ({ src, externalPlayback, miniplayer }) => this.update(video, src, externalPlayback, miniplayer),
      destroy: () => this.destroy()
    }
  }

  #listen(node) {
    const endPointerHold = this.#endPointerHold.bind(this)
    const listeners = [
      ['pointerdown', this.#startPointerHold.bind(this)],
      ['pointerup', endPointerHold],
      ['pointercancel', endPointerHold],
      ['lostpointercapture', endPointerHold],
      ['touchend', this.#endTouchHold.bind(this)],
      ['touchcancel', this.#endTouchHold.bind(this)]
    ]
    for (const [type, listener] of listeners) node.addEventListener(type, listener)
    return {
      destroy: () => {
        for (const [type, listener] of listeners) node.removeEventListener(type, listener)
        if (this.#holdPointerTarget === node) this.reset()
      }
    }
  }

  #scheduleHold() {
    if (this.#holdTimer || this.#holdActive || !this.video || !this.src || this.externalPlayback) return false
    this.#holdTimer = setTimeout(() => this.#activateHold(), 600)
    this.#holdTimer.unref?.()
    return true
  }

  #activateHold() {
    this.#holdTimer = null
    if (!this.video || !this.src || this.externalPlayback) return

    this.#holdActive = true
    this.#holdRate = this.video.playbackRate
    this.#holdWasPaused = this.video.paused
    this.video.playbackRate = Math.min(16, Number((this.#holdRate * 2).toFixed(1)))
    this.#showPlaybackRateTemporarily(this.video.playbackRate)

    const session = ++this.#holdSession
    if (this.#holdWasPaused) {
      this.video.play().then(() => {
        if (this.#holdSession === session && !this.#holdActive) this.video.pause()
      }).catch(() => {
        if (this.#holdSession === session) this.cancelHold()
      })
    }
  }

  #endHold(showIndicator = true) {
    if (this.#holdTimer) {
      clearTimeout(this.#holdTimer)
      this.#holdTimer = null
    }
    if (!this.#holdActive) return false

    const wasPaused = this.#holdWasPaused
    this.#holdActive = false
    if (this.video) {
      this.video.playbackRate = this.#holdRate
      if (showIndicator) this.#showPlaybackRateTemporarily(this.video.playbackRate)
      if (wasPaused && !this.video.paused) this.video.pause()
    }
    return true
  }

  #startPointerHold(event) {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    if (this.miniplayer && event.pointerType === 'touch') return
    if (this.#scheduleHold()) {
      this.#holdPointerId = event.pointerId
      this.#holdPointerType = event.pointerType
      this.#holdPointerTarget = event.currentTarget
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  #endPointerHold(event) {
    if (event.pointerId !== this.#holdPointerId) return
    if (this.#holdPointerType === 'touch' && (event.type === 'pointercancel' || event.type === 'lostpointercapture')) return
    if (this.#endHold() && event.type === 'pointerup') this.#suppressNextClick(event.currentTarget)
    if (event.type === 'pointerup') {
      this.#clearPointerState()
    }
    else if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
      this.#clearPointerState()
      this.#suppressClick = false
      this.#suppressClickTarget = null
    }
  }

  #endTouchHold() {
    if (this.#holdPointerType !== 'touch') return
    this.#endHold()
    this.#clearPointerState()
  }

  #clearPointerState() {
    this.#holdPointerId = null
    this.#holdPointerType = null
    this.#holdPointerTarget = null
  }

  #suppressNextClick(target = this.#holdPointerTarget) {
    this.#suppressClick = true
    this.#suppressClickTarget = target
  }

  #showPlaybackRateTemporarily(rate) {
    this.#indicator.set(`${rate.toFixed(1)}x`)
    clearTimeout(this.#playbackRateTimeout)
    this.#playbackRateTimeout = setTimeout(() => this.#indicator.set(''), 600)
    this.#playbackRateTimeout.unref?.()
  }

  #handleKeyUp(event) {
    if (event.code !== this.#holdKeyCode) return
    event.preventDefault()
    const wasHolding = this.#endHold()
    this.#holdKeyCode = null
    if (!wasHolding) this.#playPause()
  }

  handleKeyDown(event) {
    if (!event?.code || event.repeat || this.#holdKeyCode) return
    if (this.#holdActive || this.#holdTimer) {
      const wasPointerHold = this.#holdPointerId != null
      const beganPaused = this.#holdWasPaused
      const wasHolding = this.#endHold()
      if (wasPointerHold) this.#suppressNextClick()
      if (!wasHolding || !beganPaused) this.#playPause()
      return
    }
    this.#holdKeyCode = event.code
    if (!this.#scheduleHold()) {
      this.#holdKeyCode = null
      this.#playPause()
    }
  }

  consumeClick(target) {
    if (!this.#suppressClick) return false
    const shouldSuppress = !this.#suppressClickTarget || this.#suppressClickTarget === target
    this.#suppressClick = false
    this.#suppressClickTarget = null
    return shouldSuppress
  }

  cancelHold() {
    this.#holdKeyCode = null
    const wasHoldingOrPending = this.#holdActive || this.#holdTimer
    this.#endHold(false)
    if (wasHoldingOrPending && this.#holdPointerId != null) this.#suppressNextClick()
  }

  stopHold() {
    this.#holdKeyCode = null
    if (this.#endHold() && this.#holdPointerId != null) this.#suppressNextClick()
  }

  reset() {
    // Ignore play() completions from the previous file or a destroyed player.
    this.#holdSession++
    this.#holdKeyCode = null
    this.#endHold(false)
    this.#holdRate = 1
    this.#holdWasPaused = false
    const target = this.#holdPointerTarget
    const pointerId = this.#holdPointerId
    this.#clearPointerState()
    if (target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
    this.#suppressClick = false
    this.#suppressClickTarget = null
    clearTimeout(this.#playbackRateTimeout)
    this.#playbackRateTimeout = null
    this.#indicator.set('')
  }

  subscribe(run) {
    return this.#indicator.subscribe(run)
  }

  update(video, src, externalPlayback, miniplayer) {
    if (this.src !== src || this.externalPlayback !== externalPlayback) this.reset()
    this.video = video ?? null
    this.src = src
    this.externalPlayback = externalPlayback
    this.miniplayer = miniplayer
  }

  destroy() {
    this.#removeListeners()
    this.reset()
    this.video = null
  }
}
