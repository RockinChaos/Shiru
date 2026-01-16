<script>
  import { persisted } from 'svelte-persisted-store'
  import { SUPPORTS } from '@/modules/support.js'
  import { ELECTRON, VERSION } from '@/modules/bridge.js'

  let fullScreen = false
  ELECTRON.isFullScreen().then(isFullScreen => {
    fullScreen = isFullScreen
    ELECTRON.onFullScreen((isFullScreen) => fullScreen = isFullScreen)
  })
  const debug = persisted('debug', '', { serializer: { parse: e => e, stringify: e => e } })
</script>

<div class='w-full z-101 navbar bg-transparent border-0 p-0 d-none draggable' class:d-flex={!SUPPORTS.isAndroid && !fullScreen} class:ml-sb={!SUPPORTS.isAndroid && (VERSION.platform !== 'darwin' || fullScreen)}>
  <div class='controls-container d-none position-absolute top-0 {VERSION.platform !== `darwin` ? `right-0 ${VERSION.platform === `win32` ? `right-width-win` : `right-width-linux`}` : `left-0 left-width`} h-full' class:mr-sb={!SUPPORTS.isAndroid && VERSION.platform !== 'darwin'} class:d-flex={!SUPPORTS.isAndroid && !fullScreen}/>
</div>
<div class='z-100 ribbon text-center position-absolute font-size-16 font-weight-bold pointer-events-none right-0' class:d-none={!$debug}>Debug Mode</div>

<style>
  .ribbon {
    transform: translate(29.3%) rotate(45deg);
    background: var(--accent-color);
    box-shadow: 0 0 0 10rem var(--accent-color);
    clip-path: inset(0 -100%);
    opacity: 0.6;
    min-width: 19rem;
    inset: 0 0 auto auto;
    transform-origin: 0 0;
  }
  .draggable {
    -webkit-app-region: drag;
    color: var(--dm-text-muted-color);
    font-size: 11.2px;
    width: calc(env(titlebar-area-width, 100%) - 1px);
  }
  .navbar {
    left: unset !important;
    --navbar-height: 28px !important;
  }
  @media (pointer: none), (pointer: coarse) {
    .navbar {
      display: none !important;
      height: 0;
    }
  }
  .controls-container {
    -webkit-app-region: no-drag;
    backdrop-filter: blur(8px);
    background: rgba(24, 24, 24, 0.2);
  }
  .ml-sb {
    margin-left: var(--sidebar-width);
  }
  .mr-sb {
    margin-right: var(--sidebar-width);
  }
  .right-width-win {
    width: 137px;
  }
  .right-width-linux {
    width: 97px;
  }
  .left-width {
    width: 67px;
    border-bottom-right-radius: var(--rounded-2-border-radius);
  }
</style>