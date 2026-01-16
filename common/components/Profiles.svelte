<script context='module'>
  import { createListener, generateRandomString } from '@/modules/util.js'
  import { writable } from 'simple-store-svelte'
  import { swapProfiles, alToken, malToken, profiles, sync } from '@/modules/settings.js'
  import { clientID } from '@/modules/myanimelist.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { click } from '@/modules/click.js'
  import { toast } from 'svelte-sonner'
  import SoftModal from '@/components/SoftModal.svelte'
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import { ClockAlert, LogOut, Plus, X } from 'lucide-svelte'
  import { IPC } from '@/modules/bridge.js'

  const { reactive, init } = createListener(['pa-button', 'p-button', 'custom-switch', 'profile-safe-area'])
  init(true)

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
    IPC.emit(SUPPORTS.isAndroid ? 'open' : 'open-auth', `https://anilist.co/api/v2/oauth/authorize?client_id=${atob('MjE3ODg=')}&response_type=token`) // Change redirect_url to shiru://alauth
  }

  function confirmMAL () {
    const state = generateRandomString(10)
    const challenge = generateRandomString(50)
    sessionStorage.setItem(state, challenge)
    IPC.emit(SUPPORTS.isAndroid ? 'open' : 'open-auth', `https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${clientID}&state=${state}&code_challenge=${challenge}&code_challenge_method=plain`) // Change redirect_url to shiru://malauth
  }

  IPC.on('auth-canceled', () => {
    toast.error('Login Canceled', {
      description: 'The authorization window to log into your account was closed. If this was a mistake, please try logging in again.',
      duration: 10000
    })
  })
</script>
<script>
  export let overlay

  function close () {
    $profileView = false
    $profileAdd = false
    setTimeout(() => { if (overlay.includes('profiles')) overlay = overlay.filter(item => item !== 'profiles') })
  }

  $: if ($profileView && !overlay.includes('profiles')) overlay = [...overlay, 'profiles']
  $: !$profileView && close()
  window.addEventListener('overlay-check', () => { if ($profileView) close() })
</script>

<SoftModal class='w-auto mw-350 d-flex justify-content-center flex-column scrollbar-none bg-very-dark p-30 mx-20 mb-30 mt-20 rounded' bind:showModal={$profileView} {close} id='profileModal'>
  {#if $profileView}
    <div class='d-flex justify-content-end align-items-start w-auto'>
      <button type='button' class='btn btn-square d-flex align-items-center justify-content-center' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
    </div>
    <div class='d-flex flex-column align-items-center'>
      {#if $currentProfile}
        <SmartImage class='h-150 rounded-circle' images={[$currentProfile.viewer.data.Viewer['avatar']?.large, $currentProfile.viewer.data.Viewer['avatar']?.medium, $currentProfile.viewer.data.Viewer['picture'], './404_square.png']} title='Current Profile'/>
        <img class='h-3 auth-icon rounded-circle' src={isAniProfile($currentProfile) ? './anilist_icon.png' : './myanimelist_icon.png'} alt={isAniProfile($currentProfile) ? 'Logged in with AniList' : 'Logged in with MyAnimeList'} title={isAniProfile($currentProfile) ? 'Logged in with AniList' : 'Logged in with MyAnimeList'}>
        <p class='font-size-18 font-weight-bold'>{$currentProfile.viewer.data.Viewer.name}</p>
      {/if}
    </div>
    {#if $profiles.length > 0}
      <div class='info box border-0 rounded-top-30 pt-10 pb-10 d-flex align-items-center justify-content-center text-center font-weight-bold'>
        Other Profiles
      </div>
    {/if}
    <div class='d-flex flex-column align-items-start'>
      {#each $profiles as profile}
        <button type='button' class='profile-item {profile.reauth ? `authenticate` : ``} box text-left pointer border-0 d-flex align-items-center justify-content-between position-relative flex-wrap z-1' data-toggle='tooltip' data-placement='top' data-title='Switch to Profile: {profile.viewer.data.Viewer.name}' class:not-reactive={!$reactive} use:click={() => switchProfile(profile)}>
          <div class='d-flex align-items-center flex-wrap'>
            <SmartImage class='h-50 w-50 ml-10 mt-5 mb-5 mr-10 rounded-circle bg-transparent' images={[profile.viewer.data.Viewer.avatar?.large, profile.viewer.data.Viewer.avatar?.medium, profile.viewer.data.Viewer.picture, './404_square.png']}/>
            <img class='ml-5 auth-icon rounded-circle' src={isAniProfile(profile) ? './anilist_icon.png' : './myanimelist_icon.png'} alt={isAniProfile(profile) ? 'Logged in with AniList' : 'Logged in with MyAnimeList'} title={isAniProfile(profile) ? 'Logged in with AniList' : 'Logged in with MyAnimeList'}>
            <p class='text-wrap'>{profile.viewer.data.Viewer.name}</p>
          </div>
          <div class='controls d-flex align-items-center flex-wrap ml-10'>
            <button type='button' tabindex='-1' class='position-absolute profile-safe-area top-0 right-0 h-full w-100 bg-transparent border-0 shadow-none not-reactive' use:click={() => {}}/>
            {#if !profile.reauth}
              <button type='button' class='custom-switch bg-transparent border-0 z-1' data-toggle='tooltip' data-placement='left' data-title='Sync List Entries' use:click|stopPropagation>
                <input type='checkbox' id='sync-{profile.viewer.data.Viewer.id}' checked={$sync.includes(profile.viewer.data.Viewer.id)} use:click={() => toggleSync(profile)} />
                <label for='sync-{profile.viewer.data.Viewer.id}'><br/></label>
              </button>
            {:else}
              <button type='button' class='button {profile.reauth ? `pa-button` : `p-button`} pt-5 pb-5 pl-5 pr-5 mr-15 bg-transparent border-0 d-flex align-items-center justify-content-center z-1' data-toggle='tooltip' data-placement='left' data-title='Authenticate' use:click|stopPropagation={confirmMAL}>
                <ClockAlert size='2.2rem' />
              </button>
            {/if}
            <button type='button' class='button {profile.reauth ? `pa-button` : `p-button`} pt-5 pb-5 pl-5 pr-5 bg-transparent border-0 rounded d-flex align-items-center justify-content-center z-1' data-toggle='tooltip' data-placement='left' data-title='Logout' use:click|stopPropagation={() => dropProfile(profile)}>
              <LogOut size='2.2rem' />
            </button>
          </div>
        </button>
      {/each}
      {#if ($profileAdd || (!$currentProfile && $profiles.length <= 0)) && $profiles.length < 5}
        <div class='box border-0 info d-flex flex-column {$currentProfile || $profiles.length > 0 ? `align-items-center` : `bg-transparent pointer`}' class:rounded-top-30={$profiles.length <= 0}>
          {#if !$currentProfile && $profiles.length <= 0}
            <h5 class='modal-title'>Log In</h5>
          {/if}
          <div class='mb-10 d-flex justify-content-center flex-row' class:mt-10={$currentProfile || $profiles.length > 0}>
            <button class='btn anilist w-150 d-flex align-items-center justify-content-center' type='button' use:click={confirmAnilist}>
              <img class='al-logo rounded pointer-events-none z-10' src='./anilist_logo.png' alt='logo' />
            </button>
          </div>
          <div class='mb-10 d-flex justify-content-center flex-row'>
            <button class='btn myanimelist w-150 d-flex align-items-center justify-content-center' type='button' use:click={confirmMAL}>
              <img class='mal-logo rounded pointer-events-none' src='./myanimelist_logo.png' alt='logo' />
            </button>
          </div>
        </div>
      {:else if $profiles.length < 5}
        <button type='button' class='box pointer border-0 pt-10 pb-10 d-flex align-items-center justify-content-center text-center {$profiles.length > 0 && $currentProfile ? `` : !$currentProfile ? `rounded-bottom-30` : `rounded-top-30`}' use:click={() => { $profileAdd = true }}>
          <Plus class='mr-10' size='2.2rem' />
          <div class='mt-4'>
            Add Profile
          </div>
        </button>
      {/if}
      {#if $currentProfile}
        {#if $currentProfile.reauth}
          <button type='button' class='box authenticate pointer border-0 pt-10 pb-10 d-flex align-items-center justify-content-center text-center' use:click={confirmMAL}>
            <ClockAlert class='mr-10' size='2.2rem' />
            <div class='mt-4'>
              Authenticate
            </div>
          </button>
        {/if}
        <button type='button' class='box pointer border-0 rounded-bottom-30 pt-10 pb-10 d-flex align-items-center justify-content-center text-center' use:click={currentLogout}>
          <LogOut class='mr-10' size='2.2rem' />
          <div class='mt-4'>
            Sign Out
          </div>
        </button>
      {/if}
    </div>
  {/if}
</SoftModal>

<style>
  @media (hover: hover) and (pointer: fine) {
    .p-button:hover {
      background: var(--dark-color-light) !important;
    }
    .pa-button:hover {
      background: var(--error-color-very-light) !important;
    }
    .authenticate:hover {
      background: var(--error-color-light) !important;
    }
  }
  .authenticate {
    background: var(--error-color) !important;
  }
  .rounded-top-30 {
    border-radius: 3rem 3rem 0 0;
  }
  .rounded-bottom-30 {
    border-radius: 0 0 3rem 3rem;
  }
  .auth-icon {
    position: absolute;
    height: 2rem;
    margin-right: 15rem;
    margin-bottom: 3rem;
  }
  @media (hover: hover) and (pointer: fine) {
    .box:hover:not(.info) {
      background: var(--dark-color-very-light);
    }
  }
  .box {
    background: var(--dark-color-light);
    width: 100%;
    margin-bottom: .3rem;
  }

  .mal-logo {
    height: 2rem;
    margin-top: 0.2rem;
  }
  .al-logo {
    height: 1.6rem;
  }
  .anilist {
    background-color: var(--anilist-color) !important;
  }
  .myanimelist {
    background-color: var(--myanimelist-color) !important;
  }
  @media (hover: hover) and (pointer: fine) {
    .anilist:hover {
      background-color: var(--anilist-color-light) !important;
    }
    .myanimelist:hover {
      background-color: var(--myanimelist-color-light) !important;
    }
  }
</style>
