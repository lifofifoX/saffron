<script lang="ts">
  import { CopyFeedback } from '$lib/components/common/copy-feedback.svelte'
  import TruncatedId from '$lib/components/common/TruncatedId.svelte'
  import SatsAmount from '$lib/components/common/SatsAmount.svelte'
  import { EXPLORER_ADDRESS_URL, ORDINALS_ADDRESS_URL } from '$lib/config'

  type Props = {
    name: string
    address: string
    quorumLabel: string | null
    inscriptionCount: number
    valueSats: number
    loading: boolean
    onRefresh: () => void
  }

  let { name, address, quorumLabel, inscriptionCount, valueSats, loading, onRefresh }: Props =
    $props()

  const clipboard = new CopyFeedback()
</script>

<header class="flex flex-wrap items-center gap-x-4 gap-y-3">
  <div
    class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-os-border bg-os-orange/10"
  >
    <span class="text-[22px] leading-none text-os-orange">◉</span>
  </div>

  <div class="min-w-[200px] flex-1">
    <div class="flex items-center gap-2">
      <h1
        class="truncate text-[21px] font-semibold leading-tight tracking-tight text-os-text-light"
      >
        {name}
      </h1>
      {#if quorumLabel}
        <span class="os-badge">
          <i class="fa-solid fa-shield-halved text-[10px] text-os-purple"></i>
          {quorumLabel}
        </span>
      {/if}
    </div>

    <div class="mt-1 flex items-center gap-1 font-mono text-xs text-os-text">
      <button
        class="cursor-pointer transition hover:text-os-text-light"
        onclick={() => void clipboard.copy('address', address)}
        title={clipboard.copied('address') ? 'Copied!' : 'Copy address'}
      >
        <TruncatedId value={address} head={10} tail={8} />
      </button>
      <button
        class="flex h-5 w-5 items-center justify-center rounded transition hover:text-os-text-light"
        onclick={() => void clipboard.copy('address', address)}
        aria-label="Copy address"
        title={clipboard.copied('address') ? 'Copied!' : 'Copy address'}
      >
        <i
          class="fa-solid {clipboard.copied('address')
            ? 'fa-check text-os-success'
            : 'fa-copy'} text-[11px]"
        ></i>
      </button>
      <a
        href="{EXPLORER_ADDRESS_URL}/{address}"
        target="_blank"
        rel="noopener noreferrer"
        class="flex h-5 w-5 items-center justify-center rounded transition hover:text-os-text-light"
        title="View on mempool.space"
      >
        <i class="fa-solid fa-cube text-[11px]"></i>
      </a>
      <a
        href="{ORDINALS_ADDRESS_URL}/{address}"
        target="_blank"
        rel="noopener noreferrer"
        class="flex h-5 w-5 items-center justify-center rounded transition hover:text-os-text-light"
        title="View on ordinals.com"
      >
        <span class="text-[12px] leading-none">◉</span>
      </a>
    </div>
  </div>

  <div class="flex w-full flex-shrink-0 items-center gap-2.5 sm:ml-auto sm:w-auto">
    <span class="os-badge os-badge-lg">
      <i class="fa-solid fa-layer-group text-[10px]"></i>
      {inscriptionCount} inscription{inscriptionCount === 1 ? '' : 's'}
    </span>
    {#if valueSats > 0}
      <span class="os-badge os-badge-lg" title="Total value held with inscriptions">
        <SatsAmount sats={valueSats} />
      </span>
    {/if}
    <button class="os-row-btn" onclick={onRefresh} disabled={loading}>
      {#if loading}
        <span class="os-spinner"></span>
      {:else}
        <i class="fa-solid fa-rotate text-[10px]"></i>
      {/if}
      Refresh
    </button>
  </div>
</header>
