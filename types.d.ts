import type { EventEmitter } from 'node:events'
import type { SvelteComponentTyped } from 'svelte'

declare module '*.svelte' {
  export default SvelteComponentTyped
}

/** Message channel supplied by the capacitor-nodejs runtime. */
export const channel: EventEmitter & {
  /** Sends an event and its arguments to the Capacitor layer. */
  send(eventName: string, ...args: any[]): void
}

/** HTTP tracker exposed by the bundler's http-tracker alias. */
export { default } from './node_modules/bittorrent-tracker/lib/client/http-tracker.js'
