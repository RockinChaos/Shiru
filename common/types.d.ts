import type { SvelteComponentTyped } from 'svelte'

export interface Torrent {
  infoHash: string
  name: string
  size: number
  current?: boolean
  staging?: boolean
  seeding?: boolean
  progress: number
  downloaded: number
  numSeeders: number
  totalSeeders: number
  numLeechers: number
  totalLeechers: number
  numPeers: number
  downloadSpeed: number
  uploadSpeed: number
  magnetURI?: string
  date: string
  incomplete?: boolean
  missing_pieces?: boolean
  eta?: number | null
  ratio: number
  pieces?: number[] | null
  cachedAt: number
}

/** Serializable file description returned when a torrent becomes playable. */
export interface TorrentFile {
  infoHash: string
  fileHash: string
  torrent_name: string
  name: string
  type: string
  size: number
  path: string
  url: string
}

/** Identifier persisted for the current torrent. */
export interface TorrentSource {
  id?: string | Uint8Array
  infoHash?: string
  local?: boolean
}

export interface TorrentTrack {
  number: number
  type: string
  header?: string
  name?: string
  language: string
  default: boolean
  forced: boolean
}

export interface TorrentChapter {
  start: number
  end: number
  text?: string
  language?: string
}

export interface TorrentUpdate {
  current?: TorrentSource & { stats?: Torrent }
  staging?: Torrent
  seeding?: Torrent
  completed?: Torrent
  untrack?: boolean
}

type TorrentReady = (files: TorrentFile[], magnet: { magnet: string; hash: string }) => void

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
      onRequest: (callback: (request: { magnet: string; base64?: boolean }) => void) => void
      debug: (debug: string) => Promise<void>
      rescan: () => Promise<{ missingCount: number, removedCount: number }>
      scrape: (infoHashes: string[]) => Promise<{ hash: string; complete: number; incomplete: number; downloaded?: number }[]>
      stream: (id: string | Uint8Array, hash?: string | false | null, magnet?: boolean | null, base64?: boolean, onReady?: TorrentReady) => Promise<Torrent | void>
      stage: (id: string | Uint8Array, hash?: string | false | null, base64?: boolean) => Promise<Torrent | void>
      complete: (hash: string) => Promise<void>
      unload: (data?: string | TorrentSource | { torrent: string; hash?: string | boolean } | null) => Promise<void>
      untrack: (hash: string) => Promise<void>
      reannounce: (hash: string) => Promise<void>
      subscribe: (notify: (level: string, message: string) => void, updateTorrent: (hash: string | null, update: TorrentUpdate) => void) => Promise<void>
      getTorrentStats: (infoHash: string) => Promise<(Omit<Torrent, 'pieces'> & { fileProgress: number }) | null>
      getDiskSpace: () => Promise<{ total: number, free: number }>
      getTracks: () => Promise<TorrentTrack[] | null>
      getChapters: () => Promise<TorrentChapter[] | null>
      onSubtitles: (cbSubtitle: (packet: { subtitle: any; trackNumber: number }) => void, cbFont: (font: { url: string }) => void, cbFiles: (file: { name: string; url: string }) => void | Promise<void>) => Promise<void | null>
      offSubtitles: () => Promise<void | null>
      setPlayback: (infoHash: string, path: string, external: boolean) => Promise<true | void>
      restoreSession: (staging: string[] | null, seeding: string[] | null, completed: string[] | null, current?: string | TorrentSource | null, onReady?: TorrentReady) => Promise<Torrent[]>
      launchExternal: (path: string, externalWatched?: () => void) => Promise<string | void>
      updateNetwork: (status: string) => Promise<void>
      updateSettings: (settings: Record<string, any>) => Promise<void>
      portRequest: (settings: Record<string, any>) => Promise<void>
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
      pickMediaFiles: () => Promise<{ paths?: string[]; torrents?: Uint8Array[] }>
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
      cacheFlushed: () => void
      onFlushCache: (callback: () => void) => void
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
