<script context='module'>
  import Changelog, { changeLog } from '@/routes/settings/components/Changelog.svelte'
  import ChangelogSk from '@/components/skeletons/ChangelogSk.svelte'
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
  {#await $changeLog}
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
          <div class='col-sm-9 text-muted'>
            <h2 class='mt-0 font-weight-bold text-white font-scale-34'>{version}</h2>
            <Changelog class='ml-10' {body} />
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
          <div class='ml-10'>
            Failed to load the changelog.<br>
            Possible causes include network connectivity problems, missing or inaccessible changelog files, or issues communicating with the update repository.
          </div>
        </div>
      </div>
    {/if}
  {:catch e}
    {#each Array(5) as _}
      <ChangelogSk />
    {/each}
  {/await}
</div>