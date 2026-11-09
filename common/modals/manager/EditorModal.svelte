<script context='module'>
  import { writable } from 'simple-store-svelte'
  import SoftModal from '@/components/modals/SoftModal.svelte'
  import SearchPage from '@/routes/search/SearchPage.svelte'
  import { click } from '@/modules/lib/click.js'
  import { setTorrentMedia } from '@/modules/torrent.js'
  import { modal } from '@/modules/navigation.js'
  import { X } from 'lucide-svelte'

  const key = writable({})
  const searchDefaults = { format: [], format_not: [], genre: [], genre_not: [], tag: [], tag_not: [], status: [], status_not: [] }
</script>

<script>
  function close() {
    modal.close(modal.FILE_EDITOR)
  }

  export function fileEdit(_file, files, title) {
    const search = {
      search: title,
      ...structuredClone(searchDefaults),
      fileEdit: (media) => {
        const mediaId = _file.media?.media?.id ?? _file.media?.anilist_id
        const targetEpisode = _file.media.episode ?? _file.media.parseObject.episode_number
        for (const file of files) {
          const episode = file.media?.episode ?? file.media?.parseObject?.episode_number
          const fileMediaId = file.media?.media?.id ?? file.media?.anilist_id
          if ((_file === file || (!file.locked && !file.media?.locked)) && ((!mediaId && !fileMediaId) || (mediaId === fileMediaId && (_file === file || ((!/^\d+$/.test(targetEpisode) || Number(targetEpisode) !== 0) && (!/^\d+$/.test(episode) || Number(episode) !== 0)))))) {
            if (_file === file) file.locked = true
            file.media.media = media
            if (file.media.parseObject.anime_season) file.media.parseObject.anime_season = '1'
            file.media.season = '1'
            file.media.parseObject.anime_title = media.title.userPreferred
            file.media.anilist_id = media.id
            file.media.mal_id = media.idMal
            file.media.failed = false
            file.media.parseObject.failed = false
            setTorrentMedia(file.infoHash, { ...file.media, locked: !!(file.locked || file.media.locked) }, file.path)
          }
        }
        window.dispatchEvent(new Event('fileEdit', { detail: { manager: true } }))
        close()
      }
    }
    modal.open(modal.FILE_EDITOR, writable(search))
  }
</script>
<SoftModal class='w-full mx-20 h-full rounded scrollbar-none bg-very-dark' innerCss='pt-20' bind:showModal={$modal[modal.FILE_EDITOR]} {close} id={modal.FILE_EDITOR}>
  <div class='d-flex' style='margin-top: max(calc(var(--safe-area-top) - 3rem), 1rem)'>
    <div class='details'>
      <h3 class='mb-0 font-weight-bold text-white title font-size-24 ml-20 line-height-1'>Select a Series</h3>
      <h4 class='mb-0 text-muted title font-size-12 ml-20 line-height-1'>Click or tap the series that is currently playing.</h4>
    </div>
    <button type='button' class='btn btn-square ml-auto mr-20 d-flex align-items-center justify-content-center rounded-2 flex-shrink-0 mt-10' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
  </div>
  <SearchPage {key} search={$modal[modal.FILE_EDITOR]?.data}/>
</SoftModal>