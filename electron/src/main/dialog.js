import { ipcMain, dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'

export default class Dialog {

  constructor (debug) {
    ipcMain.handle('common:pickFile', async (event, title) => {
      const { filePaths, canceled } = await dialog.showOpenDialog({ title, properties: ['openFile'] })
      if (canceled || !filePaths.length) return { cancelled: true }
      return { path: filePaths[0] }
    })
    ipcMain.handle('common:pickFolder', async (event, title) => {
      const { filePaths, canceled } = await dialog.showOpenDialog({ title, properties: ['openDirectory'] })
      if (canceled || !filePaths.length) return { cancelled: true }
      if (filePaths.length) {
        let path = filePaths[0]
        if (!(path.endsWith('\\') || path.endsWith('/'))) {
          if (path.indexOf('\\') !== -1) {
            path += '\\'
          } else if (path.indexOf('/') !== -1) {
            path += '/'
          }
        }
        return { path }
      }
    })
    ipcMain.handle('common:exportLog', async () => {
      try {
        const log = await debug.getLogContents()
        const { filePath, canceled } = await dialog.showSaveDialog({
          title: 'Select export location for the log file',
          defaultPath: `shiru-log-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
          filters: [{ name: 'Log File', extensions: ['log'] }]
        })
        if (canceled || !filePath) return { error: false, cancelled: true }
        await writeFile(filePath, log, { encoding: 'utf8', mode: 0o644 })
        return { error: false }
      } catch (error) {
        console.debug(error)
        return { error: true }
      }
    })
    // TODO: Add support for media file selection, currently only supports torrent files
    ipcMain.handle('common:pickMediaFiles', async () => {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Select torrent files to import', // 'Select media file(s) or torrent(s), selecting more than one media file creates a batch.'
        properties: ['openFile', 'multiSelections'],
        filters: [{
          name: 'Torrent', // 'Media Files & Torrents'
          extensions: ['torrent'] // [ '3g2', '3gp', 'asf', 'avi', 'dv', 'flv', 'gxf', 'm2ts', 'm4a', 'm4b', 'm4p', 'm4r', 'm4v', 'mkv', 'mov', 'mp4', 'mpd', 'mpeg', 'mpg', 'mxf', 'nut', 'ogm', 'ogv', 'swf', 'ts', 'vob', 'webm', 'wmv', 'wtv', 'torrent' ]
        }]
      })
      if (canceled || !filePaths.length) return {}
      const mediaPaths = []
      const torrents = []
      for (const path of filePaths) {
        if (path.toLowerCase().endsWith('.torrent')) {
          const buffer = await readFile(path)
          torrents.push(buffer)
        } else mediaPaths.push(path)
      }
      return { paths: mediaPaths, torrents }
    })
  }
}