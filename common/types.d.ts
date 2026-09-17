import type { SvelteComponentTyped } from 'svelte'

export {}

type Track = {
  selected: boolean
  enabled: boolean
  id: string
  kind: string
  label: string
  language: string
}

declare global {
  interface Window {
    torrent: {
      reload: () => void
      onCrash: (callback: () => void) => void
      onRequest: (callback: (updateVersion: any) => void) => void
      debug: (debug: any) => void
      rescan: () => Promise<{ missingCount: number, removedCount: number }>,
      scrape: (id: any, infoHashes: any) => Promise<any>
      stream: (id: any, hash: any, magnet: any, base64: any) => void
      stage: (id: any, hash: any) => void
      complete: (hash: any) => void
      unload: (data: any) => void
      untrack: (hash: any) => void
      reannounce: (hash: any) => void
      onStats: (callback: (data: any) => void) => void
      onFiles: (callback: (data: any) => void) => void
      onMagnet: (callback: (data: any) => void) => void
      onTracks: (callback: (data: any) => void) => void
      offTracks: () => void
      onSubtitles: (cbSubtitle: any, cbFont: any, cbFiles: any) => void
      offSubtitles: () => void
      onChapters: (callback: (data: any) => void) => void
      onProgress: (callback: (data: any) => void) => void
      onCurrentStats: (callback: (data: any) => void) => void
      onExternalReady: (callback: (data: any) => void) => void
      onExternalWatched: (callback: (data: any) => void) => void
      onAndroidExternal: (callback: (data: any) => void) => void
      onLoaded: (callback: (data: any) => void) => void
      onUntrack: (callback: (data: any) => void) => void
      onStage: (callback: (data: any) => void) => void
      onSeed: (callback: (data: any) => void) => void
      onComplete: (callback: (data: any) => void) => void
      onCompletedStats: (callback: (data: any) => void) => void
      setPlayback: (current: any, external: any) => void
      restoreSession: (staging: any, seeding: any, completed: any, current: any) => void
      launchExternal: (current: any) => void
      updateNetwork: (status: any) => void
      updateSettings: (settings: any) => void
      onNotify: (callback: (type: string, detail: any) => void) => void
      portRequest: (settings: any) => Promise<void>
    }
    common: {
      getAppVersion: () => Promise<string>
      getPlatformInfo: () => { platform: string; arch: string; flatpak: string | undefined; session: string; development: boolean; manualInstall: boolean }
      getDeviceInfo: () => Promise<any>
      exportLog: () => Promise<any>
      resetLog: () => Promise<any>
      notify: (opts: any) => void
      windowReady: () => void
      isWindowVisible: () => Promise<boolean>
      openURI: (uri: string) => Promise<any>
      pickFile: (title: string) => Promise<string>
      pickFolder: (title: string) => Promise<string>
      linkAccount: (uri: string) => Promise<any>
      handleProtocol: (data: any) => void
      setUpdateChannel: (channel: 'stable' | 'nightly') => void
      checkForUpdates: (channel: 'stable' | 'nightly') => void
      onUpdateAvailable: (callback: (updateVersion: any) => void) => void
      onUpdateDownloaded: (callback: (updateVersion: any) => void) => void
      onUpdateProgress: (callback: (progress: number) => void) => void
      onUpdateAborted: (callback: (aborted: boolean) => void) => void
      quitAndInstall: () => void
      onLobbyInvite: (callback: (link: string) => void) => void
      onRequestPage: (callback: (page: any) => void) => void
      onRequestModal: (callback: (modal: any, opts: any) => void) => void
      onProviderToken: (callback: (provider: any, opts: any) => void) => void
      onRequestPlay: (callback: (opts: any) => void) => void
    }
    android?: {
      minimize: () => void
      showSplash: () => void
      toast: (text: string, duration?: 'short' | 'long') => Promise<void>
      onBackButton: (callback: (event: any) => void) => void
      onAppStateChange: (callback: (isActive: boolean) => void) => Promise<{ remove: () => Promise<void> }>
      onPictureInPictureModeChanged: (callback: (isInPictureInPictureMode: boolean) => void) => Promise<{ remove: () => Promise<void> }>
      onMediaAction: (callback: (action: 'play' | 'pause' | 'last' | 'next' | 'seek', position?: number) => void) => Promise<{ remove: () => Promise<void> }>
      setMediaSession: (state: { active: boolean; playing?: boolean; title?: string; subtitle?: string; artwork?: string; position?: number; duration?: number; playbackRate?: number; hasLast?: boolean; hasNext?: boolean }) => Promise<void>
      exitPiP: () => void
      hideStatusBar: () => void
      setSystemStyle: (style: 'LIGHT' | 'DARK') => void
      requestFileAccess: () => Promise<{ granted: boolean; error?: string | null }>
      launchExternal: (url: string) => Promise<void>
    }
    electron?: {
      exit: () => void
      setDoH: (url: string) => void
      getAngle: () => Promise<string>
      setAngle: (angle: any) => void
      isMinimized: () => Promise<boolean>
      isFullScreen: () => Promise<boolean>
      onMinimize: (callback: (isMinimized: boolean) => void) => void
      onFullScreen: (callback: (isFullScreen: boolean) => void) => void
      hideWindow: () => void
      showAndFocus: () => void
      onExitIntent: (callback: () => void) => void
      openTorrentDevTools: () => void
      openDevTools: () => void
      setUnreadCount: (notificationCount: number) => void
      setDiscordRPC: (state: any) => void
      setPresence: (activity: any) => void
      clearPresence: () => void
      showTextContextMenu: (options: { editable: boolean; textField: boolean; hasSelection: boolean; canUndo: boolean; canRedo: boolean }) => void
      onSelectContextText: (callback: () => void) => void
      getYouTube: () => Promise<string>
    }
  }
  interface HTMLMediaElement {
    videoTracks: Track[]
    audioTracks: Track[]
  }

  interface ScreenOrientation {
    lock: Function
  }

  namespace svelteHTML {
    interface HTMLAttributes {
      'on:leavepictureinpicture'?: (
        event: Event<{
          target: EventTarget;
        }>
      ) => void;
    }
  }
}

declare module '*.svelte' {
  export default SvelteComponentTyped
}
