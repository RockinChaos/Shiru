const mode = process.env.NODE_ENV?.trim() || 'production'
const isDev = mode === 'development'

// TorBox (debrid) fork uses a distinct application identity so it installs
// alongside regular Shiru on the same device.
const torbox = process.env.SHIRU_BACKEND?.trim() === 'torbox'
const baseId = torbox ? 'watch.shiru.torbox' : 'watch.shiru'
const baseName = torbox ? 'Shiru TorBox' : 'Shiru'

const config = {
  appId: isDev ? `${baseId}.dev` : baseId,
  appName: isDev ? `${baseName} (Debug)` : baseName,
  webDir: 'build',
  android: {
    buildOptions: {
      keystorePath: './watch.shiru',
      keystorePassword: '',
      keystoreAlias: 'watch.shiru'
    },
    webContentsDebuggingEnabled: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 10_000
    },
    CapacitorHttp: {
      enabled: true
    },
    CapacitorNodeJS: {
      nodeDir: 'nodejs'
    },
    LocalNotifications: {
      sound: 'ic_notification.wav'
    },
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
      hidden: false
    }
  },
  server: {
    cleartext: true
  }
}

if (isDev) config.server.url = 'http://localhost:5001/index.html'

module.exports = config