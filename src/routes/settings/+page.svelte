<script lang="ts">
  import { CopyFeedback } from '$lib/components/common/copy-feedback.svelte'
  import { errorMessage } from '$lib/utils/error-message'
  import { goto } from '$app/navigation'
  import { DEFAULT_ENDPOINTS, endpoints, type Endpoints, endpointsSchema } from '$lib/config'
  import { DEVICE_ICONS, DEVICE_LABELS } from '$lib/devices/kinds'
  import { ledgerPolicyName, registeredLedgerPolicyHmac } from '$lib/devices/ledger-direct'
  import { registerLedgerPolicy } from '$lib/devices/ledger-policy'
  import {
    exportWalletConfigJson,
    renameCosigner,
    renameVault,
  } from '$lib/persistence/wallet-store'
  import { addToast, openModal } from '$lib/stores/ui'
  import { activeVaultId, forgetWallet, hasWallet, walletConfig } from '$lib/stores/wallet-config'
  import { get } from 'svelte/store'

  let registeringXfp = $state<string | null>(null)
  let editingName = $state<string | null>(null)
  let editingValue = $state('')
  const clipboard = new CopyFeedback()

  function startEditing(key: string, currentValue: string) {
    editingName = key
    editingValue = currentValue
  }

  function commitEditing() {
    const key = editingName
    const value = editingValue.trim()
    editingName = null
    if (!key || !value) return

    try {
      if (key === 'vault') renameVault(value)
      else renameCosigner(key, value)
    } catch (error) {
      addToast(errorMessage(error), 'error')
    }
  }

  function handleEditKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') commitEditing()
    if (event.key === 'Escape') editingName = null
  }

  function focusOnMount(node: HTMLInputElement) {
    node.focus()
    node.select()
  }
  let registerMessages = $state<string[]>([])
  let registerError = $state('')

  let ledgerCosigners = $derived(
    ($walletConfig?.extendedPublicKeys ?? []).filter((cosigner) => cosigner.method === 'ledger'),
  )
  let currentLedgerPolicyName = $derived($walletConfig ? ledgerPolicyName($walletConfig) : '')

  function hmacFor(xfp: string): string | null {
    return $walletConfig ? (registeredLedgerPolicyHmac($walletConfig, xfp) ?? null) : null
  }

  function downloadBackup() {
    try {
      const json = exportWalletConfigJson()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'saffron-vault-backup.json'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      addToast(errorMessage(error), 'error')
    }
  }

  async function registerPolicy(xfp: string) {
    const config = $walletConfig
    const vaultId = $activeVaultId
    if (!config || !vaultId || registeringXfp) return
    const cosigner = config.extendedPublicKeys.find(
      (candidate) => candidate.xfp.toLowerCase() === xfp.toLowerCase(),
    )
    if (!cosigner) return

    registeringXfp = xfp
    registerError = ''
    registerMessages = []

    try {
      await registerLedgerPolicy({
        vaultId,
        walletConfig: config,
        cosigner,
        onProgress: (progress) => {
          if (progress.state === 'awaitingDevice') registerMessages = progress.messages
        },
      })
      addToast('Vault policy registered on the Ledger')
    } catch (error) {
      registerError = errorMessage(error)
    } finally {
      registeringXfp = null
      registerMessages = []
    }
  }

  function confirmForget() {
    openModal('confirm', {
      title: 'Forget this vault?',
      message:
        'This removes the vault from this browser. Your keys stay on the hardware devices, and you can recreate the vault from them at any time. Download a backup first if you have not.',
      confirmLabel: 'Forget vault',
      destructive: true,
      onConfirm: () => {
        forgetWallet()
        void goto(get(hasWallet) ? '/' : '/setup')
      },
    })
  }

  function resetEndpoints() {
    endpoints.set({ ...DEFAULT_ENDPOINTS })
    addToast('Endpoints reset')
  }

  function commitEndpoint(key: keyof Endpoints) {
    return (event: Event & { currentTarget: EventTarget & HTMLInputElement }) => {
      const parsed = endpointsSchema.shape[key].safeParse(event.currentTarget.value)
      if (!parsed.success) {
        addToast('Use an HTTPS URL, or HTTP on localhost for development', 'error')
        event.currentTarget.value = get(endpoints)[key]
        return
      }

      endpoints.update((current) => ({ ...current, [key]: parsed.data }))
    }
  }
</script>

<div class="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-4">
  <h1 class="text-[21px] font-semibold tracking-tight text-os-text-light">Settings</h1>

  {#if $walletConfig}
    <section class="os-form-section">
      <div class="os-form-section-header">
        <div>
          <h2 class="os-form-section-title">Vault</h2>
          <p class="os-form-section-desc">The keys that control this vault</p>
        </div>
      </div>

      <div class="os-form-section-body flex flex-col gap-5">
        <div class="grid grid-cols-2 gap-5">
          <div>
            <span class="os-metric-label">Name</span>
            {#if editingName === 'vault'}
              <span class="flex items-center gap-2">
                <input
                  type="text"
                  bind:value={editingValue}
                  use:focusOnMount
                  onblur={commitEditing}
                  onkeydown={handleEditKeydown}
                  class="-my-[2px] h-[24px] min-w-[4ch] max-w-[240px] border-0 border-b border-os-orange/50 bg-transparent p-0 text-[15px] font-semibold text-os-text-light focus:outline-none"
                  style="field-sizing: content"
                />
                <button
                  type="button"
                  class="flex h-5 w-5 shrink-0 items-center justify-center text-os-success/80 transition hover:text-os-success"
                  onmousedown={(event) => {
                    event.preventDefault()
                    commitEditing()
                  }}
                  aria-label="Save name"
                  title="Save"
                >
                  <i class="fa-solid fa-check text-[11px]"></i>
                </button>
              </span>
            {:else}
              <button
                type="button"
                class="group flex items-center gap-2 text-left"
                onclick={() => startEditing('vault', $walletConfig?.name ?? '')}
                title="Rename vault"
              >
                <span class="os-metric-value">{$walletConfig.name}</span>
                <i
                  class="fa-solid fa-pen text-[10px] text-os-text opacity-0 transition group-hover:opacity-100"
                ></i>
              </button>
            {/if}
          </div>
          <div>
            <span class="os-metric-label">Quorum</span>
            <span class="os-metric-value">
              {$walletConfig.quorum.requiredSigners} of {$walletConfig.quorum.totalSigners}
              key{$walletConfig.quorum.totalSigners === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="os-metric-label">Keys</span>
          {#each $walletConfig.extendedPublicKeys as cosigner (cosigner.xfp + cosigner.xpub)}
            <div class="overflow-hidden rounded-lg border border-os-border/70 bg-os-dark">
              <div class="flex items-center gap-3 px-3.5 py-2.5">
                <span
                  class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-os-border bg-os-hover/20"
                >
                  <i
                    class="fa-solid {cosigner.method === 'trezor'
                      ? 'fa-shield'
                      : cosigner.method === 'ledger'
                        ? 'fa-key'
                        : 'fa-font'} text-[11px] text-os-text"
                  ></i>
                </span>
                {#if editingName === cosigner.xfp}
                  <span class="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="text"
                      bind:value={editingValue}
                      use:focusOnMount
                      onblur={commitEditing}
                      onkeydown={handleEditKeydown}
                      class="h-[22px] min-w-[4ch] max-w-[220px] border-0 border-b border-os-orange/50 bg-transparent p-0 text-[13px] font-medium text-os-text-light focus:outline-none"
                      style="field-sizing: content"
                    />
                    <button
                      type="button"
                      class="flex h-5 w-5 shrink-0 items-center justify-center text-os-success/80 transition hover:text-os-success"
                      onmousedown={(event) => {
                        event.preventDefault()
                        commitEditing()
                      }}
                      aria-label="Save name"
                      title="Save"
                    >
                      <i class="fa-solid fa-check text-[11px]"></i>
                    </button>
                  </span>
                {:else}
                  <button
                    type="button"
                    class="group flex min-w-0 items-center gap-2 text-left"
                    onclick={() => startEditing(cosigner.xfp, cosigner.name)}
                    title="Rename key"
                  >
                    <span class="truncate text-[13px] font-medium text-os-text-light">
                      {cosigner.name}
                    </span>
                    <i
                      class="fa-solid fa-pen text-[10px] text-os-text opacity-0 transition group-hover:opacity-100"
                    ></i>
                  </button>
                {/if}
              </div>

              <button
                type="button"
                class="group flex w-full cursor-pointer items-center justify-between gap-3 border-t border-os-border/60 px-3.5 py-2.5 text-left transition-colors hover:bg-os-hover/10"
                onclick={() => void clipboard.copy(`${cosigner.xfp}:xfp`, cosigner.xfp)}
                title="Copy fingerprint"
              >
                <span
                  class="shrink-0 font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-os-text/60"
                >
                  Fingerprint
                </span>
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    class="truncate font-mono text-[11px] transition-colors {clipboard.copied(
                      `${cosigner.xfp}:xfp`,
                    )
                      ? 'text-os-success'
                      : 'text-os-text-light'}"
                  >
                    {cosigner.xfp}
                  </span>
                  <i
                    class="fa-solid {clipboard.copied(`${cosigner.xfp}:xfp`)
                      ? 'fa-check text-os-success'
                      : 'fa-copy text-os-text group-hover:text-os-text-light'} shrink-0 text-[10px] transition-colors"
                  ></i>
                </span>
              </button>

              <button
                type="button"
                class="group flex w-full cursor-pointer items-center justify-between gap-3 border-t border-os-border/60 px-3.5 py-2.5 text-left transition-colors hover:bg-os-hover/10"
                onclick={() => void clipboard.copy(`${cosigner.xfp}:xpub`, cosigner.xpub)}
                title="Copy xpub"
              >
                <span
                  class="shrink-0 font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-os-text/60"
                >
                  Xpub
                </span>
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    class="truncate font-mono text-[11px] transition-colors {clipboard.copied(
                      `${cosigner.xfp}:xpub`,
                    )
                      ? 'text-os-success'
                      : 'text-os-text-light'}"
                  >
                    {cosigner.xpub}
                  </span>
                  <i
                    class="fa-solid {clipboard.copied(`${cosigner.xfp}:xpub`)
                      ? 'fa-check text-os-success'
                      : 'fa-copy text-os-text group-hover:text-os-text-light'} shrink-0 text-[10px] transition-colors"
                  ></i>
                </span>
              </button>
            </div>
          {/each}
        </div>
      </div>

      <div class="os-form-section-footer">
        <button class="os-row-btn" onclick={downloadBackup}>
          <i class="fa-solid fa-download text-[10px]"></i>
          Download backup file
        </button>
      </div>
    </section>

    {#if ledgerCosigners.length > 0}
      <section class="os-form-section">
        <div class="os-form-section-header">
          <div>
            <h2 class="os-form-section-title">Ledger vault policies</h2>
            <p class="os-form-section-desc">
              A registered Ledger remembers the vault instead of asking you to approve the full
              policy on every signature. Confirm the exact name
              <span class="font-mono text-os-text-light">{currentLedgerPolicyName}</span> on the device.
            </p>
          </div>
        </div>

        <div class="os-form-section-body flex flex-col gap-2">
          {#each ledgerCosigners as cosigner (cosigner.xfp)}
            {@const hmac = hmacFor(cosigner.xfp)}
            <div
              class="flex items-center gap-3 rounded-lg border border-os-border/70 bg-os-dark px-3 py-2.5"
            >
              <i class="fa-solid {DEVICE_ICONS.LEDGER} text-os-purple text-xs"></i>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-semibold text-os-text-light">{cosigner.name}</p>
                <p class="font-mono text-[10px] text-os-text">{cosigner.xfp}</p>
              </div>

              {#if hmac}
                <span class="flex items-center gap-1.5 text-[11px] text-os-success">
                  <i class="fa-solid fa-circle-check"></i>
                  Registered
                </span>
              {:else if registeringXfp === cosigner.xfp}
                <span class="flex items-center gap-1.5 text-[11px] text-os-text-light">
                  <span class="os-spinner"></span>
                  Waiting for {DEVICE_LABELS.LEDGER}
                </span>
              {:else}
                <button
                  class="os-row-btn os-row-btn-primary rounded-lg"
                  disabled={registeringXfp !== null}
                  onclick={() => void registerPolicy(cosigner.xfp)}
                >
                  Register
                </button>
              {/if}
            </div>

            {#if registeringXfp === cosigner.xfp && registerMessages.length > 0}
              {#each registerMessages as message, messageIndex (messageIndex)}
                <p class="pl-2 text-[11px] text-os-text">{message}</p>
              {/each}
            {/if}
          {/each}

          {#if registerError}
            <p class="text-[11px] text-os-error">{registerError}</p>
          {/if}
        </div>
      </section>
    {/if}
  {/if}

  <section class="os-form-section">
    <div class="os-form-section-header">
      <div>
        <h2 class="os-form-section-title">Data sources</h2>
        <p class="os-form-section-desc">The APIs Saffron reads holdings and fees from</p>
      </div>
    </div>

    <div class="os-form-section-body grid gap-4">
      <label class="flex flex-col gap-2">
        <span class="os-label">Ord API</span>
        <input
          type="text"
          value={$endpoints.ordBaseUrl}
          onchange={commitEndpoint('ordBaseUrl')}
          spellcheck="false"
          class="os-input w-full"
        />
      </label>
      <label class="flex flex-col gap-2">
        <span class="os-label">Electrs API</span>
        <input
          type="text"
          value={$endpoints.electrsBaseUrl}
          onchange={commitEndpoint('electrsBaseUrl')}
          spellcheck="false"
          class="os-input w-full"
        />
      </label>
      <label class="flex flex-col gap-2">
        <span class="os-label">Content</span>
        <input
          type="text"
          value={$endpoints.contentBaseUrl}
          onchange={commitEndpoint('contentBaseUrl')}
          spellcheck="false"
          class="os-input w-full"
        />
      </label>
    </div>

    <div class="os-form-section-footer">
      <button class="os-row-btn" onclick={resetEndpoints}>Reset to defaults</button>
    </div>
  </section>

  {#if $walletConfig}
    <section class="os-form-section border-os-error/30">
      <div class="os-form-section-header">
        <div>
          <h2 class="os-form-section-title text-os-error">Danger zone</h2>
          <p class="os-form-section-desc">
            Forgetting the vault only clears this browser. The keys on your devices are untouched.
          </p>
        </div>
      </div>

      <div class="os-form-section-body">
        <button class="os-row-btn os-row-btn-danger" onclick={confirmForget}>Forget vault</button>
      </div>
    </section>
  {/if}
</div>
