<script context='module'>
  import { click } from '@/modules/click.js'
  import { writable } from 'simple-store-svelte'
  import { version } from '@/views/Settings/Settings.svelte'
  import { BadgeAlert, ExternalLink } from 'lucide-svelte'
  import { SUPPORTS } from '@/modules/support.js'
  import ChangelogSk from '@/components/skeletons/ChangelogSk.svelte'
  import SoftModal from '@/components/SoftModal.svelte'
  import { changeLog, markdownToHtml } from '@/views/Settings/Changelog.svelte'
  import { settings } from '@/modules/settings.js'
  import { page } from '@/App.svelte'
  import { IPC } from '@/modules/bridge.js'
  import Debug from 'debug'
  const debug = Debug('ui:update-modal')

  export const updateState = writable('up-to-date')
  let latestLog
  const sanitizeVersion = (version) => ((version || '').match(/[\d.]+/g)?.join('') || '')
  async function getChangelog(version) {
    try {
      const json = await (await fetch(`https://api.github.com/repos/RockinChaos/Shiru/releases/tags/v${sanitizeVersion(version)}`)).json()
      return { version: json.tag_name, date: json.published_at, body: json.body, url: json.html_url }
    } catch (error) {
      debug('Failed to fetch changelog', error)
      return null
    }
  }

  let updateVersion
  if (!SUPPORTS.isAndroid) {
    IPC.on('update-available', () => {
      if (updateState.value !== 'ready') updateState.value = 'downloading'
    })
  }
  IPC.on(SUPPORTS.isAndroid ? 'update-available' : 'update-downloaded', async (version) => {
    if ((updateState.value !== 'ignored' && updateVersion !== version)) {
      if (!document.fullscreenElement || page.value !== 'player') {
        latestLog = getChangelog(version)
        updateVersion = version
        updateState.value = 'ready'
        if (settings.value.systemNotify || SUPPORTS.isAndroid) {
          IPC.emit('notification', {
            title: 'Update Available!',
            message: `An update to v${version} ${SUPPORTS.isAndroid ? 'is available for download and installation' : 'has been downloaded and is ready for installation'}.`,
            button: [{ text: 'Update Now', activation: 'shiru://update/' }, { text: `What's New`, activation: 'shiru://changelog/' }],
            activation: {
              type: 'protocol',
              launch: 'shiru://show/'
            }
          })
        }
      }
    }
  })
  setTimeout(() => IPC.emit('update'), 2500).unref?.()
  setInterval(() => IPC.emit('update'), 300000).unref?.()
</script>
<script>
  export let overlay

  $: $updateState === 'ready' && getChangeLogs() && setOverlay()
  $: ($updateState === 'up-to-date' || $updateState === 'ignored' || $updateState === 'downloading') && close()
  $: androidUpdating = false
  const defaultLogs = [{ version: '0.0.1', date: new Date().getTime(), body: '', url: 'https://github.com/RockinChaos/Shiru/releases/latest' }, { version: '0.0.1' }]
  let changeLogs = defaultLogs
  async function getChangeLogs() {
    changeLogs = (async () => {
      const changelog = await changeLog
      const latestlog = await latestLog
      return [latestlog || defaultLogs[0], changelog?.[sanitizeVersion(latestlog?.version) === sanitizeVersion(changelog?.[0]?.version) ? 1 : 0] || defaultLogs[1]]
    })()
  }

  function setOverlay() {
    if (!overlay.includes('updateRequest')) overlay = [...overlay, 'updateRequest']
  }
  function close(ignored = false) {
    if (androidUpdating) return
    if (ignored) $updateState = 'ignored'
    setTimeout(() => { if (overlay.includes('updateRequest')) overlay = overlay.filter(item => item !== 'updateRequest') })
  }
  function confirm() {
    if (androidUpdating) return
    if (SUPPORTS.isAndroid) androidUpdating = true
    IPC.emit('quit-and-install')
  }
  function compareVersions(currentVersion, previousVersion) {
    const a = sanitizeVersion(currentVersion).split('.').map(Number)
    const b = sanitizeVersion(previousVersion).split('.').map(Number)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const numA = a[i] || 0
      const numB = b[i] || 0
      if (numA > numB) return 1
      if (numA < numB) return -1
    }
    return 0
  }
</script>

<SoftModal class='m-0 pt-0 d-flex flex-column rounded bg-very-dark scrollbar-none viewport-md-4-3 border-md w-full h-full rounded-10' css='z-105 m-0 p-0' innerCss='m-0 p-0' showModal={$updateState === 'ready'} close={() => {}} id='updateModal'>
  <p class='mt-20 px-20 px-md-40 overflow-y-auto'>
    {#await changeLogs}
      <ChangelogSk />
    {:then changelogs}
      {@const isLesser = compareVersions(version, changelogs[1].version) < 0}
      <div class='row px-md-20 position-relative'>
        <div class='text-muted w-full mt-30 mt-md-0'>
          <h3 class='font-weight-bold text-white title font-scale-34 d-flex mb-5'><BadgeAlert class='mr-20 block-scale-43' strokeWidth='2'/> Update Available!</h3>
          <div class='font-scale-20'>{updateVersion} - {new Date(changelogs[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <hr class='my-20'>
          {#if isLesser}
            <div class='mt-20'>
              It looks like you're upgrading from an earlier version, consider checking out the <span class='custom-link' use:click={() => IPC.emit('open', 'https://github.com/RockinChaos/Shiru/releases')}>past release notes</span>.
            </div>
          {/if}
          <div class:mt-20={!isLesser}>
            Consider <span class='custom-link' use:click={() => IPC.emit('open', 'https://github.com/sponsors/RockinChaos')}>donating on GitHub</span> to help support future Shiru development.
          </div>
          <hr class='my-20'/>
          <h4 class='mt-0 font-weight-bold text-white' class:d-none={!changelogs[0].body.trim().length}>Changelog</h4>
          <div class='ml-10'>{@html markdownToHtml(changelogs[0].body)}</div>
        </div>
      </div>
      <div class='mt-20'><span class='custom-link font-weight-bold d-flex' use:click={() => IPC.emit('open', changelogs[0].url)}>View on GitHub <ExternalLink class='ml-10' size='1.8rem' /></span></div>
      {#if SUPPORTS.isAndroid}<div class='mt-20 font-italic'>This update was delivered directly from the GitHub release. If you originally downloaded this app from F-Droid or IzzyOnDroid, note that updating through this method bypasses the extra review and screening normally conducted by those platforms.</div>{/if}
    {:catch e}
      <ChangelogSk />
    {/await}
  </p>
  <div class='mt-auto border-top px-40'>
    <div class='d-flex my-20 flex-column-reverse flex-md-row font-enlarge-14'>
      <button class='btn btn-close mr-5 font-weight-bold rounded-2 w-full mt-10 mt-md-0 py-10 h-auto py-md-2 w-md-auto px-md-30' type='button' disabled={androidUpdating} on:click={() => close(true)}>Not now</button>
      <button class='btn btn-secondary text-dark font-weight-bold ml-md-auto rounded-2 w-full py-10 h-auto py-md-2 w-md-auto px-md-30' type='button' disabled={androidUpdating} on:click={confirm}>{SUPPORTS.isAndroid ? (!androidUpdating ? 'Download' : 'Downloading...') : 'Update'}</button>
    </div>
  </div>
</SoftModal>

<style>
  @media (hover: hover) and (pointer: fine) {
    .btn-close:hover {
      background-color: var(--gray-color-light) !important;
    }
  }
</style>