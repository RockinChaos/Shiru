const { join, resolve } = require('path')
const { spawn } = require('node:child_process')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const commonConfig = require('common/webpack.config.cjs')

const nodeEnv = process.env.NODE_ENV?.trim()
const mode = nodeEnv === 'production' || nodeEnv === 'none' ? nodeEnv : 'development'

/** @type {import('webpack').Configuration[]} */
module.exports = [
  {
    name: 'background',
    devtool: 'source-map',
    entry: join(__dirname, 'src', 'background', 'background.js'),
    output: {
      path: join(__dirname, 'build'),
      filename: 'background.js'
    },
    mode,
    externals: {
      'utp-native': 'require("utp-native")',
      'fs-native-extensions': 'commonjs2 fs-native-extensions',
      'require-addon': 'commonjs2 require-addon'
    },
    resolve: {
      aliasFields: [],
      mainFields: ['module', 'main', 'node'],
      alias: {
        '@': resolve(__dirname, '..', 'common'),
        '@client': resolve(__dirname, '..', 'client'),
        'webtorrent-client': resolve(__dirname, '..', 'client/core/webtorrent.js'),
        'node-fetch': false,
        ws: false,
        wrtc: false,
        debug: resolve(__dirname, '../common/modules/lib/debug.js'),
        'webrtc-polyfill': resolve('../node_modules/webrtc-polyfill/browser.js'),
        'http-tracker': resolve('../node_modules/bittorrent-tracker/lib/client/http-tracker.js')
      }
    },
    plugins: [new HtmlWebpackPlugin({ filename: 'background.html' })],
    target: 'electron45.0-renderer',
    devServer: {
      onListening(server) {
        if (process.env.DEV_ENV !== 'electron') return
        let electron
        const startElectron = stats => {
          if (electron || stats.hasErrors()) return
          electron = spawn(
            require('electron'),
            [join(__dirname, 'build/main.js')],
            { cwd: __dirname, stdio: 'inherit' }
          )
          electron.once('error', error => {
            console.error(error)
            process.exit(1)
          })
          electron.once('exit', code => process.exit(code ?? 0))
        }
        process.once('exit', () => electron?.kill())
        server.compiler.hooks.done.tap('StartElectron', startElectron)
        server.middleware.waitUntilValid(startElectron)
      },
      devMiddleware: {
        writeToDisk: true
      },
      hot: true,
      compress: true,
      liveReload: false,
      client: {
        overlay: {
          errors: true,
          warnings: false,
          runtimeErrors: false
        }
      },
      host: 'localhost',
      port: 5000
    }
  },
  commonConfig(__dirname, {
    'jassub/dist/jassub-worker.wasm.js$': false
  }, 'browser', 'app'),
  {
    name: 'preload',
    devtool: 'source-map',
    entry: join(__dirname, 'src', 'preload', 'preload.js'),
    output: {
      path: join(__dirname, 'build'),
      filename: 'preload.js'
    },
    resolve: {
      aliasFields: [],
      alias: {
        '@client': resolve(__dirname, '..', 'client')
      }
    },
    mode,
    target: 'electron45.0-preload'
  },
  {
    name: 'main',
    devtool: 'source-map',
    entry: join(__dirname, 'src', 'main', 'main.js'),
    output: {
      path: join(__dirname, 'build'),
      filename: 'main.js'
    },
    externals: {
      '@paymoapp/electron-shutdown-handler': 'require("@paymoapp/electron-shutdown-handler")'
    },
    resolve: {
      aliasFields: [],
      alias: {
        '@': resolve(__dirname, '..', 'common')
      }
    },
    mode,
    target: 'electron45.0-main'
  }
]