<script>
  import { click } from '@/modules/click.js'
  import { defaults } from '@/modules/util.js'
  import { IPC } from '@/modules/bridge.js'
  import { toast } from 'svelte-sonner'
  import { Eraser } from 'lucide-svelte'
  import ClampedNumber from '@/components/inputs/ClampedNumber.svelte'
  import SettingCard from '@/views/Settings/SettingCard.svelte'
  import { SUPPORTS } from '@/modules/support.js'
  export let settings
  function handleFolder () {
    IPC.emit('dialog')
  }
</script>

{#if SUPPORTS.doh}
  <h4 class='mb-10 font-weight-bold'>DNS Settings</h4>
  <SettingCard title='Use DNS Over HTTPS' description='Enables DNS Over HTTPS, useful if your ISP blocks certain domains.'>
    <div class='custom-switch'>
      <input type='checkbox' id='rss-dohtoggle' bind:checked={settings.enableDoH} />
      <label for='rss-dohtoggle'>{settings.enableDoH ? 'On' : 'Off'}</label>
    </div>
  </SettingCard>
  <SettingCard title='DNS Over HTTPS URL' description='What URL to use for querying DNS Over HTTPS.'>
    <input type='url' class='form-control bg-dark w-300 mw-full text-truncate' bind:value={settings.doHURL} placeholder={defaults.doHURL} />
  </SettingCard>
{/if}

<h4 class='mb-10 font-weight-bold'>Client Settings</h4>
<SettingCard title='Download Location' description={'Path to the folder used to store torrents. By default this is the TMP folder, which might lose data when your OS tries to reclaim storage.' + (SUPPORTS.isAndroid ? '\n\nIn Android, /sdcard/ is internal storage not external SD Cards and /storage/AB12-34CD/ is external storage not internal.' : '')}>
  <div class='input-group mw-100 w-400 flex-nowrap'>
    <div class='input-group-prepend'>
      <button type='button' use:click={handleFolder} class='btn btn-primary input-group-append d-flex align-items-center justify-content-center' title='Select a folder to store the torrents'><span>Select Folder</span></button>
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
  <div class='custom-switch'>
    <input type='checkbox' id='torrent-persist' bind:checked={settings.torrentPersist} />
    <label for='torrent-persist'>{settings.torrentPersist ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Streamed Download' description="Only downloads the single file that's currently being watched, instead of downloading an entire batch of episodes. Saves bandwidth and reduces strain on the peer swarm. Queued torrents for pre-download completely ignore this setting but will be paused until the current file being watched is fully downloaded.">
  <div class='custom-switch'>
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
  <div class='custom-switch'>
    <input type='checkbox' id='torrent-dht' bind:checked={settings.torrentDHT} />
    <label for='torrent-dht'>{settings.torrentDHT ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Disable PeX' description='Disables Peer Exchange for use in private trackers to improve privacy. Might greatly reduce the amount of discovered peers.'>
  <div class='custom-switch'>
    <input type='checkbox' id='torrent-pex' bind:checked={settings.torrentPeX} />
    <label for='torrent-pex'>{settings.torrentPeX ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Disable µTP' description='Disables the µTP (UDP-based) peer connection protocol. May improve stability on some networks but can reduce the number of available peers.'>
  <div class='custom-switch'>
    <input type='checkbox' id='torrent-utp' bind:checked={settings.torrentUTP} />
    <label for='torrent-utp'>{settings.torrentUTP ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Disable Auto-Load' description='Disables loading the previously downloaded torrent on startup. Allowing the previous torrent to auto-load can increase your bandwidth usage, its recommended to keep this disabled on Android. All seeding and pre-downloading torrents will be marked as completed.'>
  <div class='custom-switch'>
    <input type='checkbox' id='disable-torrent-autoload' bind:checked={settings.disableStartupTorrent} />
    <label for='disable-torrent-autoload'>{settings.disableStartupTorrent ? 'On' : 'Off'}</label>
  </div>
</SettingCard>