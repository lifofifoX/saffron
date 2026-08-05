<script lang="ts">
  import { CopyFeedback } from '$lib/components/common/copy-feedback.svelte'
  import { goto } from '$app/navigation'
  import TruncatedId from '$lib/components/common/TruncatedId.svelte'
  import { EXPLORER_ADDRESS_URL } from '$lib/config'
  import { DEVICE_ICONS } from '$lib/devices/kinds'
  import type { WalletConfig } from '$lib/engine/config/schema'
  import { validateWalletConfig } from '$lib/engine/config/validate'
  import {
    buildEnvelope,
    importWalletConfigJson,
    saveWalletConfig,
    WalletConfigError,
  } from '$lib/persistence/wallet-store'
  import { addToast } from '$lib/stores/ui'
  import { assertWalletBackupFileSize } from '$lib/security/input-limits'

  let restoreError = $state('')
  let warnings = $state<string[]>([])
  let parsedConfig = $state<WalletConfig | null>(null)
  let preview = $state<{ inscriptions: string; payments: string } | null>(null)
  const clipboard = new CopyFeedback()

  function reset() {
    restoreError = ''
    warnings = []
    parsedConfig = null
    preview = null
  }

  async function handleFile(event: Event & { currentTarget: EventTarget & HTMLInputElement }) {
    const inputElement = event.currentTarget
    const file = inputElement.files?.[0]
    if (!file) return

    reset()

    try {
      assertWalletBackupFileSize(file.size)
      const config = importWalletConfigJson(await file.text())
      const { envelope } = buildEnvelope(config)

      warnings = validateWalletConfig(config)
        .filter((issue) => issue.level === 'warning')
        .map((issue) => issue.message)
      parsedConfig = config
      preview = envelope.derivedAddresses
    } catch (error) {
      if (error instanceof WalletConfigError) {
        restoreError = [error.message, ...error.issues].join('. ')
      } else {
        restoreError = 'This does not look like a saffron backup file.'
      }
    } finally {
      inputElement.value = ''
    }
  }

  function confirmRestore() {
    if (!parsedConfig) return

    saveWalletConfig(parsedConfig)
    addToast('Vault restored')
    void goto('/')
  }

  function iconFor(method: string): string {
    if (method === 'trezor') return DEVICE_ICONS.TREZOR
    if (method === 'ledger') return DEVICE_ICONS.LEDGER
    return 'fa-font'
  }
</script>

<div class="rounded-xl border border-os-border bg-os-card p-5 flex flex-col gap-3">
  <div class="flex items-center gap-2">
    <i class="fa-solid fa-clock-rotate-left text-os-purple text-sm"></i>
    <h2 class="text-sm font-bold">Restore a vault</h2>
  </div>

  <p class="text-xs text-os-text">
    Have a saffron backup file? Restore the vault on this browser. Your devices are still needed to
    sign anything.
  </p>

  <label class="os-row-btn rounded-lg cursor-pointer self-start">
    <i class="fa-solid fa-folder-open text-[10px]"></i>
    Choose backup file
    <input type="file" accept=".json,application/json" class="hidden" onchange={handleFile} />
  </label>

  {#if restoreError}
    <div
      class="rounded-lg border border-os-error/40 bg-os-error/10 px-3 py-2 text-xs text-os-error"
    >
      {restoreError}
    </div>
  {/if}

  {#each warnings as warning, warningIndex (warningIndex)}
    <div
      class="rounded-lg border border-os-warning/40 bg-os-warning/10 px-3 py-2 text-xs text-os-text-light"
    >
      {warning}
    </div>
  {/each}

  {#if parsedConfig && preview}
    <div class="flex flex-col gap-3">
      <div class="overflow-hidden rounded-lg border border-os-border/70 bg-os-dark">
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <span class="text-sm font-semibold text-os-text-light">{parsedConfig.name}</span>
          <span class="os-badge">
            <i class="fa-solid fa-shield-halved text-[10px] text-os-purple"></i>
            {parsedConfig.quorum.totalSigners === 1
              ? 'single key'
              : `${parsedConfig.quorum.requiredSigners} of ${parsedConfig.quorum.totalSigners}`}
          </span>
        </div>

        {#each parsedConfig.extendedPublicKeys as cosigner (cosigner.xfp + cosigner.xpub)}
          <button
            type="button"
            class="group flex w-full cursor-pointer items-center gap-3 border-t border-os-border/60 px-4 py-2.5 text-left transition-colors hover:bg-os-hover/10"
            onclick={() => void clipboard.copy(cosigner.xfp, cosigner.xpub)}
            title="Copy xpub"
          >
            <span
              class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-os-border bg-os-hover/20"
            >
              <i class="fa-solid {iconFor(cosigner.method)} text-[11px] text-os-text"></i>
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13px] font-medium text-os-text-light">{cosigner.name}</p>
              <p class="font-mono text-[11px] text-os-text">{cosigner.xfp}</p>
            </div>
            <TruncatedId
              value={cosigner.xpub}
              head={10}
              tail={6}
              class="shrink-0 font-mono text-[11px] transition-colors {clipboard.copied(
                cosigner.xfp,
              )
                ? 'text-os-success'
                : 'text-os-text'}"
            />
            <i
              class="fa-solid {clipboard.copied(cosigner.xfp)
                ? 'fa-check text-os-success'
                : 'fa-copy text-os-text group-hover:text-os-text-light'} shrink-0 text-[10px] transition-colors"
            ></i>
          </button>
        {/each}

        <div
          class="flex items-center justify-between gap-3 border-t border-os-border/60 px-4 py-2.5"
        >
          <span class="os-label">Vault address</span>
          <span class="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              class="group flex min-w-0 cursor-pointer items-center gap-2"
              onclick={() => void clipboard.copy('address', preview?.inscriptions ?? '')}
              title="Copy address"
            >
              <TruncatedId
                value={preview.inscriptions}
                head={14}
                tail={10}
                class="font-mono text-[11px] transition-colors {clipboard.copied('address')
                  ? 'text-os-success'
                  : 'text-os-text-light'}"
              />
              <i
                class="fa-solid {clipboard.copied('address')
                  ? 'fa-check text-os-success'
                  : 'fa-copy text-os-text group-hover:text-os-text-light'} shrink-0 text-[10px] transition-colors"
              ></i>
            </button>
            <a
              href="{EXPLORER_ADDRESS_URL}/{preview.inscriptions}"
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-os-text transition hover:text-os-text-light"
              title="View on mempool.space"
            >
              <i class="fa-solid fa-cube text-[11px]"></i>
            </a>
          </span>
        </div>
      </div>

      <button class="os-row-btn os-row-btn-primary self-start" onclick={confirmRestore}>
        <i class="fa-solid fa-vault text-[10px]"></i>
        Restore vault
      </button>
    </div>
  {/if}
</div>
