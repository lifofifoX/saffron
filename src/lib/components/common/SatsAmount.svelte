<script lang="ts">
  import BtcIcon from '$lib/components/common/BtcIcon.svelte'

  const SATS_PER_BTC = 100_000_000
  // Matches ord.net: below 0.001 BTC show sats, at or above show BTC.
  const SATS_DISPLAY_THRESHOLD = 100_000

  type Props = {
    sats: number | null | undefined
    class?: string
    iconClass?: string
  }

  let { sats, class: className = '', iconClass = '' }: Props = $props()

  let showSats = $derived(sats !== null && sats !== undefined && sats < SATS_DISPLAY_THRESHOLD)
  let formatted = $derived.by(() => {
    if (sats === null || sats === undefined || !Number.isFinite(sats)) return null
    if (sats < SATS_DISPLAY_THRESHOLD) return sats.toLocaleString('en-US')

    return (sats / SATS_PER_BTC).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 5,
    })
  })
</script>

{#if formatted !== null}
  <span
    class="inline-flex items-center gap-1 leading-none {className}"
    style="font-variant-numeric: tabular-nums"
  >
    <BtcIcon sats={showSats} class={iconClass} />
    {formatted}
  </span>
{:else}
  <span class="text-os-text/30 {className}">&mdash;</span>
{/if}
