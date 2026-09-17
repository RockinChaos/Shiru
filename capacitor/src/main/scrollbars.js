const MIN_THUMB_SIZE = 30
const EDGE_OFFSET = 2
const TRACK_INSET = 4
const hiddenScrollbars = new WeakSet()
const visibleScrollbars = new WeakSet()
const scrollPositions = new WeakMap()

let activeElement
let activeAxes
let fadeTimer
let updateFrame
let verticalThumb
let horizontalThumb
let touching = false

function showScrollbar(event) {
  const element = scrollingElement(event)
  if (!element || scrollbarIsHidden(element)) return

  const position = { top: element.scrollTop, left: element.scrollLeft }
  const previous = scrollPositions.get(element)
  scrollPositions.set(element, position)

  const vertical = previous ? Math.abs(position.top - previous.top) > .5 : element.scrollHeight - element.clientHeight > 1
  const horizontal = previous ? Math.abs(position.left - previous.left) > .5 : false
  if (!vertical && !horizontal) return

  activeElement = element
  activeAxes = { vertical, horizontal }
  if (!updateFrame) updateFrame = requestAnimationFrame(updateScrollbar)

  if (!touching) scheduleHideScrollbar()
}
document.addEventListener('scroll', showScrollbar, true)

function rememberScrollPositions(event) {
  for (let element = event.target; element instanceof HTMLElement; element = element.parentElement) {
    if (element.scrollHeight - element.clientHeight > 1 || element.scrollWidth - element.clientWidth > 1) {
      scrollPositions.set(element, { top: element.scrollTop, left: element.scrollLeft })
    }
  }
}
document.addEventListener('pointerdown', rememberScrollPositions, true)

function startTouch() {
  touching = true
  clearTimeout(fadeTimer)
}
document.addEventListener('touchstart', startTouch, { capture: true, passive: true })

function endTouch(event) {
  touching = event.touches.length > 0
  if (!touching && activeElement) scheduleHideScrollbar()
}
document.addEventListener('touchend', endTouch, { capture: true, passive: true })
document.addEventListener('touchcancel', endTouch, { capture: true, passive: true })

function scheduleHideScrollbar() {
  clearTimeout(fadeTimer)
  fadeTimer = setTimeout(hideScrollbar, 100)
}

function scrollbarIsHidden(element) {
  if (hiddenScrollbars.has(element)) return true
  if (visibleScrollbars.has(element)) return false

  let hidden = element.classList.contains('scrollbar-none') || getComputedStyle(element).getPropertyValue('scrollbar-width') === 'none'
  if (!hidden) {
    try {
      hidden = getComputedStyle(element, '::-webkit-scrollbar').display === 'none'
    } catch {}
  }

  if (hidden) hiddenScrollbars.add(element)
  else visibleScrollbars.add(element)
  return hidden
}

function scrollingElement(event) {
  if (event.target === document) return document.scrollingElement
  return event.target instanceof HTMLElement ? event.target : null
}

function createThumb(direction) {
  const thumb = document.createElement('div')
  thumb.className = `android-scrollbar-thumb android-scrollbar-thumb-${direction}`
  document.documentElement.append(thumb)
  return thumb
}

function getBounds(element) {
  if (element === document.scrollingElement) {
    return { top: 0, right: innerWidth, bottom: innerHeight, left: 0 }
  }

  const rect = element.getBoundingClientRect()
  return {
    top: Math.max(0, rect.top),
    right: Math.min(innerWidth, rect.right),
    bottom: Math.min(innerHeight, rect.bottom),
    left: Math.max(0, rect.left)
  }
}

function coveringElement(element, pointElement) {
  if (!pointElement || element === pointElement || pointElement.contains(element)) return
  if (!element.contains(pointElement)) return pointElement

  for (let current = pointElement; current && current !== element; current = current.parentElement) {
    const position = getComputedStyle(current).position
    if (position === 'sticky' || position === 'fixed') return current
  }
}

function clipCoveredBounds(element, bounds) {
  const clipped = { ...bounds }
  const x = Math.max(clipped.left, clipped.right - EDGE_OFFSET - 1)

  for (let checked = 0; checked < 5 && clipped.top < clipped.bottom; checked++) {
    const pointElement = document.elementFromPoint(x, clipped.top + 1)
    const covering = coveringElement(element, pointElement)
    if (!covering) break

    const cover = covering.getBoundingClientRect()
    if (!cover || cover.bottom <= clipped.top + 1) break
    clipped.top = Math.min(clipped.bottom, cover.bottom)
  }

  for (let checked = 0; checked < 5 && clipped.bottom > clipped.top; checked++) {
    const pointElement = document.elementFromPoint(x, clipped.bottom - 1)
    const covering = coveringElement(element, pointElement)
    if (!covering) break

    const cover = covering.getBoundingClientRect()
    if (!cover || cover.top >= clipped.bottom - 1) break
    clipped.bottom = Math.max(clipped.top, cover.top)
  }

  return clipped
}

function positionVerticalThumb(element, bounds) {
  bounds = clipCoveredBounds(element, bounds)
  bounds.top += TRACK_INSET
  bounds.bottom -= TRACK_INSET
  const trackSize = bounds.bottom - bounds.top
  const scrollSize = element.scrollHeight - element.clientHeight
  if (trackSize <= 0 || scrollSize <= 0) {
    verticalThumb?.classList.remove('active')
    return
  }

  verticalThumb ||= createThumb('vertical')
  const thumbSize = Math.max(MIN_THUMB_SIZE, trackSize * element.clientHeight / element.scrollHeight)
  const travel = Math.max(0, trackSize - thumbSize)
  const progress = Math.min(1, Math.max(0, element.scrollTop / scrollSize))
  const offset = travel * progress

  verticalThumb.style.top = `${bounds.top + offset}px`
  verticalThumb.style.left = `${bounds.right - verticalThumb.offsetWidth - EDGE_OFFSET}px`
  verticalThumb.style.height = `${Math.min(trackSize, thumbSize)}px`
  verticalThumb.classList.add('active')
}

function positionHorizontalThumb(element, bounds) {
  const trackSize = bounds.right - bounds.left
  const scrollSize = element.scrollWidth - element.clientWidth
  if (trackSize <= 0 || scrollSize <= 0) {
    horizontalThumb?.classList.remove('active')
    return
  }

  horizontalThumb ||= createThumb('horizontal')
  const thumbSize = Math.max(MIN_THUMB_SIZE, trackSize * element.clientWidth / element.scrollWidth)
  const travel = Math.max(0, trackSize - thumbSize)
  const progress = Math.min(1, Math.max(0, element.scrollLeft / scrollSize))
  const offset = travel * progress

  horizontalThumb.style.top = `${bounds.bottom - horizontalThumb.offsetHeight - EDGE_OFFSET}px`
  horizontalThumb.style.left = `${bounds.left + offset}px`
  horizontalThumb.style.width = `${Math.min(trackSize, thumbSize)}px`
  horizontalThumb.classList.add('active')
}

function updateScrollbar() {
  updateFrame = undefined
  if (!activeElement?.isConnected) return

  const bounds = getBounds(activeElement)
  if (activeAxes.vertical) positionVerticalThumb(activeElement, bounds)
  else verticalThumb?.classList.remove('active')
  if (activeAxes.horizontal) positionHorizontalThumb(activeElement, bounds)
  else horizontalThumb?.classList.remove('active')
}

function hideScrollbar() {
  verticalThumb?.classList.remove('active')
  horizontalThumb?.classList.remove('active')
  activeElement = undefined
  activeAxes = undefined
}