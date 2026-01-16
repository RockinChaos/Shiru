<script context='module'>
    import { writable } from 'simple-store-svelte'
    import { click } from '@/modules/click.js'
    import { Search, X } from 'lucide-svelte'
    import SoftModal from '@/components/SoftModal.svelte'
    import FileEditor from '@/views/Player/FileManager/FileEditor.svelte'
    import FileCard from '@/views/Player/FileManager/FileCard.svelte'
    export const managerView = writable(false)
</script>
<script>
    import { matchKeys, matchPhrase } from '@/modules/util.js'
    import { cache } from '@/modules/cache.js'

    export let overlay

    function close () {
        $managerView = false
        setTimeout(() => { if (overlay.includes('fileDetails')) overlay = overlay.filter(item => item !== 'fileDetails') })
    }
    $: $managerView && setOverlay()
    $: !$managerView && close()
    function setOverlay() {
        if (!overlay.includes('fileDetails')) overlay = [...overlay, 'fileDetails']
    }

    export let playFile
    export let playing
    export let files

    let container
    let searchText = ''
    function filterResults(files, searchText) {
        if (!searchText?.length) return files
        return files.filter(({ name, media }) => matchPhrase(searchText, name, 0.4, false, true) || (media?.media?.id && matchKeys(cache.getMedia(media?.media?.id), searchText, ['title.userPreferred', 'title.english', 'title.romaji', 'title.native', 'synonyms'], 0.4))) || []
    }

    let fileEdit
    window.addEventListener('fileEdit', (event) => {
        if (!event.detail?.manager) return
        if ($managerView) close()
        setTimeout(() => $managerView = true)
    })
    window.addEventListener('overlay-check', () => { if ($managerView) close() })
</script>

<SoftModal class='m-0 w-800 mw-0 mh-full d-flex flex-column rounded bg-very-dark pt-0 py-30 pl-20 pr-30 mx-20 scrollbar-none' bind:showModal={$managerView} {close} id='fileDetailModal'>
    <div class='d-flex mt-30 mb-10'>
        <div class='mb-0 mr-5 ml-20'>
            <h3 class='mb-0 font-weight-bold text-white title font-size-24'>File Manager</h3>
            <h5 class='mb-0 mt-0 text-muted info font-size-12'>Something didn't resolve correctly? Please open an issue on GitHub so we can investigate and fix it!</h5>
        </div>
        <button type='button' class='btn btn-square ml-auto d-flex align-items-center justify-content-center rounded-2 flex-shrink-0' use:click={close}><X size='1.7rem' strokeWidth='3'/></button>
    </div>
    <FileCard {playFile} bind:file={playing} bind:files playing={true} bind:fileEdit class='mr-30'/>
    <div class='input-group mt-10 long-input' class:d-none={files?.length < 2}>
        <Search size='2.6rem' strokeWidth='2.5' class='position-absolute z-10 text-dark-light h-full pl-10 ml-20 pointer-events-none' />
        <input
            type='search'
            class='form-control bg-dark-very-light pl-40 ml-20 mr-30 rounded-1 h-40 text-truncate'
            autocomplete='off'
            spellcheck='false'
            data-option='search'
            placeholder='Filter by file name or series title' bind:value={searchText} on:input={() => { container.scrollTo({top: 0}); }} />
    </div>
    <div><div class='shadow-overlay' class:d-none={files?.length < 2}/></div>
    <div bind:this={container} class='overflow-y-auto mt-10'>
        {#each filterResults(files?.filter((file) => file !== playing), searchText) as file, index}
            <FileCard {playFile} bind:file bind:files bind:fileEdit class='{index === 0 ? `mt-10` : ``}'/>
        {/each}
    </div>
</SoftModal>
<FileEditor bind:fileEdit bind:overlay />

<style>
    .shadow-overlay {
        position: absolute;
        left: 0;
        right: 0;
        height: 1.2rem;
        margin-top: -1rem;
        box-shadow: 0 1.2rem 1.2rem var(--dark-color-dim);
        pointer-events: none;
        z-index: 1;
    }
</style>