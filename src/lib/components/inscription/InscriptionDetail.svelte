<script lang="ts">
  import TruncatedId from '$lib/components/common/TruncatedId.svelte'
  import { CopyFeedback } from '$lib/components/common/copy-feedback.svelte'
  import { errorMessage } from '$lib/utils/error-message'
  import { onMount } from 'svelte'

  import type { OrdInscription } from '$lib/clients/ord-contracts'
  import HeroMedia from '$lib/components/inscription/HeroMedia.svelte'
  import SatsAmount from '$lib/components/common/SatsAmount.svelte'
  import { EXPLORER_TX_URL, ORD_NET_INSCRIPTION_URL } from '$lib/config'
  import { currentOrdClient } from '$lib/data/clients'
  import { parseSatpoint } from '$lib/engine/outpoints'
  import { openModal } from '$lib/stores/ui'
  import { vault } from '$lib/stores/vault'

  type Props = {
    inscriptionId: string
  }

  let { inscriptionId }: Props = $props()

  let inscription = $state<OrdInscription | null>(null)
  let loadError = $state('')
  const clipboard = new CopyFeedback()

  let holding = $derived($vault.inscriptions.find((entry) => entry.id === inscriptionId) ?? null)
  let isOwned = $derived(holding !== null)
  let numberLabel = $derived(
    inscription?.number !== null && inscription?.number !== undefined
      ? `#${inscription.number.toLocaleString('en-US')}`
      : 'Inscription',
  )
  let satpoint = $derived(inscription ? parseSatpoint(inscription.satpoint) : null)
  let contentTypeLabel = $derived(
    inscription?.effective_content_type ?? inscription?.content_type ?? 'unknown',
  )
  let inscribedLabel = $derived.by(() => {
    if (!inscription || inscription.height === null || inscription.height === undefined) return null

    const block = `block ${inscription.height.toLocaleString('en-US')}`
    if (!inscription.timestamp) return block
    return `${block}, ${new Date(inscription.timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`
  })

  onMount(() => {
    void loadDetail()
  })

  async function loadDetail() {
    loadError = ''
    inscription = null

    try {
      inscription = await currentOrdClient().getInscription(inscriptionId)
    } catch (error) {
      loadError = errorMessage(error)
    }
  }
</script>

{#snippet copyIcon(hasCopied: boolean)}
  <span
    class="ml-3 shrink-0 transition-colors {hasCopied
      ? 'text-os-success'
      : 'text-os-text group-hover:text-os-text-light'}"
    aria-hidden="true"
  >
    <i class="fa-solid {hasCopied ? 'fa-check' : 'fa-copy'} text-xs"></i>
  </span>
{/snippet}

{#snippet factCard(label: string, value: string)}
  <div class="min-w-0 rounded-lg bg-os-card px-4 py-3">
    <p class="mb-0.5 text-[10px] font-medium uppercase tracking-widest text-os-text">{label}</p>
    <p class="truncate text-sm font-semibold text-os-text-light">{value}</p>
  </div>
{/snippet}

<div class="flex flex-col gap-6">
  <div
    class="relative overflow-hidden rounded-xl border border-os-border bg-os-card"
    style="height: min(56vh, 560px)"
  >
    {#if inscription}
      <HeroMedia
        {inscriptionId}
        rawContentType={inscription.effective_content_type ?? inscription.content_type ?? null}
        name={numberLabel}
        heightClass="h-full"
      />
    {:else if loadError}
      <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <i class="fa-solid fa-triangle-exclamation text-os-warning text-xl"></i>
        <p class="text-sm text-os-text">{loadError}</p>
        <button class="os-row-btn" onclick={() => void loadDetail()}>Retry</button>
      </div>
    {:else}
      <div class="flex h-full items-center justify-center">
        <div
          class="h-8 w-8 animate-spin rounded-full border-2 border-os-border border-t-os-orange"
        ></div>
      </div>
    {/if}

    {#if isOwned}
      <span
        class="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-os-purple/30 bg-os-dark/80 px-2.5 py-1 text-[10px] font-semibold text-os-purple backdrop-blur"
      >
        <span class="text-[10px] leading-none">◉</span>
        In vault
      </span>
    {/if}
  </div>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-[21px] font-semibold tracking-tight text-os-text-light">{numberLabel}</h1>

    <div class="flex items-center gap-2">
      {#if isOwned}
        <button
          class="os-row-btn os-row-btn-primary"
          onclick={() => openModal('transfer', { inscriptionIds: [inscriptionId] })}
        >
          <i class="fa-solid fa-paper-plane text-[10px]"></i>
          Transfer
        </button>
      {/if}
      <a
        href="{ORD_NET_INSCRIPTION_URL}/{inscriptionId}"
        target="_blank"
        rel="noopener noreferrer"
        class="os-row-btn os-row-btn-surface"
      >
        <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
        View on ord.net
      </a>
    </div>
  </div>

  {#if inscription && satpoint}
    <div>
      <h2 class="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-os-text">
        Details
      </h2>

      <button
        type="button"
        onclick={() => void clipboard.copy('id', inscriptionId)}
        class="group mb-2 flex w-full cursor-pointer items-center justify-between rounded-lg bg-os-card px-4 py-3 text-left transition-colors hover:bg-os-border/30"
        title="Copy inscription id"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="shrink-0 text-[10px] font-medium uppercase tracking-widest text-os-text">
            ID
          </span>
          <span
            class="truncate font-mono text-xs transition-colors {clipboard.copied('id')
              ? 'text-os-success'
              : 'text-os-text-light'}"
          >
            {inscriptionId}
          </span>
        </div>
        {@render copyIcon(clipboard.copied('id'))}
      </button>

      <button
        type="button"
        onclick={() => void clipboard.copy('location', inscription?.satpoint ?? '')}
        class="group mb-2 flex w-full cursor-pointer items-center justify-between rounded-lg bg-os-card px-4 py-3 text-left transition-colors hover:bg-os-border/30"
        title="Copy location"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="shrink-0 text-[10px] font-medium uppercase tracking-widest text-os-text">
            Location
          </span>
          <span
            class="truncate font-mono text-xs transition-colors {clipboard.copied('location')
              ? 'text-os-success'
              : 'text-os-text-light'}"
          >
            {inscription.satpoint}
          </span>
        </div>
        {@render copyIcon(clipboard.copied('location'))}
      </button>

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {@render factCard(
          'Inscription #',
          inscription.number !== null && inscription.number !== undefined
            ? inscription.number.toLocaleString('en-US')
            : '—',
        )}
        <div class="min-w-0 rounded-lg bg-os-card px-4 py-3">
          <p class="mb-0.5 text-[10px] font-medium uppercase tracking-widest text-os-text">
            Postage
          </p>
          {#if inscription.value !== null && inscription.value !== undefined}
            <SatsAmount sats={inscription.value} class="text-sm font-semibold text-os-text-light" />
          {:else}
            <p class="truncate text-sm font-semibold text-os-text-light">&mdash;</p>
          {/if}
        </div>
        {@render factCard('Content type', contentTypeLabel)}
        {@render factCard('Inscribed', inscribedLabel ?? '—')}
        {@render factCard(
          'Charms',
          (inscription.charms ?? []).length > 0 ? (inscription.charms ?? []).join(', ') : '—',
        )}
        <div class="min-w-0 rounded-lg bg-os-card px-4 py-3">
          <p class="mb-0.5 text-[10px] font-medium uppercase tracking-widest text-os-text">
            Transaction
          </p>
          <a
            href="{EXPLORER_TX_URL}/{satpoint.txid}"
            target="_blank"
            rel="noopener noreferrer"
            class="block truncate font-mono text-sm font-semibold text-os-text-light transition-colors hover:text-os-orange"
          >
            <TruncatedId value={satpoint.txid} head={8} tail={8} />
          </a>
        </div>
      </div>

      {#if satpoint.offsetSats > 0}
        <div
          class="mt-2 rounded-lg border border-os-warning/30 bg-os-warning/10 px-4 py-3 text-xs text-os-text-light"
        >
          <i class="fa-solid fa-triangle-exclamation mr-1.5 text-os-warning"></i>
          Sits {satpoint.offsetSats.toLocaleString('en-US')} sats into its UTXO. Transfers keep the whole
          UTXO together, so this stays safe.
        </div>
      {/if}

      {#if (inscription.parents ?? []).length > 0}
        <div class="mt-2 rounded-lg bg-os-card px-4 py-3">
          <p class="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-os-text">
            Parents
          </p>
          <div class="flex flex-col gap-1">
            {#each inscription.parents ?? [] as parent (parent)}
              <a
                href="{ORD_NET_INSCRIPTION_URL}/{parent}"
                target="_blank"
                rel="noopener noreferrer"
                class="truncate font-mono text-xs text-os-text-light transition-colors hover:text-os-orange"
              >
                {parent}
                <i class="fa-solid fa-arrow-up-right-from-square ml-1 text-[9px]"></i>
              </a>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
