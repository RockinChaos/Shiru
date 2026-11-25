<script>
  import { onMount } from 'svelte'
  import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, RefreshCw, Trash2, XCircle, Zap } from 'lucide-svelte'
  import DebridIcon from '@/components/DebridIcon.svelte'
  import { settings } from '@/modules/settings.js'
  import { COMMON } from '@/modules/bridge.js'
  import { debrid } from '@/modules/debrid/index.js'
  import { fastPrettyBytes } from '@/modules/util.js'
  import { toast } from '@/modules/lib/toast.js'
  import SettingCard from '@/routes/settings/components/SettingCard.svelte'
  import ConfirmButton from '@/components/inputs/ConfirmButton.svelte'

  const providers = debrid.getProviders()
  const { status: debridStatus } = debrid

  /** @type {Record<string, boolean>} */
  let showKey = {}
  /** @type {Record<string, string>} */
  let keyInputs = {}
  /** @type {Record<string, { verifying: boolean, account: import('@/modules/debrid/types.d.ts').DebridAccountInfo | null, error: string | null }>} */
  let providerStates = {}

  function syncInputsFromSettings() {
    for (const provider of providers) {
      const cfg = debrid.getConfig(provider.id)
      if (keyInputs[provider.id] === undefined) keyInputs[provider.id] = cfg.apiKey || ''
      if (!providerStates[provider.id]) providerStates[provider.id] = { verifying: false, account: null, error: null }
    }
    keyInputs = { ...keyInputs }
    providerStates = { ...providerStates }
  }

  onMount(() => {
    syncInputsFromSettings()
    const active = $settings.debridProvider
    if (active && debrid.getConfig(active)?.apiKey?.trim() && !$debridStatus.account) {
      verify(active, true)
    }
  })

  /**
   * @param {string} providerId
   * @param {boolean} [silent=false]
   */
  async function verify(providerId, silent = false) {
    const trimmedKey = (keyInputs[providerId] ?? '').trim()
    debrid.updateConfig(providerId, { apiKey: trimmedKey })
    debrid.clearCache()

    if (!trimmedKey) {
      providerStates[providerId] = { verifying: false, account: null, error: null }
      providerStates = { ...providerStates }
      return
    }

    providerStates[providerId] = { verifying: true, account: providerStates[providerId]?.account || null, error: null }
    providerStates = { ...providerStates }

    try {
      const account = await debrid.verifyProvider(providerId, { apiKey: trimmedKey })
      providerStates[providerId] = { verifying: false, account, error: null }
      providerStates = { ...providerStates }
      if (!$settings.debridEnabled && $settings.debridProvider === providerId) {
        $settings.debridEnabled = true
      }
      if (!silent) {
        toast.success(`${debrid.getProvider(providerId)?.name || 'Debrid'} Connected`, {
          description: `${account.email || account.username || 'Account verified'}${account.plan ? ` · ${account.plan}` : ''}`
        })
      }
    } catch (err) {
      const message = err?.message || 'Verification failed'
      providerStates[providerId] = { verifying: false, account: null, error: message }
      providerStates = { ...providerStates }
      if (!silent) {
        toast.error('Debrid Verification Failed', { description: message })
      }
    }
  }

  /** @param {string} providerId */
  function clearKey(providerId) {
    keyInputs[providerId] = ''
    keyInputs = { ...keyInputs }
    debrid.updateConfig(providerId, { apiKey: '' })
    debrid.clearCache()
    providerStates[providerId] = { verifying: false, account: null, error: null }
    providerStates = { ...providerStates }
    if ($settings.debridProvider === providerId) {
      $settings.debridEnabled = false
    }
    toast.success('Debrid API Key Cleared')
  }

  /**
   * @param {string} providerId
   * @param {string} key
   * @param {any} value
   */
  function updateField(providerId, key, value) {
    debrid.updateConfig(providerId, { [key]: value })
  }

  /** @param {string | null | undefined} iso */
  function formatExpiry(iso) {
    if (!iso) return null
    try {
      return new Date(iso).toLocaleDateString()
    } catch {
      return null
    }
  }

  $: activeProviderId = $settings.debridProvider
</script>

<h4 class='mb-10 font-weight-bold'>Debrid Settings</h4>
<SettingCard title='Enable Debrid Streaming' description='Stream cached and cloud-resolved anime torrents at full speed through your configured Debrid provider instead of relying solely on P2P swarms.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='debrid-enabled' bind:checked={$settings.debridEnabled} />
    <label for='debrid-enabled' aria-label='Enable Debrid Streaming'></label>
  </div>
</SettingCard>

<SettingCard title='Active Debrid Provider' description='Select which Debrid service Shiru should use for instant cache checking and cloud streaming.'>
  <select class='form-control bg-dark mw-220 w-220 text-truncate' bind:value={$settings.debridProvider} on:change={() => debrid.clearCache()}>
    {#each providers as provider (provider.id)}
      <option value={provider.id}>{provider.name}</option>
    {/each}
  </select>
</SettingCard>

<SettingCard title='Playback Behavior' description='Choose how Shiru handles torrents when Debrid is enabled. Smart streams cached torrents via Debrid and falls back to P2P when uncached.'>
  <select class='form-control bg-dark mw-220 w-220 text-truncate' bind:value={$settings.debridMode}>
    <option value='cached'>Smart (Cached -&gt; Debrid, else P2P)</option>
    <option value='always'>Always Debrid (Add uncached to cloud)</option>
    <option value='manual'>Manual (Cache badges only)</option>
  </select>
</SettingCard>

<SettingCard title='Instant Cache Check' description='Automatically query your active Debrid provider when searching torrents to display instant cached availability badges.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='debrid-check-cache' bind:checked={$settings.debridCheckCache} />
    <label for='debrid-check-cache' aria-label='Instant Cache Check'></label>
  </div>
</SettingCard>

<SettingCard title='Prioritize Cached Releases' description='Prefer cached Debrid releases when picking the Best Release and sorting search results.'>
  <div class='custom-switch fit-content'>
    <input type='checkbox' id='debrid-prioritize-cached' bind:checked={$settings.debridPrioritizeCached} />
    <label for='debrid-prioritize-cached' aria-label='Prioritize Cached Releases'></label>
  </div>
</SettingCard>

<h4 class='mb-10 mt-20 font-weight-bold'>Providers</h4>
<div class='d-flex flex-column wm-1200 w-full'>
  {#each providers as provider (provider.id)}
    {@const config = { ...debrid.getConfig(provider.id), ...($settings.debridConfigs?.[provider.id] || {}) }}
    {@const state = providerStates[provider.id] || { verifying: false, account: null, error: null }}
    {@const isSelected = activeProviderId === provider.id}
    {@const hasKey = Boolean((keyInputs[provider.id] ?? config.apiKey ?? '').trim())}
    <div class='bg-dark-light rounded p-20 mb-15 provider-card' class:active-provider={isSelected && $settings.debridEnabled} style:--provider-accent={provider.accentColor || '#2bb690'}>
      <div class='d-flex flex-wrap align-items-center justify-content-between gap-10 mb-15'>
        <div class='d-flex align-items-center gap-15 min-w-0'>
          <div class='provider-icon d-flex align-items-center justify-content-center rounded font-weight-bold'>
            <DebridIcon providerId={provider.id} size='2.5rem' />
          </div>
          <div class='min-w-0'>
            <div class='d-flex align-items-center flex-wrap gap-8'>
              <span class='font-size-16 font-weight-bold text-white'>{provider.name}</span>
              {#if isSelected && $settings.debridEnabled}
                <span class='badge badge-primary font-size-10 font-weight-bold px-8 py-2 d-inline-flex align-items-center'>
                  <Zap size='1.1rem' class='mr-5' />Active
                </span>
              {/if}
              {#if state.account?.authenticated}
                <span class='badge bg-success-subtle text-success font-size-10 font-weight-bold px-8 py-2 d-inline-flex align-items-center'>
                  <CheckCircle2 size='1.1rem' class='mr-5' />{state.account.plan || 'Verified'}
                </span>
              {:else if state.error}
                <span class='badge bg-danger-subtle text-danger font-size-10 font-weight-bold px-8 py-2 d-inline-flex align-items-center'>
                  <XCircle size='1.1rem' class='mr-5' />Error
                </span>
              {/if}
            </div>
            <div class='text-muted font-size-12 mt-2'>{provider.description}</div>
          </div>
        </div>

        <div class='d-flex align-items-center gap-8'>
          {#if !isSelected}
            <button
              type='button'
              class='btn btn-sm bg-dark font-size-12 font-weight-semi-bold'
              on:click={() => { $settings.debridProvider = provider.id; debrid.clearCache() }}>
              Select Provider
            </button>
          {/if}
          {#if provider.apiKeyUrl}
            <button
              type='button'
              class='btn btn-sm bg-dark font-size-12 font-weight-semi-bold d-inline-flex align-items-center'
              on:click={() => COMMON.openURI(provider.apiKeyUrl)}>
              <ExternalLink size='1.3rem' class='mr-5' />Get API Key
            </button>
          {/if}
        </div>
      </div>

      <div class='bg-dark rounded p-15'>
        <label class='font-size-12 font-weight-bold text-muted d-flex align-items-center mb-8' for='debrid-key-{provider.id}'>
          <KeyRound size='1.3rem' class='mr-5' />API Key
        </label>
        <div class='d-flex flex-wrap align-items-center gap-10'>
          <div class='input-group flex-grow-1 mw-450'>
            <input
              id='debrid-key-{provider.id}'
              type={showKey[provider.id] ? 'text' : 'password'}
              class='form-control bg-dark-light'
              placeholder='Paste your {provider.name} API key...'
              autocomplete='off'
              spellcheck='false'
              value={keyInputs[provider.id] ?? ''}
              on:input={e => { keyInputs[provider.id] = e.currentTarget.value }}
              on:keydown={e => { if (e.key === 'Enter') verify(provider.id) }} />
            <div class='input-group-append'>
              <button
                type='button'
                class='btn bg-dark-light d-flex align-items-center justify-content-center px-10'
                title={showKey[provider.id] ? 'Hide API key' : 'Show API key'}
                on:click={() => { showKey[provider.id] = !showKey[provider.id]; showKey = { ...showKey } }}>
                {#if showKey[provider.id]}
                  <EyeOff size='1.6rem' />
                {:else}
                  <Eye size='1.6rem' />
                {/if}
              </button>
            </div>
          </div>

          <button
            type='button'
            class='btn btn-primary font-weight-bold d-inline-flex align-items-center'
            disabled={!hasKey || state.verifying}
            on:click={() => verify(provider.id)}>
            <span class='d-inline-flex mr-5' class:spin={state.verifying}><RefreshCw size='1.4rem' /></span>
            {state.verifying ? 'Verifying...' : 'Save & Verify'}
          </button>

          {#if config.apiKey}
            <ConfirmButton
              class='btn btn-danger d-inline-flex align-items-center justify-content-center px-12'
              confirmText='Clear'
              title='Remove saved API key'
              click={() => clearKey(provider.id)}>
              <Trash2 size='1.5rem' />
            </ConfirmButton>
          {/if}
        </div>

        {#if state.account?.authenticated}
          <div class='d-flex flex-wrap align-items-center gap-15 mt-12 pt-10 border-top border-dark-light font-size-12 text-muted'>
            {#if state.account.email}
              <span>Account: <strong class='text-white'>{state.account.email}</strong></span>
            {/if}
            {#if state.account.plan}
              <span>Plan: <strong class='text-white'>{state.account.plan}</strong></span>
            {/if}
            {#if state.account.expiresAt}
              <span>Expires: <strong class='text-white'>{formatExpiry(state.account.expiresAt)}</strong></span>
            {/if}
            {#if state.account.totalDownloaded}
              <span>Downloaded: <strong class='text-white'>{fastPrettyBytes(state.account.totalDownloaded)}</strong></span>
            {/if}
          </div>
        {:else if state.error}
          <div class='mt-10 text-danger font-size-12 font-weight-semi-bold'>
            {state.error}
          </div>
        {/if}

        {#if provider.settingsSchema?.length}
          <div class='d-flex flex-column gap-10 mt-15 pt-15 border-top border-dark-light'>
            {#each provider.settingsSchema as field (field.key)}
              <div class='d-flex align-items-center justify-content-between flex-wrap gap-10'>
                <div class='min-w-0'>
                  <div class='font-size-13 font-weight-bold text-white'>{field.label}</div>
                  {#if field.description}
                    <div class='text-muted font-size-12'>{field.description}</div>
                  {/if}
                </div>
                {#if field.type === 'select'}
                  <select
                    class='form-control bg-dark-light mw-200 w-200 text-truncate'
                    value={config[field.key] ?? field.defaultValue}
                    on:change={e => {
                      const raw = e.currentTarget.value
                      const matched = field.options?.find(opt => String(opt.value) === raw)
                      updateField(provider.id, field.key, matched ? matched.value : raw)
                    }}>
                    {#each field.options || [] as opt (opt.value)}
                      <option value={opt.value}>{opt.label}</option>
                    {/each}
                  </select>
                {:else if field.type === 'toggle'}
                  <div class='custom-switch fit-content'>
                    <input
                      type='checkbox'
                      id='debrid-{provider.id}-{field.key}'
                      checked={Boolean(config[field.key] ?? field.defaultValue)}
                      on:change={e => updateField(provider.id, field.key, e.currentTarget.checked)} />
                    <label for='debrid-{provider.id}-{field.key}' aria-label={field.label}></label>
                  </div>
                {:else}
                  <input
                    type={field.type === 'secret' ? 'password' : 'text'}
                    class='form-control bg-dark-light mw-220 w-220'
                    placeholder={field.placeholder || ''}
                    value={config[field.key] ?? field.defaultValue ?? ''}
                    on:change={e => updateField(provider.id, field.key, e.currentTarget.value)} />
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .provider-card {
    border: 1px solid rgba(255, 255, 255, 0.06);
    transition: border-color 0.2s ease, background-color 0.2s ease;
  }
  .provider-card.active-provider {
    border-color: color-mix(in srgb, var(--provider-accent, #2bb690) 40%, transparent);
  }
  .provider-icon {
    width: 4.2rem;
    height: 4.2rem;
    flex-shrink: 0;
    color: var(--provider-accent, var(--accent-color));
    background: color-mix(in srgb, var(--provider-accent, #2bb690) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--provider-accent, #2bb690) 30%, transparent);
  }
  .bg-success-subtle {
    background: rgba(34, 197, 94, 0.14);
  }
  .bg-danger-subtle {
    background: rgba(239, 68, 68, 0.14);
  }
  .border-dark-light {
    border-color: rgba(255, 255, 255, 0.06) !important;
  }
  .gap-8 {
    gap: 0.8rem;
  }
  .gap-10 {
    gap: 1rem;
  }
  .gap-15 {
    gap: 1.5rem;
  }
  .spin {
    animation: debrid-spin 1s linear infinite;
  }
  @keyframes debrid-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
