<script lang="ts">
  type Props = {
    status: 'pending' | 'busy' | 'signed' | 'skipped' | 'error'
    allowed: boolean
    reason: string
    onSign: () => void
    onRetry: () => void
  }

  let { status, allowed, reason, onSign, onRetry }: Props = $props()
</script>

{#if status === 'signed'}
  <span class="flex items-center gap-1.5 text-[11px] text-os-success">
    <i class="fa-solid fa-circle-check"></i>
    Signed
  </span>
{:else if status === 'skipped'}
  <span class="text-[11px] text-os-text">Not needed</span>
{:else if status === 'busy'}
  <span class="flex items-center gap-1.5 text-[11px] text-os-text-light">
    <span class="os-spinner"></span>
    Waiting for device
  </span>
{:else if status === 'error'}
  <button class="os-row-btn" onclick={onRetry}>
    <i class="fa-solid fa-rotate-left text-[10px]"></i>
    Retry
  </button>
{:else if allowed}
  <button class="os-row-btn os-row-btn-primary" onclick={onSign}>Connect and sign</button>
{:else}
  <span class="max-w-[240px] text-right text-[11px] leading-snug text-os-text">{reason}</span>
{/if}
