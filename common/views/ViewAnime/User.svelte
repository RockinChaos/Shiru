<script>
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import Helper from '@/modules/helper.js'
  import { onMount, onDestroy } from 'svelte'
  import { writable } from 'simple-store-svelte'
  import { since, capitalize, fadeIn, fadeOut } from '@/modules/util.js'
  import { click, hover, focus } from '@/modules/click.js'
  import { copyToClipboard } from '@/modules/clipboard.js'
  import { IPC } from '@/modules/bridge.js'
  import WPC from '@/modules/wpc.js'

  export let user = {}
  export let style = ''
  const showUser = writable(false)
  const avatar = user.avatar?.large || user.avatar?.medium

  function initials(name) {
    const parts = name.split(/\s+/).filter(Boolean)
    return ((parts[0] ? parts[0][0] : '') + (parts[1] ? parts[1][0] : '')).toUpperCase()
  }

  let hideTimeout
  function handleHover(state) {
    if (state) {
      if (hideTimeout) {
        clearTimeout(hideTimeout)
        hideTimeout = null
      }
      showUser.set(true)
      WPC.send('user-popover', user.id)
    } else {
      hideTimeout = setTimeout(() => {
        showUser.set(false)
        hideTimeout = null
      }, 100)
      hideTimeout.unref?.()
    }
  }

  function clearHover(userId) {
    if (userId !== user.id && $showUser) {
      showUser.set(false)
      clearTimeout(hideTimeout)
    }
  }

  onMount(() => WPC.listen('user-popover', clearHover))
  onDestroy(() => {
    clearTimeout(hideTimeout)
    WPC.clear('user-popover', clearHover)
  })
</script>
<div class='popover h-50 w-50 d-inline-block not-reactive rounded-circle {$$restProps.class}' style={style} use:hover={handleHover} use:focus={(state) => showUser.set(state)}>
  <button class='avatar h-50 w-50 align-items-center justify-content-center p-0 rounded-circle bg-dark-light overflow-hidden pointer not-reactive flex-shrink-0' tabindex='-1' style='border: .3rem solid hsla(var(--dark-color-hsl), 0.9);'>
    {#if avatar}
      <SmartImage class='w-full h-full cover-img' images={[avatar, './404_square.png']}/>
    {:else}
      <div class='align-items-center justify-content-center font-weight-bold text-white font-size-16'>{initials(user.name)}</div>
    {/if}
    {#if user.isBlocked}
      <div class='position-absolute text-white font-size-8 font-weight-bold blocked-banner' style='top: 40%; left: -34%;'>BLOCKED</div>
    {/if}
  </button>
  {#if $showUser}
    <div class='popover-container position-absolute top-100 left-0 mw-0 z-5 border rounded-10 overflow-hidden test-remove-later fade-change' style:--theme-base-color={user.options?.profileColor ?? `var(--dark-color)`} in:fadeIn={{ duration: 180 }} out:fadeOut={{ duration: 120 }}>
      <div class='popover-card'>
        <div class='position-relative h-140 p-5 d-flex align-items-end'>
          {#if user.bannerImage}
            <SmartImage class='position-absolute h-full w-full cover-img opacity-55 inset-0' images={[user.bannerImage, './404_banner.png']}/>
          {/if}
          <div class='top-inner d-flex align-items-end w-full z-2'>
            <div role='button' class='rounded-circle' class:pointer={user.siteUrl} data-toggle='{user.siteUrl ? `tooltip` : ``}' data-placement='top-left' data-title='Share to Clipboard' tabindex='-1' use:click={() => copyToClipboard(user.siteUrl, 'user URL')} on:contextmenu|preventDefault={() => { if (user.siteUrl) IPC.emit('open', user.siteUrl) }}>
              <div class='h-80 w-80 rounded-circle overflow-hidden flex-shrink-0' style='border: .4rem solid hsla(var(--gray-color-hsl), 0.15); clip-path: circle(50% at 50% 50%)'>
                {#if avatar}
                  <SmartImage class='w-full h-full cover-img' images={[avatar, './404_square.png']}/>
                {:else}
                  <div class='w-full h-full d-flex align-items-center justify-content-center font-weight-bold text-white bg-dark-light font-size-22'>{initials(user.name)}</div>
                {/if}
                {#if user.isBlocked}
                  <div class='position-absolute text-white font-size-12 font-weight-bold blocked-banner' style='top: 58%; left: 2%'>BLOCKED</div>
                {/if}
              </div>
            </div>
            <div class='d-flex flex-column justify-content-center flex-shrink-1 mw-0'>
              <div class='font-weight-very-bold font-size-26 line-height-1 text-white text-break-word text-truncate'>{user.name}</div>
              {#if user.isFollower}
                <div class='font-size-16 text-muted text-break-word text-truncate'>Following You</div>
              {/if}
              <div class='font-size-14 text-muted text-break-word text-truncate'>Joined {capitalize(since(new Date((user.createdAt ?? 0) * 1000)))}</div>
              <div class='d-flex flex-column justify-content-center'>
                <div class='d-flex flex-wrap gap-5 align-items-center'>
                  <div class='badge text-white px-8 py-2 text-break-word text-truncate'>
                    {user.status ? Helper.statusName[user.status] : 'Not on List'}
                  </div>
                  {#if user.status !== 'COMPLETED' && user.status !== 'PLANNING' && user.progress > 0}
                    <div class='badge text-white px-8 py-2 text-break-word text-truncate'>
                      Progress: {user.progress}
                    </div>
                  {/if}
                  {#if user.status !== 'CURRENT' && user.score > 0}
                    <div class='badge text-white px-8 py-2 text-break-word text-truncate'>
                      Score: {user.score}
                    </div>
                  {/if}
                </div>
                {#if user.moderatorRoles}
                  <div class='d-flex flex-wrap gap-5 align-items-center mt-2'>
                    {#each user.moderatorRoles as moderatorRole}
                      <div class='badge text-white font-weight-bold px-8 py-2 text-break-word text-truncate' style='border-color: var(--theme-base-color); background-color: var(--theme-base-color)'>
                        {capitalize(moderatorRole.replace('_', ' ').toLowerCase())}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
            {#if user.donatorBadge && user.donatorBadge !== 'Donator'}
              <div class='bubble position-absolute rounded-2 py-10 px-20 text-white font-weight-semi-bold font-size-16 text-break-word text-truncate'>
                {capitalize(user.donatorBadge)}
              </div>
            {/if}
          </div>
        </div>
<!--        < html={user.about ?? ''} class='text-white text-wrap pl-20 pr-10 pt-20 font-size-16 overflow-y-auto hm-250' />-->
        <div class='stats d-flex flex-wrap font-scale-14 text-white w-full justify-content-between'>
          <div class='text-nowrap'>{user.statistics?.anime?.count ?? 0} Anime</div>
          <div class='text-nowrap'>{user.statistics?.anime?.episodesWatched ?? 0} Episodes</div>
          <div class='text-nowrap'>{user.statistics?.anime?.meanScore ?? 0} Mean Score</div>
          <div class='text-nowrap'>{capitalize(since(new Date(Date.now() - (user.statistics?.anime?.minutesWatched ?? 1) * 60 * 1000)).replace('ago', 'watched'))}</div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .avatar {
    transition: transform 0.2s ease;
  }
  .avatar:hover {
    transform: translateY(-0.3rem);
  }
  .popover-container {
    width: 100%;
    max-width: 50rem;
  }
  .popover:focus-visible {
    box-shadow: 0 0 0 .4rem var(--tertiary-color) !important;
  }
  .popover-card {
    box-shadow: 0 .8rem 3rem hsla(var(--dark-color-light-hsl), 0.7);
    background: linear-gradient(var(--theme-base-color, var(--dark-color)), var(--dark-color-very-light));
  }
  .top-inner {
    gap: 1rem;
    padding: .7rem;
  }
  .stats {
    gap: 1.2rem;
    padding: 1.2rem 1.8rem;
    border-top: var(--base-border-width) solid hsla(var(--white-color-hsl), 0.04);
  }
  .blocked-banner {
    transform: rotate(-45deg);
    background: var(--accent-color);
    opacity: .75;
    padding: 0.2rem 2rem;
  }
  .bubble {
    top: 4rem;
    right: 1.6rem;
    animation: bubble-animation 10s linear infinite;
  }
  @keyframes bubble-animation {
    0%   { background-color: rgba(0, 105, 255, .9); }
    10%  { background-color: rgba(100, 0, 255, .9); }
    20%  { background-color: rgba(255, 0, 139, .9); }
    30%  { background-color: rgba(255, 0, 0, .9); }
    40%  { background-color: rgba(255, 96, 0, .9); }
    50%  { background-color: rgba(202, 255, 0, .9); }
    60%  { background-color: rgba(0, 255, 139, .9); }
    70%  { background-color: rgba(202, 255, 0, .9); }
    80%  { background-color: rgba(255, 96, 0, .9); }
    85%  { background-color: rgba(255, 0, 0, .9); }
    90%  { background-color: rgba(255, 0, 139, .9); }
    95%  { background-color: rgba(100, 0, 255, .9); }
    100% { background-color: rgba(0, 105, 255, .9); }
  }
</style>