<script context='module'>
  import { version } from '@/routes/settings/SettingsPage.svelte'
  import { SUPPORTS } from '@/modules/support.js'
  import { COMMON } from '@/modules/bridge.js'
  import { writable } from 'simple-store-svelte'
  import { settings } from '@/modules/settings.js'
  import { uniqueStore } from '@/modules/util.js'
  import semver from 'semver'
  import Debug from 'debug'
  const debug = Debug('ui:changelog-view')

  export let latestVersion
  /** @type {import('simple-store-svelte').Writable<"stable" | "nightly">} */
  export let updateChannel = writable(/** @type {"stable" | "nightly"} */ (settings.value.updateChannel ?? 'stable'))
  export let changeLog = writable(getChanges())

  uniqueStore(updateChannel).subscribe(channel => {
    changeLog.set(getChanges())
    setTimeout(() => COMMON.setUpdateChannel(channel))
  })

  window.addEventListener('online', () => changeLog.set(getChanges()))

  settings.subscribe(value => {
    if (value.updateChannel !== updateChannel.value) {
      settings.update(current => {
        current.updateVersion = undefined
        return current
      })
      updateChannel.set(/** @type {"stable" | "nightly"} */ (value.updateChannel))
    }
  })

  const startedAt = Date.now()
  if (SUPPORTS.isAndroid || COMMON.getPlatformInfo().manualInstall) COMMON.onUpdateAvailable((version) => setChangeLog(version))
  else COMMON.onUpdateDownloaded((version) => setChangeLog(version))

  /**
   * Updates the latest version and refreshes the changelog if the app has been running for at least 30 seconds.
   *
   * @param {string} version Latest available version string
   */
  function setChangeLog(version) {
    if (latestVersion !== version) {
      latestVersion = version
      if ((Date.now() - startedAt) >= 30_000) changeLog.set(getChanges())
    }
  }

  /**
   * Fetches a single release entry directly by its version tag.
   * Used as a fallback when the releases feed has not yet reflected the latest release.
   *
   * @param {string} version Version string to fetch
   * @returns {Promise<Object|null>} Mapped release entry or null on failure
   */
  export async function getReleaseByTag(version) {
    try {
      const response = await fetch(`${atob('aHR0cHM6Ly91cGRhdGVzLnNoaXJ1LmFwcA==')}/tags/v${semver.valid(version)?.replace(/^v/, '') ?? version}`)
      if (!response.ok) return null
      const [entry] = mapLogs([await response.json()])
      return entry
    } catch (error) {
      debug('Failed to fetch release by tag', error)
      return null
    }
  }

  /**
   * Fetches and filters GitHub releases based on current version and update channel.
   * Implements different filtering logic for stable/nightly channels and current version type.
   *
   * @returns {Promise<Array>} Filtered array of release entries
   */
  async function getChanges() {
    try {
      const res = await fetch(atob('aHR0cHM6Ly91cGRhdGVzLnNoaXJ1LmFwcA=='))
      if (res.status === 404 || res.status === 451) {
        debug('Repository is gone or access has been blocked, unable to fetch changes.')
        return []
      }
      const json = await res.json()
      const mapJSON = mapLogs(json)
      const currentIndex = mapJSON.findIndex(entry => semver.valid(entry.version) === semver.valid(version))
      if (currentIndex === -1) return updateChannel.value === 'stable' ? mapJSON.filter(entry => !semver.prerelease(entry.version)) : mapJSON
      const isNightlyVersion = semver.prerelease(version)
      if (updateChannel.value === 'stable') {
        if (isNightlyVersion) {
          const nextStableIndex = mapJSON.findIndex((entry, index) => index > currentIndex && !semver.prerelease(entry.version))
          return mapJSON.filter((entry, index) => {
            if (!semver.prerelease(entry.version)) return true
            if (nextStableIndex !== -1 && index >= currentIndex && index < nextStableIndex) return true
            return nextStableIndex === -1 && index >= currentIndex
          })
        }
        return mapJSON.filter(entry => !semver.prerelease(entry.version))
      }
      if (isNightlyVersion) {
        const nextStableIndex = mapJSON.findIndex((entry, index) => index > currentIndex && !semver.prerelease(entry.version))
        return mapJSON.filter((entry, index) => {
          if (!semver.prerelease(entry.version)) return true
          if (nextStableIndex !== -1 && index >= currentIndex && index < nextStableIndex) return true
          if (nextStableIndex === -1 && index >= currentIndex) return true
          const baseVersion = `${semver.major(entry.version)}.${semver.minor(entry.version)}.${semver.patch(entry.version)}`
          if (mapJSON.some(entry => semver.valid(entry.version) === baseVersion)) return false
          return index < currentIndex
        })
      }
      return mapJSON.filter((entry, index) => {
        if (!semver.prerelease(entry.version)) return true
        const baseVersion = `${semver.major(entry.version)}.${semver.minor(entry.version)}.${semver.patch(entry.version)}`
        if (mapJSON.some(entry => semver.valid(entry.version) === baseVersion)) return false
        return index < currentIndex
      })
    } catch (error) {
      debug('Failed to fetch changelog', error)
      return []
    }
  }

  /**
   * Maps GitHub release API response to simplified changelog entries.
   *
   * @param {Array} json Raw GitHub API release data
   * @returns {Array} Mapped release entries with relevant fields
   */
  function mapLogs(json) {
    return json.map(({ body, tag_name: version, published_at: date, assets, html_url: url, prerelease }) => ({
      body,
      version,
      date,
      assets,
      url,
      prerelease
    }))
  }
</script>
<script>
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  import { click } from '@/modules/lib/click.js'
  export let body = ''

  /**
   * Sanitizes markdown content by parsing and cleaning HTML.
   *
   * @param {string} body Raw markdown content
   * @returns {string} Sanitized HTML string
   */
  export function sanitize(body) {
    marked.setOptions({
      pedantic: false,
      breaks: true,
      gfm: true
    })
    return DOMPurify.sanitize(marked.parse(body.trim()).trim(), {
      ALLOWED_TAGS: [
        'p', 'br', 'span', 'div',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark',
        'ul', 'ol', 'li',
        'blockquote',
        'code', 'pre',
        'a',
        'img',
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
        'hr',
        'details', 'summary',
        'input'
      ],
      ALLOWED_ATTR: [
        'href', 'target', 'rel', 'title',
        'src', 'alt', 'width', 'height',
        'class', 'id',
        'align',
        'type', 'checked', 'disabled'
      ]
    })
  }

  /**
   * Handles link clicks within changelog content by opening externally.
   *
   * @param {Event} event Click event
   */
  function hrefListener(event) {
    const anchor = event.composedPath().find(element => element.tagName === 'A')
    if (!anchor?.href) return
    event.preventDefault()
    COMMON.openURI(anchor.href)
  }
</script>
<div class='changelog select-text {$$restProps.class}' tabindex='-1' use:click={hrefListener}>{@html sanitize(body)}</div>

<style>
  .changelog :global(a) {
    -webkit-user-drag: none;
    color: var(--tertiary-color);
    cursor: pointer;
  }

  @media (hover: hover) and (pointer: fine) {
    .changelog :global(a):hover {
      text-decoration: underline;
      color: var(--tertiary-color-dim);
    }
  }

  .changelog :global(svg),
  .changelog :global(img),
  .changelog :global(video),
  .changelog :global(iframe) {
    -webkit-user-drag: none;
    max-width: 100%;
    height: auto;
    border-radius: 1rem;
  }

  .changelog :global(p),
  .changelog :global(details) {
    margin-block: 0.8rem;
  }
</style>