const commonConfig = require('common/webpack.config.cjs')
const { merge } = require('webpack-merge')
const { join, resolve } = require('path')
const CopyWebpackPlugin = require('copy-webpack-plugin')

const mode = process.env.NODE_ENV?.trim() || 'development'

const alias = {
  '@/modules/support.js': join(__dirname, 'src', 'main', 'support.js'),
  '@': resolve(__dirname, '..', 'common')
}

/** @type {import('webpack').Configuration} */
const capacitorConfig = {
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
    aliasFields: [],
    mainFields: ['module', 'main', 'node'],
    alias: {
      ...alias,
      wrtc: false,
      'node-datachannel': false,
      '@client': resolve(__dirname, '..', 'client'),
      'webtorrent-client': resolve(__dirname, '..', 'client/core/webtorrent.js'),
      'http-tracker': resolve('../node_modules/bittorrent-tracker/lib/client/http-tracker.js'),
      'webrtc-polyfill': false // no webrtc on mobile, need the resources
    }
  },
  target: 'node',
  devServer: {
    devMiddleware: {
      writeToDisk: true
    },
    hot: true,
    client: {
      overlay: { errors: true, warnings: false, runtimeErrors: false }
    },
    port: 5001
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: join(__dirname, 'public', 'nodejs') }
      ]
    })
  ]
}

module.exports = [capacitorConfig, merge(commonConfig(__dirname, alias, 'browser', 'index'), { entry: [join(__dirname, 'src', 'main', 'main.js')] })]
