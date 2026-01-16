<script context='module'>
  import { click } from '@/modules/click.js'
  import { cache, caches } from '@/modules/cache.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { IPC, VERSION } from '@/modules/bridge.js'

  async function importSettings () {
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

  IPC.on('log-exported', detail => {
    if (detail.error) {
      toast.error('Log Not Saved', {
        description: 'Failed to save the log file to the selected location',
        duration: 10_000
      })
    } else {
      toast.success('Log Saved', {
        description: 'The log file has been saved to the selected location',
        duration: 5_000
      })
    }
  })
  IPC.on('log-reset', detail => {
    if (detail.success) {
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
</script>
<script>
  import { persisted } from 'svelte-persisted-store'
  import { capitalize, defaults } from '@/modules/util.js'
  import { onDestroy } from 'svelte'
  import { updateState } from '@/views/Updater/UpdateModal.svelte'
  import { platformMap } from '@/views/Settings/Settings.svelte'
  import SettingCard from '@/views/Settings/SettingCard.svelte'
  import Changelog from '@/views/Settings/Changelog.svelte'
  import WPC from '@/modules/wpc.js'
  import { copyToClipboard } from '@/modules/clipboard.js'
  import { toast } from 'svelte-sonner'
  import Debug from 'debug'
  const debugStore = persisted('debug', '', { serializer: { parse: e => e, stringify: e => e }})
  const debug = Debug('ui:app-settings')
  let debugPrev = null

  export let version = ''
  export let settings

  function resetSettings () {
    IPC.emit('set:angle', defaults.angle)
    cache.resetSettings()
  }

  function updateDebug (debug) {
    Debug.disable()
    if (debug) Debug.enable(debug)
    WPC.send('debug', debug)
  }

  $: updateDebug($debugStore)

  let unsubscribeDebug
  unsubscribeDebug = debugStore.subscribe(value => {
    if (value && debugPrev === '') setTimeout(() => debug('Current Settings: ', JSON.stringify(settings)))
    debugPrev = value
  })

  onDestroy(() => {
    unsubscribeDebug()
    IPC.off('device-info', writeAppInfo)
  })

  function writeAppInfo (info) {
    const deviceInfo = JSON.parse(info)
    deviceInfo.appInfo = {
      version,
      platform: VERSION.platform,
      userAgent: navigator.userAgent,
      support: SUPPORTS,
      settings
    }
    copyToClipboard(JSON.stringify(deviceInfo, null, 2), 'device info')
  }

  IPC.on('device-info', writeAppInfo)
</script>

<h4 class='mb-10 font-weight-bold'>App Settings</h4>
<SettingCard title='About This App' description="Restart may be required for some settings to take effect. If you don't know what settings do what, use defaults." class='d-lg-none'>
  <div class='d-flex flex-column'>
    <span class='text-nowrap'>{version ? `v${version}` : ``} {platformMap[VERSION.platform] || 'dev'} {VERSION.arch || 'dev'} {capitalize(VERSION.session) || ''}</span>
    <button type='button' use:click={() => { toast('Update is downloading...', { description: 'This may take a moment, the update will be ready shortly.' }) }} class='btn btn-primary mt-5 d-none align-items-center justify-content-center' style='background-color: var(--tertiary-color-light);' class:d-flex={$updateState === 'downloading'}><span class='text-truncate'>Update Downloading...</span></button>
    <button type='button' use:click={() => { $updateState = 'ready' }} class='btn btn-primary mt-5 d-none align-items-center justify-content-center bg-success-light' class:d-flex={$updateState === 'ready' || $updateState === 'ignored'}><span class='text-truncate'>Update Available!</span></button>
  </div>
</SettingCard>
{#if !SUPPORTS.isAndroid}
  <SettingCard title='Close Action' description='Choose the functionality of the close button for the app. You can choose to receive a Prompt to Minimize or Close, default to Minimize, or default to Closing the app.'>
    <div>
      <select class='form-control bg-dark mw-150 w-150 text-truncate' bind:value={settings.closeAction}>
        <option value='Prompt'>Prompt</option>
        <option value='Minimize'>Minimize</option>
        <option value='Close'>Close</option>
      </select>
    </div>
  </SettingCard>
{/if}
<SettingCard title='Query Complexity' description="Complex queries result in slower loading times but help in reducing the chances of hitting AniList's rate limit. Simple queries split up the requests into multiple queries which are requested as needed.">
  <div>
    <select class='form-control bg-dark mw-180 w-180 text-truncate' bind:value={settings.queryComplexity}>
      <option value='Complex'>Complex (slow)</option>
      <option value='Simple'>Simple (fast)</option>
    </select>
  </div>
</SettingCard>
<SettingCard title='Reset Notifications' description='Resets all notifications that have been cached, this is not recommended unless you are experiencing issues. This will also reset the last time you have been notified, so expect previous notifications to appear again.'>
  <button type='button' use:click={() => cache.resetNotifications()} class='btn btn-primary d-flex align-items-center justify-content-center' data-toggle='tooltip' data-placement='top' data-title='Resets Your Notifications Within The App'><span class='text-truncate'>Reset Notifications</span></button>
</SettingCard>
<SettingCard title='Reset History' description='Resets all history data that has been cached, this is not recommended unless you are experiencing issues. You will lose your local episode progress, subtitle choices, volume boost, and magnet links history.'>
  <button type='button' use:click={() => cache.resetHistory()} class='btn btn-primary d-flex align-items-center justify-content-center' data-toggle='tooltip' data-placement='top' data-title='Resets Your Episode Progress, Subtitle Choices, Volume Boost, Magnet Link History, Manually Corrected Series, and More'><span class='text-truncate'>Reset History</span></button>
</SettingCard>
<SettingCard title='Reset Caches' description='Resets everything the app has cached, this is not recommended unless you are experiencing issues. Caching speeds up load times and decreases down time. This does not reset the notifications or history cache. THIS WILL FORCE RESTART THE APP!'>
  <button type='button' use:click={() => cache.resetCaches()} class='btn btn-primary d-flex align-items-center justify-content-center' data-toggle='tooltip' data-placement='top' data-title='Resets All Cached Media And Queries... This Will Cause The App To Restart!'><span class='text-truncate'>Reset Caches</span></button>
</SettingCard>
<SettingCard title='Settings Management' description='Import saved settings from your clipboard, export your current configuration to back it up or share with others, and restore everything back to default values if needed. This is especially useful for syncing preferences across devices, sharing settings with friends, or starting fresh with recommended defaults.'>
  <div class='d-inline-flex flex-column'>
    <button use:click={importSettings} class='btn btn-primary d-flex align-items-center justify-content-center' type='button'><span class='text-truncate'>Import from Clipboard</span></button>
    <button use:click={() => copyToClipboard(JSON.stringify(cache.getEntry(caches.GENERAL, 'settings')), 'settings')} class='btn btn-primary mt-5 d-flex align-items-center justify-content-center' type='button'><span class='text-truncate'>Export to Clipboard</span></button>
    <button use:click={resetSettings} class='btn btn-danger mt-5 d-flex align-items-center justify-content-center' type='button' data-toggle='tooltip' data-placement='top' data-title='Restores All Settings Back To Their Recommended Defaults'><span class='text-truncate'>Reset to Defaults</span></button> <!--TODO: Add a prompt for the user  -->
  </div>
</SettingCard>

<h4 class='mb-10 font-weight-bold'>Debug Settings</h4>
<SettingCard title='Logging Levels' description='Enable logging of specific parts of the app.{!SUPPORTS.isAndroid ? ` These logs are saved to ${VERSION.platform === `win32` ? `%appdata%` : `~/config`}/Shiru/logs/main.log.` : ``}'>
  <select class='form-control bg-dark mw-150 w-150 text-truncate' bind:value={$debugStore}>
    <option value='' selected>None</option>
    <option value='*'>All</option>
    <option value='ui:*'>Interface</option>
    <option value='torrent:*'>Torrent</option>
    <option value='webtorrent:*,simple-peer,bittorrent-protocol,bittorrent-dht,bittorrent-lsd,torrent-discovery,bittorrent-tracker:*,ut_metadata,nat-pmp,nat-api'>WebTorrent</option>
    <option value='ui:*,torrent:*'>Full Stack</option>
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
  <button type='button' use:click={() => IPC.emit('get-device-info')} class='btn btn-primary d-flex align-items-center justify-content-center'><span class='text-truncate'>Copy To Clipboard</span></button>
</SettingCard>
{#if !SUPPORTS.isAndroid}
  <SettingCard title='Log Output' description='Export logs to a selection location or reset the log file. Once you enable a logging level you can use this to quickly get the created logs instead of navigating to the log file in directories.'>
    <div class='d-inline-flex flex-column'>
      <button type='button' use:click={() => IPC.emit('get-log-contents')} class='btn btn-primary d-flex align-items-center justify-content-center'><span class='text-truncate'>Export Logs</span></button>
      <button type='button' use:click={() => IPC.emit('reset-log-contents')} class='btn btn-danger mt-5 d-flex align-items-center justify-content-center'><span class='text-truncate'>Reset Logs</span></button>
    </div>
  </SettingCard>
  <SettingCard title='Open Torrent Devtools' description="Open devtools for the detached torrent process, this allows to inspect code execution and memory. DO NOT PASTE ANY CODE IN THERE, YOU'RE LIKELY BEING SCAMMED IF SOMEONE TELLS YOU TO!">
    <button type='button' use:click={() => IPC.emit('torrent-devtools')} class='btn btn-primary d-flex align-items-center justify-content-center'><span class='text-truncate'>Open Devtools</span></button>
  </SettingCard>
  <SettingCard title='Open UI Devtools' description="Open devtools for the UI process, this allows to inspect media playback information, rendering performance and more. DO NOT PASTE ANY CODE IN THERE, YOU'RE LIKELY BEING SCAMMED IF SOMEONE TELLS YOU TO!">
    <button type='button' use:click={() => IPC.emit('ui-devtools')} class='btn btn-primary d-flex align-items-center justify-content-center'><span class='text-truncate'>Open Devtools</span></button>
  </SettingCard>
{/if}
<Changelog {version} class='d-lg-none' />