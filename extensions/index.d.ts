export type Speed = 'fast' | 'moderate' | 'slow'

export type Accuracy = 'high' | 'medium' | 'low'

// Use this format when your index.json provides multiple extensions rather than defining a full source itself.
export type RepositoryIndex = RepositoryConfig[]

// This is each entry in a repository index.json array.
export interface RepositoryConfig {
    main: string | string[] // Path to the extension source. Supports 'gh:username/repo/path', 'npm:package-name', or a direct URL. Can be an array of URLs to try in order as fallbacks.
}

// This is each entry in your index.json array.
export interface SourceConfig {
    id: string // The more unique, the better.
    name: string // Max 16 characters
    version: string // Semantic Version (SemVer), e.g. 0.0.1
    main: string // This should be the path to the extension code respective to your manifest e.g. 'sources/my-extension' if your code is located under the sources folder and is called my-extension.js
    update: string | string[] // Path to the config file. Can be prefixed with: 'gh:' to load from a GitHub repository (e.g. 'gh:username/repo'), or 'npm:' to load from a npm package (e.g. 'npm:package-name'). Can be an array of URLs to try in order as fallbacks.
    nsfw?: boolean // Should be set to true if the source has a possibility of returning NSFW results e.g. Hentai
    unregulated?: boolean // Should be set to true if the source freely allows uploads without registration e.g. anonymous uploads (this increases security risks we should let users know this)
    type: 'torrent'
    speed?: Speed // Should be the best estimate on how quickly a fetch takes to complete the query, some sites are slow and see a lot of traffic. You should not consider your location relative to the host for speed, the speed should be an average of various locations of users.
    accuracy?: Accuracy // How likely the results are to be matching the requested series, 'high' should only be used if the results are a guaranteed match to the query.
    settings?: SourceSetting[] // Completely optional as you may not need any user configuration for your extension to function. Your extension settings will be accessible via this.settings
    deprecated?: false // Completely optional but should be set to true once an extension is planned to no longer be maintained or the extension source has shutdown.
    description?: string // Max 500 characters. Supports some markdown/html tags.
    icon?: string // URL or base64 encoded image that represents your source, it is suggested to use base64 encoding
}

export type SourceSetting = TextSetting | ToggleSetting | DropdownSetting | MultiSelectSetting

interface BaseSourceSetting {
    key: string // Unique key used to access the setting value in your extension via this.settings. Max 100 characters.
    label: string // Visual label to be displayed. Max 35 characters. Supports some markdown/html tags.
    description?: string // Optional description to be displayed. Max 300 characters. Supports some markdown/html tags.
}

export interface TextSetting extends BaseSourceSetting {
    type: 'text'
    secret?: boolean // If true, the input will be masked e.g. for API keys or passwords
    default?: string // Max 100 characters.
    required?: boolean // If true, will display a visual indicator that the input is required.
    placeholder?: string // Example text shown inside the input when empty. Max 120 characters.
}

export interface ToggleSetting extends BaseSourceSetting {
    type: 'toggle'
    default?: boolean // Defaults to false if not specified
}

export interface DropdownSetting extends BaseSourceSetting {
    type: 'dropdown'
    options: DropdownOption[] // Required, must have at least one option
    default?: string // Should match one of the option values. Max 100 characters.
}

export interface MultiSelectSetting extends BaseSourceSetting {
    type: 'multiselect'
    options: DropdownOption[] // Required, must have at least one option
    default?: string[] // Each value should match one of the option values. Max 100 characters per value.
}

export interface DropdownOption {
    label: string // Text shown in the dropdown. Max 50 characters.
    value: string // The value passed to your extension when this option is selected. Max 100 characters.
}

export interface TorrentResult {
    title: string
    link: string
    id?: number
    seeders: number
    leechers: number
    downloads: number
    accuracy?: Accuracy
    hash: string
    size: number
    date: Date
    type?: 'batch' | 'best' | 'alt'
}

export interface TorrentQuery {
    anilistId: number
    media: object
    mappingsA?: object
    mappingsE?: object
    anidbAid?: number
    anidbEid?: number
    tvdbAid?: number
    tvdbEid?: number
    imdbAid?: string
    mvdbAid?: number
    titles: string[]
    episode?: number
    episodeCount?: number
    resolution: '2160' | '1080' | '720' | '540' | '480' | ''
    exclusions: string[]
}

export type SearchFunction = (query: TorrentQuery, options?: {
    [key: string]: {
        type: 'string' | 'number' | 'boolean'
        description: string
        default: any
    }
}) => Promise<TorrentResult[]>

export class TorrentSource {
    single: SearchFunction
    batch: SearchFunction
    movie: SearchFunction
    validate: Promise<boolean>
}