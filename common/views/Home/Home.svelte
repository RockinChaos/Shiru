<script context='module'>
  import SectionsManager, { sections } from '@/modules/sections.js'
  import { anilistClient, currentSeason, currentYear } from '@/modules/anilist.js'
  import { animeSchedule } from '@/modules/anime/animeschedule.js'
  import { settings } from '@/modules/settings.js'
  import { uniqueStore } from '@/modules/util.js'
  import equal from 'fast-deep-equal/es6'
  import { RSSManager } from '@/modules/rss.js'
  import Helper from '@/modules/helper.js'
  import WPC from '@/modules/wpc.js'
  import { writable } from 'simple-store-svelte'
  import Debug from 'debug'
  const debug = Debug('ui:home')

  const bannerData = writable(getTitles())
  // Refresh banner every 15 minutes
  setInterval(() => getTitles(true), 5 * 60 * 1000)

  async function getTitles(refresh) {
    const res = anilistClient.search({ method: 'Search', ...(settings.value.adult === 'hentai' && settings.value.hentaiBanner ? { genre: ['Hentai'] } : {}), sort: 'TRENDING_DESC', perPage: 50, onList: false, ...(settings.value.adult !== 'hentai' || !settings.value.hentaiBanner ? { season: currentSeason } : {}), year: currentYear, status_not: 'NOT_YET_RELEASED' })
    if (refresh) {
      const renderData = await res
      bannerData.set(Promise.resolve(renderData))
    }
    else return res
  }

  let mappedSections = {}
  const manager = new SectionsManager()
  mapSections()
  WPC.listen('remap-sections', () => {
    manager.clear()
    mappedSections = {}
    mapSections()
  })

  function mapSections() {
    for (const section of sections.value) mappedSections[section.title] = section
    for (const sectionTitle of settings.value.homeSections) manager.add(mappedSections[sectionTitle[0]])
  }

  const continueWatching = 'Continue Watching'
  const resolveData = async (data) => Promise.all(
    data.map(async item => {
      const resolved = item.data && typeof item.data.then === 'function' ? await item.data : item.data
      const media = resolved?.media || resolved
      return { ...item, data: (media ? { id: media.id, idMal: media.idMal, title: media.title, bannerImage: media.bannerImage, isAdult: media.isAdult, duration: media.duration, episodes: media.episodes, format: media.format } : resolved) }
    })
  )
  if (Helper.getUser()) {
    refreshSections(Helper.getClient().userLists, ['Dubbed Releases', 'Subbed Releases', 'Hentai Releases'], true)
    refreshSections(Helper.getClient().userLists, [continueWatching, 'Sequels You Missed', 'Stories You Missed', 'Planning List', 'Completed List', 'Paused List', 'Dropped List', 'Watching List', 'Rewatching List'])
  }
  if (Helper.isMalAuth()) refreshSections(animeSchedule.subAiredLists, continueWatching) // When authorized with Anilist, this is already automatically handled.
  refreshSections(animeSchedule.dubAiredLists, continueWatching)
  function refreshSections(list, sections, schedule = false) {
    uniqueStore(list).subscribe(async (_value) => {
      const value = await _value
      if (!value) return
      for (const section of manager.sections) {
        // remove preview value, to force UI to re-request data, which updates it once in viewport
        if (sections.includes(section.title) && !section.hide && (!schedule || section.isSchedule)) {
          const loaded = section.load(1, 50, section.variables)
          if (!section.preview.value || !equal(await resolveData(loaded), await resolveData(section.preview.value))) section.preview.value = loaded
        }
      }
    })
  }

  // update AniSchedule 'Releases' feeds when a change is detected for the specified feed(s).
  WPC.listen('feedChanged', ({ updateFeeds, manifest }) => {
    for (const section of manager.sections) {
      try {
        if (section.isSchedule && updateFeeds.includes(section.title)) {
          animeSchedule.feedChanged(section.title.includes('Subbed') ? 'Sub' : section.title.includes('Dubbed') ? 'Dub' : 'Hentai', false, true, manifest).then((changed) => {
            if (changed) section.preview.value = section.load(1, 50, section.variables)
          })
        }
      } catch (error) {
        debug(`Failed to update ${section.title} feed, this is likely a temporary connection issue:`, error)
      }
    }
  })

  // force update RSS feed when the user adjusts a series in the FileManager.
  window.addEventListener('fileEdit', async () => {
    for (const section of manager.sections) {
      if (section.isRSS && !section.isSchedule) {
        const url = settings.value.rssFeedsNew.find(([feedTitle]) => feedTitle === section.title)?.[1]
        if (url) {
          const loaded = RSSManager.getMediaForRSS(1, 12, url, false, true)
          if (!section.preview.value || !equal(await resolveData(loaded), await resolveData(section.preview.value))) section.preview.value = loaded
        }
      }
    }
  })

  const isPreviousRSS = (i) => {
    let index = i - 1
    while (index >= 0) {
      if (!manager.sections[index]?.hide) return manager.sections[index]?.isRSS ?? false
      else if ((index - 1 >= 0) && manager.sections[index - 1]?.isRSS) return true
      index--
    }
    return false
  }
</script>
<script>
  import Section from '@/views/Home/Section.svelte'
  import Banner from '@/components/banner/Banner.svelte'
</script>

<div class='h-full w-full overflow-y-scroll root overflow-x-hidden'>
  <Banner data={$bannerData} />
  <div class='d-flex flex-column h-full w-full mt-15'>
    {#each manager.sections as section, i (i)}
      {#if !section.hide}
        <Section bind:opts={section} lastEpisode={isPreviousRSS(i)}/>
      {/if}
    {/each}
  </div>
</div>