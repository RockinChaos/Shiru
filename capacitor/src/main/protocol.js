import { Filesystem } from '@capacitor/filesystem'
import { Browser } from '@capacitor/browser'
import { loadingClient } from './util.js'
import { ipcWire } from './ipc.js'
import { App as Capacitor } from '@capacitor/app'

export default class Protocol {
  // schema: shiru://key/value
  protocolMap = {
    alauth: token => this.sendToken(token),
    malauth: token => this.sendMalToken(token),
    anime: id => ipcWire.send('common:onRequestModal', 'anime_details', { id }),
    malanime: id => ipcWire.send('common:onRequestModal', 'anime_details', { id, isMal: true }),
    torrent: magnet => this.add(magnet),
    search: id => this.play(id),
    w2g: link => ipcWire.send('common:onLobbyInvite', link),
    player: () => ipcWire.send('common:onRequestPage', 'player'),
    schedule: () => ipcWire.send('common:onRequestPage', 'schedule'),
    donate: () => Browser.open({ url: 'https://contribute.shiru.app/' }),
    update: () => ipcWire.emit('common:quitAndInstall'),
    changelog: () => Browser.open({ url: 'https://latest.shiru.app/' })
  }

  protocolRx = /shiru:\/\/([a-z0-9]+)\/(.*)/i

  constructor() {
    Capacitor.getLaunchUrl().then(res => {
      if (location.hash !== '#skipAlLogin') {
        location.hash = '#skipAlLogin'
        if (res) this.handleProtocol(res.url)
      } else location.hash = ''
    })
    Capacitor.addListener('appUrlOpen', async ({ url }) => {
      await loadingClient.promise
      if ((!url.startsWith('magnet:') && url.endsWith('.torrent')) || url.startsWith('content://') || url.startsWith('file://')) this.handleTorrentFile(url)
      else this.handleProtocol(url)
    })
    ipcWire.on('common:handleProtocol', (event, data) => this.handleProtocol(data))
  }

  /**
   * Handles opening a `.torrent` file and sends it as `Base64`
   *
   * Note: We pass the raw base64 string instead of converting to Uint8Array as it gets corrupted
   * when crossing the Capacitor bridge from the webview to the Node.js background process.
   *
   * @param {string} fileUri - The URI to the .torrent file (supports file:// and content:// schemes)
   */
  async handleTorrentFile(fileUri) {
    let path = fileUri
    if (path.startsWith('file://')) path = path.replace('file://', '')
    const file = await Filesystem.readFile({ path })
    this.add(file.data, true)
  }

  /**
   * @param {string} line
   */
  sendToken(line) {
    let token = line.split('access_token=')[1].split('&token_type')[0]
    if (token) {
      if (token.endsWith('/')) token = token.slice(0, -1)
      ipcWire.send('common:onProviderToken', 'anilist', { token })
    }
  }

  /**
   * @param {string} line
   */
  sendMalToken(line) {
    let code = line.split('code=')[1].split('&state')[0]
    let state = line.split('&state=')[1]
    if (code && state) {
      if (code.endsWith('/')) code = code.slice(0, -1)
      if (state.endsWith('/')) state = state.slice(0, -1)
      if (state.includes('%')) state = decodeURIComponent(state)
      ipcWire.send('common:onProviderToken', 'myanimelist', { code, state })
    }
  }

  /**
   * @param {string} id - The media id.
   */
  play(id) {
    ipcWire.send('common:onRequestPlay', { id })
  }

  /**
   * @param {string} magnet - The magnet link.
   * @param {boolean} base64 - If the data needs to be converted from `Base64` to `Uint8Array`
   */
  add(magnet, base64 = false) {
    ipcWire.send('torrent:onRequest', { magnet, base64 })
  }

  /**
   * @param {string} text
   */
  handleProtocol(text) {
    // Handle magnet links
    if (text.startsWith('magnet:')) {
      this.add(text)
      return
    }

    // Handle shiru:// scheme
    const match = text.match(this.protocolRx)
    if (match) this.protocolMap[match[1]]?.(match[2])
  }
}