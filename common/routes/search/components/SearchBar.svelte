<script context='module'>
  const badgeKeys = ['title', 'search', 'genre', 'genre_not', 'tag', 'tag_not', 'season', 'year', 'format', 'format_not', 'status', 'status_not', 'sort', 'hideSubs', 'hideMyAnime', 'hideStatus', 'showMyAnime', 'showStatus']
  const badgeDisplayNames = { title: BookUser, search: Type, genre: Hash, genre_not: Hash, tag: Hash, tag_not: Hash, season: CalendarRange, year: Leaf, format: Tv, format_not: MonitorUp, status: MonitorPlay, status_not: MonitorX, sort: ArrowDownWideNarrow, hideMyAnime: EyeOff, showMyAnime: Hourglass, hideSubs: Mic }
  const sortOptions = { TITLE_ROMAJI: 'Title', START_DATE_DESC: 'Release Date', SCORE_DESC: 'Score', POPULARITY_DESC: 'Popularity', UPDATED_AT_DESC: 'Date Updated', UPDATED_TIME_DESC: 'Last Updated', STARTED_ON_DESC: 'Start Date', FINISHED_ON_DESC: 'Completed Date', PROGRESS_DESC: 'Your Progress', USER_SCORE_DESC: 'Your Score' }
  const formatOptions = { TV: 'TV Show', MOVIE: 'Movie', TV_SHORT: 'TV Short', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA' }

  export function searchCleanup(search, badge) {
    return Object.fromEntries(Object.entries(search).map((entry) => (!badge || badgeKeys.includes(entry[0])) && entry).filter(a => a?.[1]&& (!Array.isArray(a[1]) || a[1].length > 0)))
  }
</script>

<script>
  import { traceAnime, genreIcons, genreList, tagList } from '@/modules/anime/anime.js'
  import { currentYear } from '@/modules/providers/anilist/anilist.js'
  import { page } from '@/modules/navigation.js'
  import { settings } from '@/modules/settings.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { click } from '@/modules/lib/click.js'
  import { toast } from '@/modules/lib/toast.js'
  import Helper from '@/modules/providers/helper.js'
  import CustomDropdown from '@/components/CustomDropdown.svelte'
  import { BookUser, Type, Leaf, CalendarRange, MonitorPlay, MonitorUp, MonitorX, Tv, ArrowDownWideNarrow, Filter, FilterX, X, Tags, Hash, SlidersHorizontal, EyeOff, Hourglass, Mic, ImageUp, Search, Grid3X3, Grid2X2 } from 'lucide-svelte'

  export let clearNow
  export let search

  let form
  let searchTextInput = search.search || null
  let searchTags = getTags()
  $: if (clearNow) searchTags = getTags()

  function getTags() {
    delete search.clearNow
    return {
      headers: {
        [$genreList[0]]: 'Genres',
        [$tagList[0]]: 'Tags'
      },
      tags: [...toArray(search?.genre), ...toArray(search?.tag)],
      tags_not: [...toArray(search?.genre_not), ...toArray(search?.tag_not)]
    }
  }

  $: {
    for (const [key, val] of Object.entries({
      genre: searchTags.tags.filter(val => $genreList.includes(val)),
      tag: searchTags.tags.filter(val => $tagList.includes(val)),
      genre_not: searchTags.tags_not.filter(val => $genreList.includes(val)),
      tag_not: searchTags.tags_not.filter(val => $tagList.includes(val))
    })) {
      const current = Array.isArray(search[key]) ? search[key] : []
      if (current.length !== val.length || current.join() !== val.join()) search[key] = val
    }
  }

  $: sanitisedSearch = Object.entries(searchCleanup(search, true)).flatMap(
    ([key, value]) => {
      if (Array.isArray(value)) return value.map((item) => ({ key, value: item }))
      else return [{ key, value }]
    }
  )

  function searchClear() {
    search = {
      scheduleList: ($page === page.SCHEDULE),
      genre: [],
      genre_not: [],
      tag: [],
      tag_not: [],
      format: [],
      format_not: [],
      status: [],
      status_not: [],
      ...(search.fileEdit ? { fileEdit: search.fileEdit } : {}),
      ...(($page === page.SCHEDULE) ? { load: search.load } : { season: '', sort: ''})
    }
    searchTags.tags = []
    searchTags.tags_not = []
    searchTextInput.focus()
    form.dispatchEvent(new Event('input', { bubbles: true }))
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
      delete search.continueWatching
      delete search.completedList
      if (Helper.isUserSort(search)) {
        search.sort = ''
      }
    } else if ((badge.key.startsWith('genre') || badge.key.startsWith('tag')) && !search.userList) delete search.title
    else if (badge.key === 'hideMyAnime') delete search.hideStatus
    else if (badge.key === 'showMyAnime') delete search.showStatus
    if (Array.isArray(search[badge.key])) {
      search[badge.key] = search[badge.key].filter((item) => item !== badge.value)
      if (badge.key.startsWith('tag') || badge.key.startsWith('genre')) {
        searchTags.tags = searchTags.tags.filter((item) => item !== badge.value)
        searchTags.tags_not = searchTags.tags_not.filter((item) => item !== badge.value)
      }
      if (search[badge.key].length === 0) search[badge.key] = badge.key.includes('status') || badge.key.includes('format') ? [] : ''
    } else search[badge.key] = ''
    form.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function toggleHideMyAnime() {
    if (search.disableHide || search.disableSearch || !Helper.isAuthorized()) return
    search.hideMyAnime = !search.hideMyAnime
    search.hideStatus = search.hideMyAnime ? ['CURRENT', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'] : ''
    search.showMyAnime = false
    search.showStatus = ''
    form.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function toggleShowMyAnime() {
    if (search.disableHide || search.disableSearch || !Helper.isAuthorized()) return
    search.showMyAnime = !search.showMyAnime
    search.showStatus = search.showMyAnime ? ['CURRENT', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'] : ''
    search.hideMyAnime = false
    search.hideStatus = ''
    form.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function toggleSubs() {
    search.hideSubs = !search.hideSubs
    form.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function clearTags() { // cannot specify genre and tag filtering with user specific sorting options when using alternative authentication.
    if (!Helper.isAniAuth() && Helper.isUserSort(search)) {
      search.genre = []
      search.genre_not = []
      search.tag = []
      search.tag_not = []
      searchTags.tags = []
      searchTags.tags_not = []
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

  let advancedSearch = 'd-advanced-search'
  function toggleAdvancedSearch() {
    if (!advancedSearch?.length) advancedSearch = 'd-advanced-search'
    else advancedSearch = ''
  }

  function toArray(value) {
    return Array.isArray(value) ? value : value ? [value] : []
  }
</script>

<form class='container-fluid px-md-10 bg-dark position-sticky top-0 search-container z-40' class:px-10={search.fileEdit} class:px-md-50={!search.fileEdit} class:pt-20={!search.fileEdit} class:mt-20={!SUPPORTS.isAndroid && !search.fileEdit} class:mt-md-0={!SUPPORTS.isAndroid && !search.fileEdit} class:bg-very-dark={search.fileEdit} style:--container-color={search.fileEdit ? 'var(--dark-color-dim)' : 'var(--dark-color)'} on:input bind:this={form}>
  <div class='row'>
    <div class='col-lg col-4 p-10 d-flex flex-column justify-content-end' class:d-advanced-title={advancedSearch}>
      <div class='pb-10 font-weight-semi-bold d-flex align-items-center {advancedSearch} font-scale-24'>
        <Type class='mr-10 block-scale-30'/>
        <div>Title</div>
      </div>
      <div class='input-group'>
        <Search size='2.6rem' strokeWidth='2.5' class='position-absolute z-10 text-dark-light h-full pl-10 pointer-events-none'/>
        <input
          bind:this={searchTextInput}
          type='search'
          class='form-control bg-dark-light text-capitalize pl-35 rounded-1 text-truncate'
          autocomplete='off'
          spellcheck='false'
          bind:value={search.search}
          data-option='search'
          disabled={search.disableSearch}
          placeholder='Any'/>
      </div>
    </div>
    <div class='col-lg col-4 p-10 z-4 d-flex {advancedSearch} flex-column justify-content-end'>
      <div class='pb-10 font-weight-semi-bold d-flex align-items-center font-scale-24'>
        <Hash class='mr-10 block-scale-30'/>
        <div>Genres</div>
      </div>
      <div class='input-group' title={(!Helper.isAniAuth() && Helper.isUserSort(search)) ? 'Cannot use with sort: ' + sortOptions[search.sort] : ''}>
        <CustomDropdown id='tags-input' bind:form headers={searchTags.headers} options={[...toArray($genreList), ...toArray($tagList)]} bind:value={searchTags.tags} bind:altValue={searchTags.tags_not} constrainAlt={false} disabled={search.disableSearch || (!Helper.isAniAuth() && Helper.isUserSort(search))}/>
      </div>
    </div>
    <div class='col-lg col-4 p-10 z-4 d-none {advancedSearch} flex-column justify-content-end' class:d-flex={!search.scheduleList}>
      <div class='pb-10 font-weight-semi-bold d-flex align-items-center font-scale-24'>
        <CalendarRange class='mr-10 block-scale-30'/>
        <div>Season</div>
      </div>
      <div class='d-flex align-items-center'>
        <div class='input-group'>
          <select class='form-control bg-dark-light border-right-dark radius-right-0' required bind:value={search.season} disabled={search.disableSearch}>
            <option value selected>Any</option>
            <option value='WINTER'>Winter</option>
            <option value='SPRING'>Spring</option>
            <option value='SUMMER'>Summer</option>
            <option value='FALL'>Fall</option>
          </select>
        </div>
        <div class='input-group'>
          <CustomDropdown id='year-input' class='radius-left-0' bind:form options={Array.from({ length: currentYear - 1940 + 2 }, (_, i) => currentYear + 1 - i)} bind:value={search.year} arrayValue={false} displaySize={40} bind:disabled={search.disableSearch}/>
        </div>
      </div>
    </div>
    <div class='col p-10 z-3 d-flex {advancedSearch} flex-column justify-content-end'>
      <div class='pb-10 font-weight-semi-bold d-flex align-items-center font-scale-24'>
        <Tv class='mr-10 block-scale-30'/>
        <div>Format</div>
      </div>
      <div class='input-group'>
        <CustomDropdown id='format-input' bind:form options={{ TV: 'TV Show', MOVIE: 'Movie', TV_SHORT: 'TV Short', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA' }} bind:value={search.format} bind:altValue={search.format_not} bind:disabled={search.disableSearch}/>
      </div>
    </div>
    <div class='col p-10 z-2 d-none {advancedSearch} flex-column justify-content-end' class:d-flex={!search.scheduleList}>
      <div class='pb-10 font-weight-semi-bold d-flex align-items-center font-scale-24'>
        <MonitorPlay class='mr-10 block-scale-30'/>
        <div>Status</div>
      </div>
      <div class='input-group'>
        <CustomDropdown id='status-input' bind:form options={{ RELEASING: 'Releasing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Not Yet Released', CANCELLED: 'Cancelled' }} bind:value={search.status} bind:altValue={search.status_not} bind:disabled={search.disableSearch}/>
      </div>
    </div>
    <div class='col p-10 d-none {advancedSearch} flex-column justify-content-end' class:d-flex={!search.scheduleList}>
      <div class='pb-10 font-weight-semi-bold d-flex align-items-center font-scale-24'>
        <ArrowDownWideNarrow class='mr-10 block-scale-30'/>
        <div>Sort</div>
      </div>
      <div class='input-group'>
        <select class='form-control bg-dark-light' required bind:value={search.sort} on:change={clearTags} disabled={search.disableSearch}>
          {#if search.sort !== 'TRENDING_DESC'}
            <option value selected>Trending</option>
          {:else}
            <option value='TRENDING_DESC' selected>Trending</option>
          {/if}
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
    <div class='col-auto p-10 d-none d-advanced-search-toggle'>
      <div class='align-self-end'>
        <button class='btn btn-square bg-dark-light px-5 align-self-end border-0 z-1' type='button' data-toggle='tooltip' data-placement='bottom' data-target-breakpoint='md' data-title='Advanced Search' use:click={toggleAdvancedSearch} disabled={search.disableHide || search.disableSearch} class:text-primary={!advancedSearch?.length}>
          <label for='d-advanced-search-toggle' class='pointer mb-0 d-flex align-items-center justify-content-center'>
            <SlidersHorizontal size='1.625rem' />
          </label>
        </button>
      </div>
    </div>
    {#if !search.fileEdit}
      <div class='col-auto p-10 d-flex'>
        <div class='align-self-end'>
          <button class='btn btn-square bg-dark-light px-5 align-self-end border-0 z-1' type='button' data-toggle='tooltip' data-placement='bottom' data-target-breakpoint='md' data-title='{search.showMyAnime ? `Show My Anime` : `Hide My Anime`}' use:click={toggleHideMyAnime} on:contextmenu|preventDefault={toggleShowMyAnime} disabled={search.disableHide || search.disableSearch || !Helper.isAuthorized()} class:text-primary={search.hideMyAnime} class:text-octonary={search.showMyAnime}>
            <label for='hide-my-anime' class='pointer mb-0 d-flex align-items-center justify-content-center'>
              <svelte:component this={search.showMyAnime ? badgeDisplayNames['showMyAnime'] : badgeDisplayNames['hideMyAnime']} size='1.625rem' />
            </label>
          </button>
        </div>
      </div>
      <div class='col-auto p-10 d-flex'>
        <div class='align-self-end'>
          <button class='btn btn-square bg-dark-light px-5 align-self-end border-0 z-1' type='button' data-toggle='tooltip' data-placement='bottom' data-target-breakpoint='md' data-title='Dubbed Audio' use:click={toggleSubs} disabled={search.disableSearch} class:text-primary={search.hideSubs}>
            <label for='hide-subs' class='pointer mb-0 d-flex align-items-center justify-content-center'>
              <Mic size='1.625rem' />
            </label>
          </button>
        </div>
      </div>
      <input type='file' class='d-none' id='search-image' accept='image/*' on:input|preventDefault|stopPropagation={handleFile} />
      <div class='col-auto p-10 d-none' class:d-flex={!search.scheduleList}>
        <div class='align-self-end'>
          <button class='btn btn-square bg-dark-light px-5 align-self-end border-0 z-1' type='button' data-toggle='tooltip' data-placement='bottom' data-target-breakpoint='md' data-title='Image Search'>
            <label for='search-image' class='pointer mb-0 d-flex align-items-center justify-content-center'>
              <ImageUp size='1.625rem' />
            </label>
          </button>
        </div>
      </div>
    {/if}
    <div class='col-auto p-10 d-flex'>
      <div class='align-self-end'>
        <button class='btn btn-square bg-dark-light d-flex align-items-center justify-content-center px-5 align-self-end border-0 z-1' type='button' data-toggle='tooltip' data-placement='bottom' data-target-breakpoint='md' data-title='Reset Filters' use:click={searchClear} disabled={(sanitisedSearch.length <= 0) && !search.clearNext} class:text-danger={!!sanitisedSearch?.length || search.disableSearch || search.clearNext}>
          {#if !!sanitisedSearch?.length || search.disableSearch || search.clearNext}
            <FilterX size='1.625rem' />
          {:else}
            <Filter size='1.625rem' />
          {/if}
        </button>
      </div>
    </div>
  </div>
  <div class='w-full p-10 d-flex flex-colum'>
    <form>
      <div class='not-reactive' role='button' tabindex='0'>
        {#if sanitisedSearch?.length}
          {@const filteredBadges = sanitisedSearch.filter(badge => badge.key !== 'hideStatus' && badge.key !== 'showStatus' && (search.userList || badge.key !== 'title'))}
          <div class='d-flex flex-wrap flex-row align-items-center'>
            {#if filteredBadges.length > 0}
              <Tags class='text-dark-light mr-20 block-scale-30 mb-5'/>
            {/if}
          {#each badgeKeys as key (key)}
            {@const matchingBadges = filteredBadges.filter(badge => badge.key === key)}
            {#each matchingBadges as badge, badgeIndex (badgeIndex)}
              {#if badge.key === key && (badge.key !== 'hideStatus' && badge.key !== 'showStatus' && (search.userList || badge.key !== 'title')) && !(badge.key === 'sort' && badge.value === 'TRENDING_DESC')}
                <div use:click={() => removeBadge(badge)} class='badge border-0 py-5 px-10 text-capitalize mr-10 text-white text-nowrap d-flex align-items-center mb-5' style='max-width: 60vw' class:bg-dark-light={!badge.key.includes('_not')} class:bg-danger-very-dim={badge.key.includes('_not')}>
                  <svelte:component this={badge.key === 'genre' ? genreIcons[badge.value] || badgeDisplayNames[badge.key] : badgeDisplayNames[badge.key]} class='mr-5 square-scale-18'/>
                  <span class='text-truncate'>{badge.key === 'sort' ? getSortDisplayName(badge.value) : (badge.key === 'format' || badge.key === 'format_not') ? getFormatDisplayName(badge.value) : (badge.key === 'hideMyAnime' ? 'Hide My Anime' : badge.key === 'showMyAnime' ? 'Show My Anime' : badge.key === 'hideSubs' ? 'Dubbed' : ('' + badge.value).replace(/_/g, ' ').toLowerCase())}</span>
                  <button on:click={() => removeBadge(badge)} class='pointer bg-transparent border-0 icon text-white position-relative pl-0 pr-0 pt-0 x-filter d-flex align-items-center z-1' type='button' data-toggle='tooltip' data-placement='bottom' data-target-breakpoint='md' data-title='Remove Filter'><X size='1.3rem' strokeWidth='3'/></button>
                </div>
              {/if}
            {/each}
          {/each}
          </div>
        {/if}
      </div>
    </form>
    <span class='mr-10 filled ml-auto icon text-dark-light pointer' class:d-advanced-search={!advancedSearch?.length} class:d-none={!(!search.disableSearch && !search.clearNext)} data-toggle='tooltip' data-placement='bottom' data-target-breakpoint='md' data-title='Small Cards' class:text-muted={$settings.cards === 'small'} use:click={() => { if ($settings.cards !== 'small') changeCardMode('small') }}><Grid3X3 size='2.25rem' /></span>
    <span class='icon text-dark-light pointer' class:d-advanced-search={!advancedSearch?.length} class:d-none={!(!search.disableSearch && !search.clearNext)} data-toggle='tooltip' data-placement='bottom' data-target-breakpoint='md' data-title='Large Cards' class:text-muted={$settings.cards === 'full'} use:click={() => { if ($settings.cards !== 'full') changeCardMode('full') }}><Grid2X2 size='2.25rem' /></span>
  </div>
</form>

<style>
  .pl-35 {
    padding-left: 3.5rem;
  }

  .badge .x-filter {
    opacity: 0;
    max-width: 0;
    transition: opacity 0.2s ease-in-out, max-width 0.2s, margin-left 0.2s ease-in-out;
  }
  .badge:hover .x-filter {
    opacity: 1;
    max-width: 2rem;
    margin-left: 1.5rem;
  }

  form.search-container::after {
    content: '';
    position: absolute;
    bottom: -1.2rem;
    left: 0;
    right: 0;
    height: 1.2rem;
    background: linear-gradient(to bottom, var(--container-color), transparent);
    pointer-events: none;
    z-index: 1;
  }

  input:not(:focus):invalid {
    box-shadow: 0 0 0 0.2rem var(--danger-color) !important;
  }
  select.form-control:invalid {
    color: var(--dm-input-placeholder-text-color);
  }

  @media (max-width: 768px), (max-height: 450px), (max-width: 1000px) and (max-height: 540px) {
    .d-advanced-title {
      flex-basis: 0;
      flex-grow: 1;
      max-width: 100%;
      min-width: 20rem !important;
    }
    .d-advanced-search {
      display: none !important;
    }
    .d-advanced-search-toggle {
      display: flex !important;
    }
  }
</style>
