import { append, element } from 'svelte/internal'
import { writable } from 'simple-store-svelte'
import { settings } from '@/modules/settings.js'
import { SUPPORTS } from '@/modules/support.js'
import { ANDROID } from '@/modules/bridge.js'

const style = element('style')
style.id = 'customThemes'
append(document.head, style)

export const variables = writable(settings.value.customCSS || '')

variables.subscribe(value => {
  setScale()
  setStyle(value)
})

export function setStyle(value) {
  settings.update(s => ({ ...s, customCSS: value ?? s.customCSS }))
  document.documentElement.setAttribute('data-theme', settings.value.presetTheme)
  document.querySelector('meta[name="theme-color"]').setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim())
  style.textContent = `:root[data-theme='${settings.value.presetTheme}']{${(value || variables.value).replace(/{|}/g, '')}}`
  if (SUPPORTS.isAndroid) {
    if (settings.value.presetTheme === 'default-light') ANDROID.setSystemStyle('LIGHT') // Future light theme handling for Android.
    else ANDROID.setSystemStyle('DARK')
  }
}

export function setScale() {
  document.documentElement.style.setProperty('--ui-scale', settings.value.uiScale)
  if (SUPPORTS.isAndroid) {
    document.documentElement.style.setProperty('--nav-button-size', '3.6rem')
    document.documentElement.style.setProperty('--default-bottombar-height', settings.value.showLabels ? '7.5rem' : '7rem')
  }
}