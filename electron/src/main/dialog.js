import { ipcMain, dialog } from 'electron'
import { writeFile } from 'fs/promises'

export default class Dialog {
  constructor () {
    ipcMain.on('player', async ({ sender }) => {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Select video player executable',
        properties: ['openFile']
      })
      if (canceled) return
      if (filePaths.length) {
        const path = filePaths[0]
        sender.send('player', path)
      }
    })
    ipcMain.on('dialog', async ({ sender }) => {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Select torrent download location',
        properties: ['openDirectory']
      })
      if (canceled) return
      if (filePaths.length) {
        let path = filePaths[0]
        if (!(path.endsWith('\\') || path.endsWith('/'))) {
          if (path.indexOf('\\') !== -1) {
            path += '\\'
          } else if (path.indexOf('/') !== -1) {
            path += '/'
          }
        }
        sender.send('path', path)
      }
    })
    ipcMain.on('log-contents', async (sender, log) => {
      try {
        const { filePath, canceled } = await dialog.showSaveDialog({
          title: 'Select export location for the log file',
          defaultPath: `shiru-log-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
          filters: [{ name: 'Log File', extensions: ['log'] }]
        })
        if (canceled || !filePath) return
        await writeFile(filePath, log, { encoding: 'utf8', mode: 0o644 })
        sender.send('log-exported', { error: false })
      } catch (error) {
        console.error(error)
        sender.send('log-exported', { error: true })
      }
    })
  }
}