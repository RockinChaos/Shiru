<script>
  import { click } from '@/modules/click.js'
  import { debounce, defaults } from '@/modules/util.js'
  import { IPC } from '@/modules/bridge.js'
  import { toast } from 'svelte-sonner'
  import { Eraser } from 'lucide-svelte'
  import ConfirmButton from '@/components/inputs/ConfirmButton.svelte'
  import ClampedNumber from '@/components/inputs/ClampedNumber.svelte'
  import SettingCard from '@/routes/settings/components/SettingCard.svelte'
  import { loadedTorrent, completedTorrents, seedingTorrents, stagingTorrents } from '@/modules/torrent.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { isTorBox } from '@/modules/backend.js'
  export let settings

  let trackers = settings.trackers.join('\n') || ''
  const updateTrackers = debounce((event) => {
    const newTrackers = [...new Set(event.target.value.split('\n').map(line => line.trim()).filter(Boolean))]
    if (JSON.stringify(settings.trackers) !== JSON.stringify(newTrackers)) {
      settings.trackers = newTrackers
    }
  }, 800)
  function configTrackers() {
    if (settings.configTrackers) return true
    else if (Object.entries(settings.extensionsNew).length || [...completedTorrents.value, ...seedingTorrents.value, ...stagingTorrents.value, loadedTorrent.value].some(Boolean)) {
      settings.configTrackers = true
      return true
    }
  }
</script>

{#if SUPPORTS.doh}
  <h4 class='mb-10 font-weight-bold'>DNS Settings</h4>
  <SettingCard title='Use DNS Over HTTPS' description='Enables DNS Over HTTPS, useful if your ISP blocks certain domains.'>
    <div class='custom-switch fit-content'>
      <input type='checkbox' id='rss-dohtoggle' bind:checked={settings.enableDoH} />
      <label for='rss-dohtoggle'>{settings.enableDoH ? 'On' : 'Off'}</label>
    </div>
  </SettingCard>
  <SettingCard title='DNS Over HTTPS URL' description='What URL to use for querying DNS Over HTTPS.'>
    <input type='url' class='form-control bg-dark w-300 mw-full text-truncate' bind:value={settings.doHURL} placeholder={defaults.doHURL} />
  </SettingCard>
{/if}

<h4 class='mb-10 font-weight-bold'>Client Settings</h4>
{#if isTorBox}
  <SettingCard title='TorBox API Key' description='Your TorBox API token, found in the TorBox web app under Settings. This build streams torrents through your TorBox account instead of downloading them peer-to-peer. Without a key, torrents cannot be loaded.'>
    <input type='password' autocomplete='off' spellcheck='false' class='form-control bg-dark w-300 mw-full text-truncate' bind:value={settings.torboxApiKey} placeholder='Paste your TorBox API key' />
  </SettingCard>
{/if}
<SettingCard title='Download Location' description={'Path to the folder used to store torrents. By default this is the TMP folder, which might lose data when your OS tries to reclaim storage.' + (SUPPORTS.isAndroid ? '\n\nIn Android, /sdcard/ is internal storage not external SD Cards and /storage/AB12-34CD/ is external storage not internal.' : '')}>
  <div class='input-group mw-100 w-400 flex-nowrap'>
    <div class='input-group-prepend'>
      <button type='button' use:click={() => IPC.emit('dialog')} class='btn btn-primary input-group-append d-flex align-items-center justify-content-center' title='Select a folder to store the torrents'><span>Select Folder</span></button>
    </div>
    {#if !SUPPORTS.isAndroid}
      <input type='url' class='form-control bg-dark mw-100 text-truncate' readonly bind:value={settings.torrentPathNew} placeholder='/tmp' />
    {:else}
      <input type='text' class='form-control bg-dark mw-100 text-truncate' bind:value={settings.torrentPathNew} disabled={true} placeholder='/tmp' />
    {/if}
    <div class='input-group-prepend'>
      <button type='button' use:click={() => { settings.torrentPathNew = undefined; if (SUPPORTS.isAndroid) toast.dismiss() }} disabled={!settings.torrentPathNew} class='btn btn-danger btn-square input-group-append px-5 d-flex align-items-center' title='Reset Location'><Eraser size='1.8rem' /></button>
    </div>
  </div>
</SettingCard>
<SettingCard title='Persist Files' description="Keeps torrents files instead of deleting them after a new torrent is played, this will quickly fill up your storage. Seeding Limit will be prioritized, once the limit is reached the files will be deleted if persist files is disabled. Queued torrents for pre-download will be automatically deleted if they are unable to seed and persist files is disabled.">
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='torrent-persist' bind:checked={settings.torrentPersist} />
    <label for='torrent-persist'>{settings.torrentPersist ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Streamed Download' description="Only downloads the single file that's currently being watched, instead of downloading an entire batch of episodes. Saves bandwidth and reduces strain on the peer swarm. Queued torrents for pre-download completely ignore this setting but will be paused until the current file being watched is fully downloaded.">
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='torrent-streamed-download' bind:checked={settings.torrentStreamedDownload} />
    <label for='torrent-streamed-download'>{settings.torrentStreamedDownload ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Transfer Speed Limit' description='Download/Upload speed limit for torrents, higher values increase CPU usage, and values higher than your storage write speeds will quickly fill up RAM.'>
  <div class='input-group w-100 mw-full'>
    <ClampedNumber bind:bindTo={settings.torrentSpeed} min={0.05} max={50} step={0.01} class='form-control text-right bg-dark'/>
    <div class='input-group-append'>
      <span class='input-group-text bg-dark'>MB/s</span>
    </div>
  </div>
</SettingCard>
<SettingCard title='Max Number of Connections' description='Number of peers per torrent. Higher values will increase download speeds but might quickly fill up available ports if your ISP limits the maximum allowed number of open connections.'>
  <ClampedNumber bind:bindTo={settings.maxConns} min={1} max={512} class='form-control text-right bg-dark mw-100 w-100 mw-full'/>
</SettingCard>
<SettingCard title='Seeding Limit' description={'The maximum number of torrents that can be seeded at the same time. The minimum is 1 as you will always be seeding at least one torrent (the currently loaded torrent). When the seeding limit is reached, the highest ratio torrent will be completed. Raising the seeding limit may increase memory usage, which can slow down or destabilize older systems or devices with limited resources.'}>
  <ClampedNumber bind:bindTo={settings.seedingLimit} min={1} max={SUPPORTS.maxSeeding} class='form-control text-right bg-dark mw-100 w-100 mw-full'/>
</SettingCard>
<SettingCard title='Torrent Port' description='Port used for Torrent connections. 0 is automatic.'>
  <ClampedNumber bind:bindTo={settings.torrentPort} min={0} max={65536} class='form-control text-right bg-dark mw-100 w-100 mw-full'/>
</SettingCard>
<SettingCard title='DHT Port' description='Port used for DHT connections. 0 is automatic.'>
  <ClampedNumber bind:bindTo={settings.dhtPort} min={0} max={65536} class='form-control text-right bg-dark mw-100 w-100 mw-full'/>
</SettingCard>
<SettingCard title='Disable DHT' description='Disables Distributed Hash Tables for use in private trackers to improve privacy. Might greatly reduce the amount of discovered peers.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='torrent-dht' bind:checked={settings.torrentDHT} />
    <label for='torrent-dht'>{settings.torrentDHT ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Disable PeX' description='Disables Peer Exchange for use in private trackers to improve privacy. Might greatly reduce the amount of discovered peers.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='torrent-pex' bind:checked={settings.torrentPeX} />
    <label for='torrent-pex'>{settings.torrentPeX ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Disable µTP' description='Disables the µTP (UDP-based) peer connection protocol. May improve stability on some networks but can reduce the number of available peers.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='torrent-utp' bind:checked={settings.torrentUTP} />
    <label for='torrent-utp'>{settings.torrentUTP ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Disable Auto-Load' description='Disables loading the previously downloaded torrent on startup. Allowing the previous torrent to auto-load can increase your bandwidth usage, its recommended to keep this disabled on Android. All seeding and pre-downloading torrents will be marked as completed.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='disable-torrent-autoload' bind:checked={settings.disableStartupTorrent} />
    <label for='disable-torrent-autoload'>{settings.disableStartupTorrent ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
{#if configTrackers()}
  <SettingCard title='Custom Trackers' description={'Configure tracker servers used for peer discovery and coordination of peer-to-peer connections for faster downloads. Enter one tracker URL per line (udp://, http://, https://, ws:// or wss://).\n\nChanges immediately apply to new torrents but a restart will be required for changes to take effect for existing torrents.'}>
    <div class='d-flex flex-column'>
        <span class='text-muted font-weight-semi-bold align-self-center'>
          {settings.trackers.length} Tracker{settings.trackers.length === 1 ? '' : 's'}
        </span>
      <textarea class='form-control w-md-500 w-full bg-dark hm-20' placeholder={defaults.trackers.join('\n') || ''} bind:value={trackers} on:input={(event) => { trackers = event.target.value; updateTrackers(event) }} />
      <ConfirmButton click={() => { settings.trackers = defaults.trackers; trackers = defaults.trackers.join('\n') || '' }} class='btn btn-secondary d-flex align-items-center justify-content-center mt-10 long-button' confirmText='Confirm Reset' actionClass='d-inline-flex'>
        <span class='text-truncate'>Reset to Defaults</span>
      </ConfirmButton>
    </div>
  </SettingCard>
{/if}