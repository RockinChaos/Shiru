<script context='module'>
  const badgeKeys = ['title', 'search', 'genre', 'tag', 'season', 'year', 'format', 'format_not', 'status', 'status_not', 'sort', 'hideSubs', 'hideMyAnime', 'hideStatus']
  const badgeDisplayNames = { title: BookUser, search: Type, genre: Drama, tag: Hash, season: CalendarRange, year: Leaf, format: Tv, format_not: MonitorUp, status: MonitorPlay, status_not: MonitorX, sort: ArrowDownWideNarrow, hideMyAnime: SlidersHorizontal, hideSubs: Mic }
  const sortOptions = { TITLE_ROMAJI: 'Title', START_DATE_DESC: 'Release Date', SCORE_DESC: 'Score', POPULARITY_DESC: 'Popularity', UPDATED_AT_DESC: 'Date Updated', UPDATED_TIME_DESC: 'Last Updated', STARTED_ON_DESC: 'Start Date', FINISHED_ON_DESC: 'Completed Date', PROGRESS_DESC: 'Your Progress', USER_SCORE_DESC: 'Your Score' }
  const formatOptions = { TV: 'TV Show', MOVIE: 'Movie', TV_SHORT: 'TV Short', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA' }

  export function searchCleanup(search, badge) {
    return Object.fromEntries(Object.entries(search).map((entry) => (!badge || badgeKeys.includes(entry[0])) && entry).filter(a => a?.[1]&& (!Array.isArray(a[1]) || a[1].length > 0)))
  }
</script>

<script>
  import { traceAnime, genreIcons, genreList, tagList } from '@/modules/anime.js'
  import { settings } from '@/modules/settings.js'
  import { click } from '@/modules/click.js'
  import { page } from '@/App.svelte'
  import { toast } from 'svelte-sonner'
  import Helper from '@/modules/helper.js'
  import CustomDropdown from '@/components/CustomDropdown.svelte'
  import { MagnifyingGlass, Image } from 'svelte-radix'
  import { BookUser, Type, Drama, Leaf, CalendarRange, MonitorPlay, MonitorUp, MonitorX, Tv, ArrowDownWideNarrow, Filter, FilterX, Tags, Hash, SlidersHorizontal, Mic, Grid3X3, Grid2X2 } from 'lucide-svelte'

  export let search
  let searchTextInput = {
    title: null,
    genre: null,
    tag: null
  }
  let form

  let filteredTags = []

  $: {
    const searchInput = (searchTextInput.tag ? searchTextInput.tag.toLowerCase() : null)
    filteredTags = tagList.filter(tag => (!search.tag || !search.tag.includes(tag)) && (!searchInput || tag.toLowerCase().includes(searchInput))).slice(0, 20)
  }

  $: sanitisedSearch = Object.entries(searchCleanup(search, true)).flatMap(
    ([key, value]) => {
      if (Array.isArray(value)) {
        return value.map((item) => ({ key, value: item }))
      } else {
        return [{ key, value }]
      }
    }
  )

  function searchClear() {
    const schedule = $page === 'schedule'
    search = {
      ...(schedule ? search : { format: [] }),
      title: '',
      search: '',
      genre: '',
      tag: '',
      season: '',
      year: null,
      format: [],
      format_not: [],
      status: [],
      status_not: [],
      sort: '',
      hideSubs: false,
      hideMyAnime: false,
      disableHide: false,
      hideStatus: '',
      scheduleList: schedule,
      userList: false,
      missedList: true,
      completedList: true,
      planningList: true,
      droppedList: true,
      continueWatching: false
    }
    searchTextInput.title.focus()
    form.dispatchEvent(new Event('input', { bubbles: true }))
    $page = schedule ? 'schedule' : 'search'
  }

  function getSortDisplayName(value) {
    return sortOptions[value] || value
  }

  function getFormatDisplayName(value) {
    return formatOptions[value] || value
  }

  function removeBadge(badge) {
    if (badge.key === 'title') {
      delete search.load
      delete search.disableHide
      delete search.userList
      delete search.scheduleList
      delete search.continueWatching
      delete search.completedList
      if (Helper.isUserSort(search)) {
        search.sort = ''
      }
    } else if ((badge.key === 'genre' || badge.key === 'tag') && !search.userList) {
      delete search.title
    } else if (badge.key === 'hideMyAnime') {
      delete search.hideStatus
    } 
    if (Array.isArray(search[badge.key])) {
      search[badge.key] = search[badge.key].filter((item) => item !== badge.value)
      if (search[badge.key].length === 0) {
        search[badge.key] = badge.key.includes('status') || badge.key.includes('format') ? [] : ''
      }
    } else {
      search[badge.key] = ''
    }
    form.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function toggleHideMyAnime() {
    search.hideMyAnime = !search.hideMyAnime
    search.hideStatus = search.hideMyAnime ? ['CURRENT', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'] : ''
    form.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function toggleSubs() {
    search.hideSubs = !search.hideSubs
    form.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function filterTags(event, type, trigger) {
    const list = type === 'tag' ? tagList : genreList
    const searchKey = type === 'tag' ? 'tag' : 'genre'
    const inputValue = event.target.value
    let bestMatch = list.find(item => item.toLowerCase() === inputValue.toLowerCase())
    if ((trigger === 'keydown' && (event.key === 'Enter' || event.code === 'Enter')) || (trigger === 'input' && bestMatch)) {
      if (!bestMatch || inputValue.endsWith('*')) {
        bestMatch = (inputValue.endsWith('*') && inputValue.slice(0, -1)) || list.find(item => item.toLowerCase().startsWith(inputValue.toLowerCase())) || list.find(item => item.toLowerCase().endsWith(inputValue.toLowerCase()))
      }
      if (bestMatch && (!search[searchKey] || !search[searchKey].includes(bestMatch))) {
        search[searchKey] = search[searchKey] ? [...search[searchKey], bestMatch] : [bestMatch]
        searchTextInput[searchKey] = null
        setTimeout(() => {
          form.dispatchEvent(new Event('input', {bubbles: true}))
        }, 0)
      }
    }
  }

  function clearTags() { // cannot specify genre and tag filtering with user specific sorting options when using alternative authentication.
    if (!Helper.isAniAuth() && Helper.isUserSort(search)) {
      search.genre = ''
      search.tag = ''
    }
  }

  function handleFile({ target }) {
    const { files } = target
    if (files?.[0]) {
      toast.promise(traceAnime(files[0]), {
        description: 'You can also paste an URL to an image.',
        loading: 'Looking up anime for image...',
        success: 'Found anime for image!',
        error:
          'Couldn\'t find anime for specified image! Try to remove black bars, or use a more detailed image.'
      })
      target.value = null
    }
  }

  function changeCardMode(type) {
    $settings.cards = type
    form.dispatchEvent(new Event('input', { bubbles: true }))
  }
</script>

<form class='container-fluid py-20 px-md-50 bg-dark pb-0 position-sticky top-0 search-container z-40' on:input bind:this={form}>
  <div class='row'>
    <div class='col-lg col-4 p-10 d-flex flex-column justify-content-end'>
      <div class='pb-10 font-size-24 font-weight-semi-bold d-flex'>
        <Type class='mr-10' size='3rem' />
        <div>Title</div>
      </div>
      <div class='input-group'>
        <div class='input-group-prepend'>
          <MagnifyingGlass size='2.75rem' class='input-group-text bg-dark-light pr-0' />
        </div>
        <input
          bind:this={searchTextInput.title}
          type='search'
          class='form-control bg-dark-light border-left-0 text-capitalize'
          autocomplete='off'
          bind:value={search.search}
          data-option='search'
          disabled={search.disableSearch}
          placeholder='Any'/>
      </div>
    </div>
    <div class='col-lg col-4 p-10 d-flex flex-column justify-content-end'>
      <div class='pb-10 font-size-24 font-weight-semi-bold d-flex'>
        <Drama class='mr-10' size='3rem' />
        <div>Genres</div>
      </div>
      <div class='input-group'>
        <input
          id='genre'
          type='search'
          title={(!Helper.isAniAuth() && Helper.isUserSort(search)) ? 'Cannot use with sort: ' + sortOptions[search.sort] : ''}
          class='form-control bg-dark-light border-left-0 text-capitalize no-bubbles'
          autocomplete='off'
          bind:value={searchTextInput.genre}
          on:keydown={(event) => filterTags(event, 'genre', 'keydown')}
          on:input={(event) => filterTags(event, 'genre', 'input')}
          data-option='search'
          disabled={search.disableSearch || (!Helper.isAniAuth() && Helper.isUserSort(search))}
          placeholder='Any'
          list='search-genre'/>
      </div>
      <datalist id='search-genre'>
        {#each genreList as genre}
          {#if !search.genre || !search.genre.includes(genre) }
            <option>{genre}</option>
          {/if}
        {/each}
      </datalist>
    </div>
    <div class='col-lg col-4 p-10 d-flex flex-column justify-content-end'>
      <div class='pb-10 font-size-24 font-weight-semi-bold d-flex'>
        <Hash class='mr-10' size='3rem' />
        <div>Tags</div>
      </div>
      <div class='input-group'>
        <input
          id='tag'
          type='search'
          title={(!Helper.isAniAuth() && Helper.isUserSort(search)) ? 'Cannot use with sort: ' + sortOptions[search.sort] : ''}
          class='form-control bg-dark-light border-left-0 text-capitalize no-bubbles'
          autocomplete='off'
          bind:value={searchTextInput.tag}
          on:keydown={(event) => filterTags(event, 'tag', 'keydown')}
          on:input={(event) => filterTags(event, 'tag', 'input')}
          data-option='search'
          disabled={search.disableSearch || (!Helper.isAniAuth() && Helper.isUserSort(search))}
          placeholder='Any'
          list='search-tag'/>
      </div>
      <datalist id='search-tag'>
        {#each filteredTags as tag}
          <option>{tag}</option>
        {/each}
      </datalist>
    </div>
    {#if !search.scheduleList}
      <div class='col-lg col-4 p-10 d-flex flex-column justify-content-end'>
        <div class='pb-10 font-size-24 font-weight-semi-bold d-flex'>
          <CalendarRange class='mr-10' size='3rem' />
          <div>Season</div>
        </div>
        <div class='input-group'>
          <select class='form-control bg-dark-light border-right-dark' required bind:value={search.season} disabled={search.disableSearch}>
            <option value selected>Any</option>
            <option value='WINTER'>Winter</option>
            <option value='SPRING'>Spring</option>
            <option value='SUMMER'>Summer</option>
            <option value='FALL'>Fall</option>
          </select>
          <datalist id='search-year'>
            {#each Array(new Date().getFullYear() - 1940 + 2) as _, i}
              {@const year = new Date().getFullYear() + 2 - i}
              <option>{year}</option>
            {/each}
          </datalist>
          <input type='number' inputmode='numeric' pattern='[0-9]*' placeholder='Any' min='1940' max='2100' list='search-year' class='bg-dark-light form-control' disabled={search.disableSearch} bind:value={search.year} />
        </div>
      </div>
    {/if}
    <div class='col p-10 d-flex flex-column justify-content-end'>
      <div class='pb-10 font-size-24 font-weight-semi-bold d-flex'>
        <Tv class='mr-10' size='3rem' />
        <div>Format</div>
      </div>
      <div class='input-group z-5'>
        <CustomDropdown id={`format-input`} bind:form options={{ TV: 'TV Show', MOVIE: 'Movie', TV_SHORT: 'TV Short', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA' }} bind:value={search.format} bind:altValue={search.format_not} bind:disabled={search.disableSearch}/>
      </div>
    </div>
    {#if !search.scheduleList}
      <div class='col p-10 d-flex flex-column justify-content-end'>
        <div class='pb-10 font-size-24 font-weight-semi-bold d-flex'>
          <MonitorPlay class='mr-10' size='3rem' />
          <div>Status</div>
        </div>
        <div class='input-group z-5'>
          <CustomDropdown id={`status-input`} bind:form options={{ RELEASING: 'Releasing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Not Yet Released', CANCELLED: 'Cancelled' }} bind:value={search.status} bind:altValue={search.status_not} bind:disabled={search.disableSearch}/>
        </div>
      </div>
      <div class='col p-10 d-flex flex-column justify-content-end'>
        <div class='pb-10 font-size-24 font-weight-semi-bold d-flex'>
          <ArrowDownWideNarrow class='mr-10' size='3rem' />
          <div>Sort</div>
        </div>
        <div class='input-group'>
          <select class='form-control bg-dark-light' required bind:value={search.sort} on:change={clearTags} disabled={search.disableSearch}>
            <option value selected>Trending</option>
            <option value='POPULARITY_DESC'>Popularity</option>
            <option value='TITLE_ROMAJI'>Title</option>
            <option value='SCORE_DESC'>Score</option>
            <option value='START_DATE_DESC'>Release Date</option>
            {#if search.userList && search.title && !search.missedList}
              {#if search.completedList}
                <option value='FINISHED_ON_DESC'>Completed Date</option>
              {/if}
              {#if !search.planningList}
                <option value='STARTED_ON_DESC'>Start Date</option>
              {/if}
              <option value='UPDATED_TIME_DESC'>Last Updated</option>
              {#if !search.completedList && !search.planningList}
                <option value='PROGRESS_DESC'>Your Progress</option>
              {/if}
              {#if search.completedList || search.droppedList}
                <option value='USER_SCORE_DESC'>Your Score</option>
              {/if}
            {/if}
          </select>
        </div>
      </div>
    {/if}
    <div class='col-auto p-10 d-flex'>
      <div class='align-self-end'>
        <button
          class='btn btn-square bg-dark-light px-5 align-self-end border-0'
          type='button'
          title='Hide My Anime'
          use:click={toggleHideMyAnime}
          disabled={search.disableHide || search.disableSearch || !Helper.isAuthorized()}
          class:text-primary={search.hideMyAnime}>
          <label for='hide-my-anime' class='pointer mb-0 d-flex align-items-center justify-content-center'>
            <SlidersHorizontal size='1.625rem' />
          </label>
        </button>
      </div>
    </div>
    <div class='col-auto p-10 d-flex'>
      <div class='align-self-end'>
        <button
          class='btn btn-square bg-dark-light px-5 align-self-end border-0'
          type='button'
          title='Dubbed Audio'
          use:click={toggleSubs}
          disabled={search.disableSearch}
          class:text-primary={search.hideSubs}>
          <label for='hide-subs' class='pointer mb-0 d-flex align-items-center justify-content-center'>
            <Mic size='1.625rem' />
          </label>
        </button>
      </div>
    </div>
    {#if !search.scheduleList}
      <input type='file' class='d-none' id='search-image' accept='image/*' on:input|preventDefault|stopPropagation={handleFile} />
      <div class='col-auto p-10 d-flex'>
        <div class='align-self-end'>
          <button class='btn btn-square bg-dark-light px-5 align-self-end border-0' type='button' title='Image Search'>
            <label for='search-image' class='pointer mb-0 d-flex align-items-center justify-content-center'>
              <Image size='1.625rem' />
            </label>
          </button>
        </div>
      </div>
    {/if}
    <div class='col-auto p-10 d-flex'>
      <div class='align-self-end'>
        <button class='btn btn-square bg-dark-light d-flex align-items-center justify-content-center px-5 align-self-end border-0' type='button' use:click={searchClear} disabled={(sanitisedSearch.length <= 0) && !search.clearNext} class:text-danger={!!sanitisedSearch?.length || search.disableSearch || search.clearNext}>
          {#if !!sanitisedSearch?.length || search.disableSearch || search.clearNext}
            <FilterX size='1.625rem' />
          {:else}
            <Filter size='1.625rem' />
          {/if}
        </button>
      </div>
    </div>
  </div>
  <div class='w-full p-10 d-flex flex-colum align-items-center'>
    <form>
      <div class='not-reactive' role='button' tabindex='0'>
        {#if sanitisedSearch?.length}
          {@const filteredBadges = sanitisedSearch.filter(badge => badge.key !== 'hideStatus' && (search.userList || badge.key !== 'title'))}
          <div class='d-flex flex-wrap flex-row align-items-center'>
            {#if filteredBadges.length > 0}
              <Tags class='text-dark-light mr-20' size='3rem' />
            {/if}
          {#each badgeKeys as key}
            {@const matchingBadges = filteredBadges.filter(badge => badge.key === key)}
            {#each matchingBadges as badge}
              {#if badge.key === key && (badge.key !== 'hideStatus' && (search.userList || badge.key !== 'title')) }
                <div class='badge border-0 py-5 px-10 text-capitalize mr-10 text-white text-nowrap d-flex align-items-center mb-5' class:bg-light={!badge.key.includes('_not')} class:bg-danger-dark={badge.key.includes('_not')}>
                  <svelte:component this={badge.key === 'genre' ? genreIcons[badge.value] || badgeDisplayNames[badge.key] : badgeDisplayNames[badge.key]} class='mr-5' size='1.8rem' />
                  <div class='font-size-12 mr-5'>{badge.key === 'sort' ? getSortDisplayName(badge.value) : (badge.key === 'format' || badge.key === 'format_not') ? getFormatDisplayName(badge.value) : (badge.key === 'hideMyAnime' ? 'Hide My Anime' : badge.key === 'hideSubs' ? 'Dubbed' : ('' + badge.value).replace(/_/g, ' ').toLowerCase())}</div>
                  <button on:click={() => removeBadge(badge)} class='pointer bg-transparent border-0 text-white font-size-12 position-relative ml-5 pr-0 pt-0 x-filter' title='Remove Filter' type='button'>x</button>
                </div>
              {/if}
            {/each}
          {/each}
          </div>
        {/if}
      </div>
    </form>
    {#if !search.disableSearch && !search.clearNext}
      <span class='mr-10 filled ml-auto text-dark-light pointer' title='Small Cards' class:text-muted={$settings.cards === 'small'} use:click={() => changeCardMode('small')}><Grid3X3 size='2.25rem' /></span>
      <span class='text-dark-light pointer' title='Large Cards' class:text-muted={$settings.cards === 'full'} use:click={() => changeCardMode('full')}><Grid2X2 size='2.25rem' /></span>
    {/if}
  </div>
</form>

<style>
  .bg-danger-dark {
    background-color: #631420;
  }
  .z-5 {
    z-index: 5;
  }

  .input-group,
  .container-fluid button, .pointer {
    transition: scale 0.2s ease;
  }

  .input-group:hover, .pointer:hover {
    scale: 1.08;
  }

  .container-fluid button:hover {
    scale: 1.20;
  }
  input:not(:focus):invalid {
    box-shadow: 0 0 0 0.2rem var(--danger-color) !important;
  }
  select.form-control:invalid {
    color: var(--dm-input-placeholder-text-color);
  }
</style>
