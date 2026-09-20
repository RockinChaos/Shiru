<script context='module'>
  import { click } from '@/modules/lib/click.js'
  import { cache, caches } from '@/modules/cache.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { COMMON, ELECTRON, TORRENT } from '@/modules/bridge.js'
  import { toast } from '@/modules/lib/toast.js'

  async function importSettings() {
    try {
      const settings = JSON.parse(await navigator.clipboard.readText())
      await cache.write(caches.GENERAL, 'settings', settings)
      location.reload()
    } catch (error) {
      toast.error('Failed to import settings', {
        description: 'Failed to import settings from clipboard, make sure the copied data is valid JSON.',
        duration: 5_000
      })
    }
  }

  function exportLog() {
    COMMON.exportLog().then(({ error, cancelled = false }) => {
      if (error) {
        toast.error('Log Not Saved', {
          description: 'Failed to save the log file to the selected location',
          duration: 10_000
        })
      } else if (cancelled) {
        toast.warning('Log Not Saved', {
          description: 'The log file was not saved as the action was cancelled',
          duration: 5_000
        })
      } else {
        toast.success('Log Saved', {
          description: 'The log file has been saved to the selected location',
          duration: 5_000
        })
      }
    })
  }
  function resetLog() {
    COMMON.resetLog().then(({ success }) => {
      if (success) {
        toast.success('Logs Reset', {
          description: 'The log file has successfully been reset',
          duration: 5_000
        })
      } else {
        toast.error('Log Not Reset', {
          description: 'Failed to reset the log file',
          duration: 10_000
        })
      }
    })
  }
</script>
<script>
  import { capitalize, defaults } from '@/modules/util.js'
  import { onDestroy } from 'svelte'
  import { updateState } from '@/modals/UpdateModal.svelte'
  import { platformMap } from '@/routes/settings/SettingsPage.svelte'
  import SettingCard from '@/routes/settings/components/SettingCard.svelte'
  import { resetNotifications } from '@/modules/notification/manager.js'
  import ChangelogTab from '@/routes/settings/tabs/ChangelogTab.svelte'
  import ConfirmButton from '@/components/inputs/ConfirmButton.svelte'
  import { extensionManager } from '@/modules/extensions/manager.js'
  import { modal } from '@/modules/navigation.js'
  import { copyToClipboard } from '@/modules/lib/clipboard.js'
  import semver from 'semver'
  import Debug from 'debug'

  export let debugStore

  const debug = Debug('ui:app-settings')
  let debugPrev = null

  export let version = ''
  export let settings

  function resetSettings () {
    ELECTRON.setAngle(defaults.angle)
    cache.resetSettings()
  }

  function updateDebug (debug) {
    Debug.disable()
    if (debug) Debug.enable(debug)
    TORRENT.debug(debug)
  }

  $: updateDebug($debugStore)

  let unsubscribeDebug
  unsubscribeDebug = debugStore.subscribe(value => {
    if (value && debugPrev === '') setTimeout(() => debug('Current Settings: ', JSON.stringify(settings)))
    debugPrev = value
  })

  onDestroy(() => unsubscribeDebug())

  function writeAppInfo() {
    COMMON.getDeviceInfo().then(info => {
      const deviceInfo = info
      deviceInfo.appInfo = {
        version,
        platform: COMMON.getPlatformInfo().platform,
        userAgent: navigator.userAgent,
        support: SUPPORTS,
        settings
      }
      copyToClipboard(JSON.stringify(deviceInfo, null, 2), 'device info')
    })
  }
</script>

<h4 class='mb-10 font-weight-bold'>App Settings</h4>
<SettingCard title='About This App' description='Not sure what a setting does? Leave it as default. Some settings require the app to be restarted to take effect.' class='d-lg-none'>
  <div class='d-flex flex-column'>
    <span class='text-nowrap'>{version ? `v${version} ${semver.prerelease(version) ? `(Nightly)` : ``}` : ``} {platformMap[COMMON.getPlatformInfo().platform] || 'dev'} {COMMON.getPlatformInfo().arch || 'dev'} {capitalize(COMMON.getPlatformInfo().session) || ''}</span>
    <button type='button' use:click={() => { toast.info('Update is downloading...', { description: 'This may take a moment, the update will be ready shortly.' }) }} class='btn btn-primary mt-5 d-none align-items-center justify-content-center' style='background-color: var(--tertiary-color-light);' class:d-flex={$updateState === 'downloading'}><span class='text-truncate'>Update Downloading...</span></button>
    <button type='button' use:click={() => { if ($updateState !== 'ready') updateState.set('ready'); else modal.open(modal.UPDATE_PROMPT) }} class='btn btn-primary mt-5 d-none align-items-center justify-content-center bg-success-light' class:d-flex={$updateState === 'ready' || $updateState === 'ignored' || $updateState === 'aborted'}><span class='text-truncate'>Update Available!</span></button>
  </div>
</SettingCard>
<SettingCard title='Update Channel' description={'Choose which type of updates you receive. Stable provides tested releases only, while Nightly includes frequent pre-release builds with the latest features and fixes but may include bugs.' + '\n\n' + 'Once you switch to Nightly and update you cannot downgrade back to the previous stable release. Nightly users automatically receive stable updates when available.'}>
  <div>
    <select class='form-control bg-dark mw-150 w-150 text-truncate' bind:value={settings.updateChannel}>
      <option value='stable'>Stable</option>
      <option value='nightly'>Nightly (Beta)</option>
    </select>
  </div>
</SettingCard>
{#if SUPPORTS.discord}
  <SettingCard title='Discord Rich Presence' description={'Enables the use of Discord rich presence to display app activity.' + '\n' + 'Full enables complete rich presence support showing anime details, limited reduces what is seen not showing the currently played anime and episode, disabled completely disables rich presence.'}>
    <select class='form-control bg-dark w-100 mw-full text-truncate' bind:value={settings.enableRPC}>
      <option value='full' selected>Full</option>
      <option value='limited'>Limited</option>
      <option value='disabled'>Disabled</option>
    </select>
  </SettingCard>
{/if}
{#if !SUPPORTS.isAndroid}
  <SettingCard title='Exit Action' description='Choose the functionality of the close button for the app. You can choose to receive a Prompt to Minimize or Exit, default to Minimize, or default to Exiting the app.'>
    <div>
      <select class='form-control bg-dark mw-150 w-150 text-truncate' bind:value={settings.closeAction}>
        <option value='Prompt'>Prompt</option>
        <option value='Minimize'>Minimize</option>
        <option value='Close'>Exit</option>
      </select>
    </div>
  </SettingCard>
{/if}
<SettingCard title='Offline Sync' description='When enabled, any changes made to your list while offline will be automatically synced to your profile when you reconnect. Disable this if you only want changes to be synced when you have an active connection.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='offline-sync' bind:checked={settings.offlineSync} />
    <label for='offline-sync'>{settings.offlineSync ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Query Complexity' description="Complex queries result in slower loading times but help in reducing the chances of hitting AniList's rate limit. Simple queries split up the requests into multiple queries which are requested as needed.">
  <div>
    <select class='form-control bg-dark mw-180 w-180 text-truncate' bind:value={settings.queryComplexity}>
      <option value='Complex'>Complex (slow)</option>
      <option value='Simple'>Simple (fast)</option>
    </select>
  </div>
</SettingCard>
<SettingCard title='Reset Notifications' description='Resets all notifications that have been cached, this is not recommended unless you are experiencing issues. This will also reset the last time you have been notified, so expect previous notifications to appear again.'>
  <ConfirmButton click={resetNotifications} class='btn btn-primary mt-5 d-flex align-items-center justify-content-center' confirmText='Confirm Reset' confirmClass='btn-danger-dim long-button' cancelClass='btn-secondary long-button' actionClass='d-inline-flex d-md-block' dataToggle='tooltip' dataPlacement='top' dataTitle='Resets Your Notifications Within The App'>
    <span class='text-truncate'>Reset Notifications</span>
  </ConfirmButton>
</SettingCard>
<SettingCard title='Reset History' description='Resets all history data that has been cached, this is not recommended unless you are experiencing issues. You will lose your local episode progress, subtitle choices, volume boost, and magnet links history.'>
  <ConfirmButton click={() => cache.resetHistory()} class='btn btn-primary mt-5 d-flex align-items-center justify-content-center' primaryClass='px-30' confirmText='Confirm Reset' confirmClass='btn-danger-dim long-button' cancelClass='btn-secondary long-button' actionClass='d-inline-flex d-md-block' dataToggle='tooltip' dataPlacement='top' dataTitle='Resets Your Episode Progress, Subtitle Choices, Volume Boost, Magnet Link History, Manually Corrected Series, and More'>
    <span class='text-truncate'>Reset History</span>
  </ConfirmButton>
</SettingCard>
<SettingCard title='Reset Extensions' description='Resets extension data that has been cached. The code reset will remove and refetched new code on next load, while the full reset permanently removes all added extensions. RESET CODE WILL FORCE RESTART THE APP!'>
  <div class='d-inline-flex flex-column mb-5'>
    <ConfirmButton click={() => cache.resetExtensions()} class='btn btn-primary d-flex align-items-center justify-content-center mt-5' primaryClass='px-30' confirmText='Confirm Code Reset' confirmClass='btn-danger-dim long-button' cancelClass='btn-secondary long-button' actionClass='d-inline-flex d-md-block' dataToggle='tooltip' dataPlacement='top' dataTitle='Clears cached extension code, which will be refetched on next load'>
      <span class='text-truncate'>Reset Code</span>
    </ConfirmButton>
    <ConfirmButton click={() => cache.resetExtensions(false).then(() => extensionManager.reloadExtensions().then(() => toast.success('Extensions Reset', { description: 'All previously added extensions and cached extension data has been successfully been reset!', duration: 5_000 })))} class='btn btn-danger d-flex align-items-center justify-content-center mt-5' primaryClass='px-30' confirmText='Confirm Full Reset' confirmClass='btn-danger-dim long-button' cancelClass='btn-secondary long-button' actionClass='d-inline-flex d-md-block' dataToggle='tooltip' dataPlacement='top' dataTitle='Permanently removes all added extensions and their data'>
      <span class='text-truncate'>Reset Extensions</span>
    </ConfirmButton>
  </div>
</SettingCard>
<SettingCard title='Reset Caches' description='Resets everything the app has cached, this is not recommended unless you are experiencing issues. Caching speeds up load times and decreases down time. This does not reset the extensions, notifications or history cache and it does not reset settings. THIS WILL FORCE RESTART THE APP!'>
  <ConfirmButton click={() => cache.resetCaches()} class='btn btn-primary mt-5 d-flex align-items-center justify-content-center' primaryClass='px-30' confirmText='Confirm Reset' confirmClass='btn-danger-dim long-button' cancelClass='btn-secondary long-button' actionClass='d-inline-flex d-md-block' dataToggle='tooltip' dataPlacement='top' dataTitle='Resets All Cached Media And Queries... This Will Cause The App To Restart!'>
    <span class='text-truncate'>Reset Caches</span>
  </ConfirmButton>
</SettingCard>
<SettingCard title='Settings Management' description='Import saved settings from your clipboard, export your current configuration to back it up or share with others, and restore everything back to default values if needed. This is especially useful for syncing preferences across devices, sharing settings with friends, or starting fresh with recommended defaults.'>
  <div class='d-inline-flex flex-column'>
    <button use:click={importSettings} class='btn btn-primary d-flex align-items-center justify-content-center' type='button'><span class='text-truncate'>Import from Clipboard</span></button>
    <button use:click={() => copyToClipboard(JSON.stringify(cache.getEntry(caches.GENERAL, 'settings')), 'settings')} class='btn btn-primary mt-5 d-flex align-items-center justify-content-center' type='button'><span class='text-truncate'>Export to Clipboard</span></button>
    <ConfirmButton click={() => resetSettings()} class='btn btn-danger mt-5 d-flex align-items-center justify-content-center' confirmText='Confirm Reset' confirmClass='btn-danger-dim long-button' cancelClass='btn-secondary long-button' actionClass='d-inline-flex d-md-block' dataToggle='tooltip' dataPlacement='top' dataTitle='Restores All Settings Back To Their Recommended Defaults'>
      <span class='text-truncate'>Reset to Defaults</span>
    </ConfirmButton>
  </div>
</SettingCard>

<h4 class='mb-10 font-weight-bold'>Debug Settings</h4>
<SettingCard title='Logging Levels' description='Enable logging of specific parts of the app.{!SUPPORTS.isAndroid ? ` These logs are saved to ${COMMON.getPlatformInfo().platform === `win32` ? `%appdata%` : `~/config`}/Shiru/logs/main.log.` : ``}'>
  <select class='form-control bg-dark mw-150 w-150 text-truncate' bind:value={$debugStore}>
    <option value='' selected>None</option>
    <option value='*'>All</option>
    <option value='ui:*'>Interface</option>
    <option value='net:*'>Network</option>
    <option value='torrent:*'>Torrent</option>
    <option value='webtorrent:*,simple-peer,bittorrent-protocol,bittorrent-dht,bittorrent-lsd,torrent-discovery,bittorrent-tracker:*,ut_metadata,nat-pmp,nat-api'>WebTorrent</option>
    <option value='ui:*,torrent:*,net:*'>Full Stack</option>
  </select>
</SettingCard>
<SettingCard title='Toast Levels' description='Changes what toasts are shown in the app, limiting what toasts are shown could be useful if an api is down to prevent spam.'>
  <select class='form-control bg-dark mw-220 w-220 text-truncate' bind:value={settings.toasts}>
    <option value='All' selected>All</option>
    <option value='Warnings / Successes'>Warnings / Successes</option>
    <option value='Errors'>Errors</option>
    <option value='None'>None</option>
  </select>
</SettingCard>
<SettingCard title='App and Device Info' description='Copy app and device debug info and capabilities, such as GPU information, GPU capabilities, version information and settings to clipboard.'>
  <button type='button' use:click={writeAppInfo} class='btn btn-primary d-flex align-items-center justify-content-center'><span class='text-truncate'>Copy To Clipboard</span></button>
</SettingCard>
<SettingCard title='Log Output' description='Export logs to a selection location or reset the log file. Once you enable a logging level you can use this to quickly get the created logs instead of navigating to the log file in directories.'>
  <div class='d-inline-flex flex-column'>
    <button type='button' use:click={exportLog} class='btn btn-primary d-flex align-items-center justify-content-center px-40'><span class='text-truncate'>Export Logs</span></button>
    <ConfirmButton click={resetLog} class='btn btn-danger mt-5 d-flex align-items-center justify-content-center' confirmText='Confirm Reset' confirmClass='btn-danger-dim long-button' cancelClass='btn-secondary long-button' actionClass='d-inline-flex d-md-block'>
      <span class='text-truncate'>Reset Logs</span>
    </ConfirmButton>
  </div>
</SettingCard>
{#if !SUPPORTS.isAndroid}
  <SettingCard title='Open Torrent Devtools' description="Open devtools for the detached torrent process, this allows to inspect code execution and memory. DO NOT PASTE ANY CODE IN THERE, YOU'RE LIKELY BEING SCAMMED IF SOMEONE TELLS YOU TO!">
    <button type='button' use:click={() => ELECTRON.openTorrentDevTools()} class='btn btn-primary d-flex align-items-center justify-content-center'><span class='text-truncate'>Open Devtools</span></button>
  </SettingCard>
  <SettingCard title='Open UI Devtools' description="Open devtools for the UI process, this allows to inspect media playback information, rendering performance and more. DO NOT PASTE ANY CODE IN THERE, YOU'RE LIKELY BEING SCAMMED IF SOMEONE TELLS YOU TO!">
    <button type='button' use:click={() => ELECTRON.openDevTools()} class='btn btn-primary d-flex align-items-center justify-content-center'><span class='text-truncate'>Open Devtools</span></button>
  </SettingCard>
{/if}
<ChangelogTab {version} class='d-lg-none' />
