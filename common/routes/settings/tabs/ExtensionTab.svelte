<script>
  import { click } from '@/modules/lib/click.js'
  import SettingCard from '@/routes/settings/components/SettingCard.svelte'
  import ConfirmButton from '@/components/inputs/ConfirmButton.svelte'
  import { stringToHex, capitalize, debounce } from '@/modules/util.js'
  import { getKey, normalizeUrl, VALID_SCHEMES, extensionManager } from '@/modules/extensions/manager.js'
  import { cache, caches } from '@/modules/cache.js'
  import { status } from '@/modules/networking.js'
  import { slide } from 'svelte/transition'
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  import { TriangleAlert, CircleAlert, Github, Folder, FileQuestion, Trash2, CircleX, ChevronDown, ChevronUp, SquarePlus, Adult, Settings, RefreshCw } from 'lucide-svelte'
  export let settings

  const activeWorkers = extensionManager.activeWorkers
  const inactiveWorkers = extensionManager.inactiveWorkers
  const updateExtensionSettings = debounce((key) => extensionManager.updateExtensionSettings(key), 500)
  const npmIcon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcBAMAAACAI8KnAAAALVBMVEXLAADKAADMERHVSkrURkb////eeXnghITfgIDstrbFAADJAADhiorPJCTVSUliGH6+AAAAUklEQVR4AWMgETAKQoEAmKvsAgVGYEnTUCgIFmBgYmAQgOtiAHERACdXSNkBmevi/AGZyxrwAU3v4OJ+gLACGP7DA8dZgOGeixEi6ECUAIlhDgBoOA7wXH0RDQAAAABJRU5ErkJggg=='

  $: mainTab = true
  $: viewSources = false
  $: viewSettings = {}
  $: pendingSource = false
  $: pendingReload = false
  $: failedSource = null
  $: availableSources = (settings.extensionsNew && cache.getEntry(caches.EXTENSIONS, 'repositorySources')) || {}
  $: availableExtensions = (settings.extensionsNew && cache.getEntry(caches.EXTENSIONS, 'extensionSources')) || {}

  let sourceUrl = ''
  async function addSource(source) {
    if (!source?.length && !sourceUrl?.length || pendingSource) return
    pendingSource = true
    failedSource = await extensionManager.addSource(source || sourceUrl)
    sourceUrl = ''
    updateAvailable()
    pendingSource = false
  }

  async function removeSource(sourceUrl, extensionSource = false) {
    if (pendingSource) return
    pendingSource = true
    if (!extensionSource) await extensionManager.removeSource(sourceUrl)
    else {
      const repositorySources = { ...(availableSources) }
      delete repositorySources[sourceUrl]
      cache.setEntry(caches.EXTENSIONS, 'repositorySources', repositorySources)
    }
    updateAvailable()
    pendingSource = false
  }

  function updateAvailable() {
    availableSources = (settings.extensionsNew && cache.getEntry(caches.EXTENSIONS, 'repositorySources')) || {}
    availableExtensions = (settings.extensionsNew && cache.getEntry(caches.EXTENSIONS, 'extensionSources')) || {}
  }

  function parseSafeMarkdown(text) {
    if (!text) return text
    marked.setOptions({
      pedantic: false,
      breaks: true,
      gfm: true
    })
    return DOMPurify.sanitize(marked.parseInline(text), {
      ALLOWED_TAGS: [ 'strong', 'b', 'em', 'i', 'code', 's', 'del', 'u', 'ins', 'mark', 'sub', 'sup', 'small', 'br', 'kbd', 'abbr', 'cite', 'q', 'var', 'samp' ],
      ALLOWED_ATTR: []
    })
  }

  async function validateExtension(key) {
    if (pendingSource) return
    pendingSource = true
    extensionManager.validateExtension(key).then(() => pendingSource = false)
  }

  async function reloadExtensions() {
    pendingReload = true
    await extensionManager.reloadExtensions()
    pendingReload = false
  }

  function getSettingValue(key, settingKey, defaultValue) {
    return settings.extensionsNew[key]?.settings?.[settingKey] ?? defaultValue ?? ''
  }

  function setSettingValue(key, setKey, value) {
    if (!settings.extensionsNew[key]) return
    if (!settings.extensionsNew[key].settings) settings.extensionsNew[key].settings = {}
    settings.extensionsNew[key].settings[setKey] = value
    updateExtensionSettings(key)
  }

  function toggleSettings(key) {
    const visible = viewSettings[key]
    viewSettings = {}
    if (!visible) viewSettings[key] = true
  }
</script>

<h4 class='mb-10 font-weight-bold'>Content Settings</h4>
<SettingCard title='Auto-Select Torrents' description='Automatically selects torrents based on quality and amount of seeders. Disable this to have more precise control over played torrents.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='rss-autoplay' bind:checked={settings.rssAutoplay} />
    <label for='rss-autoplay'>{settings.rssAutoplay ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Auto-Select Files' description='Automatically selects the requested file when clicking the desired episode if it already exists in the batch or if you already have the torrent file before prompting the torrent selection. With this setting enabled you may get unexpected results if the video file(s) fail to determine what media is playing. Disable this to always be prompted to select a torrent regardless of what you already downloaded or is in the current batch.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='rss-autofile' bind:checked={settings.rssAutofile} />
    <label for='rss-autofile'>{settings.rssAutofile ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Auto-Scrape Results' description={'Automatically scrapes seeder and leecher counts when fetching extension results for torrent selection. When enabled, you\'ll see accurate peer data but results may load slower (5-15 seconds). When disabled, results load instantly but show the counts reported by indexers, which may be outdated. You can always manually scrape using the "Scrape" button in the torrent menu to refresh peer data on demand.'}>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='rss-autoscrape' bind:checked={settings.torrentAutoScrape} />
    <label for='rss-autoscrape'>{settings.torrentAutoScrape ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Torrent Quality' description="What quality to use when trying to find torrents. None might rarely find less results than specific qualities. This doesn't exclude other qualities from being found like 4K or weird DVD resolutions.">
  <select class='form-control bg-dark mw-150 w-150 text-truncate' bind:value={settings.rssQuality}>
    <option value='1080' selected>1080p</option>
    <option value='720'>720p</option>
    <option value='540'>540p</option>
    <option value='480'>480p</option>
    <option value=''>Any</option>
  </select>
</SettingCard>
<SettingCard title='Torrent Order' description='Sorts the results by the preferred order. The auto-selected torrent will still consider your Preferred Audio setting.'>
  <select class='form-control bg-dark mw-150 w-150 text-truncate' bind:value={settings.torrentSort}>
    <option value='seeders' selected>Seeders</option>
    <option value='smallest' selected>Smallest</option>
    <option value='new' selected>Newest</option>
    <option value='old' selected>Oldest</option>
    <option value='batch' selected>Batch</option>
    <option value='best' selected>Best</option>
  </select>
</SettingCard>
<SettingCard title='Preferred Audio' description='Prioritizes results matching the preferred language, otherwise will default to Japanese. This language will be loaded automatically when the video is loaded.'>
  <select class='form-control bg-dark mw-220 w-220 text-truncate' bind:value={settings.audioLanguage}>
    <option value='eng'>English</option>
    <option value='jpn' selected>Japanese</option>
    <option value='chi'>Chinese</option>
    <option value='por'>Portuguese</option>
    <option value='spa'>Spanish (Spain)</option>
    <option value='lat'>Spanish (Latin America)</option>
    <option value='ger'>German</option>
    <option value='pol'>Polish</option>
    <option value='cze'>Czech</option>
    <option value='dan'>Danish</option>
    <option value='gre'>Greek</option>
    <option value='fin'>Finnish</option>
    <option value='fre'>French</option>
    <option value='hun'>Hungarian</option>
    <option value='ita'>Italian</option>
    <option value='kor'>Korean</option>
    <option value='dut'>Dutch</option>
    <option value='nor'>Norwegian</option>
    <option value='rum'>Romanian</option>
    <option value='rus'>Russian</option>
    <option value='slo'>Slovak</option>
    <option value='swe'>Swedish</option>
    <option value='ara'>Arabic</option>
    <option value='idn'>Indonesian</option>
  </select>
</SettingCard>
<SettingCard title='Preferred Providers' description='Prioritizes results matching the preferred providers. Providers are considered equally and used only when choosing the best available result.'>
  <div>
    {#each settings.torrentProvider as _, i}
      <div class='input-group mb-10 w-200 mw-full'>
        <input id='torrent-provider-{i}' type='text' list='torrent-provider-list-{i}' class='w-400 form-control mw-full bg-dark text-truncate' placeholder={'QuickSubs'} autocomplete='off' bind:value={settings.torrentProvider[i]} />
        <div class='input-group-append'>
          <button type='button' use:click={() => { settings.torrentProvider.splice(i, 1); settings.torrentProvider = settings.torrentProvider }} class='btn btn-danger btn-square input-group-append px-5 d-flex align-items-center'><Trash2 size='1.8rem' /></button>
        </div>
      </div>
    {/each}
    <button type='button' use:click={() => { settings.torrentProvider[settings.torrentProvider.length] = '' }} class='btn btn-primary mb-10 d-flex align-items-center justify-content-center'><span>Add Provider</span></button>
  </div>
</SettingCard>

<h4 class='mb-10 font-weight-bold'>Extension Settings</h4>
{#if $status !== 'offline' && Object.values(settings.extensionsNew).some(extension => extension?.enabled)}
  {@const loading = pendingReload || pendingSource || Object.entries(settings.extensionsNew).some(([key, extension]) => extension?.enabled && !$activeWorkers[key] && !$inactiveWorkers[key])}
  <div class='d-flex bg-dark-light rounded-3 p-4 mw-300 mb-5'>
    <button type='button' class='btn btn-primary w-full rounded-3 overflow-hidden d-flex align-items-center justify-content-center font-scale-16' disabled={loading} class:cursor-wait={loading} use:click={reloadExtensions}>
      <RefreshCw class='mr-10 {loading ? `spin` : ``}' size='1.8rem' />
      <span class='text-truncate'>{pendingReload ? 'Reloading Extensions...' : 'Reload Extensions'}</span>
    </button>
  </div>
{/if}
<div class='d-flex bg-dark-light rounded-3 p-4 mw-300 mb-20'>
  <button type='button' class='btn w-150 rounded-3 shadow-none border-0 overflow-hidden text-truncate font-scale-16 h-40' class:bg-primary={mainTab} class:bg-transparent={!mainTab} use:click={()=> { mainTab = true }}>Extensions</button>
  <button type='button' class='btn w-150 rounded-3 shadow-none border-0 overflow-hidden text-truncate font-scale-16 h-40' class:bg-primary={!mainTab} class:bg-transparent={mainTab} use:click={()=> { mainTab = false; viewSettings = {} }}>Sources</button>
</div>
{#if mainTab}
  <div class='wm-1200 w-full'>
    <div class='w-full d-flex flex-column mb-10'>
      {#if !Object.values(availableExtensions)?.length}
        <div class='card m-0 p-15 mb-10 solid-border bg-error'>
          <div class='d-flex'>
            <TriangleAlert size='4.3rem' />
            <div class='ml-10 mb-5 mb-md-0 select-text'>
              <div class='font-size-18 font-weight-bold'>No Extensions Installed</div>
              <div class='text-muted pre-wrap'>This is not a bug, extensions are not included by default. Visit the <u>Sources</u> tab to add an extension source.</div>
            </div>
          </div>
        </div>
      {:else}
        {#each Object.values(availableExtensions).sort((a, b) => (settings.extensionsNew[getKey(b)]?.enabled ? 1 : 0) - (settings.extensionsNew[getKey(a)]?.enabled ? 1 : 0)) as extension (getKey(extension))}
          {#if !extension?.nsfw || (settings.adult !== 'none')}
            {@const key = getKey(extension)}
            {@const enabled = settings.extensionsNew[key]?.enabled}
            {@const isActive = $activeWorkers[key]}
            {@const isInactive = $status !== 'offline' && $inactiveWorkers[key]}
            {@const extensionName = `${(extension?.name || extension?.id).slice(0, 25)}${extension?.name?.length > 25 ? '...' : ''}`}
            <div class='card m-0 p-15 mb-10 bg-dark-light border position-relative' style='border-color: {stringToHex(extension?.locale || [extension?.update].flat()[0])} !important' class:extension-disabled={!enabled} class:extension-error={enabled && isInactive}>
              {#if enabled && isInactive}
                <button class='btn position-absolute d-flex align-items-center justify-content-center border-0 p-0 z-10 bg-transparent icon-container' disabled={pendingSource} class:cursor-wait={pendingSource} data-toggle='tooltip' data-placement='right' data-title='Extension failed to validate. Click to retry.' use:click={() => validateExtension(key)}>
                  <div class='d-flex align-items-center justify-content-center error-indicator' style='color: var(--danger-color)'><TriangleAlert size='3.6rem' fill='var(--dark-color-light)'/></div>
                </button>
              {:else if enabled && !isActive}
                <div class='position-absolute d-flex align-items-center justify-content-center border-0 p-0 z-10 rounded-circle bg-transparent icon-container' class:cursor-wait={pendingSource} data-toggle='tooltip' data-placement='right' data-title='Extension is loading...'>
                  <div class='d-flex align-items-center justify-content-center loadingIcon'/>
                </div>
              {/if}
              <div class='d-flex'>
                {#if extension?.icon}
                  <img class='w-43 h-43' src={(!extension?.icon.startsWith('http') && !extension?.icon.startsWith('data:image') ? 'data:image/png;base64,' : '') + extension?.icon} alt={extensionName} title={extensionName}>
                {:else}
                  <FileQuestion size='4.3rem' />
                {/if}
                <div class='ml-10 mb-5 mb-md-0 w-full'>
                  <div class='d-flex'>
                    <div class='font-size-18 font-weight-bold d-flex align-items-center text-break-word select-text' title={extensionName}>
                      {extensionName}
                    </div>
                    <div class='d-flex ml-auto pl-10 align-items-center gap-10 h-20'>
                      {#if extension?.settings?.length}
                        <button type='button' class='btn d-flex align-items-center justify-content-center bg-transparent shadow-none border-0 p-0 h-20' class:text-primary={viewSettings[key]} data-toggle='tooltip' data-placement='top' data-title='Configure Extension Settings' use:click={() => toggleSettings(key)}><Settings size='2rem'/></button>
                      {/if}
                      {#if extension?.deprecated}
                        <div class='d-flex align-items-center' data-toggle='tooltip' data-placement='top' data-title='This extension is deprecated and no longer maintained' style='color: var(--warning-color)'><CircleAlert size='2rem'/></div>
                      {/if}
                      {#if settings.extensionsNew[key]}
                        <div class='custom-switch fit-content'>
                          <input type='checkbox' id={`extension-${key}`} bind:checked={settings.extensionsNew[key].enabled}
                            on:change={(event) => {
                              viewSettings = {}
                              if (event.target.checked) extensionManager.enableExtension(key)
                              else extensionManager.disableExtension(key)
                            }}
                          />
                          <label for={`extension-${key}`}><br/></label>
                        </div>
                      {/if}
                    </div>
                  </div>
                  {#if extension?.description}
                    <div class='text-muted pre-wrap text-break-word select-text'>
                      {@html parseSafeMarkdown(extension.description.slice(0, 500) + (extension.description.length > 500 ? '...' : ''))}
                    </div>
                  {/if}
                </div>
              </div>
              <div class='d-flex flex-wrap align-items-end select-text'>
                <span class='badge border-0 bg-light pl-10 pr-10 mr-10 mt-10 font-scale-16'>{extension?.version}</span>
                {#if extension?.type}<span class='badge border-0 bg-light pl-10 pr-10 mr-10 mt-10 font-scale-16'>{capitalize(extension?.type)}</span>{/if}
                {#if extension?.speed}<span class='badge border-0 bg-light pl-10 pr-10 mr-10 mt-10 font-scale-16' data-toggle='tooltip' data-placement='top' data-title='How quickly query results are received'>{capitalize(extension?.speed)}</span>{/if}
                {#if extension?.accuracy}<span class='badge border-0 bg-light pl-10 pr-10 mr-10 mt-10 font-scale-16'  data-toggle='tooltip' data-placement='top' data-title='How accurate the query results are'>{capitalize(extension?.accuracy)} Accuracy</span>{/if}
                {#if extension?.nsfw} <div class='d-flex align-items-center' title='Query results include adult content'><Adult class='mt-10' size='2.2rem' /></div>{/if}
              </div>
              {#if extension?.settings?.length && viewSettings[key]}
                <div transition:slide={{ duration: 250, axis: 'y' }}>
                  <div class='pt-15'>
                    <div class='bt-10 pt-15 mx-5'>
                      {#each extension.settings as field, index}
                        {@const fieldKey = field.key.slice(0, 100)}
                        {@const fieldDefault = Array.isArray(field.default) ? field.default.map(value => typeof value === 'string' ? value.slice(0, 100) : value) : typeof field.default === 'string' ? field.default.slice(0, 100) : field.default}
                        <div class='d-flex flex-column flex-md-row align-items-md-center justify-content-between' class:mb-15={index < extension.settings.length - 1}>
                          <div class='mr-md-80 mb-5 mb-md-0'>
                            <label class='font-weight-semi-bold font-scale-16 mb-0 select-text cursor-text' for='ext-setting-{key}-{fieldKey}'>
                              {@html parseSafeMarkdown(field.label.slice(0, 35) + (field.label.length > 35 ? '...' : ''))}
                              {#if field.required}<span class='text-danger ml-5'>*</span>{/if}
                            </label>
                            {#if field.description}
                              <div class='text-muted font-scale-14 select-text'>
                                {@html parseSafeMarkdown(field.description.slice(0, 300) + (field.description.length > 300 ? '...' : ''))}
                              </div>
                            {/if}
                          </div>
                          {#if field.type === 'text'}
                            <input
                                id='ext-setting-{key}-{fieldKey}'
                                type={field.secret ? 'password' : 'text'}
                                class='form-control bg-dark mw-0 wm-350'
                                placeholder={field.placeholder ? field.placeholder.slice(0, 120) + (field.placeholder.length > 120 ? '...' : '') : ''}
                                value={getSettingValue(key, fieldKey, fieldDefault)}
                                required={field.required && !getSettingValue(key, fieldKey, fieldDefault)}
                                on:input={event => setSettingValue(key, fieldKey, event.target.value)}
                            />
                          {:else if field.type === 'toggle'}
                            <div class='custom-switch fit-content'>
                              <input
                                  type='checkbox'
                                  id='ext-setting-{key}-{fieldKey}'
                                  checked={getSettingValue(key, fieldKey, fieldDefault ?? false)}
                                  on:change={event => setSettingValue(key, fieldKey, event.target.checked)}
                              />
                              <label for='ext-setting-{key}-{fieldKey}'>{getSettingValue(key, fieldKey, fieldDefault ?? false) ? 'On' : 'Off'}</label>
                            </div>
                          {:else if field.type === 'dropdown'}
                            <select
                                id='ext-setting-{key}-{fieldKey}'
                                class='form-control bg-dark text-truncate w-auto wm-300 align-self-start'
                                on:change={event => setSettingValue(key, fieldKey, event.target.value)}>
                              {#each field.options as option}
                                <option value={option.value.slice(0, 100)} selected={getSettingValue(key, fieldKey, fieldDefault) === option.value.slice(0, 100)}>{option.label.slice(0, 50)}</option>
                              {/each}
                            </select>
                          {:else if field.type === 'multiselect'}
                            {@const currentValues = (getSettingValue(key, fieldKey, fieldDefault ?? []) ?? [])}
                            <div class='d-flex flex-column align-self-start'>
                              {#each currentValues as selected, i}
                                <div class='input-group mb-10'>
                                  <select
                                      id='ext-setting-{key}-{fieldKey}-{i}'
                                      class='form-control bg-dark text-truncate w-auto wm-300 align-self-start'
                                      on:change={event => {
                                        const current = [...currentValues]
                                        current[i] = event.target.value
                                        setSettingValue(key, fieldKey, current)}}>
                                    {#each (field.options ?? []).filter(option => { const value = option.value.slice(0, 100); return !currentValues.some((_v, _i) => _i !== i && _v === value) }) as option}
                                      <option value={option.value.slice(0, 100)} selected={selected === option.value.slice(0, 100)}>{option.label.slice(0, 50)}</option>
                                    {/each}
                                  </select>
                                  <div class='input-group-append'>
                                    <button
                                        type='button'
                                        class='btn btn-danger btn-square input-group-append px-5 d-flex align-items-center'
                                        on:click={() => {
                                          const current = [...currentValues]
                                          current.splice(i, 1)
                                          setSettingValue(key, fieldKey, current)
                                        }}>
                                      <Trash2 size='1.8rem' />
                                    </button>
                                  </div>
                                </div>
                              {/each}
                              <button
                                  type='button'
                                  disabled={(field.options ?? []).every(option => currentValues.includes(option.value.slice(0, 100)))}
                                  class='btn btn-primary mb-10 d-flex align-items-center justify-content-center'
                                  on:click={() => {
                                    const first = (field.options ?? []).find(option => !currentValues.includes(option.value.slice(0, 100)))
                                    if (first) setSettingValue(key, fieldKey, [...currentValues, first.value.slice(0, 100)])
                                  }}>
                                <span>Add Option</span>
                              </button>
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  </div>
{:else}
  <div class='alert bg-warning border-warning-dim text-warning-very-dim wm-1200 p-10 pl-15 mb-5 d-flex'>
    <TriangleAlert size='1.8rem' />
    <span class='ml-10 select-text'>Extensions are sandboxed and should be safe from attacks, but it is not recommended to add <u>unknown</u> or <u>untrusted</u> extensions.</span>
  </div>
  {#if failedSource}
    <div class='alert bg-error border-error-light wm-1200 p-10 pl-15 mb-5 d-flex'>
      <CircleX size='1.8rem' />
      <span class='ml-10 select-text'>{failedSource}</span>
    </div>
  {/if}
  <div class='input-group wm-1200 mb-20'>
    <input placeholder='https://example.com/index.json, gh:user/repo, or npm:package_name' type='url' class='form-control bg-dark-light mw-full rounded-2 h-43 border text-truncate long-input' disabled={pendingSource} class:cursor-wait={pendingSource} bind:value={sourceUrl} />
    <button class='ml-10 btn btn-primary d-flex align-items-center justify-content-center rounded-2 w-200 h-43 font-scale-16' disabled={pendingSource || !sourceUrl?.length} class:cursor-wait={pendingSource} type='button' use:click={() => addSource()}><SquarePlus class='mr-10' size='1.8rem' /><span>Add Source</span></button>
  </div>
  <div class='wm-1200'>
    {#if Object.values(availableExtensions)?.length}
      {#each Object.entries(Object.values(availableExtensions).reduce((a, { update, locale }) => { if (!a[[update].flat()[0]]) a[[update].flat()[0]] = { count: 0, locale }; a[[update].flat()[0]].count += 1; return a }, {})).map(([host, { count, locale }]) => ({ host, count, locale })) as extension}
        <div class='d-flex align-items-center bg-dark-light border rounded-2 p-10 mb-10' style='border-color: {stringToHex(extension?.locale || extension?.host)} !important'>
          <div class='d-flex align-items-center ml-10'>
            {#if extension.locale}
              <Folder size='2.2rem' />
            {:else if extension.host?.startsWith('gh:')}
              <Github size='2.2rem' />
            {:else if extension.host?.startsWith('npm:')}
              <img class='rounded sourceIcon' src={npmIcon} alt='NPM' title='NPM'/>
            {:else}
              <FileQuestion size='2.2rem' />
            {/if}
          </div>
          <span class='font-weight-semi-bold ml-10 overflow-hidden text-truncate mr-5 font-scale-18 select-text'>{(extension.locale || extension.host).replace(VALID_SCHEMES, '').replace(/^\/+/, '')}</span>
          <span class='font-weight-semi-bold ml-auto text-muted text-nowrap text-truncate select-text'>{extension.count} Extensions</span>
          <ConfirmButton click={() => removeSource(extension.host)} title='Remove Source' class='btn btn-square d-flex align-items-center justify-content-center bg-transparent shadow-none border-0 {pendingSource ? `cursor-wait` : ``} text-danger' disabled={pendingSource} primaryClass='ml-10' confirmText='' cancelText='' confirmClass='btn-square text-success w-auto' cancelClass='ml-10 text-muted w-auto' actionClass='d-inline-flex flex-row-reverse'>
            <Trash2 size='1.8rem' />
          </ConfirmButton>
        </div>
      {/each}
    {/if}
  </div>
  {#if availableSources && Object.keys(availableSources)?.length}
    {@const addedSources = Object.keys(availableSources)}
    <div class='wm-1200'>
      {#each addedSources as sourceUrl, i}
        <div class='d-flex align-items-center bg-dark-light border rounded-2 p-10 mb-10'>
          <div class='d-flex align-items-center ml-10'>
            {#if sourceUrl.startsWith('extension:')}
              <Folder size='2.2rem' />
            {:else if sourceUrl.startsWith('gh:')}
              <Github size='2.2rem' />
            {:else if sourceUrl.startsWith('npm:')}
              <img class='rounded sourceIcon' src={npmIcon} alt='NPM' title='NPM'/>
            {:else}
              <FileQuestion size='2.2rem' />
            {/if}
          </div>
          <span class='font-weight-semi-bold ml-10 overflow-hidden text-truncate mr-5 font-scale-18 select-text'>{sourceUrl.replace(VALID_SCHEMES, '').replace(/^\/+/, '')}</span>
          <span class='font-weight-semi-bold ml-auto text-muted text-nowrap text-truncate select-text'>{availableSources[sourceUrl].length} Sources</span>
          <ConfirmButton click={() => removeSource(sourceUrl, true)} title='Remove Repository' class='btn btn-square d-flex align-items-center justify-content-center bg-transparent shadow-none border-0 {pendingSource ? `cursor-wait` : ``} text-danger' disabled={pendingSource} primaryClass='ml-10' confirmText='' cancelText='' confirmClass='btn-square text-success w-auto' cancelClass='ml-10 text-muted w-auto' actionClass='d-inline-flex flex-row-reverse'>
            <Trash2 size='1.8rem' />
          </ConfirmButton>
        </div>
      {/each}
    </div>
  {/if}
  {#if availableSources && Object.keys(availableSources)?.length}
    {@const missingSources = Object.values(availableSources).flat().filter(entry => !Object.values(availableExtensions).some(existing => [entry.main].flat().map(m => normalizeUrl(m)).includes(normalizeUrl([existing.update].flat()[0])))).map(entry => [entry.main].flat()[0])}
    {#if missingSources.length}
      <div class='wm-1200'>
        <button type='button' class='btn w-full h-full p-5 rounded-2 d-flex align-items-center long-button' class:bg-dark-light={!viewSources} class:bg-primary={viewSources} use:click={() => { viewSources = !viewSources }}>
          <span class='ml-10 text-truncate'>{missingSources.length} Available Source{missingSources.length > 1 ? 's' : ''}</span>
          <svelte:component this={ viewSources ? ChevronUp : ChevronDown } class='ml-auto mr-10' size='2.2rem' />
        </button>
      </div>
      {#if viewSources}
        <div class='wm-1200 mt-5'>
          {#each missingSources as source, i}
            <div class='d-flex align-items-center bg-dark-light border rounded-2 p-10 mb-10'>
              <div class='d-flex align-items-center ml-10'>
                {#if source.startsWith('extension:')}
                  <Folder size='2.2rem' />
                {:else if source.startsWith('gh:')}
                  <Github size='2.2rem' />
                {:else if source.startsWith('npm:')}
                  <img class='rounded sourceIcon' src={npmIcon} alt='NPM' title='NPM'/>
                {:else}
                  <FileQuestion size='2.2rem' />
                {/if}
              </div>
              <span class='font-weight-semi-bold ml-10 font-scale-18 select-text'>{source.replace(VALID_SCHEMES, '').replace(/^\/+/, '')}</span>
              <button type='button' use:click={() => { addSource(source); if (missingSources.length <= 1) viewSources = !viewSources }} class='btn btn-square d-flex align-items-center justify-content-center ml-10 bg-transparent shadow-none border-0 ml-auto' title='Add Source' style='color: var(--success-color)' disabled={pendingSource} class:cursor-wait={pendingSource}><SquarePlus size='1.8rem' /></button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
{/if}

<style>
  .w-43 {
    width: 4.3rem;
  }
  .h-43 {
    height: 4.3rem;
  }
  .mw-300 {
    max-width: 30rem;
  }
  .solid-border {
    border: .1rem solid;
  }
  .sourceIcon {
    width: 2.2rem;
    height: 2.2rem;
  }
  .loadingIcon {
    width: 25px;
    height: 25px;
    border: 3px solid transparent;
    border-top-color: var(--white-color);
    background: var(--dark-color-light) !important;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    transform-origin: 50% 50%;
  }
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  .extension-disabled {
    opacity: .4;
  }
  .extension-error {
    opacity: .7;
    background: var(--danger-color-very-dim) !important;
  }
  .icon-container {
    top: -1.2rem;
    left: -1.2rem;
  }
  .error-indicator {
    animation: wiggle 4s ease-in-out infinite;
    transition: filter 0.2s ease;
  }
  .error-indicator:hover {
    animation: attention 0.8s ease-in-out infinite;
  }
  .error-indicator:active {
    transform: scale(0.85) rotate(0deg);
  }
  @keyframes wiggle {
    0% { transform: rotate(0deg); }
    2% { transform: rotate(-15deg); }
    4% { transform: rotate(15deg); }
    6% { transform: rotate(-12deg); }
    8% { transform: rotate(12deg); }
    10% { transform: rotate(-8deg); }
    12% { transform: rotate(8deg); }
    14% { transform: rotate(0deg); }
    100% { transform: rotate(0deg); }
  }
  @keyframes attention {
    0%, 100% { transform: rotate(-18deg) scale(1.1); }
    25% { transform: rotate(18deg) scale(1.15); }
    50% { transform: rotate(-18deg) scale(1.1); }
    75% { transform: rotate(18deg) scale(1.15); }
  }
</style>