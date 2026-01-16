import { append, element } from 'svelte/internal'
import { writable } from 'simple-store-svelte'
import { cache, caches } from '@/modules/cache.js'
import { settings } from '@/modules/settings.js'

const style = element('style')
style.id = 'customThemes'
append(document.head, style)

export const variables = writable(cache.getEntry(caches.GENERAL, 'theme') || '')

variables.subscribe(value => {
  cache.setEntry(caches.GENERAL, 'theme', value)
  setScale()
  setStyle(value)
})

export function setStyle(value) {
  document.documentElement.setAttribute('data-theme', settings.value.presetTheme)
  document.querySelector('meta[name="theme-color"]').setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim())
  style.textContent = `:root[data-theme='${settings.value.presetTheme}']{${(value || variables.value).replace(/{|}/g, '')}}`
}

export function setScale() {
  document.documentElement.style.setProperty('--ui-scale', settings.value.uiScale)
}