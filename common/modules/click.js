import { SUPPORTS } from '@/modules/support.js'

let lastTapElement = null
let lastTapTarget = null
let lastTapCurrent = null
let lastHoverElement = null
let lastInteractionMethod = 'mouse'

const noop = _ => {}

document.addEventListener('mousedown', () => lastInteractionMethod = 'mouse')
document.addEventListener('touchstart', () => lastInteractionMethod = 'touch', { passive: true })
document.addEventListener('focusin', (e) => {
  if (lastInteractionMethod !== 'dpad') return
  const activeEl = document.activeElement
  const isTextInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)
  if (!isTextInput && !e.target?.closest('.select-all')) window.getSelection()?.removeAllRanges()
  if (lastTapTarget !== e.target && (!lastTapCurrent || !e.target || !lastTapCurrent.contains(e.target))) {
    lastTapElement?.(false)
    lastTapElement = null
    lastHoverElement?.(false)
    lastHoverElement = null
    lastTapCurrent = null
    lastTapTarget = null
  }
})

document.addEventListener('pointercancel', (e) => {
  if (lastTapTarget !== e.target && (!lastTapCurrent || !e.target || !lastTapCurrent.contains(e.target))) {
    lastTapElement?.(false)
    lastTapElement = null
    lastHoverElement?.(false)
    lastHoverElement = null
    lastTapCurrent = null
    lastTapTarget = null
  }
})

document.addEventListener('selectionchange', () => {
  const activeEl = document.activeElement
  const isTextInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)
  if (!isTextInput && (window.getSelection()?.toString()?.trim() === '')) window.getSelection()?.removeAllRanges()
})

if (SUPPORTS.isAndroid) {
  document.addEventListener('touchstart', () => window.Capacitor.Plugins.StatusBar.hide(), { passive: true })
} else {
  // don't focus what we can't even tab to, fixes function keys being used to focus.
  document.addEventListener('focusin', (e) => {
    if (e.target.getAttribute('tabindex') === '-1') e.target.blur()
  }, true)
}
/** @typedef {{element: Element, x: number, y: number, inViewport: boolean}} ElementPosition  */

/**
 * Adds click event listener to the specified node.
 * @param {HTMLElement} node - The node to attach the click event listener to.
 * @param {Function} [cb=noop] - The callback function to be executed on click.
 */
export function click(node, cb = noop) {
  if (!node.hasAttribute('tabindex')) node.tabIndex = 0
  node.role = 'button'
  node.addEventListener('click', e => {
    e.stopPropagation()
    navigator.vibrate(15)
    cb(e)
  })
  node.addEventListener('pointerup', e => {
    e.stopPropagation()
  })
  node.addEventListener('pointerleave', e => {
    e.stopPropagation()
  })
  if (!SUPPORTS.isAndroid) {
    node.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.stopPropagation()
        cb(e)
      }
    })
  }
}

/**
 * Adds blur (focus lost) event listener to the specified node.
 * @param {HTMLElement} node - The node to attach the blur event listener to.
 * @param {Function} [onBlur=noop] - The callback function to be executed on blur.
 */
export function blurExit(node, onBlur = noop) {
  if (SUPPORTS.isAndroid) {
    if (!node.hasAttribute('tabindex')) node.tabIndex = 0
    node.role = 'button'
    node.addEventListener('blur', e => onBlur())
  }
}

/**
 * Adds hover event listener to the specified node.
 * @param {HTMLElement} node - The node to attach the click event listener to.
 * @param {Function} [hoverUpdate=noop] - The callback function to be executed on hover.
 */
export function hoverExit(node, hoverUpdate = noop) {
  if (!node.hasAttribute('tabindex')) node.tabIndex = 0
  node.role = 'button'
  node.addEventListener('pointerleave', e => {
    hoverUpdate()
  })
}

/**
 * Adds focus event listeners to the specified node.
 * @param {HTMLElement} node - The node to attach the event listeners to.
 * @param {Function} [focusUpdate=noop] - The callback function to be executed on focus.
 */
export function focus(node, focusUpdate = noop) {
  if (!node.hasAttribute('tabindex')) node.tabIndex = 0
  node.role = 'button'
  let focusTimeout
  let blurTimeout
  function clearTimeouts() {
    clearTimeout(focusTimeout)
    clearTimeout(blurTimeout)
  }
  function handleOutsideClick(e) {
    const focused = e.target
    if (node && focused?.offsetParent != null && !node.contains(focused)) {
      clearTimeouts()
      focusUpdate(false)
      lastTapElement = null
      lastTapCurrent = null
      document.removeEventListener('pointerup', handleOutsideClick)
    }
  }
  node.addEventListener('pointerleave', clearTimeouts)
  node.addEventListener('focus', () => {
    clearTimeouts()
    document.addEventListener('pointerup', handleOutsideClick)
    focusTimeout = setTimeout(() => focusUpdate(true), 800)
    focusTimeout.unref?.()
  })
  node.addEventListener('focusout', () => {
    clearTimeouts()
    blurTimeout = setTimeout(() => {
      const focused = document.activeElement
      if (node && focused?.offsetParent != null && !node.contains(focused)) {
        focusUpdate(false)
        lastTapElement = null
        lastTapCurrent = null
        document.removeEventListener('pointerup', handleOutsideClick)
      }
    })
    blurTimeout.unref?.()
  })
}

/**
 * Adds hover event listeners to the specified node.
 * @param {HTMLElement} node - The node to attach the event listeners to.
 * @param {Function} [hoverUpdate=noop] - The callback function to be executed on hover.
 */
export function hover(node, hoverUpdate = noop) {
  let pointerType = 'touch'
  if (!node.hasAttribute('tabindex')) node.tabIndex = 0
  node.role = 'button'
  node.addEventListener('pointerenter', e => {
    if (e.pointerType !== 'touch') {
      if (!node.contains(e.target)) {
        lastHoverElement?.(false)
        lastTapElement?.(false)
      }
      hoverUpdate(true)
      lastHoverElement = hoverUpdate
      lastTapCurrent = e.currentTarget
      pointerType = e.pointerType
    }
  })
  node.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.stopPropagation()
      lastTapElement?.(false)
      if (lastTapElement === hoverUpdate) {
        lastTapElement = null
      } else {
        hoverUpdate(true, true)
        if (!SUPPORTS.isAndroid) lastTapElement = hoverUpdate
      }
    }
  })
  node.addEventListener('pointerleave', e => {
    lastHoverElement = hoverUpdate
    if (e.pointerType === 'mouse') hoverUpdate(false)
  })
  node.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch' && (!lastTapCurrent || !lastTapCurrent.contains(e.target))) {
      e.stopPropagation()
      lastHoverElement?.(false)
      lastTapElement?.(false)
      if (lastTapElement === hoverUpdate) {
        hoverUpdate(false, true)
        lastTapElement = null
        lastTapCurrent = null
      } else {
        hoverUpdate(true, true)
        lastTapElement = hoverUpdate
        lastTapCurrent = e.currentTarget
      }
    }
  })
}

/**
 * Adds hover and click event listeners to the specified node.
 * @param {HTMLElement} node - The node to attach the event listeners to.
 * @param {Function} [cb=noop] - The callback function to be executed on click.
 * @param {Function} [hoverUpdate=noop] - The callback function to be executed on hover.
 * @param {Function} [rcb=noop] - The callback function to be executed on right-click (alt click).
 */
export function hoverClick(node, [cb = noop, hoverUpdate = noop, rcb = noop]) {
  let pointerType = 'touch'
  if (!node.hasAttribute('tabindex')) node.tabIndex = 0
  node.role = 'button'
  function handleOutsideClick(e) {
    const focused = e.target
    if (node && focused?.offsetParent != null && !node.contains(focused)) {
      hoverUpdate(false)
      lastTapElement = null
      lastHoverElement = null
      document.removeEventListener('pointerup', handleOutsideClick)
    }
  }
  node.addEventListener('pointerenter', e => {
    if (e.pointerType !== 'touch') {
      if (!node.contains(e.target)) {
        lastHoverElement?.(false)
        lastTapElement?.(false)
      }
      hoverUpdate(true)
      document.addEventListener('pointerup', handleOutsideClick)
      lastHoverElement = hoverUpdate
      lastTapCurrent = e.currentTarget
      pointerType = e.pointerType
    }
  })
  node.addEventListener('click', e => {
    e.stopPropagation()
    if (pointerType === 'mouse') return cb(e)
    lastTapElement?.(false)
    if (lastTapElement === hoverUpdate) {
      lastTapElement = null
      navigator.vibrate(15)
      hoverUpdate(false)
      document.removeEventListener('pointerup', handleOutsideClick)
      cb(e)
    } else {
      hoverUpdate(true, true)
      document.addEventListener('pointerup', handleOutsideClick)
      lastTapElement = hoverUpdate
      lastTapTarget = e.target
    }
  })
  node.addEventListener('contextmenu', e => {
    e.preventDefault()
    rcb(e)
  })
  node.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.stopPropagation()
      lastTapElement?.(false)
      if (lastTapElement === hoverUpdate) {
        lastTapElement = null
        cb(e)
      } else {
        hoverUpdate(true, true)
        document.addEventListener('pointerup', handleOutsideClick)
        if (!SUPPORTS.isAndroid) lastTapElement = hoverUpdate
      }
    }
  })
  node.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse') {
      e.stopPropagation()
      setTimeout(() => {
        hoverUpdate(false)
        document.removeEventListener('pointerup', handleOutsideClick)
      })
    }
  })
  node.addEventListener('pointerleave', e => {
    lastHoverElement = hoverUpdate
    if (e.pointerType === 'mouse') {
      hoverUpdate(false)
      document.removeEventListener('pointerup', handleOutsideClick)
    }
  })
}

/**
 * Adds drag event listener to the specified node.
 * @param {HTMLElement} node - The node to attach the drag event listener to.
 * @param {Function} [dp=noop] - The callback function to be executed on drag.
 */
export function drag(node, dp = noop) {
  let startX = 0
  let endX = 0
  let isDragging = false
  let hasMoved = false
  node.role = 'presentation'
  node.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX
    hasMoved = false
  }, { passive: true })
  node.addEventListener('touchmove', e => {
    endX = e.touches[0].clientX
    if (Math.abs(endX - startX) > 50) hasMoved = true
  }, { passive: true })
  node.addEventListener('touchend', () => {
    if (hasMoved) dp(endX - startX)
  })
  node.addEventListener('mousedown', e => {
    isDragging = true
    startX = e.clientX
    hasMoved = false
  })
  node.addEventListener('mousemove', e => {
    if (!isDragging) return
    endX = e.clientX
    if (Math.abs(endX - startX) > 50) hasMoved = true
  })
  node.addEventListener('mouseup', () => {
    if (isDragging && hasMoved) dp(endX - startX)
    isDragging = false
  })
}

/**
 * Handles smooth scrolling an element via drag scroll.
 * @param {HTMLElement} node - The node to attach the drag scroll event listener to.
 */
export function dragScroll(node) {
  let dragging = false
  let activePointer = null
  let threshold = 50
  let dragged = false
  let draggedX = 0
  let draggedY = 0
  let startX = 0
  let startY = 0
  let suppressClick = false
  const controller = new AbortController()
  const opts = { signal: controller.signal }
  node.addEventListener('pointerleave', () => {
    if (dragging && activePointer) {
      try { node.releasePointerCapture(activePointer) } catch {}
    }
    dragging = false
  }, opts)
  node.addEventListener('click', (e) => {
    if (suppressClick) {
      e.preventDefault()
      e.stopPropagation()
    }
    dragging = false
  }, opts)
  node.addEventListener('mouseleave', () => dragging = false, opts)
  node.addEventListener('pointerdown', e => activePointer = e.pointerId, opts)
  node.addEventListener('mouseup', () => {
    if (dragging && activePointer) {
      node.style.removeProperty('cursor')
      try { node.releasePointerCapture(activePointer) } catch {}
    }
    dragging = false
  }, opts)
  node.addEventListener('pointerup', (e) => {
    if (dragging && dragged) {
      suppressClick = true
      e.stopPropagation()
      setTimeout(() => suppressClick = false).unref?.()
    }
    if (dragging && activePointer) {
      node.style.removeProperty('cursor')
      try { node.releasePointerCapture(activePointer) } catch {}
    }
    dragging = false
  }, opts)
  node.addEventListener('mousedown', e => {
    const target = e.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return
    dragged = false
    dragging = true
    draggedX = 0
    draggedY = 0
    startX = e.clientX
    startY = e.clientY
  }, opts)
  node.addEventListener('mousemove', e => {
    if (!dragging) return true
    if (isMouseLeave(node, e.clientX, e.clientY)) {
      if (activePointer) try { node.releasePointerCapture(activePointer) } catch {}
      dragging = false
      return true
    }
    draggedX += Math.abs(e.clientX - startX)
    draggedY += Math.abs(e.clientY - startY)
    node.scrollBy(startX - e.clientX, startY - e.clientY)
    startX = e.clientX
    startY = e.clientY
    node.style.cursor = 'grabbing'
    if (draggedX > threshold || draggedY > threshold) {
      dragged = true
      try { node.setPointerCapture(activePointer) } catch {}
    }
  }, opts)
  function isMouseLeave(node, x, y) {
    const rect = node.getBoundingClientRect()
    return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
  }
  return { destroy: () => controller.abort() }
}

const Directions = { up: 1, right: 2, down: 3, left: 4 }
// const InverseDirections = { up: 'down', down: 'up', left: 'right', right: 'left' }
const DirectionKeyMap = { ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right' }

/**
 * Calculates the direction between two points.
 * @param {Object} anchor - The anchor point.
 * @param {Object} relative - The relative point.
 * @returns {number} - The direction between the two points.
 */
function getDirection(anchor, relative) {
  return Math.round((Math.atan2(relative.y - anchor.y, relative.x - anchor.x) * 180 / Math.PI + 180) / 90) || 4
}

/**
 * Calculates the distance between two points.
 * @param {Object} anchor - The anchor point.
 * @param {Object} relative - The relative point.
 * @returns {number} - The distance between the two points.
 */
function getDistance(anchor, relative) {
  return Math.hypot(relative.x - anchor.x, relative.y - anchor.y)
}

/**
 * Gets keyboard-focusable elements within a specified element.
 * @param {Element} [element=document.body] - The element to search within.
 * @returns {Element[]} - An array of keyboard-focusable elements.
 */
function getKeyboardFocusableElements(element = document.body) {
  return [...element.querySelectorAll('a[href], button:not([disabled], [tabindex="-1"]), fieldset:not([disabled]), input:not([disabled]), optgroup:not([disabled]), option:not([disabled]), select:not([disabled]), textarea:not([disabled]), details, [tabindex]:not([tabindex="-1"], [disabled]), [contenteditable], [controls]')].filter(
    el => !el.getAttribute('aria-hidden')
  )
}

/**
 * Gets the position of an element.
 * @param {Element} element - The element to get the position of.
 * @returns {ElementPosition} - The position of the element.
 */
function getElementPosition(element) {
  const { x, y, width, height, top, left, bottom, right } = element.getBoundingClientRect()
  const inViewport = isInViewport({ top, left, bottom, right, width, height })
  return { element, x: x + width * 0.5, y: y + height * 0.5, inViewport }
}

/**
 * Gets the positions of all focusable elements.
 * @returns {ElementPosition[]} - An array of element positions.
 */
function getFocusableElementPositions() {
  const elements = []
  for (const element of getKeyboardFocusableElements(document.querySelector('.modal.show') ?? document.body)) {
    const position = getElementPosition(element)
    if (position) elements.push(position)
  }
  return elements
}

/**
 * Checks if an element is within the viewport.
 * @param {Object} rect - The coordinates of the element.
 * @returns {boolean} - True if the element is within the viewport, false otherwise.
 */
function isInViewport({ top, left, bottom, right, width, height }) {
  return top + height >= 0 && left + width >= 0 && bottom - height <= window.innerHeight && right - width <= window.innerWidth
}

// function isVisible({ top, left, bottom, right }, element) {
//   for (const [x, y] of [[left, top], [right, top], [left, bottom], [right, bottom]]) {
//     if (document.elementFromPoint(x, y)?.isSameNode(element)) return true
//   }
//   return false
// }

/**
 * @param {ElementPosition[]} keyboardFocusable
 * @param {ElementPosition} currentElement
 * @param {string} direction
 * @returns {ElementPosition[]}
 */
function getElementsInDesiredDirection(keyboardFocusable, currentElement, direction) {
  // first try finding visible elements in desired direction
  return keyboardFocusable.filter(position => {
    // in order of computation cost
    if (position.element === currentElement.element) return false
    if (getDirection(currentElement, position) !== Directions[direction]) return false

    // filters out elements which are in the viewport, but are overlayed by other elements like a modal
    if (position.inViewport && !position.element.checkVisibility()) return false
    if (!position.inViewport && direction === 'right') return false // HACK: prevent right navigation from going to offscreen elements, but allow vertical elements!
    return true
  })
}

/**
 * Navigates using D-pad keys.
 * @param {string} [direction='up'] - The direction to navigate.
 */
function navigateDPad(direction = 'up') {
  const keyboardFocusable = getFocusableElementPositions()
  const currentElement = !document.activeElement || document.activeElement === document.body ? keyboardFocusable[0] : getElementPosition(document.activeElement)

  const elementsInDesiredDirection = getElementsInDesiredDirection(keyboardFocusable, currentElement, direction)

  // if there are elements in desired direction
  if (elementsInDesiredDirection.length) {
    const closestElement = elementsInDesiredDirection.reduce((reducer, position) => {
      const distance = getDistance(currentElement, position)
      if (distance < reducer.distance) return { distance, element: position.element }
      return reducer
    }, { distance: Infinity, element: null })

    /** @type {{element: HTMLElement}} */
    const { element } = closestElement

    const isInput = element.matches('input[type=text], input[type=url], input[type=number], textarea')
    // make readonly
    let wasReadOnly = false
    if (isInput) {
      wasReadOnly = element.readOnly
      element.readOnly = true
    }
    element.focus()
    if (isInput && !wasReadOnly) setTimeout(() => { element.readOnly = false })
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    // return
  }

  // no elements in desired direction, go to opposite end [wrap around] // this wasnt a good idea in the long run
  // const elementsInOppositeDirection = getElementsInDesiredDirection(keyboardFocusable, currentElement, InverseDirections[direction])
  // if (elementsInOppositeDirection.length) {
  //   const furthestElement = elementsInOppositeDirection.reduce((reducer, position) => {
  //     const distance = getDistance(currentElement, position)
  //     if (distance > reducer.distance) return { distance, element: position.element }
  //     return reducer
  //   }, { distance: -Infinity, element: null })

  //   furthestElement.element.focus()
  // }
}

// hacky, but make sure keybinds system loads first so it can prevent this from running
queueMicrotask(() => {
  document.addEventListener('keydown', e => {
    if (DirectionKeyMap[e.key]) {
      e.preventDefault()
      lastInteractionMethod = 'dpad'
      navigateDPad(DirectionKeyMap[e.key])
    } else lastInteractionMethod = 'keyboard'
  })
})
