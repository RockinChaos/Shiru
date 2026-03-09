<script context='module'>
  import { settings } from '@/modules/settings.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { capitalize } from '@/modules/util.js'
  import { toast } from 'svelte-sonner'
  import { IPC, ANDROID, VERSION } from '@/modules/bridge.js'
  import Debug from 'debug'
  const debug = Debug('ui:settings-view')

  if (settings.value.enableDoH) IPC.emit('doh', settings.value.doHURL)
  export const platformMap = {
    aix: 'Aix',
    darwin: 'MacOS',
    android: 'Android',
    ios: 'iOS',
    freebsd: 'Linux',
    linux: 'Linux',
    openbsd: 'Linux',
    sunos: 'SunOS',
    win32: 'Windows'
  }
  export let version = '1.0.0'
  IPC.on('version', data => {
    version = data
    debug(`v${version} ${platformMap[VERSION.platform] || 'dev'} ${VERSION.arch || 'dev'} ${capitalize(VERSION.session) || ''}`, JSON.stringify(settings))
  })
  IPC.emit('version')
  IPC.emit('discord-rpc', settings.value.enableRPC)
  if (SUPPORTS.angle) settings.value.angle = await IPC.invoke('get:angle')
  if (SUPPORTS.isAndroid) setTimeout(() => requestFileAccess(settings.value.torrentPathNew), 2_500).unref?.()
  function requestFileAccess(path, cb) {
    if (path && path !== '/tmp') {
      const requestAccess = () => {
        ANDROID.requestFileAccess().then(access => {
          if (!access?.granted) toastAccess(access.error)
          else cb?.()
        })
      }
      const toastAccess = (error) => {
        toast.warning('Missing File Access', {
          description: error,
          duration: Infinity,
          onDismiss: () => requestAccess()
        })
      }
      requestAccess()
    }
  }
</script>

<script>
  import { Tabs, TabLabel, Tab } from '@/components/tabs/Tabination.js'
  import { onDestroy } from 'svelte'
  import PlayerTab from '@/routes/settings/tabs/PlayerTab.svelte'
  import ClientTab from '@/routes/settings/tabs/ClientTab.svelte'
  import InterfaceTab from '@/routes/settings/tabs/InterfaceTab.svelte'
  import AppTab from '@/routes/settings/tabs/AppTab.svelte'
  import ChangelogTab from '@/routes/settings/tabs/ChangelogTab.svelte'
  import ExtensionTab from '@/routes/settings/tabs/ExtensionTab.svelte'
  import TorrentPage from '@/routes/torrentManager/TorrentPage.svelte'
  import { status } from '@/modules/networking.js'
  import { modal } from '@/modules/navigation.js'
  import semver from 'semver'
  import { AppWindow, Puzzle, User, Heart, Logs, Play, Rss, Download, LayoutDashboard } from 'lucide-svelte'

  export let statusTransition = false

  const groups = {
    player: {
      name: 'Player',
      icon: Play
    },
    client: {
      name: 'Client',
      icon: Rss
    },
    torrents: {
      name: 'Torrents',
      icon: Download,
      substitute: true
    },
    interface: {
      name: 'Interface',
      icon: AppWindow
    },
    extensions: {
      name: 'Extensions',
      icon: Puzzle
    },
    login: {
      name: 'Profiles',
      icon: User,
      action: () => modal.open(modal.PROFILE),
    },
    app: {
      name: 'App',
      icon: LayoutDashboard
    },
    changelog: {
      name: 'Changelog',
      icon: Logs,
      sidebar: true
    },
    donate: {
      name: 'Donate',
      icon: Heart,
      action: () => IPC.emit('open', 'https://github.com/sponsors/RockinChaos/'),
      sidebar: true
    }
  }
  function pathListener (data) {
    if (SUPPORTS.isAndroid) requestFileAccess(data, () => $settings.torrentPathNew = data)
    else $settings.torrentPathNew = data
  }

  function playerListener (data) {
    $settings.playerPath = data
  }

  $: IPC.emit('discord-rpc', $settings.enableRPC)
  IPC.on('path', pathListener)
  IPC.on('player', playerListener)
  onDestroy(() => {
    IPC.off('path', pathListener)
    IPC.off('player', playerListener)
  })
</script>

<Tabs>
  <div class='d-flex w-full h-full position-relative settings root flex-md-row flex-column'>
    <div class='d-flex flex-column h-lg-full bg-dark position-absolute position-lg-relative bb-10 w-full w-lg-300 z-10 flex-lg-shrink-0 br-10' class:status-transition={statusTransition} class:pt-28px={!SUPPORTS.isAndroid && !$status.match(/offline/i)} class:pt-lg-28px={SUPPORTS.isAndroid && !$status.match(/offline/i)} class:pt-safe-area={SUPPORTS.isAndroid && !$status.match(/offline/i)}>
      <div class='px-20 py-5 font-size-24 font-weight-semi-bold position-absolute d-none d-lg-block'>Settings</div>
      <div class='mt-lg-20 py-lg-20 py-10 d-flex flex-lg-column flex-row justify-content-center justify-content-lg-start align-items-center align-items-lg-start'>
        {#each Object.values(groups) as group}
          <TabLabel name={group.name} action={group.action} sidebar={group.sidebar} substitute={group.substitute} let:active>
            {@const isActive = ((!$modal || !modal.length) && active) || (group.name === 'Profiles' && modal.focused === modal.PROFILE)}
            <svelte:component this={group.icon} size='3.6rem' stroke-width='2.5' class='flex-shrink-0 p-5 m-5 rounded' color={isActive ? 'currentColor' : 'var(--gray-color-very-dim)'} fill={group.icon === Play ? (isActive ? 'currentColor' : 'var(--gray-color-very-dim)') : 'transparent'} />
            <div class='font-size-16 line-height-normal d-none d-sm-block mr-10 text-truncate' style='color: {isActive ? `currentColor` : `var(--gray-color-very-dim)`}'>{group.name}</div>
          </TabLabel>
        {/each}
      </div>
      <div class='d-none d-lg-block mt-auto'>
        <p class='text-muted px-20 py-10 m-0'>Restart may be required for some settings to take effect.</p>
        <p class='text-muted px-20 pb-10 m-0'>If you don't know what settings do what, use defaults.</p>
        <p class='text-muted px-20 m-0 mb-lg-20'>{version ? `v${version} ${semver.prerelease(version) ? `(Nightly)` : ``}` : ``} {platformMap[VERSION.platform] || 'dev'} {VERSION.arch || 'dev'} {capitalize(VERSION.session) || ''}</p>
      </div>
    </div>
    <div class='mt-75 mt-lg-0 w-full overflow-y-auto overflow-y-md-hidden' class:status-transition={statusTransition} class:pt-28px={!SUPPORTS.isAndroid && !$status.match(/offline/i)} class:pt-lg-28px={SUPPORTS.isAndroid && !$status.match(/offline/i)} class:pt-safe-area={SUPPORTS.isAndroid && !$status.match(/offline/i)}>
      <div class='shadow-overlay d-lg-none' />
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='scroll-container'>
            <div class='page pb-100'>
              <PlayerTab bind:settings={$settings} />
            </div>
          </div>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='scroll-container'>
            <div class='page pb-100'>
              <ClientTab bind:settings={$settings} />
            </div>
          </div>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-15'>
          <div class='scroll-container'>
            <div class='page pb-100'>
              <TorrentPage />
            </div>
          </div>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='scroll-container'>
            <div class='page pb-100'>
              <InterfaceTab bind:settings={$settings} />
            </div>
          </div>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='scroll-container'>
            <div class='page pb-100'>
              <ExtensionTab bind:settings={$settings} />
            </div>
          </div>
        </div>
      </Tab>
      <Tab/> <!-- Skip Profile Tab -->
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='scroll-container'>
            <div class='page pb-100'>
              <AppTab {version} bind:settings={$settings} />
            </div>
          </div>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='scroll-container'>
            <div class='page pb-100'>
              <ChangelogTab {version} />
            </div>
          </div>
        </div>
      </Tab>
      <Tab/> <!-- Skip Donate Tab -->
    </div>
  </div>
</Tabs>

<style>
  .mt-75 {
    margin-top: 7.5rem;
  }
  .pb-100 {
    padding-bottom: 10rem;
  }
  .settings :global(select.form-control:invalid) {
    color: var(--dm-input-placeholder-text-color);
  }
  .settings :global(input:not(:focus):invalid) {
    box-shadow: 0 0 0 0.2rem var(--danger-color) !important;
  }
  .shadow-overlay {
    position: absolute;
    left: 0;
    right: 0;
    height: 1.2rem;
    box-shadow: 0 1.2rem 1.2rem var(--dark-color-dim);
    pointer-events: none;
    margin-top: -1.6rem;
    z-index: 1;
  }
  .bb-10 {
    border-bottom: .10rem var(--border-color-sp) solid !important;
  }
</style>