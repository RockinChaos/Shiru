<script>
  import NotificationCard from '@/modals/notification/components/NotificationCard.svelte'
  import { localNotifications, unreadCount } from '@/modules/notification/manager.js'
  import NotificationCardSk from '@/components/skeletons/NotificationCardSk.svelte'
  import { sort, filter } from '@/modules/notification/util.js'
  import { Search, MailCheck, X } from 'lucide-svelte'
  import { playActive } from '@/components/TorrentButton.svelte'
  import SoftModal from '@/components/modals/SoftModal.svelte'
  import ErrorCard from '@/components/cards/ErrorCard.svelte'
  import { handleAnime } from '@/modules/anime/anime.js'
  import { modal } from '@/modules/navigation.js'
  import { click } from '@/modules/lib/click.js'
  import { debounce } from '@/modules/util.js'
  import { cache } from '@/modules/cache.js'

  const NOTIFICATION_PAGE_SIZE = 25
  let notificationCount = NOTIFICATION_PAGE_SIZE
  let cachedNotificationCount = 0
  let currentNotifications = []
  let searchText = ''
  let container

  $: {
    if (!$modal[modal.NOTIFICATIONS]) onClose()
    else onOpen()
  }

  // Auto-refresh if close to top of the list and new notifications arrived
  $: {
    if (container && container.scrollTop <= 200 && $localNotifications.length > cachedNotificationCount) {
      notificationCount = NOTIFICATION_PAGE_SIZE
      cachedNotificationCount = $localNotifications.length
      currentNotifications = filter($localNotifications, searchText).slice(0, notificationCount)
    }
  }

  /** Re-sorts notifications when the modal closes */
  function onClose() {
    localNotifications.update((n) => sort([...n]))
  }

  /** Initializes visible notifications and caches count when the modal opens */
  function onOpen() {
    notificationCount = NOTIFICATION_PAGE_SIZE
    cachedNotificationCount = localNotifications.value.length
    currentNotifications = filter(localNotifications.value, searchText).slice(0, notificationCount)
  }

  /** Closes the notifications modal */
  function close() {
    modal.close(modal.NOTIFICATIONS)
  }

  /** Marks all local notifications as read */
  function markAllAsRead() {
    if (!!searchText?.length || !unreadCount.value) return // TODO: If actively searching, allow markAllAsRead to function but only mark searchText matches.
    localNotifications.update((items) => {
      for (const n of items) n.read = true
      return [...items]
    })
  }

  /**
   * Handles notification click by either opening
   * the anime view or starting playback/prompting torrent
   *
   * @param {Object} notification
   * @param {boolean} [view=false]
   */
  function handleClick(notification, view = false) {
    localNotifications.update((n) => {
      const found = n.find((x) => x.uid === notification.uid)
      if (found) found.read = true
      return [...n]
    })
    close()
    if (view) handleAnime({ id: notification.id })
    else playActive(notification.hash, { media: { id: notification.id }, episode: notification.episode }, notification.magnet, notification.click_action === 'PLAY')
  }

  /**
   * Updates filtered notification results from search input (debounced).
   * Resets pagination and scroll position.
   */
  const updateSearch = debounce((value) => {
    container?.scrollTo?.({ top: 0 })
    notificationCount = NOTIFICATION_PAGE_SIZE
    currentNotifications = filter(localNotifications.value, value).slice(0, notificationCount)
  }, 500)

  /**
   * Loads additional notifications when scrolling near bottom.
   * Implements simple infinite scroll pagination.
   *
   * @param {Event} event
   */
  function handleScroll(event) {
    const container = event.target
    // Auto-refresh if scrolled to top and new notifications arrived
    if (container.scrollTop <= 60 && localNotifications.value.length > cachedNotificationCount) {
      notificationCount = NOTIFICATION_PAGE_SIZE
      cachedNotificationCount = localNotifications.value.length
      currentNotifications = filter(localNotifications.value, searchText).slice(0, notificationCount)
      return
    }
    // Infinite scroll
    if (currentNotifications.length !== localNotifications.value.length && container.scrollTop + container.clientHeight + 10 >= container.scrollHeight) {
      const nextBatch = filter(localNotifications.value, searchText).slice(currentNotifications.length, currentNotifications.length + notificationCount)
      currentNotifications = [...new Set([...currentNotifications, ...nextBatch])]
    }
  }
</script>

<SoftModal class='m-0 w-1000 mw-0 mh-full d-flex flex-column rounded bg-very-dark pt-0 pb-20 pl-md-20 pr-md-30 mx-20 scrollbar-none' innerCss='pt-20' bind:showModal={$modal[modal.NOTIFICATIONS]} {close} id={modal.NOTIFICATIONS}>
  <div class='d-flex' style='margin-top: max(calc(var(--safe-area-top) - 3rem), 1rem)'>
    <h3 class='mb-0 font-weight-bold text-white title mr-5 font-size-24 ml-20'>Notifications</h3>
    <button type='button' class='btn btn-square ml-auto d-flex align-items-center justify-content-center rounded-2 flex-shrink-0 mt-10 mr-20 mr-md-0' use:click={close}>
      <X size='1.7rem' strokeWidth='3' />
    </button>
  </div>
  <div class='input-group mt-10 long-input' class:d-none={!$localNotifications?.length}>
    <Search size='2.6rem' strokeWidth='2.5' class='position-absolute z-10 text-dark-light h-full pl-10 ml-20 pointer-events-none' />
    <input
        type='search'
        class='form-control pl-40 ml-20 mr-30 bg-dark-very-light rounded-1 h-40 text-truncate'
        autocomplete='off'
        spellcheck='false'
        data-option='search'
        placeholder='Filter notifications by their titles'
        bind:value={searchText}
        on:input={(event) => updateSearch(event.target.value)}/>
  </div>
  {#if $localNotifications?.length && !currentNotifications?.length}
    <ErrorCard promise={{ errors: [{ message: 'found no results' }] }} />
  {/if}
  <div bind:this={container} class='notification-list mt-10 overflow-y-auto' on:scroll={handleScroll}>
    {#if $localNotifications?.length && !currentNotifications.length}
      {#each { length: NOTIFICATION_PAGE_SIZE } as _, index}
        <NotificationCardSk {index}/>
      {/each}
    {:else}
      {#each currentNotifications as notification, index}
        {@const media = cache.getMedia(notification?.id)}
        {#if !media?.id}
          {#await cache.requestMedia(notification?.id)}
            <NotificationCardSk {index}/>
          {:then media}
            <NotificationCard {index} {media} {notification} onClick={handleClick}/>
          {/await}
        {:else}
          <NotificationCard {index} {media} {notification} onClick={handleClick}/>
        {/if}
      {/each}
    {/if}
  </div>
  <div class='d-flex flex-column justify-content-between align-items-center'>
    {#if $localNotifications?.length}
      <button
          type='button'
          class='read-button btn text-light font-weight-bold shadow-none border-0 d-flex align-items-center mt-20'
          disabled={!!searchText?.length || !$unreadCount}
          on:click={markAllAsRead}>
        <MailCheck strokeWidth='3' class='mr-10' size='1.7rem' />
        Mark All As Read
      </button>
    {:else}
      <div class='w-800 mw-0'>
        <ErrorCard promise={{ errors: [{ message: ['Nothing To See Here!', 'Settings > Interface > Notifications Settings'] }] }} />
      </div>
    {/if}
  </div>
</SoftModal>

<style>
  .long-input::after {
    content: '';
    position: absolute;
    bottom: -2.2rem;
    left: 0;
    right: 0;
    height: 1.2rem;
    background: linear-gradient(to bottom, var(--dark-color-dim), transparent);
    pointer-events: none;
    z-index: 1;
  }
  .long-input.d-none::after {
    display: none;
  }
</style>