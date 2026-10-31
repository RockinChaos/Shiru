import { LocalNotifications } from '@capacitor/local-notifications'
import { SystemBars, SystemBarType } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { Keyboard } from '@capacitor/keyboard'
import { NodeJS } from 'capacitor-nodejs'
import { App as Capacitor } from '@capacitor/app'

import '../preload/preload.js'
import Protocol from './protocol.js'
import Updater from './updater.js'
import Debug from './debugger.js'
import Dialog from './dialog.js'

import { development, loadingClient } from './util.js'
import { ipcWire } from './ipc.js'
import './scrollbars.js'

export default class App {
  protocol = new Protocol()
  updater = new Updater({ provider: atob('Z2l0aHVi'), owner: atob('Um9ja2luQ2hhb3M='), repo: atob('U2hpcnU=') }, [{ provider: atob('Z2VuZXJpYw=='), url: atob('Y2RuLnNoaXJ1LmFwcA==') }])
  debug = new Debug()
  dialog = new Dialog(this.debug)

  ready = NodeJS.whenReady()

  canNotify = false
  handleNotify = false
  NOTIFICATION_FG_ID = 9001
  notifyTypes = [
    {
      id: 'view_anime',
      actions: [{ id: 'view_anime', title: 'View Anime' }]
    },
    {
      id: 'start_watching',
      actions: [{ id: 'watch_anime', title: 'Start Watching' }, { id: 'view_anime', title: 'View Anime' }]
    },
    {
      id: 'continue_watching',
      actions: [{ id: 'watch_anime', title: 'Resume' }, { id: 'view_anime', title: 'View Anime' }]
    },
    {
      id: 'watch_now',
      actions: [{ id: 'watch_anime', title: 'Watch' }, { id: 'view_anime', title: 'View Anime' }]
    },
    {
      id: 'update_app',
      actions: [{ id: 'update_now', title: 'Update Now' }, { id: 'whats_new', title: `What's New` }]
    }
  ]

  constructor() {
    SystemBars.hide({ bar: SystemBarType.StatusBar })
    Keyboard.addListener('keyboardWillHide', () => SystemBars.hide({ bar: SystemBarType.StatusBar }))
    Capacitor.addListener('appStateChange', (state) => {
      if (state.isActive) SystemBars.hide({ bar: SystemBarType.StatusBar })
    })
    if (development) SplashScreen.hide()
    else ipcWire.once('common:windowReady', () => setTimeout(() => SplashScreen.hide({ fadeOutDuration: 600 })).unref?.()) // HACK: Prevents the window from being shown while it's still loading. This is nice for production as the window can't be moved without the elements being rendered.

    // Receives log events bridged from webtorrent.js stderr/stdout.
    NodeJS.addListener('torrent:log', ({ args }) => {
      const { level, message } = args[0]
      level === 'error' ? console.error(message) : console.debug(message)
    })

    ipcWire.handle('torrent:portRequest', async (event, { settings, requestId }) => {
      /** @type {import('@capacitor/core').PluginListenerHandle|undefined} */
      let messageListener
      const port = {
        onmessage: async cb => {
          messageListener = await NodeJS.addListener('torrent:message', ({ args }) => {
            if (args[0]?.requestId === requestId) cb({ data: args[0].data })
          })
        },
        postMessage: data => NodeJS.send({ eventName: 'torrent:message', args: [{ requestId, data }] }),
        close: async () => messageListener?.remove()
      }
      await this.ready
      this.handleNotify = true
      /** @type {import('@capacitor/core').PluginListenerHandle[]} */
      const listeners = []
      /** @type {ReturnType<typeof setTimeout>|undefined} */
      let timer
      /** @type {boolean} */
      let settled = false
      try {
        return await new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Torrent initialization timed out')), 15_000)
          const onReady = async ({ args }) => {
            if (settled || args[0] !== requestId) return
            try {
              await NodeJS.send({ eventName: 'torrent:connect', args: [requestId] })
              if (settled) return
              loadingClient.resolve()
              resolve(port)
            } catch (error) { reject(error) }
          }
          Promise.all([
            NodeJS.addListener('torrent:ready', onReady),
            NodeJS.addListener('torrent:init-error', ({ args }) => {
              if (args[0] === requestId) reject(new Error(args[1]))
            })
          ].map(registration => registration.then(handle => {
            if (settled) return handle.remove()
            listeners.push(handle)
          }))).then(() => {
            if (!settled) return NodeJS.send({ eventName: 'torrent:init', args: [{ settings, requestId }] })
          }).catch(reject)
        })
      } finally {
        settled = true
        clearTimeout(timer)
        await Promise.all(listeners.map(listener => listener.remove()))
      }
    })
    ipcWire.on('torrent:reload', () => NodeJS.send({ eventName: 'torrent:reload', args: [] }))

    LocalNotifications.registerActionTypes({ types: this.notifyTypes })
    LocalNotifications.checkPermissions().then(value => {
      if (value?.display !== 'granted') {
        try {
          LocalNotifications.requestPermissions().then(() => (this.canNotify = true))
        } catch (error) {
          console.debug(error)
        }
      } else this.canNotify = true
    })
    LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
      const url = ['watch_anime', 'update_now'].includes(notification.actionId) ? notification.notification.extra?.buttons?.[0]?.activation : notification.notification.extra?.buttons?.[notification.notification.extra?.buttons?.length - 1]?.activation
      if (url) {
        const checkInterval = setInterval(() => {
          if (this.handleNotify) {
            clearInterval(checkInterval)
            window.location.href = url
          }
        }, 50)
      }
    })
    ipcWire.on('common:notify', (event, opts) => {
      if (!this.canNotify) return
      LocalNotifications.schedule({
        notifications: [{
          smallIcon: 'ic_filled',
          largeIcon: opts.icon || opts.iconXL,
          sound: 'ic_notification.wav',
          iconColor: '#2F4F4F',
          id: this.NOTIFICATION_FG_ID++,
          title: opts.title,
          body: opts.message,
          actionTypeId: opts.button?.length > 1 ? opts.button[0].text?.includes('Start') ? 'start_watching' : (opts.button[0].text?.includes('Continue') ? 'continue_watching' : (opts.button[0].text?.includes('Update') ? 'update_app' : 'watch_now')) : (opts.button?.length ? 'view_anime' : undefined),
          attachments: [{ id: 'my_preview', url: opts.heroImg || opts.iconXL || opts.icon }],
          extra: { buttons: opts.button }
        }]
      })
    })

    ipcWire.on('common:quitAndInstall', () => {
      if (this.updater.updateAvailable) this.updater.install(true)
    })
  }
}
