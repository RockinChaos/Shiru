/**
 * Build-time torrent backend flavor.
 *
 * `process.env.SHIRU_BACKEND` is replaced at build time by webpack's
 * DefinePlugin, so this resolves to a string literal in the bundle.
 *
 * - `'webtorrent'` (default): the standard peer-to-peer WebTorrent backend.
 * - `'torbox'`: the debrid fork that streams from TorBox instead.
 */
export const BACKEND = process.env.SHIRU_BACKEND || 'webtorrent'

/** Whether this build is the TorBox (debrid) fork. */
export const isTorBox = BACKEND === 'torbox'
