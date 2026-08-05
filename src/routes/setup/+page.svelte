<script lang="ts">
  import Banner from '$lib/components/common/Banner.svelte'
  import ChromiumGate from '$lib/components/common/ChromiumGate.svelte'
  import CreateWizard from '$lib/components/setup/CreateWizard.svelte'
  import RestoreVault from '$lib/components/setup/RestoreVault.svelte'
  import { hasWallet } from '$lib/stores/wallet-config'
</script>

<div class="mx-auto max-w-6xl px-4 py-8 flex flex-col gap-4">
  <div>
    <h1 class="text-[21px] font-semibold tracking-tight text-os-text-light">Set up your vault</h1>
    <p class="text-sm text-os-text mt-1">
      One address for your inscriptions, secured by your Ledger or Trezor. Use a single key, or
      several keys that must co-sign. Transfer fees are always paid by your Xverse or Unisat hot
      wallet, never from the vault.
    </p>
  </div>

  <ChromiumGate />

  {#if $hasWallet}
    <Banner severity="info">
      <i class="fa-solid fa-circle-info text-os-purple mr-1.5"></i>
      This adds another vault. Your existing vaults stay untouched, and you can switch between them from
      the top bar. <a href="/" class="underline">Back to the current vault</a>
    </Banner>
  {/if}

  <CreateWizard />

  <div class="flex items-center gap-3 px-1">
    <div class="h-px flex-1 bg-os-border"></div>
    <span class="text-[10px] font-semibold uppercase tracking-wide text-os-text">or</span>
    <div class="h-px flex-1 bg-os-border"></div>
  </div>

  <RestoreVault />
</div>
