import { cache, caches } from '@/modules/cache.js'
import { settings } from '@/modules/settings.js'
import { writable } from 'simple-store-svelte'

export default class Volume {
  #store
  #audioCtx = null
  #source = null
  #gainNode = null
  #volumeTimeout
  #boostResetTimer = null

  constructor() {
    this.level = Number(settings.value.volume || 1)
    this.muted = false
    this.gain = 0
    this.boosted = false
    this.text = ''
    this.visible = false
    this.wheelAccumulator = 0
    this.boostCount = 0
    this.#store = writable(this.#snapshot())
    this.#syncSettings()
  }

  #snapshot() {
    return {
      level: this.level,
      muted: this.muted,
      gain: this.gain,
      boosted: this.boosted,
      text: this.text,
      visible: this.visible,
      boostCount: this.boostCount
    }
  }

  #update() {
    this.#store.set(this.#snapshot())
  }

  #syncSettings() {
    settings.value.volume = String(this.level || 0)
    settings.set(settings.value)
  }

  #historyKey(media) {
    return media?.media?.id || media?.title || media?.parseObject?.title || media?.parseObject?.file_name
  }

  #setupAudio(video) {
    if (!this.#audioCtx) {
      this.#audioCtx = new AudioContext()
      this.#source = this.#audioCtx.createMediaElementSource(video)
      this.#gainNode = this.#audioCtx.createGain()
      this.#source.connect(this.#gainNode)
      this.#gainNode.connect(this.#audioCtx.destination)
    }
  }

  setGain(event, media) {
    const value = parseFloat(event.target.value)
    const previous = this.level
    if (value <= 1) {
      this.#gainNode.gain.value = 1
      this.level = value
    } else {
      this.level = 1
      this.#gainNode.gain.value = value
    }
    this.gain = value
    if (this.level !== previous) this.#syncSettings()
    cache.setEntry(caches.HISTORY, 'lastBoosted', { ...(cache.getEntry(caches.HISTORY, 'lastBoosted') || {}), [this.#historyKey(media)]: { boosted: this.boosted, gain: this.gain } })
    this.#update()
  }

  toggleGain(video, media) {
    this.#setupAudio(video)
    if (this.boosted) {
      const previous = this.level
      this.level = this.gain <= 1 ? this.gain : 1
      this.gain = 1
      if (this.#audioCtx) this.#gainNode.gain.value = 1
      if (this.level !== previous) this.#syncSettings()
    } else {
      this.setGain({ target: { value: this.level } }, media)
      this.boostCount = 0
      clearTimeout(this.#boostResetTimer)
    }
    this.boosted = !this.boosted
    cache.setEntry(caches.HISTORY, 'lastBoosted', { ...(cache.getEntry(caches.HISTORY, 'lastBoosted') || {}), [this.#historyKey(media)]: { boosted: this.boosted, gain: this.gain } })
    this.#update()
    return true
  }

  toggleMute() {
    this.muted = !this.muted
    this.#update()
    return this.muted
  }

  adjust(delta, media) {
    if (this.boosted) this.setGain({ target: { value: delta > 0 ? Math.min(3, this.gain + delta) : Math.max(0, this.gain + delta) } }, media)
    else {
      const previous = this.level
      this.level = delta > 0 ? Math.min(1, this.level + delta) : Math.max(0, this.level + delta)
      if (this.level !== previous) this.#syncSettings()
    }
    this.muted = this.level === 0
    this.#update()
    this.showTemporarily()
  }

  handleWheel(event, video, media) {
    // make trackpad type device scroll more gradual
    this.wheelAccumulator += event.deltaY
    if (Math.abs(this.wheelAccumulator) < 100) return

    const direction = this.wheelAccumulator < 0 ? 'up' : 'down'
    const delta = direction === 'up' ? 0.05 : -0.05
    this.wheelAccumulator = 0

    const wasVolumeBoosted = this.boosted
    const combined = (this.boosted && this.gain > 1) ? this.gain : this.level
    let next = Math.max(0, Math.min(3, combined + delta))
    // If crossing 100% on the way up, snap to exactly 100% and stop
    if (direction === 'up' && combined < 1 && next > 1) next = 1
    // limit guard at 100%
    if (!this.boosted && combined >= 1 && next > 1 && direction === 'up' && this.boostCount < 5) {
      this.boostCount++
      const superscripts = ['⁵', '⁴', '³', '²', '¹']
      this.text = `${(combined * 100).toFixed(0)}%${superscripts[this.boostCount - 1]}`
      this.showTemporarily(false)
      // Reset boostScrollCount after 2s of inactivity
      clearTimeout(this.#boostResetTimer)
      this.#boostResetTimer = setTimeout(() => { this.boostCount = 0; this.#update() }, 2_000)
      this.#boostResetTimer.unref?.()
      return
    }
    // Reset guard if we go back down
    if (next <= 1) {
      this.boostCount = 0
      clearTimeout(this.#boostResetTimer)
    }
    // --- STATE APPLICATION ---
    const previous = this.level
    if (next <= 1) {
      this.level = next
      this.gain = 1
      this.boosted = false
      this.muted = this.level === 0
    } else {
      this.#setupAudio(video)
      this.level = 1
      this.gain = next
      this.boosted = true
    }

    if (this.level !== previous) this.#syncSettings()
    if (this.#audioCtx) this.#gainNode.gain.value = this.boosted ? this.gain : this.level
    if (this.boosted || wasVolumeBoosted) cache.setEntry(caches.HISTORY, 'lastBoosted', { ...(cache.getEntry(caches.HISTORY, 'lastBoosted') || {}), [this.#historyKey(media)]: { boosted: this.boosted, gain: this.gain } })
    this.showTemporarily()
  }

  showTemporarily(updateText = true) {
    if (updateText) this.text = this.level === 0 || this.muted ? 'Muted' : `${((this.gain > 1 ? this.gain : this.level) * 100).toFixed(0)}%`
    this.visible = true
    this.#update()
    clearTimeout(this.#volumeTimeout)
    this.#volumeTimeout = setTimeout(() => { this.visible = false; this.#update() }, 600)
    this.#volumeTimeout.unref?.()
  }

  restore(video, media) {
    this.boosted = cache.getEntry(caches.HISTORY, 'lastBoosted')?.[`${this.#historyKey(media)}`]?.boosted || false
    if (this.boosted) {
      this.#setupAudio(video)
      this.gain = cache.getEntry(caches.HISTORY, 'lastBoosted')?.[`${this.#historyKey(media)}`]?.gain || 0
      this.#gainNode.gain.value = this.gain
    } else {
      if (this.#gainNode?.gain) this.#gainNode.gain.value = this.level
      this.gain = 0
      this.boostCount = 0
      clearTimeout(this.#boostResetTimer)
    }
    this.#update()
  }

  set(next) {
    const previous = this.level
    this.level = next.level
    this.muted = next.muted
    this.gain = next.gain
    if (this.level !== previous) this.#syncSettings()
    this.#update()
  }

  subscribe(run) {
    return this.#store.subscribe(run)
  }
}
