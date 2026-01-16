<script context='module'>
  import ChangelogSk from '@/components/skeletons/ChangelogSk.svelte'
  import Debug from 'debug'
  import { IPC } from '@/modules/bridge.js'
  import { SUPPORTS } from '@/modules/support.js'
  const debug = Debug('ui:changelog-view')

  export let changeLog = getChanges()
  window.addEventListener('online', () => changeLog = getChanges())
  let updateVersion
  const updateTime = Date.now()
  IPC.on(SUPPORTS.isAndroid ? 'update-available' : 'update-downloaded', (version) => {
    if (updateVersion !== version) {
      updateVersion = version
      if ((Date.now() - updateTime) >= 60_000) changeLog = getChanges()
    }
  })
  async function getChanges() {
    try {
      const json = await (await fetch('https://api.github.com/repos/RockinChaos/Shiru/releases')).json()
      return json.map(({body, tag_name: version, published_at: date, assets, html_url: url}) => ({ body, version, date, assets, url }))
    } catch (error) {
      debug('Failed to changelog', error)
      return {}
    }
  }
  export function markdownToHtml(text) {
    const cleaned = text.replace(/<[^>]+>.*?<\/[^>]+>/gs, '').replace(/<[^>]+>/gs, '').replace(/(## Preview:|# Preview:)/g, '').trim()
    let htmlOutput = ''
    let listStack = []
    let inList = false
    let lastLevel = 0

    const closeList = (level) => {
      while (level < lastLevel && listStack.length > 0) {
        htmlOutput += listStack.pop()
        lastLevel--
      }
    }

    const openList = (level) => {
      while (level > lastLevel) {
        htmlOutput += '<ul>'
        listStack.push('</ul>')
        lastLevel++
      }
    }

    cleaned.split('\n').forEach(line => {
      if (!line.trim()) return
      const match = line.match(/^(\s*)([-*])\s+(.*)/)
      if (match) {
        const [, spaces, , content] = match
        const level = Math.floor(spaces.length / 2)
        closeList(level)
        openList(level)
        if (!inList) {
          htmlOutput += '<ul>'
          listStack.push('</ul>')
          inList = true
          lastLevel = 0
        }
        htmlOutput += `<li>${content.trim()}</li>`
      } else {
        closeList(0)
          if (inList) {
            htmlOutput += listStack.pop()
            inList = false
            lastLevel = 0
          }
        htmlOutput += `<p>${line.trim()}</p>`
      }
    })
    closeList(0)
    if (inList) htmlOutput += listStack.pop()
    return htmlOutput
  }
</script>
<script>
  export let version
</script>

<div class='{$$restProps.class}'>
  <div class='column px-20 px-sm-0'>
    <h4 class='mb-10 font-weight-bold'>Changelog</h4>
    <div class='font-size-18 text-muted'>New updates and improvements to Shiru.</div>
    <div class='font-size-14 text-muted'>Your current App Version is <b>v{version}</b></div>
  </div>
  {#await changeLog}
    {#each Array(5) as _}
      <ChangelogSk />
    {/each}
  {:then changelog}
    {#if changelog?.length}
      {#each changelog.slice(0, 5) as { version, date, body }}
        <hr class='my-20' />
        <div class='row py-20 px-20 px-sm-0 position-relative text-wrap text-break'>
          <div class='col-sm-3 order-first text-white mb-10 mb-sm-0'>
            <div class='position-sticky top-0 pt-20'>
              {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
          <div class='col-sm-9 pre-wrap text-muted'>
            <h2 class='mt-0 font-weight-bold text-white font-scale-34'>{version}</h2>
            <div class='ml-10'>{@html markdownToHtml(body)}</div>
          </div>
        </div>
      {/each}
     {:else}
      <hr class='my-20' />
      <div class='row py-20 px-20 px-sm-0 position-relative text-wrap text-break'>
        <div class='col-sm-3 order-first text-white mb-10 mb-sm-0'>
          <div class='position-sticky top-0 pt-20'>
            {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
        <div class='col-sm-9 pre-wrap text-muted'>
          <h2 class='mt-0 font-weight-bold text-white font-scale-34'>{version}</h2>
          <div class='ml-10'>Failed to load the changelog.<br>Possible causes include network connectivity problems, missing or inaccessible changelog files, or issues communicating with the update repository.</div>
        </div>
      </div>
    {/if}
  {:catch e}
    {#each Array(5) as _}
      <ChangelogSk />
    {/each}
  {/await}
</div>