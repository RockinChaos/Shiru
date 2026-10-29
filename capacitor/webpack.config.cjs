const { join, resolve } = require('path')
const { spawn } = require('node:child_process')
const commonConfig = require('common/webpack.config.cjs')
const CopyWebpackPlugin = require('copy-webpack-plugin')

const nodeEnv = process.env.NODE_ENV?.trim()
const mode = nodeEnv === 'production' || nodeEnv === 'none' ? nodeEnv : 'development'
const alias = {
  '@/modules/support.js': join(__dirname, 'src', 'main', 'support.js'),
  '@': resolve(__dirname, '..', 'common'),
  '@client': resolve(__dirname, '..', 'client')
}
const common = commonConfig(__dirname, alias, 'browser', 'index')

/** @type {import('webpack').Configuration & { devServer?: import('webpack-dev-server').Configuration }} */
const capacitorConfig = {
  name: 'background',
  devtool: 'source-map',
  entry: [join(__dirname, 'src', 'background', 'background.js')],
  output: {
    path: join(__dirname, 'build', 'nodejs'),
    filename: 'index.js'
  },
  mode,
  externals: {
    bridge: 'require("bridge")',
    'utp-native': 'require("utp-native")',
    'fs-native-extensions': 'commonjs2 fs-native-extensions',
    'require-addon': 'commonjs2 require-addon'
  },
  resolve: {
    modules: [
      'node_modules',
      resolve(__dirname, '../node_modules'),
      resolve(__dirname, '../client/node_modules'),
      resolve(__dirname, '../capacitor/node_modules'),
      resolve(__dirname, 'node_modules')
    ],
    aliasFields: [],
    mainFields: ['module', 'main', 'node'],
    alias: {
      ...alias,
      wrtc: false,
      'node-datachannel': false,
      'webtorrent-client': resolve(__dirname, '..', 'client/core/webtorrent.js'),
      debug: resolve(__dirname, '..', 'common/modules/lib/debug.js'),
      'http-tracker': resolve(__dirname, '../client/node_modules/bittorrent-tracker/lib/client/http-tracker.js'),
      'webrtc-polyfill': false // no webrtc on mobile, need the resources
    }
  },
  target: 'node',
  devServer: {
    onListening(server) {
      const platform = process.env.DEV_APP
      if (platform !== 'android' && platform !== 'ios') return
      let capacitor
      const startCapacitor = stats => {
        if (capacitor || stats.hasErrors()) return
        const args = [require.resolve('@capacitor/cli/bin/capacitor'), 'run', platform]
        if (platform === 'android') args.push('--forwardPorts', '5001:5001')
        capacitor = spawn(process.execPath, args, { cwd: __dirname, stdio: 'inherit' })
        capacitor.once('error', error => {
          console.error(error)
          process.exit(1)
        })
        capacitor.once('exit', code => {
          if (code !== 0) process.exit(code ?? 1)
        })
      }
      process.once('exit', () => capacitor?.kill())
      server.compiler.hooks.done.tap('StartCapacitor', startCapacitor)
      server.middleware.waitUntilValid(startCapacitor)
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
    port: 5001
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: join(__dirname, 'public', 'nodejs'),
          globOptions: {
            ignore: [
              '**/Dockerfile',
              '**/setup-deps.sh',
              '**/pnpm-lock.yaml',
              '**/node_modules/.modules.yaml',
              '**/node_modules/.pnpm/**'
            ]
          }
        }
      ]
    })
  ]
}

module.exports = [
  capacitorConfig,
  {
    ...common,
    entry: [join(__dirname, 'src', 'main', 'main.js'), ...(Array.isArray(common.entry) ? common.entry : [common.entry].filter(Boolean))]
  }
]