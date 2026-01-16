<script context='module'>
    import { writable } from 'simple-store-svelte'
    import SoftModal from '@/components/SoftModal.svelte'
    import Search from '@/views/Search.svelte'
    import { click } from '@/modules/click.js'
    import { setHash } from '@/modules/anime/animehash.js'
    import { X } from 'lucide-svelte'

    const key = writable({})
    const searchDefaults = { format: [], format_not: [], genre: [], genre_not: [], tag: [], tag_not: [], status: [], status_not: [] }
    const search = writable(structuredClone(searchDefaults))
    const editorView = writable(false)
</script>

<script>
    export let overlay

    export function fileEdit(_file, files, title) {
        $editorView = true
        $search.search = title
        $search.fileEdit = (media) => {
            const mediaId = _file.media?.mediaId
            const targetEpisode = _file.media.episode || _file.media.parseObject.episode_number
            for (const file of files) {
              const episode = file.media?.episode || file.media?.parseObject?.episode_number
                if ((_file === file || (!file.locked && !file.media?.locked)) && ((!mediaId && !file.media?.mediaId) || (mediaId === file.media?.mediaId && (_file === file || ((!/^\d+$/.test(targetEpisode) || Number(targetEpisode) !== 0) && (!/^\d+$/.test(episode) || Number(episode) !== 0)))))) {
                    if (_file === file) file.locked = true
                    file.media.media = media
                    if (file.media.parseObject.anime_season) file.media.parseObject.anime_season = '1'
                    file.media.season = '1'
                    file.media.parseObject.anime_title = media.title.userPreferred
                    file.media.mediaId = media.id
                    file.media.failed = false
                    setHash(file.infoHash, {
                        fileHash: file.fileHash,
                        mediaId: file.media.mediaId,
                        episodeRange: file.media.episodeRange,
                        episode,
                        season: file.media.season || file.media.parseObject.anime_season,
                        parseObject: file.media.parseObject,
                        ...(file.locked ? { locked: true } : {}),
                        failed: false
                    })
                }
            }
            window.dispatchEvent(new Event('fileEdit', { detail: { manager: true } }))
            close()
        }
    }

    function close () {
        $editorView = false
        $search = structuredClone(searchDefaults)
        setTimeout(() => { if (overlay.includes('fileEditor')) overlay = overlay.filter(item => item !== 'fileEditor') })
    }
    $: $editorView && setOverlay()
    $: !$editorView && close()
     function setOverlay() {
         if (!overlay.includes('fileEditor')) overlay = [...overlay, 'fileEditor']
     }
    window.addEventListener('overlay-check', () => { if ($editorView) close() })
</script>
<SoftModal class='vwh-90 rounded scrollbar-none bg-very-dark' bind:showModal={$editorView} {close} id='fileEditorModal'>
    <div class='d-flex mt-10'>
        <div>
            <h3 class='mb-0 font-weight-bold text-white title font-size-24 ml-20'>Select a Series</h3>
            <h4 class='mb-0 text-muted title font-size-12 ml-20'>Click or tap the series that is currently playing.</h4>
        </div>
        <button type='button' class='btn btn-square ml-auto mr-20 d-flex align-items-center justify-content-center rounded-2 flex-shrink-0' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
    </div>
    <Search {key} {search}/>
</SoftModal>