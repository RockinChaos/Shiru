<script context='module'>
  import { copyToClipboard } from '@/modules/clipboard.js'
  import { EventEmitter } from 'events'
  import { writable } from 'simple-store-svelte'
  import { SUPPORTS } from '@/modules/support.js'
  import { page } from '@/App.svelte'
  import { IPC } from '@/modules/bridge.js'
  import WPC from '@/modules/wpc.js'
  import 'browser-event-target-emitter'
  import Debug from 'debug'
  const debug = Debug('ui:w2g')

  export const w2gEmitter = new EventEmitter()

  /** @type {import('simple-store-svelte').Writable<W2GClient | null>} */
  export const state = writable(null)

  function joinLobby (code) {
    debug('Joining lobby with code:', code)
    if (state.value) state.value.destroy()
    const w2g = new W2GClient(code)
    state.value = w2g
    w2g.on('index', i => w2gEmitter.emit('setindex', i))
    w2g.on('player', state => w2gEmitter.emit('playerupdate', { time: state.time, paused: state.paused }))

    if (!code) invite()
  }
  WPC.listen('magnet', (detail) => state.value?.magnetLink(detail))

  w2gEmitter.on('player', data => state.value?.playerStateChanged(data))
  w2gEmitter.on('index', index => state.value?.mediaIndexChanged(index))

  IPC.on('w2glink', (link) => {
    joinLobby(link)
    page.set('watchtogether')
  })

  function invite () {
    copyToClipboard(state.value.inviteLink, 'invite code')
  }
</script>

<script>
  import Lobby from '@/views/WatchTogether/Lobby.svelte'
  import { Plus, UserPlus } from 'lucide-svelte'
  import { W2GClient } from '@/views/WatchTogether/w2g.js'
  import { click } from '@/modules/click.js'

  let joinText

  const inviteRx = /([A-z0-9]{16})/i
  function checkInvite (invite) {
    if (!invite) return
    const match = invite?.match(inviteRx)?.[1]
    if (!match) return
    page.set('watchtogether')
    joinLobby(match)
    joinText = ''
  }

  $: checkInvite(joinText)
</script>

<div class='d-flex h-full align-items-center flex-column px-md-20 overflow-y-auto scroll-container'>
  {#if !$state}
    <div class='font-scale-50 font-weight-bold pt-20 mt-20 root'>Watch Together</div>
    <div class='d-flex flex-row flex-wrap justify-content-center align-items-center h-auto mb-20 pb-20 root position-relative w-full' class:h-full={!SUPPORTS.isAndroid}>
      <div class='card d-flex flex-column align-items-center w-300 h-300 justify-content-end'>
        <UserPlus size='6rem' class='d-flex align-items-center h-full' />
        <h2 class='font-weight-bold font-scale-34'>Join Lobby</h2>
        <input
          type='text'
          class='form-control h-80 text-center'
          autocomplete='off'
          bind:value={joinText}
          data-option='search'
          placeholder='Lobby Code or Link' />
      </div>
      <div class='card d-flex flex-column align-items-center w-300 h-300 justify-content-end'>
        <Plus size='6rem' class='d-flex align-items-center h-full' />
        <button class='btn btn-primary btn-lg mt-10 btn-block d-flex align-items-center justify-content-center' type='button' use:click={() => joinLobby()}><span>Create Lobby</span></button>
      </div>
    </div>
  {:else}
    <Lobby {state} {invite} />
  {/if}
</div>