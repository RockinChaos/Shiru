<script>
  import ClampedNumber from '@/components/inputs/ClampedNumber.svelte'
  import SettingCard from '@/routes/settings/components/SettingCard.svelte'
  import { playPage } from '@/modules/navigation.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { click } from '@/modules/lib/click.js'
  import { COMMON } from '@/modules/bridge.js'
  import { writable } from 'simple-store-svelte'
  import { toast } from '@/modules/lib/toast.js'
  import { Eraser } from 'lucide-svelte'
  import { onMount } from 'svelte'
  import Debug from 'debug'
  const debug = Debug('ui:playerTab')

  export let settings

  const supportsLocalFonts = 'queryLocalFonts' in self
  const fontFamilies = writable({})
  let foundFonts = null
  let fontsLoaded = false
  let selectedFont = settings.font?.name ?? ''

  async function loadFonts() {
    if (!supportsLocalFonts || fontsLoaded) return
    fontsLoaded = true
    try {
      foundFonts = await queryLocalFonts()
    } catch (error) {
      debug('Local Font Access denied:', error.message)
      fontsLoaded = false
      return
    }
    const grouped = {}
    const rules = []
    for (const font of foundFonts) (grouped[font.family] ??= []).push(font)
    for (const [family, variants] of Object.entries(grouped)) {
      grouped[family] = variants
        .map(font => {
          font.variationName = (font.fullName.replace(family, '').replace(/-/g, '').trim()) || 'Regular'
          return font
        }).sort((a, b) => {
          if (a.variationName === 'Regular') return -1
          if (b.variationName === 'Regular') return 1
          return a.variationName.localeCompare(b.variationName)
        })
      for (const font of grouped[family]) rules.push(`@font-face { font-family: 'lfa-${font.fullName}'; src: local('${font.fullName}'); }`)
    }
    const style = document.createElement('style')
    style.textContent = rules.join('\n')
    document.head.appendChild(style)
    fontFamilies.set(grouped)
  }
  async function changeFont(event) {
    const selectedFullName = event.target.value
    if (!selectedFullName) removeFont()
    if (!selectedFullName || !foundFonts) return
    const font = foundFonts.find(_font => _font.fullName === selectedFullName)
    if (!font) return
    try {
      const blob = await font.blob()
      await blob.arrayBuffer()
      settings.font = { name: font.fullName, family: font.family, value: font.postscriptName }
      selectedFont = font.fullName
      settings.missingFont = true
    } catch (error) {
      removeFont()
      debug('File Error:', error.message)
      toast.error('File Error', {
        description: `${error.message}\nTry using a different font.`,
        duration: 8_000
      })
    }
  }
  function removeFont() {
    settings.font = null
    selectedFont = ''
  }

  function setPlayerPath() {
    COMMON.pickFile('Select video player executable').then(({ path, cancelled = false }) => {
      if (cancelled) {
        toast.warning('No Path Selected', {
          description: 'The video player executable was not changed as the action was cancelled',
          duration: 5_000
        })
      } else settings.playerPath = path
    })
  }

  onMount(() => {
    if (!settings.missingFont || !supportsLocalFonts) removeFont()
    else if (settings.font?.name) {
      const style = document.createElement('style')
      style.textContent = `@font-face { font-family: 'lfa-${settings.font.name}'; src: local('${settings.font.name}'); }`
      document.head.appendChild(style)
    }
  })
</script>

<h4 class='mb-10 font-weight-bold'>Player Settings</h4>
<SettingCard title='Disable Miniplayer' description='Disables the built-in Miniplayer, this is not recommended but could be useful for small screens. When utilizing the minimize button on the Miniplayer, this setting is changed automatically.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='miniplayer-disabled' bind:checked={$playPage} />
    <label for='miniplayer-disabled'>{$playPage ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
{#if !$playPage}
  <SettingCard title='Auto-Hide Miniplayer' description='When enabled, the miniplayer will automatically shelve itself when playback is paused and unshelve when hovered or focused. When disabled, you can manually shelve and unshelve the miniplayer by clicking, tapping or swiping. Whether enabled or disabled the miniplayer will always unshelve itself when playback resumes.'>
    <div class='custom-switch fit-content'>
      <input type='checkbox' id='autohide-miniplayer' bind:checked={settings.autoHideMiniplayer} />
      <label for='autohide-miniplayer'>{settings.autoHideMiniplayer ? 'On' : 'Off'}</label>
    </div>
  </SettingCard>
{/if}
<h4 class='mb-10 font-weight-bold'>Subtitle Settings</h4>
{#if supportsLocalFonts}
  <SettingCard title='Default Subtitle Font' description={"What font to use when the current loaded video doesn't provide or specify one." + '\n' + 'This uses fonts installed on your OS.'}>
    <div class='input-group w-400 mw-full'>
      <select class='form-control bg-dark' style={settings.font?.name ? `font-family: 'lfa-${settings.font.name}'` : `font-family: Roboto`} bind:value={selectedFont} on:click|once={loadFonts} on:change={changeFont}>
        <!-- Placeholder shown when no font is selected -->
        <optgroup label='Default' style='font-family: Roboto'>
          <option value='' style='font-family: Roboto'>Roboto Medium</option>
        </optgroup>
        <!-- Placeholder shown when a font is selected but fonts have not been loaded -->
        {#if settings.font?.name && !Object.keys($fontFamilies).length}
          <optgroup label={settings.font.family ?? 'Current'}>
            <option value={settings.font.name} style="font-family: 'lfa-{settings.font.name}'">{settings.font.name}</option>
          </optgroup>
        {/if}
        {#each Object.entries($fontFamilies) as [familyName, variants] (familyName)}
          <optgroup label={familyName} style="font-family: 'lfa-{familyName}'">
            {#each variants as { fullName }, variantIndex (variantIndex)}
              <option value={fullName} style="font-family: 'lfa-{fullName}'">
                {fullName}
              </option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <div class='input-group-append'>
        <button type='button' use:click={removeFont} class='btn btn-danger btn-square input-group-append px-5 d-flex align-items-center' title='Reset to default font' disabled={!settings.font}>
          <Eraser size='1.8rem' />
        </button>
      </div>
    </div>
  </SettingCard>
  <SettingCard title='Find Missing Subtitle Fonts' description="Automatically finds and loads fonts that are missing from a video's subtitles.">
    <div class='custom-switch fit-content'>
      <input type='checkbox' id='player-missingFont' bind:checked={settings.missingFont} on:change={() => { if (!settings.missingFont) removeFont() }} />
      <label for='player-missingFont'>{settings.missingFont ? 'On' : 'Off'}</label>
    </div>
  </SettingCard>
{/if}
<SettingCard title='Fast Subtitle Rendering' description='Disables blur when rendering subtitles reducing lag. Will cause text and subtitle edges to appear sharper and in rare cases might break styling. If you want better rendering speeds without sacrificing accuracy lower the render resolution limit.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='player-sub-blur' bind:checked={settings.disableSubtitleBlur} />
    <label for='player-sub-blur'>{settings.disableSubtitleBlur ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Subtitle Render Resolution Limit' description="Max resolution to render subtitles at. If your resolution is higher than this setting the subtitles will be upscaled linearly. This will GREATLY improve rendering speeds for complex typesetting for slower devices. It's best to lower this on mobile devices which often have high pixel density where their effective resolution might be ~1440p while having small screens and slow processors.">
  <select class='form-control bg-dark mw-150 w-150 text-truncate' bind:value={settings.subtitleRenderHeight}>
    <option value='0' selected>None</option>
    <option value='1440'>1440p</option>
    <option value='1080'>1080p</option>
    <option value='720'>720p</option>
    <option value='480'>480p</option>
  </select>
</SettingCard>

<h4 class='mb-10 font-weight-bold'>Language Settings</h4>
<SettingCard title='Preferred Subtitle Language' description="What subtitle language to automatically select when a video is loaded if it exists. This won't find sources with this language automatically. If not found defaults to English.">
  <select class='form-control bg-dark mw-220 w-220 text-truncate' bind:value={settings.subtitleLanguage}>
    <option value=''>None</option>
    <option value='eng' selected>English</option>
    <option value='jpn'>Japanese</option>
    <option value='chi'>Chinese</option>
    <option value='por'>Portuguese</option>
    <option value='spa'>Spanish (Spain)</option>
    <option value='lat'>Spanish (Latin America)</option>
    <option value='ger'>German</option>
    <option value='pol'>Polish</option>
    <option value='cze'>Czech</option>
    <option value='dan'>Danish</option>
    <option value='gre'>Greek</option>
    <option value='fin'>Finnish</option>
    <option value='fre'>French</option>
    <option value='hun'>Hungarian</option>
    <option value='ita'>Italian</option>
    <option value='kor'>Korean</option>
    <option value='dut'>Dutch</option>
    <option value='nor'>Norwegian</option>
    <option value='rum'>Romanian</option>
    <option value='rus'>Russian</option>
    <option value='slo'>Slovak</option>
    <option value='swe'>Swedish</option>
    <option value='ara'>Arabic</option>
    <option value='idn'>Indonesian</option>
  </select>
</SettingCard>

<h4 class='mb-10 font-weight-bold'>Playback Settings</h4>
<SettingCard title='Autoplay Next Episode' description='Automatically starts playing next episode when a video ends.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='player-autoplay' bind:checked={settings.playerAutoplay} />
    <label for='player-autoplay'>{settings.playerAutoplay ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
{#if !SUPPORTS.isAndroid}
  <SettingCard title='Pause On Minimize' description='Pauses/Resumes video playback when minimizing/restoring the app.'>
    <div class='custom-switch fit-content'>
      <input type='checkbox' id='player-pause' bind:checked={settings.playerPause} />
      <label for='player-pause'>{settings.playerPause ? 'On' : 'Off'}</label>
    </div>
  </SettingCard>
{/if}
<SettingCard title='Auto-Complete Episodes' description='Automatically marks episodes as complete on AniList or MyAnimeList when you finish watching them. You must be logged in.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='player-autocomplete' bind:checked={settings.playerAutocomplete} />
    <label for='player-autocomplete'>{settings.playerAutocomplete ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
{#if settings.playerAutocomplete}
  <SettingCard title='Auto-Complete Threshold' description='The percentage of an episode that must be watched before it is automatically marked as complete. A higher value means more of the episode must be watched.'>
    <div class='input-group w-100 mw-full'>
      <ClampedNumber bind:bindTo={settings.playerAutocompleteThreshold} min={1} max={100} class='form-control text-right bg-dark'/>
      <div class='input-group-append'>
        <span class='input-group-text bg-dark'>%</span>
      </div>
    </div>
  </SettingCard>
{/if}
{#if SUPPORTS.isAndroid}
  <SettingCard title='Auto-Fullscreen Playback' description='If playback should automatically enter fullscreen when loading a torrent.'>
    <div class='custom-switch fit-content'>

      <input type='checkbox' id='player-auto-fullscreen' bind:checked={settings.autoFullscreen} />
      <label for='player-auto-fullscreen'>{settings.autoFullscreen ? 'On' : 'Off'}</label>
    </div>
  </SettingCard>
{/if}
<SettingCard title='Deband Video' description='Reduces banding on dark and compressed videos. High performance impact, not recommended for high quality videos.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='player-deband' bind:checked={settings.playerDeband} />
    <label for='player-deband'>{settings.playerDeband ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Seek Duration' description='Seconds to skip forward or backward when using the seek buttons or keyboard shortcuts. Higher values might negatively impact buffering speeds.'>
  <div class='input-group w-100 mw-full'>
    <ClampedNumber bind:bindTo={settings.playerSeek} min={0.2} max={360} step={0.1} class='form-control text-right bg-dark'/>
    <div class='input-group-append'>
      <span class='input-group-text bg-dark'>sec</span>
    </div>
  </div>
</SettingCard>
<SettingCard title='Chapter Source Preference' description='The chapter source to use during video playback. If your preferred source isn’t available, another source will be used automatically.'>
  <select class='form-control bg-dark mw-150 w-150 text-truncate' bind:value={settings.playerChapterSkip}>
    <option value='embedded' selected>Embedded</option>
    <option value='aniskip'>Aniskip</option>
  </select>
</SettingCard>
<SettingCard title='Auto-Skip Intro/Outro' description='Attempt to automatically skip intro and outro. This WILL sometimes skip incorrect chapters, as some of the chapter data is community sourced.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='player-skip' bind:checked={settings.playerSkip} />
    <label for='player-skip'>{settings.playerSkip ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
<SettingCard title='Title Position' description='Changes the position of the anime title overlay in the player between the top left or bottom left.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='player-title-position' bind:checked={settings.playerTitleTop} />
    <label for='player-title-position'>{settings.playerTitleTop ? 'Top Left' : 'Bottom Left'}</label>
  </div>
</SettingCard>

<h4 class='mb-10 font-weight-bold'>External Player Settings</h4>
<SettingCard title='Enable External Player' description='Tells Shiru to open a custom user-picked external video player to play video, instead of using the built-in one.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='player-external-enabled' bind:checked={settings.enableExternal} />
    <label for='player-external-enabled'>{settings.enableExternal ? 'On' : 'Off'}</label>
  </div>
</SettingCard>
{#if SUPPORTS.externalPlayer}
  <SettingCard title='External Video Player' description='Executable for an external video player. Make sure the player supports HTTP sources.'>
    <div class='input-group mw-100 w-400 mw-full'>
      <div class='input-group-prepend'>
        <button type='button' use:click={setPlayerPath} class='btn btn-primary input-group-append d-flex align-items-center justify-content-center'><span>Select Executable</span></button>
      </div>
      <input type='url' class='form-control bg-dark text-truncate mw-100' readonly value={settings.playerPath} placeholder='Choose an executable...' />
      <div class='input-group-prepend'>
        <button type='button' use:click={() => (settings.playerPath = '')} disabled={!settings.playerPath} class='btn btn-danger btn-square input-group-append px-5 d-flex align-items-center' title='Reset Location'><Eraser size='1.8rem' /></button>
      </div>
    </div>
  </SettingCard>
{/if}
