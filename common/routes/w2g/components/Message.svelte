<script>
  import SmartImage from '@/components/visual/SmartImage.svelte'
  import { getAvatar } from '@/modules/util.js'

  /** @type {import('@/modules/providers/anilist/al.d.ts').Viewer | import('@/modules/providers/myanimelist/mal.d.ts').Viewer | {}} */
  export let user = {}

  /** @type {string[]} */
  export let messages = []

  /** @type {Date} */
  export let time

  /** @type {'incoming' | 'outgoing'} */
  export let type = 'incoming'
  const incoming = type === 'incoming'
</script>

<div class='message d-flex flex-row mt-15 overflow-y-auto' class:flex-row={incoming} class:flex-row-reverse={!incoming}>
  <SmartImage class='w-50 h-50 rounded-circle p-5 mt-auto' images={[user?.avatar?.medium, user?.picture, getAvatar(user?.id || 'Anonymous')]}/>
  <div class='d-flex flex-column px-10 align-items-start flex-auto' class:align-items-start={incoming} class:align-items-end={!incoming}>
    <div class='pb-5 d-flex flex-row align-items-center px-5'>
      <div class='font-weight-bold font-size-18 line-height-normal'>
        {user?.name || 'Anonymous'}
      </div>
      <div class='text-muted pl-10 font-size-12 line-height-normal'>
        {time.toLocaleTimeString()}
      </div>
    </div>
    {#each messages as message}
      <div class='bg-dark-light py-10 px-15 rounded-top rounded-right mb-5 select-text pre-wrap text-break-word' style='max-width: calc(100% - 10rem)'
        class:bg-dark-light={incoming} class:bg-accent={!incoming}
        class:rounded-right={incoming} class:rounded-left={!incoming}>
        {message}
      </div>
    {/each}
  </div>
</div>

<style>
  .message {
    --base-border-radius: 1.3rem;
  }
  .bg-accent {
    background-color: var(--accent-color);
  }
  .flex-auto {
    flex: auto;
  }
</style>
