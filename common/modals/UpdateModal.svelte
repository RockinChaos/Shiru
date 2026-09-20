<script context='module'>
  import { click } from '@/modules/lib/click.js'
  import { writable } from 'simple-store-svelte'
  import { version } from '@/routes/settings/SettingsPage.svelte'
  import { TriangleAlert, CloudAlert, ExternalLink, Flame, Sparkles, Info } from 'lucide-svelte'
  import { SUPPORTS } from '@/modules/support.js'
  import UpdatelogSk from '@/components/skeletons/UpdatelogSk.svelte'
  import SoftModal from '@/components/modals/SoftModal.svelte'
  import ErrorCard from '@/components/cards/ErrorCard.svelte'
  import Changelog, { changeLog, latestVersion, updateChannel, getReleaseByTag } from '@/routes/settings/components/Changelog.svelte'
  import { settings } from '@/modules/settings.js'
  import { page, modal } from '@/modules/navigation.js'
  import { createDeferred, uniqueStore } from '@/modules/util.js'
  import { toast } from '@/modules/lib/toast.js'
  import { COMMON } from '@/modules/bridge.js'
  import semver from 'semver'

  export const updateState = writable('up-to-date')
  const updateVersion = writable()
  uniqueStore(updateChannel).subscribe(() => {
    updateState.set('up-to-date')
    updateVersion.set(null)
  })

  const platformInfo = COMMON.getPlatformInfo()
  const manualInstall = platformInfo.manualInstall ?? false

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
    let entry
    if (updateIndex === -1) {
      entry = await getReleaseByTag(updateVersion)
      if (!entry) return { entry: changelog[0], preVersion: null }
    } else entry = changelog[updateIndex]
    const preStableIndex = changelog.findIndex((e, index) => (updateIndex === -1 || index > updateIndex) && !semver.prerelease(e.version))
    let nightlies = []
    if (semver.prerelease(updateVersion)) {
      if (changelog.findIndex(e => semver.valid(e.version) === semver.valid(version)) !== -1) {
        const effectiveIndex = updateIndex === -1 ? -1 : updateIndex
        const nextStableIndex = changelog.findIndex((e, index) => index > (effectiveIndex + 1) && !semver.prerelease(e.version))
        if (effectiveIndex !== -1 && nextStableIndex !== -1) {
          nightlies = changelog.slice(effectiveIndex + 1, nextStableIndex).filter(e => semver.prerelease(e.version) && semver.eq(semver.coerce(e.version), semver.coerce(updateVersion)))
        }
      }
    }
    return {
      entry,
      preVersion: preStableIndex !== -1 ? changelog[preStableIndex].version : null,
      nightlies
    }
  }

  COMMON.onUpdateAvailable((version) => {
    if (!SUPPORTS.isAndroid && !manualInstall && updateState.value !== 'ready') updateState.value = 'downloading'
    if (SUPPORTS.isAndroid || manualInstall) updateReady(version)
  })
  COMMON.onUpdateDownloaded((version) => updateReady(version))
  function updateReady(version) {
    if (updateState.value !== 'ignored' && latestVersion === version && updateVersion.value !== version && (!document.fullscreenElement || page.value !== page.PLAYER)) {
      updateVersion.set(version)
      if (settings.value.updateVersion !== version) {
        updateState.value = 'ready'
        if (settings.value.systemNotify || SUPPORTS.isAndroid) {
          COMMON.notify({
            title: 'Update Available!',
            message: `An update to v${version}${semver.prerelease(version) ? ' (Nightly)' : ''} ${SUPPORTS.isAndroid || manualInstall ? 'is available for download and installation' : 'has been downloaded and is ready for installation'}.`,
            button: [{ text: 'Update Now', activation: 'shiru://update/' }, { text: `What's New`, activation: 'shiru://changelog/' }],
            activation: {
              type: 'protocol',
              launch: 'shiru://show/'
            }
          })
        }
      } else updateState.value = 'ignored'
    }
  }

  const updateProgress = writable(0)
  COMMON.onUpdateProgress((progress) => updateProgress.set(progress))
  setTimeout(() => COMMON.checkForUpdates(updateChannel.value), 2.5 * 1_000).unref?.()
  setInterval(() => COMMON.checkForUpdates(updateChannel.value), 30 * 60 * 1_000).unref?.()
</script>
<script>
  $: $updateState === 'ready' && modal.open(modal.UPDATE_PROMPT)
  $: ($updateState === 'up-to-date' || $updateState === 'downloading') && close()
  $: isNightlyVersion = $updateVersion && semver.prerelease($updateVersion)
  let updatePromise = createDeferred()
  let updating = false

  /**
   * Closes the update modal.
   * @param {boolean} ignored Whether update was explicitly ignored by user
   */
  function close(ignored = false) {
    if (updating) return
    if (ignored) {
      $updateState = 'ignored'
      $settings.updateVersion = updateVersion.value
    }
    modal.close(modal.UPDATE_PROMPT)
  }

  /** Confirms and initiates the update installation process. */
  function confirm() {
    if (updating) return
    updating = true
    updatePromise = createDeferred()
    const id = toast.loading(manualInstall ? 'Opening Download' : SUPPORTS.isAndroid ? 'Downloading Update' : 'Preparing Update', { duration: Infinity, description: manualInstall ? 'Opening the download page in your browser...' : SUPPORTS.isAndroid ? 'Please wait while the latest version is downloaded...' : 'Please wait while the update is applied. The app will restart automatically...', force: true })
    updatePromise.promise.then(() => {
      toast.success(manualInstall ? 'Download Opened' : 'Update Complete', {
        id,
        force: true,
        duration: 6_000,
        description: manualInstall ? 'The download page has been opened in your browser.' : 'Update was successfully applied. The app will now restart...'
      })
    }).catch(() => {
      toast.error(manualInstall ? 'Download Failed' : SUPPORTS.isAndroid ? 'Update Aborted' : 'Update Failed', {
        id,
        force: true,
        duration: 15_000,
        description: manualInstall ? 'Failed to open the download page.' : SUPPORTS.isAndroid ? 'Update was not installed. The process was cancelled or an error occurred.' : 'Something went wrong during the update process!'
      })
    })
    COMMON.quitAndInstall()
  }

  COMMON.onUpdateAborted((aborted) => {
    if (!updating) return
    updating = false
    $updateProgress = 0
    if (aborted) $updateState = 'aborted'
    updatePromise.reject()
  })

  const deliveryText = 'This update was delivered directly from the GitHub release. If you originally downloaded this app from F-Droid or IzzyOnDroid, note that updating through this method bypasses the extra review and screening normally conducted by those platforms.'
</script>

<SoftModal class='m-0 d-flex flex-column bg-very-dark scrollbar-none vp-md-wh-4-3 border-md w-full h-full rounded-md-10 p-md-mwh-safe-area' css='z-105 m-0 p-0 modal-soft-ellipse' innerCss='m-0 p-0' showModal={$modal[modal.UPDATE_PROMPT]} close={() => {}} id={modal.UPDATE_PROMPT}>
  <div class='update-header bg-very-dark px-20 px-md-40 mt-md-15 mb-1 pb-15 border-bottom' class:mt-15={!SUPPORTS.isAndroid}>
    <div class='text-muted w-full mt-20 mt-md-0'>
      <div class='d-flex align-items-center mb-10'>
        <Sparkles class='mr-15 text-white' size='3.6rem' strokeWidth='2'/>
        <div class='update-container'>
          <h3 class='font-weight-bold text-white font-scale-34 mb-0 d-flex align-items-center'>Update Available</h3>
          <div class='d-flex mt-5'>
            <span class='font-scale-18 text-muted select-text'>v{$updateVersion}</span>
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
        {#if changelog?.entry?.date}
          <div class='font-size-14 text-muted select-text'>{new Date(changelog.entry.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        {/if}
      {:catch}
        <div class='skeloader rounded w-120 h-20 bg-ske'/>
      {/await}
    </div>
  </div>
  {#await getChangelog($updateVersion)}
    <UpdatelogSk {deliveryText} />
  {:then changelog}
    {@const isLesser = changelog?.preVersion && semver.lt(version, changelog.preVersion)}
    <div class='pt-20 px-20 px-md-40 overflow-y-auto'>
      {#if isNightlyVersion}
        <div class='nightly-box mb-5 p-15 rounded-2 d-flex align-items-start'>
          <TriangleAlert class='mr-10 flex-shrink-0' size='2rem' />
          <div>
            <strong class='d-block mb-5'>Nightly Build</strong>
            <div class='select-text'>This pre-release version may contain experimental features and bugs, use at your own risk. {!semver.prerelease(version) ? 'You are currently on a stable release, once updated you will not be able to downgrade.' : ''}</div>
            <div class='mt-10 select-text' class:d-none={!isLesser}>It looks like you're upgrading from an earlier version, consider checking out the <span class='custom-link' use:click={() => COMMON.openURI(atob('aHR0cHM6Ly9yZWxlYXNlcy5zaGlydS5hcHAv'))}>previous release notes</span></div>
          </div>
        </div>
      {/if}
      <div class='info-box mb-5 p-15 rounded-2 d-none align-items-start' class:d-flex={!isNightlyVersion && isLesser}>
        <Info class='mr-10 flex-shrink-0' size='2rem' />
        <div class='upgrade-notice'>
          <strong class='d-block mb-5'>Upgrade Notice</strong>
          <span class='select-text'>It looks like you're upgrading from an earlier version, consider checking out the <span class='custom-link' use:click={() => COMMON.openURI(atob('aHR0cHM6Ly9yZWxlYXNlcy5zaGlydS5hcHAv'))}>previous release notes</span>.</span>
        </div>
      </div>
      {#if manualInstall}
        <div class='manual-install-box p-15 rounded-2 d-flex align-items-start'>
          <CloudAlert class='mr-10 flex-shrink-0' size='2rem' />
          <div>
            <strong class='d-block mb-5'>Manual Update Required</strong>
            {#if platformInfo.flatpak}
              <div>This app is running as a Flatpak, automatic updates are not supported directly in the app. You can manually download and install the new version directly from the releases page.</div>
            {:else if platformInfo.platform === 'darwin'}
              <div>Automatic updates are not supported on macOS at this time. You can manually download and install the new version directly from the releases page.</div>
            {/if}
          </div>
        </div>
      {/if}
      <hr class='my-20' class:d-none={!isNightlyVersion && !isLesser && !manualInstall}/>
      <span class='select-text'>Consider <span class='custom-link' use:click={() => COMMON.openURI('https://contribute.shiru.app/')}>donating on GitHub</span> to help support future Shiru development.</span>
      <hr class='my-20'/>
      {#if changelog?.entry?.body?.trim().length}
        <div class='whats-new'>
          <h4 class='font-weight-bold text-white mb-15'>What's New</h4>
          <Changelog class='ml-10' body={changelog.entry.body} />
        </div>
      {:else}
        <ErrorCard promise={{ errors: [{ message: 'changelog unavailable' }] }} containerClass='h-auto pt-60 {SUPPORTS.isAndroid ? `pb-60` : `pb-0`}' />
      {/if}
      {#if changelog?.nightlies?.length > 0}
        <hr class='my-20'/>
        <div class='nightly-changes'>
          <h4 class='font-weight-bold text-white mb-15'>Nightly Changes</h4>
          <div class='cumulative-changes ml-10'>
            {#each changelog.nightlies as nightlyEntry, nightlyIndex (nightlyIndex)}
              {#if nightlyEntry.body?.trim()}
                <Changelog body={nightlyEntry.body} />
              {/if}
            {/each}
          </div>
        </div>
      {/if}
      <div class='mt-10 mb-20'><span class='custom-link font-weight-bold d-none' class:d-flex={changelog?.entry?.url} use:click={() => COMMON.openURI(changelog.entry.url)}>View Release <ExternalLink class='ml-10' size='1.8rem' /></span></div>
      <div class='mt-30 mb-20 font-italic' class:d-none={!SUPPORTS.isAndroid}>{deliveryText}</div>
    </div>
  {:catch}
    <UpdatelogSk {deliveryText} />
  {/await}
  <div class='mt-auto border-top px-40'>
    <div class='d-flex my-20 flex-column-reverse flex-md-row font-enlarge-14 gap-10'>
      <button class='btn btn-close font-weight-bold rounded-2 w-full py-10 h-auto py-md-2 w-md-auto px-md-30' type='button' disabled={updating} on:click={() => close(true)}>Not now</button>
      <button class='btn btn-secondary update-button position-relative overflow-hidden border-0 text-dark font-weight-bold ml-md-auto rounded-2 w-full py-10 h-auto py-md-2 w-md-auto px-md-30' type='button' disabled={updating} on:click={confirm} style={updating && $updateProgress > 0 ? `--update-progress: ${$updateProgress}%` : ''}>{manualInstall ? 'Manually Download' : SUPPORTS.isAndroid && $updateState !== 'aborted' ? (!updating ? 'Download' : 'Downloading...') : (!updating ? 'Update' : 'Updating...')}</button>
    </div>
  </div>
</SoftModal>

<style>
  @media (hover: hover) and (pointer: fine) {
    .btn-close:hover {
      background-color: var(--gray-color-light) !important;
    }
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
  .manual-install-box {
    background: color-mix(in srgb, var(--quaternary-color) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--quaternary-color) 30%, transparent);
  }
  .info-box {
    background: color-mix(in srgb, var(--tertiary-color) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--tertiary-color) 30%, transparent);
  }
  .update-header {
    position: relative;
  }
  .update-header::after {
    content: '';
    position: absolute;
    bottom: -12px;
    left: 0;
    right: 0;
    height: 1.4rem;
    background: linear-gradient(to bottom, var(--dark-color-dim), transparent);
    pointer-events: none;
    z-index: 1;
  }
</style>
