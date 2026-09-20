<script>
  import { anilistClient } from '@/modules/providers/anilist/anilist.js'
  import User from '@/modals/details/components/User.svelte'
  import Helper from '@/modules/providers/helper.js'

  /** @type {import('@/modules/providers/anilist/al.d.ts').Media} */
  export let media
  $: following = anilistClient.userID?.viewer?.data?.Viewer && anilistClient.following({ id: media.id })
</script>

{#await following then res}
  {@const following = [...new Map(res?.data?.Page?.mediaList.filter(item => !Helper.isAuthorized() || item.user.id !== Helper.getUser().id).map(item => [item.user.name, item])).values()]}
  {#if following?.length}
    <div class='position-relative mt-10 d-flex flex-wrap align-items-center justify-content-center justify-content-sm-start'>
      {#each following.slice(0, 11) as user, index (user.user.id ?? index)}
        <div class='avatar z-5'>
          <User user={{...user.user, score: user.score, status: user.status, progress: user.progress }} style='z-index: {index + 1}; margin-left: {index > 0 ? `-1rem` : `0`}'/>
        </div>
      {/each}
      {#if following.length > 11}
        <div class='bg-dark-light rounded-circle h-50 w-50 ml--1 mb-4 d-flex align-items-center justify-content-center font-size-14 font-weight-bold' style='border: .3rem solid hsla(var(--dark-color-hsl), 0.9)'>
          +{following.length - 11}
        </div>
      {/if}
    </div>
  {/if}
{/await}

<style>
  .avatar {
    will-change: z-index;
    transition: z-index .05s;
  }
  .avatar:has(*:focus) {
    z-index: 10 !important;
  }
  .avatar:hover {
    z-index: 10 !important;
  }
</style>
