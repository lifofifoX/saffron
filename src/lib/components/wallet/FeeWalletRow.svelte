<script lang="ts">
  import SatsAmount from '$lib/components/common/SatsAmount.svelte'
  import { connectAndLoadFeeWallet, disconnectFeeWallet, feeWallet } from '$lib/stores/fee-wallet'
  import { WALLET_PROVIDER_META } from '$lib/wallets/meta'
  import { detectProviders } from '$lib/wallets/providers'

  type Props = {
    label?: string
  }

  let { label = 'Pay from' }: Props = $props()

  let providers = $derived(detectProviders())
</script>

<div class="flex min-h-[52px] w-full flex-wrap items-center justify-between gap-3 py-2">
  <span class="flex items-center gap-2.5 text-[13px] text-os-text">
    <i class="fa-solid fa-wallet text-xs"></i>
    {label}
  </span>

  {#if $feeWallet.wallet}
    <span class="flex min-w-0 items-center gap-2.5">
      {#if $feeWallet.loading}
        <span class="os-spinner text-os-text"></span>
      {:else}
        <SatsAmount sats={$feeWallet.spendableSats} class="text-[11px] text-os-text" />
      {/if}
      <span
        class="flex items-center gap-1.5 rounded-full border border-os-border bg-os-dark/60 py-1 pl-1.5 pr-1.5"
      >
        <img
          src={WALLET_PROVIDER_META[$feeWallet.wallet.provider].image}
          alt=""
          class="h-5 w-5 rounded-full"
        />
        <span class="text-[12px] font-semibold text-os-text-light">
          {WALLET_PROVIDER_META[$feeWallet.wallet.provider].label}
        </span>
        <button
          class="flex h-5 w-5 items-center justify-center rounded-full text-os-text transition hover:bg-os-hover hover:text-os-error"
          onclick={disconnectFeeWallet}
          aria-label="Disconnect fee wallet"
          title="Disconnect"
        >
          <i class="fa-solid fa-xmark text-[10px]"></i>
        </button>
      </span>
    </span>
  {:else}
    <span class="flex items-center gap-2">
      <button
        class="os-row-btn"
        disabled={!providers.xverse || $feeWallet.loading}
        title={providers.xverse ? '' : 'Xverse is not installed'}
        onclick={() => void connectAndLoadFeeWallet('xverse')}
      >
        <img src={WALLET_PROVIDER_META.xverse.image} alt="" class="h-3.5 w-3.5 rounded" />
        Xverse
      </button>
      <button
        class="os-row-btn"
        disabled={!providers.unisat || $feeWallet.loading}
        title={providers.unisat ? '' : 'Unisat is not installed'}
        onclick={() => void connectAndLoadFeeWallet('unisat')}
      >
        <img src={WALLET_PROVIDER_META.unisat.image} alt="" class="h-3.5 w-3.5 rounded" />
        Unisat
      </button>
    </span>
  {/if}

  {#if $feeWallet.error}
    <p class="w-full pb-1 text-[11px] text-os-error">{$feeWallet.error}</p>
  {/if}
</div>
