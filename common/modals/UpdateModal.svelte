<script context='module'>
  import { click } from '@/modules/click.js'
  import { writable } from 'simple-store-svelte'
  import { version } from '@/routes/settings/SettingsPage.svelte'
  import { TriangleAlert, ExternalLink, Flame, Sparkles, Info } from 'lucide-svelte'
  import { SUPPORTS } from '@/modules/support.js'
  import UpdatelogSk from '@/components/skeletons/UpdatelogSk.svelte'
  import SoftModal from '@/components/modals/SoftModal.svelte'
  import Changelog, { changeLog, latestVersion, updateChannel } from '@/routes/settings/components/Changelog.svelte'
  import { settings } from '@/modules/settings.js'
  import { page, modal } from '@/modules/navigation.js'
  import { createDeferred, uniqueStore } from '@/modules/util.js'
  import { IPC } from '@/modules/bridge.js'
  import { toast } from 'svelte-sonner'
  import semver from 'semver'

  export const updateState = writable('up-to-date')
  const updateVersion = writable()
  uniqueStore(updateChannel).subscribe(() => {
    updateState.set('up-to-date')
    updateVersion.set(null)
  })

  /**
   * Retrieves changelog data for a specific update version.
   * Finds previous version and collects nightly changes if applicable.
   * @param {string} updateVersion Version string to get changelog for
   * @returns {Promise<Object|null>} Changelog object with entry, previous version, and previous nightly changes
   */
  async function getChangelog(updateVersion) {
    const changelog = await changeLog.value
    if (!changelog?.length) return null
    const updateIndex = changelog.findIndex(entry => semver.valid(entry.version) === semver.valid(updateVersion))
    if (updateIndex === -1) return { entry: changelog[0], preVersion: null }
    const preStableIndex = changelog.findIndex((entry, index) => index > updateIndex && !semver.prerelease(entry.version))
    let nightlies = []
    if (semver.prerelease(updateVersion)) {
      if (changelog.findIndex(entry => semver.valid(entry.version) === semver.valid(version)) !== -1) {
        const nextStableIndex = changelog.findIndex((entry, index) => index > (updateIndex + 1) && !semver.prerelease(entry.version))
        if (nextStableIndex !== -1) nightlies = changelog.slice(updateIndex + 1, nextStableIndex).filter(entry => semver.prerelease(entry.version) && semver.eq(semver.coerce(entry.version), semver.coerce(updateVersion)))
      }
    }
    return {
      entry: changelog[updateIndex],
      preVersion: preStableIndex !== -1 ? changelog[preStableIndex].version : null,
      nightlies
    }
  }

  if (!SUPPORTS.isAndroid) {
    IPC.on('update-available', () => {
      if (updateState.value !== 'ready') updateState.value = 'downloading'
    })
  }
  IPC.on(SUPPORTS.isAndroid ? 'update-available' : 'update-downloaded', (version) => {
    if (updateState.value !== 'ignored' && latestVersion === version && updateVersion.value !== version && (!document.fullscreenElement || page.value !== page.PLAYER)) {
      updateVersion.set(version)
      updateState.value = 'ready'
      if (settings.value.systemNotify || SUPPORTS.isAndroid) {
        IPC.emit('notification', {
          title: 'Update Available!',
          message: `An update to v${version}${semver.prerelease(version) ? ' (Nightly)' : ''} ${SUPPORTS.isAndroid ? 'is available for download and installation' : 'has been downloaded and is ready for installation'}.`,
          button: [{ text: 'Update Now', activation: 'shiru://update/' }, { text: `What's New`, activation: 'shiru://changelog/' }],
          activation: {
            type: 'protocol',
            launch: 'shiru://show/'
          }
        })
      }
    }
  })

  const updateProgress = writable(0)
  IPC.on('update-progress', progress => updateProgress.set(progress))
  setTimeout(() => IPC.emit('update', updateChannel.value), 2_500).unref?.()
  setInterval(() => IPC.emit('update', updateChannel.value), 300_000).unref?.()
</script>
<script>
  $: $updateState === 'ready' && modal.open(modal.UPDATE_PROMPT)
  $: ($updateState === 'up-to-date' || $updateState === 'downloading') && close()
  $: updating = false
  $: isNightlyVersion = $updateVersion && semver.prerelease($updateVersion)
  let updatePromise = createDeferred()

  /**
   * Closes the update modal.
   * @param {boolean} ignored Whether update was explicitly ignored by user
   */
  function close(ignored = false) {
    if (updating) return
    if (ignored) $updateState = 'ignored'
    modal.close(modal.UPDATE_PROMPT)
  }

  /** Confirms and initiates the update installation process. */
  function confirm() {
    if (updating) return
    updating = true
    updatePromise = createDeferred()
    const id = toast.loading(SUPPORTS.isAndroid ? 'Downloading Update' : 'Preparing Update', { duration: Infinity, description: SUPPORTS.isAndroid ? 'Please wait while the latest version is downloaded...' : 'Please wait while the update is applied. The app will restart automatically...' })
    updatePromise.promise.then(() => {
      toast.success('Update Complete', {
        id, duration: 6_000, description: 'Update was successfully applied. The app will now restart...'
      })
    }).catch(() => {
      toast.error(SUPPORTS.isAndroid ? 'Update Aborted' : 'Update Failed', {
        id, duration: 15_000, description: SUPPORTS.isAndroid ? 'Update was not installed. The process was canceled or an error occurred.' : 'Something went wrong during the update process!'
      })
    })
    IPC.emit('quit-and-install')
  }

  IPC.on('update-aborted', (aborted) => {
    if (!updating) return
    updating = false
    $updateProgress = 0
    if (aborted) $updateState = 'aborted'
    updatePromise.reject()
  })

  const deliveryText = 'This update was delivered directly from the GitHub release. If you originally downloaded this app from F-Droid or IzzyOnDroid, note that updating through this method bypasses the extra review and screening normally conducted by those platforms.'
</script>

<SoftModal class='m-0 pt-0 d-flex flex-column rounded bg-very-dark scrollbar-none viewport-md-4-3 border-md w-full h-full rounded-10' css='z-105 m-0 p-0 modal-soft-ellipse' innerCss='m-0 p-0' showModal={$modal[modal.UPDATE_PROMPT]} close={() => {}} id={modal.UPDATE_PROMPT}>
  <div class='update-header bg-very-dark px-20 px-md-40 mt-md-15 mb-10 pb-15 border-bottom pt-safe-area' class:mt-15={!SUPPORTS.isAndroid}>
    <div class='text-muted w-full mt-20 mt-md-0 pt-safe-area'>
      <div class='d-flex align-items-center mb-10'>
        <Sparkles class='mr-15 text-white' size='3.6rem' strokeWidth='2'/>
        <div class='update-container'>
          <h3 class='font-weight-bold text-white font-scale-34 mb-0 d-flex align-items-center'>Update Available</h3>
          <div class='d-flex mt-5'>
            <span class='font-scale-18 text-muted'>v{$updateVersion}</span>
            <span class='badge nightly-badge ml-15 d-none align-items-center justify-content-center font-weight-semi-bold text-white font-scale-12' class:d-flex={isNightlyVersion}>
              <Flame size='1.4rem' class='mr-5'/>
              <span class=''>NIGHTLY</span>
            </span>
          </div>
        </div>
      </div>
      {#await getChangelog($updateVersion)}
        <div class='skeloader rounded w-120 h-20 bg-ske'/>
      {:then changelog}
        {#if changelog?.entry}
          <div class='font-size-14 text-muted'>{new Date(changelog.entry.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        {/if}
      {:catch e}
        <div class='skeloader rounded w-120 h-20 bg-ske'/>
      {/await}
    </div>
  </div>
  {#await getChangelog($updateVersion)}
    <UpdatelogSk {deliveryText} />
  {:then changelog}
    {@const isLesser = changelog?.preVersion && semver.lt(version, changelog.preVersion)}
    <div><div class='shadow-overlay'/></div>
    <div class='pt-10 px-20 px-md-40 overflow-y-auto'>
      {#if isNightlyVersion}
        <div class='nightly-box mb-20 p-15 rounded-2 d-flex align-items-start'>
          <TriangleAlert class='mr-10 flex-shrink-0' size='2rem' />
          <div>
            <strong class='d-block mb-5'>Nightly Build</strong>
            <div>This pre-release version may contain experimental features and bugs, use at your own risk. {!semver.prerelease(version) ? 'You are currently on a stable release, once updated you will not be able to downgrade.' : ''}</div>
            <div class='mt-10' class:d-none={!isLesser}>It looks like you're upgrading from an earlier version, consider checking out the <span class='custom-link' use:click={() => IPC.emit('open', 'https://github.com/RockinChaos/Shiru/releases')}>previous release notes</span></div>
          </div>
        </div>
      {/if}
      <div class='info-box p-15 rounded-2 d-none align-items-start' class:d-flex={!isNightlyVersion && isLesser}>
        <Info class='mr-10 flex-shrink-0' size='2rem' />
        <div class='upgrade-notice'>
          <strong class='d-block mb-5'>Upgrade Notice</strong>
          <span>It looks like you're upgrading from an earlier version, consider checking out the <span class='custom-link' use:click={() => IPC.emit('open', 'https://github.com/RockinChaos/Shiru/releases')}>previous release notes</span>.</span>
        </div>
      </div>
      <hr class='my-20' class:d-none={!isNightlyVersion && !isLesser}/>
      <span>Consider <span class='custom-link' use:click={() => IPC.emit('open', 'https://github.com/sponsors/RockinChaos')}>donating on GitHub</span> to help support future Shiru development.</span>
      <hr class='my-20'/>
      {#if changelog?.entry?.body?.trim().length}
        <div class='whats-new'>
          <h4 class='font-weight-bold text-white mb-15'>What's New</h4>
          <Changelog class='ml-10' body={changelog.entry.body} />
        </div>
      {/if}
      {#if changelog?.nightlies?.length > 0}
        <hr class='my-20'/>
        <div class='nightly-changes'>
          <h4 class='font-weight-bold text-white mb-15'>Nightly Changes</h4>
          <div class='cumulative-changes ml-10'>
            {#each changelog.nightlies as nightlyEntry}
              {#if nightlyEntry.body?.trim()}
                <Changelog body={nightlyEntry.body} />
              {/if}
            {/each}
          </div>
        </div>
      {/if}
      <div class='mt-10 mb-20'><span class='custom-link font-weight-bold d-flex' class:d-none={!changelog?.entry?.url} use:click={() => IPC.emit('open', changelog.entry.url)}>View on GitHub <ExternalLink class='ml-10' size='1.8rem' /></span></div>
      <div class='mt-30 mb-20 font-italic' class:d-none={!SUPPORTS.isAndroid}>{deliveryText}</div>
    </div>
  {:catch e}
    <UpdatelogSk {deliveryText} />
  {/await}
  <div class='mt-auto border-top px-40'>
    <div class='d-flex my-20 flex-column-reverse flex-md-row font-enlarge-14 gap-10'>
      <button class='btn btn-close font-weight-bold rounded-2 w-full py-10 h-auto py-md-2 w-md-auto px-md-30' type='button' disabled={updating} on:click={() => close(true)}>Not now</button>
      <button class='btn btn-secondary update-button position-relative overflow-hidden border-0 text-dark font-weight-bold ml-md-auto rounded-2 w-full py-10 h-auto py-md-2 w-md-auto px-md-30' type='button' disabled={updating} on:click={confirm} style={updating && $updateProgress > 0 ? `--update-progress: ${$updateProgress}%` : ''}>{SUPPORTS.isAndroid && $updateState !== 'aborted' ? (!updating ? 'Download' : 'Downloading...') : (!updating ? 'Update' : 'Updating...')}</button>
    </div>
  </div>
</SoftModal>

<style>
  @media (hover: hover) and (pointer: fine) {
    .btn-close:hover {
      background-color: var(--gray-color-light) !important;
    }
  }
  .gap-10 {
    gap: 1rem;
  }
  .update-button::before {
    content: '';
    position: absolute;
    z-index: -1;
    top: 0;
    left: 0;
    height: 100%;
    width: var(--update-progress, 0%);
    border-radius: inherit;
    background: var(--white-color-dim);
    transition: width .3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }
  .nightly-badge {
    border: none;
    letter-spacing: 0.08rem;
    background: linear-gradient(135deg, var(--octonary-color), var(--nonary-color));
  }
  .nightly-box {
    background: color-mix(in srgb, var(--octonary-color) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--octonary-color) 30%, transparent);
    color: var(--quindenary-color);
  }
  .info-box {
    background: color-mix(in srgb, var(--tertiary-color) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--tertiary-color) 30%, transparent);
  }
  .shadow-overlay {
    position: absolute;
    left: 0;
    right: 0;
    height: 1.4rem;
    margin-top: -2rem;
    box-shadow: 0 1.2rem 1rem var(--dark-color-dim);
    pointer-events: none;
    z-index: 1;
  }
</style>