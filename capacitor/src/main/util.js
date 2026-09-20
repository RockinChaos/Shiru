import { Keyboard } from '@capacitor/keyboard'
import { createDeferred } from '@/modules/util.js'

export const development = process.env.NODE_ENV?.trim() === 'development'
export const loadingClient = createDeferred()

export let keyboardVisible = false
Keyboard.addListener('keyboardDidShow', () => (keyboardVisible = true))
Keyboard.addListener('keyboardDidHide', () => (keyboardVisible = false))