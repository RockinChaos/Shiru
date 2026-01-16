<script>
  import { anilistClient } from '@/modules/anilist.js'
  import { profiles, settings, sync } from '@/modules/settings.js'
  import { getMediaMaxEp } from '@/modules/anime/anime.js'
  import { codes, createListener } from '@/modules/util.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { click } from '@/modules/click.js'
  import { writable } from 'simple-store-svelte'
  import { toast } from 'svelte-sonner'
  import { X, Bookmark, PencilLine } from 'lucide-svelte'
  import Helper from '@/modules/helper.js'
  import Debug from 'debug'
  const debug = Debug('ui:scoring')

  /** @type {import('@/modules/al.d.ts').Media} */
  export let media
  export let viewAnime = false
  export let previewAnime = false

  let scoringModal
  const showModal = writable(false)
  $: setTimeout(() => $showModal && scoringModal?.focus())

  let score = 0
  let status = 'NOT IN LIST'
  let episode = 0
  let totalEpisodes = '?'

  const scoreName = {
    10: '(Masterpiece)',
    9: '(Great)',
    8: '(Very Good)',
    7: '(Good)',
    6: '(Fine)',
    5: '(Average)',
    4: '(Bad)',
    3: '(Very bad)',
    2: '(Horrible)',
    1: '(Appalling)',
    0: 'Not Rated'
  }

  async function toggleModal (state) {
    if (state.save || state.delete) {
      showModal.set(false)
      if (state.save) {
        await saveEntry()
      } else if (state.delete) {
        await deleteEntry()
      }
    } else {
      score = (media.mediaListEntry?.score ? media.mediaListEntry?.score : 0)
      status = (media.mediaListEntry?.status ? media.mediaListEntry?.status : 'NOT IN LIST')
      episode = (media.mediaListEntry?.progress ? media.mediaListEntry?.progress : 0)
      totalEpisodes = (getMediaMaxEp(media) ? `${getMediaMaxEp(media)}` : '?')
      showModal.set(!$showModal)
    }
  }

  async function deleteEntry() {
    score = 0
    episode = 0
    status = 'NOT IN LIST'
    if (media.mediaListEntry) {
      const res = await Helper.delete(media, Helper.isAniAuth() ? {id: media.mediaListEntry.id, idAni: media.id} : {idMal: media.idMal})
      const description = `${anilistClient.title(media)} has been deleted from your list.`
      printToast(res, description, false, false)
      if (sync.value.length > 0) { // handle profile syncing
        for (const profile of profiles.value) {
          if (sync.value.includes(profile?.viewer?.data?.Viewer?.id)) {
            const anilist = profile.viewer?.data?.Viewer?.avatar
            const listId = (anilist ? { id: (await anilistClient.getUserLists({userID: profile.viewer.data.Viewer.id, token: profile.token}))?.data?.MediaListCollection?.lists?.flatMap(list => list.entries).find(({ media: listMedia }) => listMedia.id === media.id)?.media?.mediaListEntry?.id } : { idMal: media.idMal })
            if (listId?.id || listId?.idMal) {
              const res = await Helper.delete(media, {...listId, token: profile.token, refresh_in: profile.refresh_in, anilist})
              printToast(res, description, false, profile)
            }
          }
        }
      }
    }
  }

  async function saveEntry() {
    if (!status.includes('NOT IN LIST')) {
      const fuzzyDate = Helper.getFuzzyDate(media, status)
      const variables = {
              id: media.id,
              idMal: media.idMal,
              status,
              episode,
              score: Helper.isAniAuth() ? (score * 10) : score, // AniList score scale is out of 100, others use a scale of 10.
              repeat: media.mediaListEntry?.repeat || 0,
              lists: media.mediaListEntry?.customLists?.filter(list => list.enabled).map(list => list.name) || [],
              ...fuzzyDate
            }
      if (media?.mediaListEntry?.status !== variables.status || media?.mediaListEntry?.progress !== variables.episode || media?.mediaListEntry?.score !== variables.score || media?.mediaListEntry?.repeat !== variables.repeat) {
        const res = await Helper.entry(media, variables)
        const description = `Title: ${anilistClient.title(media)}\nStatus: ${Helper.statusName[status]}\nEpisode: ${episode} / ${totalEpisodes}${score !== 0 ? `\nYour Score: ${score}` : ''}`
        printToast(res, description, true, false)
        if (sync.value.length > 0) { // handle profile syncing
          for (const profile of profiles.value) {
            if (sync.value.includes(profile?.viewer?.data?.Viewer?.id)) {
              const anilist = profile.viewer?.data?.Viewer?.avatar
              const lists = anilist ? (await anilistClient.getUserLists({userID: profile.viewer.data.Viewer.id, token: profile.token}))?.data?.MediaListCollection?.lists?.flatMap(list => list.entries).find(({ media: listMedia }) => listMedia.id === media.id)?.media?.mediaListEntry?.customLists?.filter(list => list.enabled).map(list => list.name) : []
              const res = await Helper.entry(media, {
                ...variables,
                lists,
                score: (anilist ? (score * 10) : score),
                token: profile.token,
                refresh_in: profile.refresh_in,
                anilist
              })
              printToast(res, description, true, profile)
            }
          }
        }
      } else if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Warnings')) {
        toast.warning('No Changes to List', {
          description: `Title: ${anilistClient.title(media)}\nStatus: ${Helper.statusName[status]}\nEpisode: ${episode} / ${totalEpisodes}${score !== 0 ? `\nYour Score: ${score}` : ''}`,
          duration: 6000
        })
      }
    } else {
       await deleteEntry()
    }
  }

  function printToast(res, description, save, profile) {
    const who = (profile ? ' for ' + profile.viewer.data.Viewer.name + (profile.viewer?.data?.Viewer?.avatar ? ' (AniList)' : ' (MyAnimeList)')  : '')
    if ((save && res?.data?.SaveMediaListEntry) || (!save && res)) {
      debug(`List Updated${who}: ${description.replace(/\n/g, ', ')}`)
      if (!profile) {
        if (save && (settings.value.toasts.includes('All') || settings.value.toasts.includes('Successes'))) {
          toast.success('List Updated', {
            description,
            duration: 6000
          })
        } else if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Warnings')) {
          toast.warning('List Updated', {
            description,
            duration: 9000
          })
        }
      }
    } else {
      const error = `\n${429} - ${codes[429]}`
      debug(`Error: Failed to ${(save ? 'update' : 'delete title from')} user list${who} with: ${description.replace(/\n/g, ', ')} ${error}`)
      if (settings.value.toasts.includes('All') || settings.value.toasts.includes('Errors')) {
        toast.error('Failed to ' + (save ? 'Update' : 'Delete') + ' List' + who, {
          description: description + error,
          duration: 9000
        })
      }
    }
  }

  /**
   * @param {Event & { currentTarget: HTMLInputElement }} event
   */
  function handleEpisodes(event) {
    const enteredValue = event.currentTarget.value
    if (/^\d+$/.test(enteredValue)) {
      const maxEpisodes = getMediaMaxEp(media) || (media.status === 'RELEASING' ? 12 : 0)
      if (parseInt(enteredValue) > maxEpisodes) {
        episode = maxEpisodes
        event.currentTarget.value = episode
      } else {
        episode = parseInt(enteredValue)
        event.currentTarget.value = episode
      }
    } else {
      episode = 0
    }
  }

  $: {
    if ($showModal) {
      const { reactive, init } = createListener([`scoring`, `scoring-btn`])
      init(true, true)
      reactive.subscribe(value => {
        if (!value) {
          showModal.set(false)
          init(false, true)
        }
      })
    }
  }
</script>


<div class='score-dropdown {$$restProps.class}' class:ml-10={!$$restProps.class}>
  <button type='button' id='list-btn' data-toggle='tooltip' data-placement={previewAnime ? 'top-right' : 'top'} data-target-breakpoint='md' data-title='List Editor' class='btn scoring-btn font-size-{viewAnime ? `20 btn-lg` : `16`} btn-square shadow-none border-0 d-flex align-items-center justify-content-center' class:bg-dark-light={!previewAnime} use:click={() => toggleModal({ toggle: !$showModal })} disabled={!Helper.isAuthorized()}>
    {#if media?.mediaListEntry}
      <PencilLine size='1.7rem' />
    {:else}
      <Bookmark size='1.7rem' />
    {/if}
  </button>
  {#if Helper.isAuthorized()}
    <div bind:this={scoringModal} class='modal scoring position-absolute bg-very-dark shadow-lg rounded-3 p-20 z-30 {$showModal ? `visible` : `invisible`} {!previewAnime && !viewAnime ? `banner ${SUPPORTS.isAndroid ? `ml--255` : ``}` : !previewAnime ? `viewAnime` : `previewAnime`} {(!previewAnime || !viewAnime) ? `w-auto h-auto` : ``}' use:click={() => {}}>
      <div class='d-flex justify-content-between align-items-center mb-2'>
        <h5 class='font-weight-bold'>List Editor</h5>
        <button type='button' class='btn btn-square d-flex align-items-center justify-content-center' use:click={() => toggleModal({ toggle: false })}><X size='1.7rem' strokeWidth='3'/></button>
      </div>
      <div class='modal-body'>
        <div class='form-group mb-15'>
          <label class='d-block mb-5' for='status'>Status</label>
          <select class='form-control bg-dark-light' class:noList={status?.includes('NOT IN LIST')} id='status' required bind:value={status}>
            <option value='NOT IN LIST' selected disabled hidden>Not on List</option>
            <option value='CURRENT'>Watching</option>
            <option value='PLANNING'>Planning</option>
            <option value='COMPLETED'>Completed</option>
            <option value='PAUSED'>Paused</option>
            <option value='DROPPED'>Dropped</option>
            <option value='REPEATING'>Rewatching</option>
          </select>
        </div>
        <div class='form-group'>
          <label class='d-block mb-5' for='episode'>Episode</label>
          <div class='d-flex'>
            <input class='form-control bg-dark-light w-full' type='number' id='episode' bind:value={episode} on:input={handleEpisodes} />
            <div>
              <span class='total-episodes position-absolute text-right pointer-events-none'>/ {totalEpisodes}</span>
            </div>
          </div>
        </div>
        <div class='form-group'>
          <label class='d-block mb-5' for='score'>Your Score</label>
          <input class='w-full p-2 bg-dark-light' type='range' id='score' min='0' max='10' bind:value={score} />
          <div class='d-flex justify-content-center'>
            {#if score !== 0}
              <span class='text-center text-decoration-underline font-weight-bold'>{score}</span>
              <span class='ml-5'>/ 10</span>
            {/if}
            <span class='ml-5'>{scoreName[score]}</span>
          </div>
        </div>
      </div>
      <div class='d-flex justify-content-center'>
        {#if !status.includes('NOT IN LIST') && media?.mediaListEntry}
          <button type='button' class='btn btn-delete btn-secondary text-dark mr-20 font-weight-bold shadow-none d-flex align-items-center justify-content-center' use:click={() => toggleModal({ delete: true })}><span>Delete</span></button>
        {/if}
        <button type='button' class='btn btn-save btn-secondary text-dark font-weight-bold shadow-none d-flex align-items-center justify-content-center' use:click={() => toggleModal({ save: true })}><span>Save</span></button>
      </div>
    </div>
  {/if}
</div>

<style>
  .modal:global(.absolute-container) {
    left: -48% !important;
  }
  @media (hover: hover) and (pointer: fine) {
    .btn-delete:hover {
      color: white !important;
      background: darkred !important;
    }
    .btn-save:hover {
      color: white !important;
      background: darkgreen !important;
    }
  }
  .total-episodes {
    margin-top: 0.65rem;
    right: 4rem;
  }
  .previewAnime {
    top: 65%;
    margin-top: -25rem;
    width: 78% !important;
    left: -1.5rem;
    cursor: auto;
  }
  .viewAnime {
    top: auto;
    left: auto;
    margin-top: -20rem;
    margin-left: 5rem;
  }
  .banner {
    top: 0;
    left: auto;
    margin-top: 1rem;
    margin-left: -23.7rem;
  }
  .ml--255 {
    margin-left: -25.5rem !important;
  }
  .visible {
    animation: 0.15s ease 0s 1 load-in;
    will-change: transform, opacity;
  }
  .invisible {
    animation: load-out 0.15s ease-out forwards;
    will-change: transform, opacity;
  }
  .noList {
    color: var(--dm-input-placeholder-text-color) !important;
  }
  @keyframes load-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  @keyframes load-out {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.95);
    }
  }
</style>
