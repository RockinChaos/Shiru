export type DebridMode = 'cached' | 'always' | 'manual'

export type DebridSettingField = {
  key: string
  label: string
  description?: string
  type: 'text' | 'secret' | 'select' | 'toggle'
  placeholder?: string
  options?: { value: string | number, label: string }[]
  defaultValue?: string | number | boolean
}

export type DebridProviderCapabilities = {
  cacheCheck: boolean
  userLibrary: boolean
  supportsTorrentFile: boolean
  supportsMagnet: boolean
  supportsUncached: boolean
}

export type DebridProviderMeta = {
  id: string
  name: string
  shortName: string
  description: string
  website: string
  apiKeyUrl?: string
  accentColor?: string
  capabilities: DebridProviderCapabilities
  settingsSchema?: DebridSettingField[]
}

export type DebridAccountInfo = {
  authenticated: boolean
  username?: string
  email?: string
  plan?: string
  isSubscribed?: boolean
  expiresAt?: string | null
  totalDownloaded?: number
  raw?: Record<string, any>
}

export type DebridCacheEntry = {
  hash: string
  cached: boolean
  providerId?: string
  providerName?: string
  name?: string
  size?: number
  files?: { id?: number | string, name: string, path?: string, size: number }[]
}

export type DebridResolvedFile = {
  id: string | number
  name: string
  path: string
  length: number
  streamUrl?: string | null
  headers?: Record<string, string>
}

export type DebridResolvedTorrent = {
  providerId: string
  providerName?: string
  torrentId: string | number
  infoHash: string
  name: string
  cached: boolean
  status: 'ready' | 'downloading' | 'queued' | 'error'
  progress: number
  files: DebridResolvedFile[]
}

export type DebridRequestFormEntry = {
  name: string
  value: string | Uint8Array
  encoding?: 'base64'
  filename?: string
  contentType?: string
}

export type DebridRequestOptions = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | { __formData: DebridRequestFormEntry[] }
  responseType?: 'json' | 'text' | 'arrayBuffer'
  timeout?: number
  signal?: AbortSignal
}

export type DebridResponse<T = any> = {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  data: T
}

export type DebridStreamPayload = {
  providerId: string
  providerName: string
  torrentId: string | number
  infoHash: string
  torrentName: string
  files: Array<{
    id: string | number
    name: string
    path: string
    length: number
    remoteUrl?: string | null
    headers?: Record<string, string>
  }>
}
