import { Client } from '@xhayper/discord-rpc'
import { ipcMain } from 'electron'
import { debounce } from '@/modules/util.js'

export default class Discord {
  defaultStatus = {
    activity: {
      timestamps: { start: Date.now() },
      details: 'Streaming anime instantly',
      state: 'Enjoying an anime episode...',
      assets: {
        large_image: 'icon',
        large_text: 'https://github.com/RockinChaos/Shiru',
        small_image: 'sail',
        small_text: 'Watching anime on Shiru'
      },
      buttons: [
        {
          label: 'Download Shiru',
          url: 'https://github.com/RockinChaos/Shiru/releases/latest'
        }
      ],
      instance: true,
      type: 3
    }
  }

  discord = new Client({ transport: { type: 'ipc' }, clientId: '1301772260780019742' })

  /** @type {string} */
  enableRPC = 'disabled'
  /** @type {Discord['defaultStatus'] | undefined} */
  cachedPresence

  /** @param {import('electron').BrowserWindow} window */
  constructor (window) {
    ipcMain.on('discord', (event, data) => {
      this.cachedPresence = data
      this.debouncedDiscordRPC(this.enableRPC === 'full' ? this.cachedPresence : undefined, this.enableRPC === 'disabled')
    })

    ipcMain.on('discord-rpc', (event, data) => {
      if (this.enableRPC !== data) {
        this.enableRPC = data
        if (data !== 'disabled') {
          if (!this.discord?.user) this.loginRPC()
          else this.debouncedDiscordRPC(this.enableRPC === 'full' ? this.cachedPresence : undefined)
        } else if (this.discord?.user) {
          this.debouncedDiscordRPC(undefined, true)
        }
      }
    })

    ipcMain.on('discord-clear', () => this.debouncedDiscordRPC(undefined, true))

    this.discord.on('ready', async () => {
      this.setDiscordRPC(this.enableRPC === 'full' ? this.cachedPresence : undefined)
      this.discord.subscribe('ACTIVITY_JOIN_REQUEST')
      this.discord.subscribe('ACTIVITY_JOIN')
      this.discord.subscribe('ACTIVITY_SPECTATE')
    })

    this.discord.on('disconnected', () => { if (this.enableRPC !== 'disabled') this.loginRPC() })

    this.discord.on('ACTIVITY_JOIN', ({ secret }) => window.webContents.send('w2glink', secret))
    this.debouncedDiscordRPC = debounce((status, clearActivity) => this.setDiscordRPC(status, clearActivity), 4_500)
  }

  loginRPC () {
    this.discord.login().catch(() => setTimeout(() => this.loginRPC(), 5_000).unref?.())
  }

  setDiscordRPC (data = this.defaultStatus, clearActivity = false) {
    if (clearActivity) {
      if (this.discord?.user) this.discord.user.clearActivity(process.pid)
    } else if (this.discord.user && data && this.enableRPC !== 'disabled') {
      data.pid = process.pid
      this.discord.request('SET_ACTIVITY', data)
    }
  }
}