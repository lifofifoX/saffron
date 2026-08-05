<script lang="ts">
  import CopyButton from '$lib/components/common/CopyButton.svelte'
  import SatsAmount from '$lib/components/common/SatsAmount.svelte'
  import TruncatedId from '$lib/components/common/TruncatedId.svelte'
  import { BROADCAST_URL } from '$lib/config'
  import type { FinalizedArtifacts } from '$lib/engine/psbt/finalize'

  type Props = {
    artifacts: FinalizedArtifacts | null
    partialPsbtBase64: string
    signedCount: number
    requiredSigners: number
  }

  let { artifacts, partialPsbtBase64, signedCount, requiredSigners }: Props = $props()

  function download(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }
</script>

<div class="rounded-xl border border-os-border bg-os-card p-4 flex flex-col gap-3">
  {#if artifacts}
    <div class="flex items-center gap-2">
      <i class="fa-solid fa-circle-check text-os-success"></i>
      <h3 class="text-sm font-bold">Fully signed</h3>
    </div>

    <div class="flex flex-col gap-2 text-[11px]" style="font-variant-numeric: tabular-nums">
      <div class="flex items-center justify-between gap-3">
        <span class="text-os-text">Transaction id</span>
        <span class="flex items-center gap-1.5 text-os-text-light">
          <TruncatedId value={artifacts.txid} head={10} tail={8} />
          <CopyButton value={artifacts.txid} label="Copy txid" />
        </span>
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-os-text">Size / fee</span>
        <span class="inline-flex items-baseline gap-1 text-os-text-light">
          {artifacts.vsize} vB,
          <SatsAmount sats={artifacts.feeSats} />
        </span>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button
        class="os-row-btn os-row-btn-primary rounded-lg"
        onclick={() => navigator.clipboard.writeText(artifacts.rawTxHex)}
      >
        <i class="fa-solid fa-copy text-[10px]"></i>
        Copy raw hex
      </button>
      <button
        class="os-row-btn rounded-lg"
        onclick={() => navigator.clipboard.writeText(artifacts.finalPsbtBase64)}
      >
        Copy signed PSBT
      </button>
      <button
        class="os-row-btn rounded-lg"
        onclick={() => download('saffron-transaction.txt', artifacts.rawTxHex, 'text/plain')}
      >
        <i class="fa-solid fa-download text-[10px]"></i>
        Download hex
      </button>
    </div>

    <p class="text-[11px] text-os-text">
      Saffron never broadcasts. Paste the raw hex at
      <a
        href={BROADCAST_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="text-os-orange hover:underline">mempool.space/tx/push</a
      > when you are ready.
    </p>
  {:else if partialPsbtBase64 && signedCount > 0}
    <div class="flex items-center gap-2">
      <i class="fa-solid fa-hourglass-half text-os-warning"></i>
      <h3 class="text-sm font-bold">Partially signed</h3>
    </div>

    <p class="text-[11px] text-os-text">
      {signedCount} of {requiredSigners} signatures collected. Export the partial PSBT to continue on
      another machine, or keep signing here.
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <button
        class="os-row-btn rounded-lg"
        onclick={() => navigator.clipboard.writeText(partialPsbtBase64)}
      >
        <i class="fa-solid fa-copy text-[10px]"></i>
        Copy partial PSBT
      </button>
      <button
        class="os-row-btn rounded-lg"
        onclick={() => download('saffron-partial.psbt.txt', partialPsbtBase64, 'text/plain')}
      >
        <i class="fa-solid fa-download text-[10px]"></i>
        Download
      </button>
    </div>
  {/if}
</div>
