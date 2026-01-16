<script context='module'>
  import { derived, writable } from 'simple-store-svelte'
  import { click, hoverExit, blurExit } from '@/modules/click.js'
  import { getHash } from '@/modules/anime/animehash.js'
  import { createListener, matchPhrase, matchKeys, debounce, since, isValidNumber } from '@/modules/util.js'
  import { Search, MailCheck, MailOpen, Play, X } from 'lucide-svelte'
  import TorrentButton, { playActive } from '@/components/TorrentButton.svelte'
  import ErrorCard from '@/components/cards/ErrorCard.svelte'
  import SoftModal from '@/components/SoftModal.svelte'
  import Helper from '@/modules/helper.js'
  import { IPC } from '@/modules/bridge.js'
  import { cache, caches } from '@/modules/cache.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { settings } from '@/modules/settings.js'

  export const notifyView = writable(false)
  export const notifications = writable(cache.getEntry(caches.NOTIFICATIONS, 'notifications') || [])
  export const hasUnreadNotifications = derived(notifications, _notifications => _notifications?.filter?.(notification => notification.read !== true)?.length)

  const { reactive, init } = createListener(['torrent-button', 'read-button', 'continue-button', 'n-safe-area'])
  init(true)

  let debounceNotify = false
  const debounceBatch = debounce(() => {
    if (debounceNotify) {
      cache.setEntry(caches.NOTIFICATIONS, 'notifications', notifications.value)
      setTimeout(() => IPC.emit('notification-unread', hasUnreadNotifications.value), 50)
      debounceNotify = false
    }
  }, 1500)
  notifications.subscribe(() => {
    debounceNotify = true
    debounceBatch()
  })
</script>
<script>
  export let overlay
  function close () {
    $notifyView = false
    setTimeout(() => { if (overlay.includes('notifications')) overlay = overlay.filter(item => item !== 'notifications') })
    updateSort()
  }
  $: $notifyView && setOverlay()
  $: !$notifyView && close()
  $: if ($notifyView) markWatchedAsRead()
  $: {
    if (!$notifyView) updateSort()
    else currentNotifications = filterResults($notifications, searchText).slice(0, notificationCount)
  }
  function setOverlay() {
    if (!overlay.includes('notifications')) overlay = [...overlay, 'notifications']
  }

  window.addEventListener('overlay-check', () => { if ($notifyView) close() })
  window.addEventListener('notification-app', (event) => queueNotification(event.detail, settings.value.systemNotify && (event.detail.button?.length || event.detail.activation)))
  window.addEventListener('notification-read', (event) => markRead(event.detail))
  window.addEventListener('notification-reset', () => { notifications.set([]); incomingNotifications.length = 0 })

  const incomingNotifications = []
  const debounceNotification = debounce(processNotifications, 15_000)
  function queueNotification(detail, systemNotify = false) {
    incomingNotifications.push({ detail, systemNotify })
    debounceNotification()
  }

  function dedupeNotifications(notifications) {
    const map = new Map()
    for (const notification of notifications) {
      const key = `${notification.detail.id}-${notification.detail.episode}-${notification.detail.dub}`
      const existing = map.get(key)
      if (!existing || (notification.detail.click_action === 'TORRENT' && existing.detail.click_action !== 'TORRENT')) map.set(key, notification)
    }
    return Array.from(map.values())
  }

  const SYSTEM_KEYS = ['id', 'title', 'message', 'timestamp', 'icon', 'iconXL', 'heroImg', 'button', 'activation']
  function splitLocalAndSystem(notifications) {
    const localNotifications = []
    const systemNotifications = []
    for (const { detail, systemNotify } of notifications) {
      const { button, activation, ...localDetails } = detail
      localNotifications.push(localDetails)
      if (systemNotify) {
        const systemDetails = {}
        for (const key of SYSTEM_KEYS) {
          if (key in detail) systemDetails[key] = detail[key]
        }
        systemNotifications.push(systemDetails)
      }
    }
    return { localNotifications, systemNotifications: systemNotifications.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 20) }
  }

  function processNotifications() {
    if (!incomingNotifications.length) return
    const { localNotifications, systemNotifications } = splitLocalAndSystem(dedupeNotifications(incomingNotifications))
    for (const notification of localNotifications) addNotification(notification)
    systemNotifications.forEach((notification, i) => setTimeout(() => IPC.emit('notification', notification), 5 * (i + 1)))
    incomingNotifications.length = 0
  }

  function addNotification(notification) {
    notifications.update((n) => {
      const filterDelayed = n.filter((existing) => { // Remove existing notifications based on delayed status and conditions
        if (notification.delayed) return !(existing.id === notification.id && existing.episode === notification.episode && existing.dub === true && existing.click_action === 'PLAY') // If the new notification is delayed, remove all matching notifications
        else return !(existing.id === notification.id && existing.episode === notification.episode && existing.delayed === true) // If the new notification is not delayed, remove any existing delayed notifications
      })

      if ((filterDelayed.findIndex((existing) => existing.id === notification.id && ((existing.episode === notification.episode && ((existing.season || 0) === (notification.season || 0))) || (existing.format === 'MOVIE' && notification.format === 'MOVIE')) && (existing.dub === notification.dub) && (existing.click_action === 'TORRENT'))) !== -1) return filterDelayed // Don't add notifications for an episode if a torrent notification already exists (prevents duplicate notifications)
      const filtered = filterDelayed.filter((existing) => (existing.id !== notification.id || existing.episode !== notification.episode || existing.dub !== notification.dub || existing.click_action === 'TORRENT'))
      const cachedMedia = cache.getMedia(notification?.id)
      if (isValidNumber(notification.episode) && (cachedMedia?.mediaListEntry?.status === 'COMPLETED' || ((cachedMedia?.mediaListEntry?.progress || -1) >= (!isValidNumber(notification.season) ? notification.episode : cachedMedia?.episodes)))) notification.read = true
      return sort([notification, ...filtered])
    })
  }

  function sort(array) {
    return array.sort((a, b) => {
      const timestampDiff = b.timestamp - a.timestamp
      if (timestampDiff !== 0) return timestampDiff
      if (a.id === b.id && isValidNumber(a.episode) && isValidNumber(b.episode) && isValidNumber(a.season) && isValidNumber(b.season)) return b.episode - a.episode
      return 0
    }).sort((a, b) => {
      if (!a.read && b.read) return -1
      if (a.read && !b.read) return 1
      return 0
    })
  }

  function markAll(read) {
    notifications.update(items => items.map(notification => ({...notification, read: read })))
  }

  function markRead(media) {
    notifications.update((n) => {
      return n.map((existing) => {
        if (existing.id === media.id && ((media.episode >= existing.episode) || (isValidNumber(existing.season) && (media.episode >= media.episodes)))) existing.read = true
        return existing
      })
    })
  }

  async function markWatchedAsRead() {
    const updates = []
    for (const { notification, media } of await Promise.all($notifications.filter(notification => !notification.read).map(notification => cache.requestMedia(notification.id).then(media => ({ notification, media }))))) {
      const delayed = notification.delayed
      const announcement = notification.click_action === 'VIEW' && !delayed
      const notWatching = !announcement && !delayed && ((!media?.mediaListEntry?.progress) || (media?.mediaListEntry?.progress === 0 && (media?.mediaListEntry?.status !== 'CURRENT' || media?.mediaListEntry?.status !== 'REPEATING' && media?.mediaListEntry?.status !== 'COMPLETED')))
      const behind = Helper.isAuthorized() && !announcement && !delayed && isValidNumber(notification.episode) && (notification.episode - 1) >= 1 && (media?.mediaListEntry?.status !== 'COMPLETED' && ((media?.mediaListEntry?.progress || -1) < ((!isValidNumber(notification.season) ? notification.episode : media?.episodes) - 1)))
      const watched = !announcement && !delayed && !notWatching && !behind && isValidNumber(notification.episode) && (media?.mediaListEntry?.status === 'COMPLETED' || (media?.mediaListEntry?.progress >= (!isValidNumber(notification.season) ? notification.episode : media?.episodes)))
      if (watched) updates.push(notification.id + '-' + notification.episode)
    }
    if (updates.length > 0) {
      notifications.update((n) => {
        return n.map((existing) => {
          if (updates.includes(existing.id + '-' + existing.episode)) existing.read = true
          return existing
        })
      })
      updateSort()
    }
  }

  function onclick(notification, view) {
    close()
    if (view) {
      window.dispatchEvent(new CustomEvent('open-anime', { detail: { id: notification.id } }))
    } else playActive(notification.hash, { media: { id: notification.id }, episode: notification.episode }, notification.magnet, notification.click_action === 'PLAY')
  }

  function updateSort() {
    notifications.update(notifications => sort([...notifications]))
  }

  let container
  let searchText = ''
  function filterResults(results, searchText) {
    if (!searchText?.length) return results
    return results.filter(({ id, title }) => matchPhrase(searchText, title, 0.4, false, true) || matchKeys(cache.getMedia(id), searchText, ['title.userPreferred', 'title.english', 'title.romaji', 'title.native', 'synonyms'], 0.4)) || []
  }

  let notificationCountDefault = 25
  let notificationCount = notificationCountDefault
  let currentNotifications = []
  let scrollLocked = false
  function handleScroll(event) {
    if (scrollLocked) return
    const container = event.target
    if (currentNotifications.length !== $notifications.length && container.scrollTop + container.clientHeight + 10 >= container.scrollHeight) {
      const nextBatch = filterResults($notifications, searchText).slice(currentNotifications.length, currentNotifications.length + notificationCount)
      currentNotifications = [...new Set([...currentNotifications, ...nextBatch])]
    }
  }
  function preventScroll(position, cb) {
    scrollLocked = true
    cb()
    requestAnimationFrame(() => {
      if (container && $notifyView) container.scrollTop = position
      scrollLocked = false
    })
  }
  IPC.emit('notification-unread', hasUnreadNotifications.value)
</script>

<SoftModal class='m-0 w-1000 mw-0 mh-full d-flex flex-column rounded bg-very-dark pt-0 py-30 pl-md-20 pr-md-30 mx-20 scrollbar-none' bind:showModal={$notifyView} {close} id='notificationModal'>
  {#if $notifyView}
    <div class='d-flex mt-30'>
      <h3 class='mb-0 font-weight-bold text-white title mr-5 font-size-24 ml-20'>Notifications</h3>
      <button type='button' class='btn btn-square ml-auto d-flex align-items-center justify-content-center rounded-2 flex-shrink-0 mr-20 mr-md-0' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
    </div>
    <div class='input-group mt-10 long-input' class:d-none={!$notifications?.length}>
      <Search size='2.6rem' strokeWidth='2.5' class='position-absolute z-10 text-dark-light h-full pl-10 ml-20 pointer-events-none' />
      <input
        type='search'
        class='form-control pl-40 ml-20 mr-30 bg-dark-very-light rounded-1 h-40 text-truncate'
        autocomplete='off'
        spellcheck='false'
        data-option='search'
        placeholder='Filter notifications by their titles' bind:value={searchText} on:input={(event) => { container.scrollTo({top: 0}); notificationCount = notificationCountDefault; currentNotifications = filterResults($notifications, event.target.value).slice(0, notificationCount) }} />
    </div>
    <div class='shadow-overlay' class:d-none={!$notifications?.length} />
    {#if $notifications?.length && !currentNotifications?.length}
      <ErrorCard promise={{ errors: [ { message: 'found no results' }]}}/>
    {/if}
    <div bind:this={container} class='notification-list mt-10 overflow-y-auto' on:scroll={handleScroll}>
      {#each currentNotifications as notification, index}
        {#await cache.requestMedia(notification?.id) then media}
            {@const delayed = notification.delayed}
            {@const announcement = notification.click_action === 'VIEW' && !delayed}
            {@const notWatching = !announcement && !delayed && ((!media?.mediaListEntry?.progress) || (media?.mediaListEntry?.progress === 0 && (media?.mediaListEntry?.status !== 'CURRENT' || media?.mediaListEntry?.status !== 'REPEATING' && media?.mediaListEntry?.status !== 'COMPLETED')))}
            {@const behind = Helper.isAuthorized() && !announcement && !delayed && isValidNumber(notification.episode) && (notification.episode - 1) >= 1 && (media?.mediaListEntry?.status !== 'COMPLETED' && ((media?.mediaListEntry?.progress || -1) < ((!isValidNumber(notification.season) ? notification.episode : media?.episodes) - 1)))}
            {@const watched = !announcement && !delayed && !notWatching && !behind && isValidNumber(notification.episode) && (media?.mediaListEntry?.status === 'COMPLETED' || (media?.mediaListEntry?.progress >= (!isValidNumber(notification.season) ? notification.episode : media?.episodes)))}
            {@const resolvedHash = getHash(notification.id, { episode: notification.episode, client: true }, false, true)}
            <div class='notification-item shadow-lg position-relative d-flex align-items-center mx-20 my-5 p-5 scale pointer' class:mt-10={index === 0} role='button' tabindex='0' class:not-reactive={!$reactive} class:read={notification.read} class:behind={(behind && !notWatching) || delayed} class:current={!behind && !notWatching} class:not-watching={notWatching} class:watched={watched} class:announcement={announcement}
                 use:blurExit={ () => { if (notification.prompt) setTimeout(() => preventScroll(container.scrollTop, () => delete notification.prompt)) }}
                 use:hoverExit={() => { if (notification.prompt) setTimeout(() => preventScroll(container.scrollTop, () => delete notification.prompt)) }}
                 use:click={() => {
                   if (!behind || notification.prompt) preventScroll(container.scrollTop, () => { notification.read = true; delete notification.prompt; onclick(notification) })
                   else preventScroll(container.scrollTop, () => notification.prompt = true)
                 }}
                 on:contextmenu|preventDefault={() => { notification.read = true; onclick(notification, true) }}>
              {#if notification.heroImg}
                <div class='position-absolute top-0 left-0 w-full h-full'>
                  <img src={notification.heroImg} alt='bannerImage' class='hero-img img-cover w-full h-full' />
                  <div class='position-absolute rounded-5 opacity-transition-hack' style='background: var(--notification-card-gradient);' />
                </div>
              {/if}
              <div class='rounded-5 d-flex justify-content-center align-items-center overflow-hidden mr-10 z-10 notification-icon-container'>
                <img src={notification.icon || './404_cover.png'} alt='icon' class='notification-icon rounded-5 w-auto' />
              </div>
              <div class='notification-content z-10 w-full'>
                <div class='d-flex'>
                  <p class='notification-title overflow-hidden font-weight-bold my-0 mt-5 mr-10 font-scale-18 {SUPPORTS.isAndroid ? `line-clamp-1` : `line-clamp-2`}'>{notification.title}</p>
                  <div class='ml-auto d-flex'>
                    <button type='button' tabindex='-1' class='position-absolute n-safe-area top-0 right-0 h-50 bg-transparent border-0 shadow-none not-reactive z-1 {notification.hash || resolvedHash ? `w-90` : `w-50`}' use:click={() => {}}/>
                    {#if notification.hash || resolvedHash}
                      <TorrentButton class='btn btn-square mr-5 z-1' hash={[...(notification.hash && notification.hash !== resolvedHash ? [notification.hash] : []), ...(resolvedHash ? [resolvedHash] : [])]} torrentID={notification.magnet} search={{ media: { id: notification.id }, episode: notification.episode }}/>
                    {/if}
                    <button type='button' class='read-button btn btn-square d-flex align-items-center justify-content-center z-1' class:not-allowed={watched} class:not-reactive={watched} use:click={() => { preventScroll(container.scrollTop, () => { notification.read = !notification.read; delete notification.prompt }) }}>
                      {#if notification.read}
                        <MailOpen size='1.7rem' strokeWidth='3'/>
                      {:else}
                        <MailCheck size='1.7rem' strokeWidth='3'/>
                      {/if}
                    </button>
                  </div>
                </div>
                <p class='font-size-12 my-0 mr-40'>{notification.message}</p>
                <div class='d-flex justify-content-between align-items-center mt-5'>
                  <p class='font-size-10 text-muted my-0'>{since(new Date(notification.timestamp * 1000))}</p>
                  <div>
                    {#if announcement}
                      <span class='badge text-dark bg-duodenary mr-5'>Announcement</span>
                    {:else if notification.format === 'MOVIE'}
                      <span class='badge text-dark bg-undenary mr-5'>Movie</span>
                    {:else if !isValidNumber(notification.season)}
                      {#if delayed}<span class='badge text-dark bg-denary mr-5'>Delayed</span>{/if}
                      <span class='badge text-dark bg-undenary mr-5'>{notification.episode != null && (Array.isArray(notification.episode) || isValidNumber(notification.episode)) ? `Episode ${Array.isArray(notification.episode) ? `${Number(notification.episode[0])} ~ ${Number(notification.episode[1])}` : Number(notification.episode)}` : `Batch`} </span>
                    {:else if isValidNumber(notification.season)}
                      <span class='badge text-dark bg-undenary mr-5'>Season {notification.season}</span>
                    {/if}
                    {#if notification.dub}
                      <span class='badge text-dark bg-senary'>Dub</span>
                    {:else}
                      <span class='badge text-dark bg-septenary'>Sub</span>
                    {/if}
                  </div>
                </div>
                <div class='position-absolute bd-highlight rounded-5 opacity-transition-hack' style='left: -.5rem' />
              </div>
              <div class='prompt position-absolute w-full h-full z-40 d-flex flex-column align-items-center' class:visible={notification.prompt} class:invisible={!notification.prompt}>
                <p class='mx-20 font-scale-20 text-white text-center mt-auto mb-0'>
                  {#if !media?.mediaListEntry?.progress}
                    You Haven't Watched Any Episodes Yet!
                  {:else}
                    Your Current Progress Is At <b>Episode {media?.mediaListEntry?.progress}</b>
                  {/if}
                </p>
                <button type='button' class='continue-button btn btn-lg btn-secondary w-230 h-33 text-dark font-scale-16 font-weight-bold shadow-none border-0 d-flex align-items-center mt-10 mb-auto' use:click={() => { delete notification.prompt; notification.read = true; onclick(notification) } }>
                  <Play class='mr-10' fill='currentColor' size='1.4rem' />
                  Continue Anyway?
                </button>
              </div>
            </div>
        {/await}
      {/each}
    </div>
    <div class='d-flex flex-column justify-content-between align-items-center'>
      {#if $notifications?.length}
        <button type='button' class='read-button btn text-light font-weight-bold shadow-none border-0 d-flex align-items-center mt-20' disabled={!!searchText?.length} on:click={() => { container.scrollTo({top: 0}); markAll($hasUnreadNotifications && $hasUnreadNotifications > 0) }}>
          {#if $hasUnreadNotifications && $hasUnreadNotifications > 0}
            <MailCheck strokeWidth='3' class='mr-10' size='1.7rem' />
            Mark All As Read
          {:else}
            <MailOpen strokeWidth='3' class='mr-10' size='1.7rem' />
            Mark All As Unread
          {/if}
        </button>
      {:else}
        <div class='w-800 mw-0'>
          <ErrorCard promise={{ errors: [ { message: ['Nothing To See Here!', 'Settings > Interface > Notifications Settings']}]}}/>
        </div>
      {/if}
    </div>
  {/if}
</SoftModal>

<style>
  .h-33 {
    height: 3.3rem !important;
  }
  .scale {
    transition: transform 0.2s ease;
    will-change: transform;
  }
  .scale:hover{
    transform: scale(1.02);
  }
  .font-size-10 {
    font-size: 1rem;
  }

  .notification-item {
    background-color: var(--dark-color-light);
    border-radius: .75rem;
  }
  .notification-item.read {
    opacity: .5;
  }
  .notification-item.current {
    border-left: .4rem solid var(--current-color);
  }
  .notification-item.watched {
    border-left: .4rem solid var(--watched-color);
  }
  .notification-item.behind {
    border-left: .4rem solid var(--dropped-color);
  }
  .notification-item.announcement {
    border-left: .4rem solid var(--duodenary-color);
  }
  .notification-item.not-watching {
    border-left: .4rem solid var(--gray-color-very-dim);
  }

  .notification-title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    text-overflow: ellipsis;
    word-wrap: break-word;
  }

  .line-clamp-1 {
    line-height: 1.8;
    -webkit-line-clamp: 1;
  }
  .line-clamp-2 {
    line-height: 1.2;
    -webkit-line-clamp: 2;
  }

  .hero-img {
    border-radius: .75rem;
  }
  .notification-icon {
    height: 100%;
    object-fit: cover;
    object-position: center;
  }
  .notification-icon-container {
    width: 6rem;
    height: 8rem;
  }
  .rounded-5 {
    border-radius: .5rem;
  }
  .shadow-overlay {
    position: absolute;
    left: 0;
    right: 0;
    height: 1.2rem;
    margin-top: 11.3rem;
    box-shadow: 0 1.2rem 1.2rem var(--dark-color-dim);
    pointer-events: none;
    z-index: 1;
  }

  .prompt {
    margin-left: -.9rem !important;
    width: 100.6% !important;
    border-radius: .62rem;
    background-color: hsla(var(--black-color-hsl), 0.8) !important;
  }
</style>