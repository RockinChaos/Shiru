<script context='module'>
  import { settings, debugStore } from '@/modules/settings.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { capitalize, debounce } from '@/modules/util.js'
  import { toast } from '@/modules/lib/toast.js'
  import { ANDROID, COMMON, ELECTRON } from '@/modules/bridge.js'
  import Debug from 'debug'
  const debug = Debug('ui:settings-view')

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
  const debounceRPC = debounce((state) => ELECTRON.setDiscordRPC(state), 100)
  COMMON.getAppVersion().then(_version => {
    version = _version
    debug(`v${version} ${platformMap[COMMON.getPlatformInfo().platform] || 'dev'} ${COMMON.getPlatformInfo().arch || 'dev'} ${capitalize(COMMON.getPlatformInfo().session) || ''}`, JSON.stringify(settings))
  })
  debounceRPC(settings.value.enableRPC)
  if (settings.value.enableDoH) ELECTRON.setDoH(settings.value.doHURL)
  if (SUPPORTS.angle) settings.value.angle = await ELECTRON.getAngle()
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
          id: 'missing-file-access',
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
  import PlayerTab from '@/routes/settings/tabs/PlayerTab.svelte'
  import ClientTab from '@/routes/settings/tabs/ClientTab.svelte'
  import InterfaceTab from '@/routes/settings/tabs/InterfaceTab.svelte'
  import AppTab from '@/routes/settings/tabs/AppTab.svelte'
  import ChangelogTab from '@/routes/settings/tabs/ChangelogTab.svelte'
  import ExtensionTab from '@/routes/settings/tabs/ExtensionTab.svelte'
  import { status } from '@/modules/networking.js'
  import { modal } from '@/modules/navigation.js'
  import semver from 'semver'
  import { AppWindow, Puzzle, User, Heart, Logs, Play, Rss, LayoutDashboard } from 'lucide-svelte'

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
      action: () => COMMON.openURI('https://contribute.shiru.app/'),
      sidebar: true
    }
  }

  $: debounceRPC($settings.enableRPC)
</script>
<!-- TODO: Remove usage of tabs in favor of native routing, add top navigation bar with search box for easily finding settings. -->

<Tabs>
  <div class='d-flex w-full h-full position-relative settings root flex-md-row flex-column'>
    <div class='tab-container bg-dark position-absolute position-lg-relative h-lg-full w-full w-lg-300 br-10 z-10 pb-1' class:status-transition={statusTransition} class:pt-28px={!SUPPORTS.isAndroid && $status === 'online'} class:pt-lg-28px={SUPPORTS.isAndroid && $status === 'online'} class:pt-safe-area={SUPPORTS.isAndroid && $status === 'online'}>
      <div class='d-flex flex-column flex-lg-shrink-0 h-lg-full w-full w-lg-300 bb-10'>
        <div class='px-20 py-5 font-size-24 font-weight-semi-bold position-absolute d-none d-lg-block'>Settings</div>
        <div class='mt-lg-20 py-lg-20 py-10 d-flex flex-lg-column flex-row justify-content-center justify-content-lg-start align-items-center align-items-lg-start'>
          {#each Object.values(groups) as group (group.name)}
            <TabLabel name={group.name} action={group.action} sidebar={group.sidebar} substitute={group.substitute} let:active>
              {@const isActive = ((!$modal || !modal.length) && active) || (group.name === 'Profiles' && modal.focused === modal.PROFILE)}
              <svelte:component this={group.icon} size='3.6rem' stroke-width='2.5' class='flex-shrink-0 p-5 m-5 rounded' color={isActive ? 'currentColor' : 'var(--gray-color-very-dim)'} fill={group.icon === Play ? (isActive ? 'currentColor' : 'var(--gray-color-very-dim)') : 'transparent'} />
              <div class='font-size-16 line-height-normal d-none d-sm-block mr-10' style='color: {isActive ? `currentColor` : `var(--gray-color-very-dim)`}'>{group.name}</div>
            </TabLabel>
          {/each}
        </div>
        <div class='d-none d-lg-block mt-auto select-text'>
          <p class='text-muted px-20 py-10 m-0'>Not sure what a setting does? Leave it as default. Some settings require the app to be restarted to take effect.</p>
          <p class='text-muted px-20 m-0 mb-lg-20'>{version ? `v${version} ${semver.prerelease(version) ? `(Nightly)` : ``}` : ``} {platformMap[COMMON.getPlatformInfo().platform] || 'dev'} {COMMON.getPlatformInfo().arch || 'dev'} {capitalize(COMMON.getPlatformInfo().session) || ''}</p>
        </div>
      </div>
    </div>
    <div class='mt-75 mt-lg-0 w-full overflow-y-auto overflow-y-md-hidden pr-notch-safe-area' class:status-transition={statusTransition} class:pt-28px={!SUPPORTS.isAndroid && $status === 'online'} class:scroll-container={!SUPPORTS.isAndroid && $status === 'online'} class:pt-safe-area={SUPPORTS.isAndroid && $status === 'online'}>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='page pb-100'>
            <PlayerTab bind:settings={$settings} />
          </div>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='page pb-100'>
            <ClientTab bind:settings={$settings} {requestFileAccess} />
          </div>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='page pb-100'>
            <InterfaceTab bind:settings={$settings} />
          </div>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='page pb-100'>
            <ExtensionTab bind:settings={$settings} />
          </div>
        </div>
      </Tab>
      <Tab/> <!-- Skip Profile Tab -->
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='page pb-100'>
            <AppTab {version} {debugStore} bind:settings={$settings} />
          </div>
        </div>
      </Tab>
      <Tab>
        <div class='root h-full w-full overflow-y-md-auto p-20 pt-5'>
          <div class='page pb-100'>
            <ChangelogTab {version} />
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
  .tab-container::before {
    content: '';
    position: absolute;
    bottom: -9px;
    left: 0;
    right: 0;
    height: 1.2rem;
    background: linear-gradient(to bottom, var(--dark-color), transparent);
    pointer-events: none;
    z-index: 100;
  }
  .scroll-container::before {
    content: '';
    position: absolute;
    top: 28px;
    left: 0;
    right: 0;
    height: 1.2rem;
    background: linear-gradient(to bottom, var(--dark-color), transparent);
    pointer-events: none;
  }
  .bb-10 {
    border-bottom: .10rem var(--border-color-sp) solid;
  }
  @media (min-width: 993px) {
    .bb-10 {
      border-bottom: none !important;
    }
  }
  @media (max-width: 992px) {
    .br-10 {
      border-right: none !important;
    }
  }
</style>
