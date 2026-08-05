<script lang="ts">
  import Banner from '$lib/components/common/Banner.svelte'
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'

  import InscriptionCard from '$lib/components/cards/InscriptionCard.svelte'
  import SatsAmount from '$lib/components/common/SatsAmount.svelte'
  import VaultHeader from '$lib/components/dashboard/VaultHeader.svelte'
  import { openModal } from '$lib/stores/ui'
  import { refreshVault, vault } from '$lib/stores/vault'
  import { quorumLabel, vaultAddresses, walletConfig } from '$lib/stores/wallet-config'

  const selected = new SvelteSet<string>()
  let selectingMode = $state(false)

  let selecting = $derived(selectingMode || selected.size > 0)

  function toggleSelected(id: string) {
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
  }

  function cancelSelection() {
    selectingMode = false
    selected.clear()
  }

  $effect(() => {
    const known = new Set($vault.inscriptions.map((entry) => entry.id))
    for (const id of [...selected]) {
      if (!known.has(id)) selected.delete(id)
    }
  })

  function transferSelected() {
    if (selected.size === 0) return
    openModal('transfer', { inscriptionIds: [...selected] })
  }

  onMount(() => {
    void refreshVault()
  })
</script>

<div class="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-6">
  {#if $vaultAddresses && $walletConfig}
    <VaultHeader
      name={$walletConfig.name}
      address={$vaultAddresses.inscriptions}
      quorumLabel={$quorumLabel}
      inscriptionCount={$vault.inscriptions.length}
      valueSats={$vault.inscribedValueSats}
      loading={$vault.loading}
      onRefresh={() => void refreshVault()}
    />

    {#if $vault.error}
      <Banner severity="error">
        {$vault.error}
        <button class="ml-2 underline" onclick={() => void refreshVault()}>Retry</button>
      </Banner>
    {/if}

    {#if $vault.holdingsStale}
      <Banner severity="warning">
        <i class="fa-solid fa-triangle-exclamation text-os-warning mr-1.5"></i>
        Inscription data may be stale, the ord index answered inconsistently. Refresh before transferring.
      </Banner>
    {/if}

    <section class="flex flex-col gap-3">
      {#if $vault.inscriptions.length > 0}
        <div class="flex min-h-[38px] items-center justify-between gap-3">
          {#if selecting}
            <span class="text-[13px] text-os-text-light" style="font-variant-numeric: tabular-nums">
              {selected.size} selected
            </span>
            <div class="flex items-center gap-2">
              <button
                class="os-row-btn os-row-btn-primary"
                disabled={selected.size === 0}
                onclick={transferSelected}
              >
                <i class="fa-solid fa-paper-plane text-[10px]"></i>
                Transfer
              </button>
              <button class="os-row-btn os-row-btn-surface" onclick={cancelSelection}>
                Cancel
              </button>
            </div>
          {:else}
            <span class="os-label">Inscriptions</span>
            <button class="os-row-btn" onclick={() => (selectingMode = true)}>
              <i class="fa-solid fa-square-check text-[10px]"></i>
              Select
            </button>
          {/if}
        </div>
      {/if}

      {#if $vault.loading && $vault.inscriptions.length === 0}
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {#each Array.from({ length: 10 }, (_, index) => index) as skeletonIndex (skeletonIndex)}
            <div
              class="os-shimmer aspect-square rounded-xl border border-os-border bg-os-card"
            ></div>
          {/each}
        </div>
      {:else if $vault.inscriptions.length === 0}
        <div
          class="rounded-xl border border-dashed border-os-hover bg-os-card px-6 py-12 text-center"
        >
          <div
            class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-os-border bg-os-hover/20"
          >
            <span class="text-xl leading-none text-os-text">◉</span>
          </div>
          <h4 class="text-sm font-semibold text-os-text-light">No inscriptions yet</h4>
          <p class="mx-auto mt-1.5 max-w-xs text-[13px] text-os-text">
            Send an inscription to your vault address to get started.
          </p>
        </div>
      {:else}
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {#each $vault.inscriptions as inscription (inscription.id)}
            <InscriptionCard
              {inscription}
              {selecting}
              selected={selected.has(inscription.id)}
              onToggleSelect={() => toggleSelected(inscription.id)}
            />
          {/each}
        </div>
      {/if}

      {#if $vault.strayCardinalSats > 0}
        <p class="text-[11px] text-os-text">
          <i class="fa-solid fa-circle-info mr-1"></i>
          <SatsAmount sats={$vault.strayCardinalSats} /> of plain sats also sit on the vault address.
          They stay protected and are never used for fees.
        </p>
      {/if}
    </section>
  {:else if $walletConfig}
    <Banner severity="error">
      The saved vault failed address verification. Do not send funds until you restore a verified
      backup or recreate the vault from its devices.
    </Banner>
  {/if}
</div>
