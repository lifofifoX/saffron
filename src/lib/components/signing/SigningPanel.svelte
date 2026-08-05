<script lang="ts">
  import { DEVICE_ICONS } from '$lib/devices/kinds'

  import { CopyFeedback } from '$lib/components/common/copy-feedback.svelte'

  import ImportSignedPanel from './ImportSignedPanel.svelte'
  import type { SignSession } from './sign-session.svelte'
  import SignRowStatus from './SignRowStatus.svelte'

  type Props = {
    session: SignSession
  }

  let { session }: Props = $props()

  let importOpenXfp = $state<string | null>(null)
  const psbtClipboard = new CopyFeedback()
</script>

<div class="rounded-xl border border-os-border bg-os-card p-4 flex flex-col gap-3">
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-bold">Signatures</h3>
    <span class="text-[11px] text-os-text" style="font-variant-numeric: tabular-nums">
      {session.signedCount} of {session.requiredSigners} collected
    </span>
  </div>

  <div class="flex flex-col gap-2">
    {#each session.rows as row, rowIndex (row.cosigner.xfp)}
      {@const gate = session.canSignWith(row)}
      <div class="rounded-lg border border-os-border/70 bg-os-dark px-3 py-2.5">
        <div class="flex items-center gap-3">
          <span
            class="flex h-8 w-8 items-center justify-center rounded-lg bg-os-purple/15 text-os-purple"
          >
            <i class="fa-solid {row.device ? DEVICE_ICONS[row.device] : 'fa-font'} text-xs"></i>
          </span>

          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-os-text-light">{row.cosigner.name}</p>
            <p class="font-mono text-[10px] text-os-text">{row.cosigner.xfp}</p>
          </div>

          {#if row.device === null && (row.status === 'pending' || row.status === 'error')}
            <span class="flex shrink-0 items-center gap-2">
              <button
                class="os-row-btn os-row-btn-surface"
                onclick={() => void psbtClipboard.copy('psbt', session.partialPsbtBase64())}
              >
                {#if psbtClipboard.copied('psbt')}
                  <i class="fa-solid fa-check text-[10px] text-os-success"></i>
                  Copied
                {:else}
                  Copy PSBT
                {/if}
              </button>
              <button
                class="os-row-btn os-row-btn-surface"
                onclick={() =>
                  (importOpenXfp = importOpenXfp === row.cosigner.xfp ? null : row.cosigner.xfp)}
              >
                Import
              </button>
            </span>
          {:else}
            <SignRowStatus
              status={row.status}
              allowed={gate.allowed}
              reason={gate.reason ?? ''}
              onSign={() => void session.signWith(rowIndex)}
              onRetry={() => session.retry(rowIndex)}
            />
          {/if}
        </div>

        {#if row.status === 'busy' && row.messages.length > 0}
          <div class="mt-2 flex flex-col gap-1 border-t border-os-border/50 pt-2">
            {#each row.messages as message, messageIndex (messageIndex)}
              <p class="text-[11px] text-os-text">{message}</p>
            {/each}
          </div>
        {/if}

        {#if row.status === 'error' && row.error}
          <p class="mt-2 border-t border-os-border/50 pt-2 text-[11px] text-os-error">
            {row.error}
          </p>
        {/if}

        {#if row.device === null && importOpenXfp === row.cosigner.xfp && (row.status === 'pending' || row.status === 'error')}
          <div class="mt-2 border-t border-os-border/50 pt-2.5">
            <ImportSignedPanel {session} onImported={() => (importOpenXfp = null)} />
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
