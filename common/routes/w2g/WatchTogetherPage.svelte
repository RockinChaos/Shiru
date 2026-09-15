<script context='module'>
  import { copyToClipboard } from '@/modules/lib/clipboard.js'
  import { writable } from 'simple-store-svelte'
  import { status } from '@/modules/networking.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { page } from '@/modules/navigation.js'
  import { COMMON, TORRENT } from '@/modules/bridge.js'
  import { loadedTorrent } from '@/modules/torrent.js'
  import { settings } from '@/modules/settings.js'
  import { toast } from '@/modules/lib/toast.js'
  import Debug from 'debug'
  const debug = Debug('ui:w2g')

  export const w2gEmitter = new EventTarget()

  /** @type {import('simple-store-svelte').Writable<W2GClient | null>} */
  export const state = writable(null)

  function joinLobby (code) {
    debug('Joining lobby with code:', code)
    if (state.value) state.value.destroy()
    const w2g = new W2GClient(code)
    state.value = w2g

    // Temporary reject handle, better to have a modal show than a toast.
    // TODO: Make this a soft modal.
    w2g.addEventListener('reject', ({ detail }) => {
      state.value = null
      const msg = detail.isNewer ? 'Lobby is outdated' : 'Your app is outdated'
      debug(`reject: ${msg} peerVersion=${detail.peerVersion} hostVersion=${detail.hostVersion}`)
      toast.error(msg, {
        description: detail.isNewer
          ? `This watch together session requires an older app version. Ask the host to update their app!`
          : `You are running an older app version than the joined watch together session. Please update your app!`,
        duration: 30_000
      })
    })

    // If we are the host and a torrent is already loaded, set it immediately
    if (!code && loadedTorrent.value?.magnetURI) w2g.magnetLink({ magnet: loadedTorrent.value.magnetURI, hash: loadedTorrent.value.infoHash })

    w2g.addEventListener('index', ({ detail }) => w2gEmitter.dispatchEvent(new CustomEvent('setindex', { detail })))
    w2g.addEventListener('player', ({ detail }) => w2gEmitter.dispatchEvent(new CustomEvent('playerupdate', { detail: { time: detail.time, paused: detail.paused } })))

    if (!code) invite()
  }

  // Only allow host to change magnet.
  // TODO: Make this an optional setting.
  TORRENT.onMagnet(magnet => {
    if (state.value?.isHost) state.value.magnetLink(magnet)
  })

  w2gEmitter.addEventListener('player', ({ detail }) => state.value?.playerStateChanged(detail))
  w2gEmitter.addEventListener('index', ({ detail }) => state.value?.mediaIndexChanged(detail))

  COMMON.onLobbyInvite((link) => {
    if (settings.value.w2g || COMMON.getPlatformInfo().development) {
      joinLobby(link)
      page.navigateTo(page.WATCH_TOGETHER)
    }
  })

  function invite () {
    copyToClipboard(state.value.inviteLink, 'invite code')
  }
</script>

<script>
  import Lobby from '@/routes/w2g/components/Lobby.svelte'
  import { Plus, UserPlus } from 'lucide-svelte'
  import { W2GClient } from '@/routes/w2g/components/w2g.js'
  import { click } from '@/modules/lib/click.js'
  import { TriangleAlert } from 'lucide-svelte'

  let joinText

  const inviteRx = /([A-z0-9]{16})/i
  function checkInvite (invite) {
    if (!invite) return
    const match = invite?.match(inviteRx)?.[1]
    if (!match) return
    page.navigateTo(page.WATCH_TOGETHER)
    joinLobby(match)
    joinText = ''
  }

  $: checkInvite(joinText)
</script>

<div class='d-flex h-full align-items-center flex-column px-md-20 overflow-y-auto' class:pt-safe-area={$status === 'online'}>
  {#if !$state}
    <div class='alert bg-warning border-warning-dim text-warning-very-dim p-10 pl-15 mb-5 d-flex mt-10'>
      <TriangleAlert size='1.8rem' />
      <span class='ml-10'>Watch Together is currently in an <u>experimental</u> state and may behave unexpectedly.</span>
    </div>
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