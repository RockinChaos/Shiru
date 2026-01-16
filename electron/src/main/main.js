import { app } from 'electron'
import App from './app.js'

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
