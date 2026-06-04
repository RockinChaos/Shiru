import { app } from 'electron'
import App from './app.js'
import { isTorBox } from '@/modules/backend.js'

// The TorBox fork runs as a distinct application so it can be installed and run
// side-by-side with regular Shiru. Renaming the app gives it a separate userData
// directory (isolated settings/cache/torrent state) and its own single-instance
// lock, so both builds can run at the same time without clobbering each other.
if (isTorBox) app.setName('Shiru TorBox')

let main // Keep a global reference of the window object, if you don't, the window will, be closed automatically when the JavaScript object is garbage collected.

function createWindow () {
  main = new App()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('ready', createWindow)

  app.on('activate', () => {
    if (main == null) createWindow()
    else main.showAndFocus()
  })
}
