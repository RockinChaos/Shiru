<script context='module'>
  import { generateRandomString } from "@/modules/util.js"
  import { writable } from 'simple-store-svelte'
  import { swapProfiles, alToken, malToken, profiles, sync } from '@/modules/settings.js'
  import { platformMap } from '@/views/Settings/Settings.svelte'
  import { clientID } from "@/modules/myanimelist.js"
  import { click } from '@/modules/click.js'
  import { toast } from 'svelte-sonner'
  import { ClockAlert, LogOut, Plus, X } from 'lucide-svelte'
  import IPC from "@/modules/ipc.js"

  export const profileView = writable(false)
  const profileAdd = writable(false)
  const currentProfile = writable(alToken || malToken)

  profiles.subscribe(() => {
      currentProfile.set(alToken || malToken)
  })

  function isAniProfile (profile) {
    return profile.viewer?.data?.Viewer?.avatar
  }

  function currentLogout () {
    swapProfiles(null)
  }

  function dropProfile (profile) {
    profiles.update(profiles => {
      return profiles.filter(p => p.viewer.data.Viewer.id !== profile.viewer?.data?.Viewer.id)
    })
  }

  function switchProfile (profile) {
    swapProfiles(profile)
  }

  function toggleSync(profile) {
    const profileID = profile.viewer.data.Viewer.id
    if (sync.value.includes(profileID)) sync.value = sync.value.filter(id => id !== profileID)
    else sync.value = sync.value.concat(profileID)
  }

  function confirmAnilist () {
    IPC.emit('open', 'https://anilist.co/api/v2/oauth/authorize?client_id=21788&response_type=token') // Change redirect_url to shiru://alauth
    supportNotify()
  }

  function confirmMAL () {
    const state = generateRandomString(10)
    const challenge = generateRandomString(50)
    sessionStorage.setItem(state, challenge)
    IPC.emit('open', `https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${clientID}&state=${state}&code_challenge=${challenge}&code_challenge_method=plain`) // Change redirect_url to shiru://malauth
    supportNotify()
  }

  function supportNotify() {
    if (platformMap[window.version.platform] === 'Linux') {
      toast('Support Notification', {
        description: "If your linux distribution doesn't support custom protocol handlers, you can simply paste the full URL into the app.",
        duration: 300000
      })
    }
  }
</script>
<script>
  export let overlay

  let modal
  function close () {
    $profileView = false
    $profileAdd = false
    if (overlay.includes('profiles')) overlay = overlay.filter(item => item !== 'profiles')
  }
  function checkClose ({ keyCode }) {
    if (keyCode === 27) close()
  }
  $: $profileView && (modal?.focus(), setOverlay())
  $: !$profileView && close()
  function setOverlay() {
    if (!overlay.includes('profiles')) overlay = [...overlay, 'profiles']
  }
  window.addEventListener('overlay-check', () => { if ($profileView) close() })
</script>

<div class='modal z-55' class:show={$profileView}>
  {#if $profileView}
    <div class='modal-dialog' on:pointerup|self={close} on:keydown={checkClose} tabindex='-1' role='button' bind:this={modal}>
      <div class='modal-content w-auto mw-400 d-flex justify-content-center flex-column'>
        <div class="d-flex justify-content-end align-items-start w-auto">
          <button type='button' class='btn btn-square d-flex align-items-center justify-content-center' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
        </div>
        <div class='d-flex flex-column align-items-center'>
          {#if $currentProfile}
            <img class='h-150 rounded-circle' src={$currentProfile.viewer.data.Viewer["avatar"]?.large || $currentProfile.viewer.data.Viewer["avatar"]?.medium || $currentProfile.viewer.data.Viewer["picture"]} alt='Current Profile' title='Current Profile'>
            <img class='h-3 auth-icon rounded-circle' src={isAniProfile($currentProfile) ? './anilist_icon.png' : './myanimelist_icon.png'} alt={isAniProfile($currentProfile) ? 'Logged in with AniList' : 'Logged in with MyAnimeList'} title={isAniProfile($currentProfile) ? 'Logged in with AniList' : 'Logged in with MyAnimeList'}>
            <p class='font-size-18 font-weight-bold'>{$currentProfile.viewer.data.Viewer.name}</p>
          {/if}
        </div>
        {#if $profiles.length > 0}
          <div class='info box pointer border-0 rounded-top-10 pt-10 pb-10 d-flex align-items-center justify-content-center text-center font-weight-bold'>
            Other Profiles
          </div>
        {/if}
        <div class='d-flex flex-column align-items-start'>
          {#each $profiles as profile}
            <button type='button' class='profile-item {profile.reauth ? `authenticate` : ``} box text-left pointer border-0 d-flex align-items-center justify-content-between position-relative flex-wrap' on:click={() => switchProfile(profile)}>
              <div class='d-flex align-items-center flex-wrap'>
                <img class='h-50 ml-10 mt-5 mb-5 mr-10 rounded-circle bg-transparent' src={profile.viewer.data.Viewer.avatar?.large || profile.viewer.data.Viewer.avatar?.medium || profile.viewer.data.Viewer.picture} alt={profile.viewer.data.Viewer.name}>
                <img class='ml-5 auth-icon rounded-circle' src={isAniProfile(profile) ? './anilist_icon.png' : './myanimelist_icon.png'} alt={isAniProfile(profile) ? 'Logged in with AniList' : 'Logged in with MyAnimeList'} title={isAniProfile(profile) ? 'Logged in with AniList' : 'Logged in with MyAnimeList'}>
                <p class='text-wrap'>{profile.viewer.data.Viewer.name}</p>
              </div>
              <div class='controls d-flex align-items-center flex-wrap ml-10'>
                {#if !profile.reauth}
                  <button type='button' class='custom-switch bg-transparent border-0' title='Sync List Entries' on:click|stopPropagation>
                    <input type='checkbox' id='sync-{profile.viewer.data.Viewer.id}' checked={$sync.includes(profile.viewer.data.Viewer.id)} on:click={() => toggleSync(profile)} />
                    <label for='sync-{profile.viewer.data.Viewer.id}'><br/></label>
                  </button>
                {:else}
                  <button type='button' class='button {profile.reauth ? `pa-button` : `p-button`} pt-5 pb-5 pl-5 pr-5 mr-15 bg-transparent border-0 d-flex align-items-center justify-content-center' title='Authenticate' on:click|stopPropagation={confirmMAL}>
                    <ClockAlert size='2.2rem' />
                  </button>
                {/if}
                <button type='button' class='button {profile.reauth ? `pa-button` : `p-button`} pt-5 pb-5 pl-5 pr-5 bg-transparent border-0 rounded d-flex align-items-center justify-content-center' title='Logout' on:click|stopPropagation={() => dropProfile(profile)}>
                  <LogOut size='2.2rem' />
                </button>
              </div>
            </button>
          {/each}
          {#if ($profileAdd || (!$currentProfile && $profiles.length <= 0)) && $profiles.length < 5}
            <div class='modal-buttons box pointer border-0 info d-flex flex-column {$profiles.length > 0 ? "" : "rounded-top-10"} {$currentProfile || $profiles.length > 0 ? "align-items-center" : "bg-transparent"}'>
              {#if !$currentProfile && $profiles.length <= 0}
                <h5 class='modal-title'>Log In</h5>
              {/if}
              <div class='modal-button mb-10 d-flex justify-content-center flex-row {$currentProfile || $profiles.length > 0 ? "mt-10" : ""}'>
                <img class='al-logo position-absolute rounded pointer-events-none' src='./anilist_logo.png' alt='logo' />
                <button class='btn anilist w-150' type='button' on:click={confirmAnilist}></button>
              </div>
              <div class='modal-button mb-10 d-flex justify-content-center flex-row'>
                <img class='mal-logo position-absolute rounded pointer-events-none' src='./myanimelist_logo.png' alt='logo' />
                <button class='btn myanimelist w-150' type='button' on:click={confirmMAL}></button>
              </div>
            </div>
          {:else if $profiles.length < 5}
            <button type='button' class='box pointer border-0 pt-10 pb-10 d-flex align-items-center justify-content-center text-center {$profiles.length > 0 && $currentProfile ? "" : !$currentProfile ? "rounded-bottom-10" : "rounded-top-10"}' on:click={() => { $profileAdd = true }}>
              <Plus class='mr-10' size='2.2rem' />
              <div class='mt-4'>
                Add Profile
              </div>
            </button>
          {/if}
          {#if $currentProfile}
            {#if $currentProfile.reauth}
              <button type='button' class='box authenticate pointer border-0 pt-10 pb-10 d-flex align-items-center justify-content-center text-center' on:click={confirmMAL}>
                <ClockAlert class='mr-10' size='2.2rem' />
                <div class='mt-4'>
                  Authenticate
                </div>
              </button>
            {/if}
            <button type='button' class='box pointer border-0 rounded-bottom-10 pt-10 pb-10 d-flex align-items-center justify-content-center text-center' on:click={currentLogout}>
              <LogOut class='mr-10' size='2.2rem' />
              <div class='mt-4'>
                Sign Out
              </div>
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .p-button:hover {
    background: #393838 !important;
  }
  .pa-button:hover {
    background: #6c363c !important;
  }
  .authenticate:hover {
    background: #4e272c !important;
  }
  .authenticate {
    background: #2e171a !important;
  }
  .h-3 {
    height: 3rem !important;
  }
  .mt-4 {
    margin-top: .4rem;
  }
  .z-55 {
    z-index: 55;
  }
  .mw-400 {
    min-width: 35rem;
  }
  .rounded-top-10 {
    border-radius: 3rem 3rem 0 0;
  }
  .rounded-bottom-10 {
    border-radius: 0 0 3rem 3rem;
  }
  .auth-icon {
    position: absolute;
    height: 2rem;
    margin-right: 15rem;
    margin-bottom: 3rem;
  }
  .box:hover:not(.info) {
    background: #272727;
  }
  .box {
    background: #0e0e0e;
    width: 100%;
    margin-bottom: .3rem;
  }

  .mal-logo {
    height: 2rem;
    margin-top: 0.8rem;
  }
  .al-logo {
    height: 1.6rem;
    margin-top: 0.82rem;
  }
  .anilist {
    background-color: #283342 !important;
  }
  .myanimelist {
    background-color: #2C51A2 !important;
  }
  .anilist:hover {
    background-color: #46536c !important;
  }
  .myanimelist:hover {
    background-color: #2861d6 !important;
  }
</style>
