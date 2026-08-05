<script lang="ts">
  import TruncatedId from '$lib/components/common/TruncatedId.svelte'
  import { scriptHexToAddress } from '$lib/engine/address'
  import type { PsbtAnalysis } from '$lib/engine/psbt/analyze'

  type Props = {
    analysis: PsbtAnalysis
  }

  let { analysis }: Props = $props()

  const severityClasses = {
    info: 'border-os-purple/40 bg-os-purple/10 text-os-text-light',
    warning: 'border-os-warning/40 bg-os-warning/10 text-os-text-light',
    danger: 'border-os-error/50 bg-os-error/10 text-os-error',
  } as const

  const severityIcons = {
    info: 'fa-circle-info text-os-purple',
    warning: 'fa-triangle-exclamation text-os-warning',
    danger: 'fa-skull-crossbones text-os-error',
  } as const

  function inputBadge(input: PsbtAnalysis['inputs'][number]): { label: string; classes: string } {
    if (input.class.kind === 'external') {
      return { label: 'External', classes: 'bg-os-hover/40 text-os-text' }
    }

    return input.class.branch === 0
      ? { label: 'Inscriptions', classes: 'bg-os-purple/15 text-os-purple' }
      : { label: 'Payments', classes: 'bg-os-orange/15 text-os-orange' }
  }

  function findingsForInput(inputIndex: number) {
    return analysis.inscriptionFindings.filter((finding) => finding.inputIndex === inputIndex)
  }

  function formatSats(sats: number | null): string {
    if (sats === null) return 'unknown'
    return `${sats.toLocaleString('en-US')} sats`
  }

  function outputAddress(scriptHex: string | null): string | null {
    if (!scriptHex) return null

    try {
      return scriptHexToAddress(scriptHex)
    } catch {
      return null
    }
  }
</script>

<div class="flex flex-col gap-3">
  {#each analysis.warnings as warning, warningIndex (warningIndex)}
    <div
      class="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs {severityClasses[
        warning.severity
      ]}"
    >
      <i class="fa-solid {severityIcons[warning.severity]} mt-0.5"></i>
      <span>{warning.message}</span>
    </div>
  {/each}

  <div class="overflow-hidden rounded-xl border border-os-border bg-os-card">
    <div class="flex items-center justify-between border-b border-os-border px-4 py-2.5">
      <h3 class="text-xs font-bold uppercase tracking-wide text-os-text">Inputs</h3>
      <span class="text-[11px] text-os-text" style="font-variant-numeric: tabular-nums">
        fee {formatSats(analysis.feeSats)}
        {#if analysis.feeRateSatVb !== null}
          · {analysis.feeRateSatVb} sat/vB
        {/if}
      </span>
    </div>

    {#each analysis.inputs as input (input.inputIndex)}
      {@const badge = inputBadge(input)}
      {@const findings = findingsForInput(input.inputIndex)}
      <div class="border-b border-os-border/50 px-4 py-2.5 last:border-b-0">
        <div class="flex items-center gap-3">
          <span class="w-5 text-[11px] text-os-text" style="font-variant-numeric: tabular-nums">
            {input.inputIndex}
          </span>
          <TruncatedId
            value="{input.txid}:{input.vout}"
            head={10}
            tail={8}
            class="flex-1 text-xs text-os-text-light"
          />
          <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold {badge.classes}"
            >{badge.label}</span
          >
          <span
            class="w-24 text-right text-xs text-os-text-light"
            style="font-variant-numeric: tabular-nums"
          >
            {formatSats(input.valueSats)}
          </span>
        </div>

        {#each findings as finding (finding.inscriptionId)}
          <div class="mt-1.5 flex items-center gap-2 pl-8 text-[11px]">
            <span class="text-[11px] leading-none text-os-purple">◉</span>
            <TruncatedId
              value={finding.inscriptionId}
              head={10}
              tail={6}
              class="text-os-text-light"
            />
            <span class="text-os-text">
              {#if finding.outputIndex === 'fee'}
                would burn as fees
              {:else if finding.landsInVault}
                stays in the vault (output {finding.outputIndex})
              {:else}
                goes to output {finding.outputIndex}
              {/if}
            </span>
          </div>
        {/each}
      </div>
    {/each}
  </div>

  <div class="overflow-hidden rounded-xl border border-os-border bg-os-card">
    <div class="border-b border-os-border px-4 py-2.5">
      <h3 class="text-xs font-bold uppercase tracking-wide text-os-text">Outputs</h3>
    </div>

    {#each analysis.outputs as output (output.outputIndex)}
      {@const address = outputAddress(output.scriptHex)}
      <div class="flex items-center gap-3 border-b border-os-border/50 px-4 py-2.5 last:border-b-0">
        <span class="w-5 text-[11px] text-os-text" style="font-variant-numeric: tabular-nums">
          {output.outputIndex}
        </span>
        {#if address}
          <span class="min-w-0 flex-1 break-all font-mono text-xs text-os-text-light">
            {address}
          </span>
        {:else}
          <TruncatedId
            value={output.scriptHex ?? 'unknown script'}
            head={14}
            tail={8}
            class="flex-1 text-xs text-os-text-light"
          />
        {/if}
        {#if output.class.kind === 'ours'}
          <span
            class="rounded-full bg-os-success-muted px-2 py-0.5 text-[10px] font-semibold text-os-success"
          >
            {output.class.branch === 0 ? 'Back to vault' : 'Change'}
          </span>
        {/if}
        <span
          class="w-24 text-right text-xs text-os-text-light"
          style="font-variant-numeric: tabular-nums"
        >
          {output.valueSats.toLocaleString('en-US')} sats
        </span>
      </div>
    {/each}
  </div>
</div>
