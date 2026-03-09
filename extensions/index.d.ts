export type Speed = 'fast' | 'moderate' | 'slow'

export type Accuracy = 'high' | 'medium' | 'low'

export type ServerLocations = 'AF' | 'AX' | 'AL' | 'DZ' | 'AS' | 'AD' | 'AO' | 'AI' | 'AQ' | 'AG' | 'AR' | 'AM' | 'AW' | 'AU' | 'AT' | 'AZ' | 'BS' | 'BH' | 'BD' | 'BB' | 'BY' | 'BE' | 'BZ' | 'BJ' | 'BM' | 'BT' | 'BO' | 'BQ' | 'BA' | 'BW' | 'BV' | 'BR' | 'IO' | 'BN' | 'BG' | 'BF' | 'BI' | 'KH' | 'CM' | 'CA' | 'CV' | 'KY' | 'CF' | 'TD' | 'CL' | 'CN' | 'CX' | 'CC' | 'CO' | 'KM' | 'CG' | 'CD' | 'CK' | 'CR' | 'CI' | 'HR' | 'CU' | 'CW' | 'CY' | 'CZ' | 'DK' | 'DJ' | 'DM' | 'DO' | 'EC' | 'EG' | 'SV' | 'GQ' | 'ER' | 'EE' | 'ET' | 'FK' | 'FO' | 'FJ' | 'FI' | 'FR' | 'GF' | 'PF' | 'TF' | 'GA' | 'GM' | 'GE' | 'DE' | 'GH' | 'GI' | 'GR' | 'GL' | 'GD' | 'GP' | 'GU' | 'GT' | 'GG' | 'GN' | 'GW' | 'GY' | 'HT' | 'HM' | 'VA' | 'HN' | 'HK' | 'HU' | 'IS' | 'IN' | 'ID' | 'IR' | 'IQ' | 'IE' | 'IM' | 'IL' | 'IT' | 'JM' | 'JP' | 'JE' | 'JO' | 'KZ' | 'KE' | 'KI' | 'KR' | 'KP' | 'KW' | 'KG' | 'LA' | 'LV' | 'LB' | 'LS' | 'LR' | 'LY' | 'LI' | 'LT' | 'LU' | 'MO' | 'MK' | 'MG' | 'MW' | 'MY' | 'MV' | 'ML' | 'MT' | 'MH' | 'MQ' | 'MR' | 'MU' | 'YT' | 'MX' | 'FM' | 'MD' | 'MC' | 'MN' | 'ME' | 'MS' | 'MA' | 'MZ' | 'MM' | 'NA' | 'NR' | 'NP' | 'NL' | 'NC' | 'NZ' | 'NI' | 'NE' | 'NG' | 'NU' | 'NF' | 'MP' | 'NO' | 'OM' | 'PK' | 'PW' | 'PS' | 'PA' | 'PG' | 'PY' | 'PE' | 'PH' | 'PN' | 'PL' | 'PT' | 'PR' | 'QA' | 'RE' | 'RO' | 'RU' | 'RW' | 'BL' | 'SH' | 'KN' | 'LC' | 'MF' | 'PM' | 'VC' | 'WS' | 'SM' | 'ST' | 'SA' | 'SN' | 'RS' | 'SC' | 'SL' | 'SG' | 'SX' | 'SK' | 'SI' | 'SB' | 'SO' | 'ZA' | 'GS' | 'SS' | 'ES' | 'LK' | 'SD' | 'SR' | 'SJ' | 'SZ' | 'SE' | 'CH' | 'SY' | 'TW' | 'TJ' | 'TZ' | 'TH' | 'TL' | 'TG' | 'TK' | 'TO' | 'TT' | 'TN' | 'TR' | 'TM' | 'TC' | 'TV' | 'UG' | 'UA' | 'AE' | 'GB' | 'US' | 'UM' | 'UY' | 'UZ' | 'VU' | 'VE' | 'VN' | 'VG' | 'VI' | 'WF' | 'EH' | 'YE' | 'ZM' | 'ZW';

// Use this format when your index.json provides multiple extensions rather than defining a full source itself.
export type RepositoryIndex = RepositoryConfig[]

// This is each entry in a repository index.json array.
export interface RepositoryConfig {
    main: string // Path to the extension source. Supports 'gh:username/repo/path', 'npm:package-name', or a direct URL.
}

// This is each entry in your index.json array.
export interface SourceConfig {
    id: string // The more unique, the better.
    name: string
    version: string // Semantic Version (SemVer), e.g. 0.0.1
    main: string // This should be the path to the extension code respective to your manifest e.g. 'sources/my-extension' if your code is located under the sources folder and is called my-extension.js
    update: string // Path to the config file. Can be prefixed with: 'gh:' to load from a GitHub repository (e.g. 'gh:username/repo'), or 'npm:' to load from a npm package (e.g. 'npm:package-name')
    nsfw?: boolean // Should be set to true if the source has a possibility of returning NSFW results e.g. Hentai
    unregulated?: boolean // Should be set to true if the source freely allows uploads without registration e.g. anonymous uploads (this increases security risks we should let users know this)
    type?: 'torrent'
    speed?: Speed // Should be the best estimate on how quickly a fetch takes to complete the query, some sites are slow and see a lot of traffic. You should not consider your location relative to the host for speed, the speed should be an average of various locations of users.
    accuracy?: Accuracy // How likely the results are to be matching the requested series, 'high' should only be used if the results are a guaranteed match to the query.
    regions?: ServerLocations[] // This should be the server location(s) e.g. nodes of the site used to fetch the results for your extension
    deprecated?: false // Completely optional but should be set to true once an extension is planned to no longer be maintained or the extension source has shutdown.
    description?: string
    icon?: string // URL or base64 encoded image that represents your source, it is suggested to use base64 encoding
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