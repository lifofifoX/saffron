<script lang="ts">
  import { CopyFeedback } from '$lib/components/common/copy-feedback.svelte'
  import ImportSignedPanel from '$lib/components/signing/ImportSignedPanel.svelte'
  import TruncatedId from '$lib/components/common/TruncatedId.svelte'
  import SignRowStatus from '$lib/components/signing/SignRowStatus.svelte'
  import { errorMessage } from '$lib/utils/error-message'
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'

  import { getPrevTxHex } from '$lib/clients/prevtx-cache'
  import InscriptionThumb from '$lib/components/cards/InscriptionThumb.svelte'
  import SatsAmount from '$lib/components/common/SatsAmount.svelte'
  import { OsSelect } from '$lib/components/common/ui'
  import OsModal from '$lib/components/common/ui/OsModal.svelte'
  import { SignSession } from '$lib/components/signing/sign-session.svelte'
  import { currentElectrsClient } from '$lib/data/clients'
  import { BROADCAST_URL } from '$lib/config'
  import { DEVICE_ICONS } from '$lib/devices/kinds'
  import {
    addressToScriptHex,
    isModernAddress,
    validateRecipientAddress,
  } from '$lib/engine/address'
  import { parseOutpoint } from '$lib/engine/outpoints'
  import { transferErrorMessage } from '$lib/engine/transfer/errors'
  import {
    planSimpleTransfer,
    type SimpleTransferPlan,
    type SimpleTransferRequest,
  } from '$lib/engine/transfer/simple'
  import {
    snapshotSimpleTransferReview,
    type SimpleTransferReview,
    type TransferReviewGroup,
  } from '$lib/engine/transfer/review'
  import { simpleTransferToPsbt } from '$lib/engine/transfer/simple-to-psbt'
  import { loadVerifiedWallet } from '$lib/persistence/wallet-store'
  import { feeWallet } from '$lib/stores/fee-wallet'
  import { closeModal, modalData } from '$lib/stores/ui'
  import type { TransferModalData } from '$lib/stores/ui/modal'
  import { refreshVault, vault } from '$lib/stores/vault'
  import { MAX_FEE_RATE_SAT_VB } from '$lib/security/fee-policy'
  import FeeWalletRow from '$lib/components/wallet/FeeWalletRow.svelte'
  import { WALLET_PROVIDER_META } from '$lib/wallets/meta'

  type Phase = 'form' | 'sign'

  let data = $derived(($modalData ?? null) as TransferModalData | null)
  let selectedIds = $derived(data?.inscriptionIds ?? [])

  let phase = $state<Phase>('form')
  let recipient = $state('')
  let recipientTouched = $state(false)
  let feePreset = $state<'fast' | 'medium' | 'slow' | 'custom'>('fast')
  let customFeeRate = $state('')
  let signError = $state('')
  let review = $state.raw<SimpleTransferReview | null>(null)
  let session = $state<SignSession | null>(null)
  let buildingPsbt = $state(false)
  let importOpenXfp = $state<string | null>(null)
  const psbtClipboard = new CopyFeedback()

  function focusWhenVisible(node: HTMLInputElement, delayMs = 320) {
    const timer = setTimeout(() => {
      if (node.offsetParent !== null) node.focus()
    }, delayMs)
    return {
      destroy: () => clearTimeout(timer),
    }
  }

  onMount(() => {
    void refreshVault()
  })

  // One transfer item per UTXO: selecting any inscription moves its whole
  // outpoint, so cohabitants ride along and are shown.
  let groups = $derived.by(() => {
    const selectedHoldings = selectedIds
      .map((id) => $vault.inscriptions.find((entry) => entry.id === id))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)

    const byOutpoint = new Map<string, typeof selectedHoldings>()
    for (const holding of selectedHoldings) {
      const existing = byOutpoint.get(holding.outpoint) ?? []
      byOutpoint.set(holding.outpoint, [...existing, holding])
    }

    return [...byOutpoint.entries()].map(([outpoint, members]) => {
      const cohabitants = $vault.inscriptions.filter((entry) => entry.outpoint === outpoint)
      const primary = members[0]
      if (!primary) throw new Error('empty transfer group')
      return { outpoint, primary, cohabitants }
    })
  })

  let allFound = $derived(
    selectedIds.length > 0 &&
      selectedIds.every((id) => $vault.inscriptions.some((entry) => entry.id === id)),
  )
  let inscriptionCount = $derived(groups.reduce((sum, group) => sum + group.cohabitants.length, 0))

  let recipientError = $derived.by(() => {
    if (!recipientTouched) return null
    return validateRecipientAddress(recipient)
  })

  let feeRateSatVb = $derived.by(() => {
    if (feePreset === 'custom') {
      const parsed = Number.parseFloat(customFeeRate)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }

    return $vault.feePresets[feePreset]
  })

  let feeOptions = $derived.by(() => {
    const presets = $vault.feePresets
    const options = []
    if (presets.fast !== null)
      options.push({ value: 'fast', label: 'Fast', description: `${presets.fast} sat/vB` })
    if (presets.medium !== null)
      options.push({ value: 'medium', label: '~30 min', description: `${presets.medium} sat/vB` })
    if (presets.slow !== null)
      options.push({ value: 'slow', label: '~1 hr', description: `${presets.slow} sat/vB` })
    options.push({ value: 'custom', label: 'Custom', description: 'Enter a rate' })
    return options
  })

  function safeWallet() {
    try {
      return loadVerifiedWallet()
    } catch {
      return null
    }
  }

  // Live plan preview: recomputes as the recipient, wallet, or rate changes.
  let preview = $derived.by((): { plan: SimpleTransferPlan | null; error: string } => {
    const wallet = safeWallet()
    const rate = feeRateSatVb
    const connectedWallet = $feeWallet.wallet

    if (groups.length === 0 || !allFound || !wallet) return { plan: null, error: '' }
    if (recipient.trim().length === 0 || validateRecipientAddress(recipient) !== null)
      return { plan: null, error: '' }
    if (!connectedWallet || rate === null || $feeWallet.loading) return { plan: null, error: '' }

    const recipientScriptHex = addressToScriptHex(recipient)
    const items = groups.map((group) => ({
      outpoint: parseOutpoint(group.outpoint),
      valueSats: group.primary.valueSats,
      inscriptionIds: group.cohabitants.map((entry) => entry.id),
      recipientScriptHex,
    }))

    const request: SimpleTransferRequest = {
      items,
      quorum: wallet.config.quorum,
      inscriptionsScriptHex: wallet.addresses.inscriptions.scriptPubkeyHex,
      feeWallet: {
        kind: connectedWallet.kind,
        cardinalUtxos: $feeWallet.spendable.map((utxo) => ({
          outpoint: { txid: utxo.txid, vout: utxo.vout },
          valueSats: utxo.valueSats,
        })),
        changeScriptHex: addressToScriptHex(connectedWallet.address),
      },
      feeRateSatVb: rate,
    }

    try {
      return { plan: planSimpleTransfer(request), error: '' }
    } catch (error) {
      return { plan: null, error: transferErrorMessage(error) }
    }
  })

  async function goToSign() {
    const currentPlan = preview.plan
    const wallet = safeWallet()
    if (!currentPlan || !wallet) return

    // Snapshot the exact plan and review data before any asynchronous work.
    // Later edits to the still-visible form cannot change the PSBT or sign review.
    const currentReview = snapshotSimpleTransferReview(currentPlan, groups)
    review = currentReview

    buildingPsbt = true
    signError = ''

    try {
      const connectedWallet = $feeWallet.wallet
      if (!connectedWallet) throw new Error('Connect a fee wallet first.')

      const electrs = currentElectrsClient()
      const prevTxHexByTxid: Record<string, string> = {}
      for (const input of currentReview.plan.vaultInputs) {
        prevTxHexByTxid[input.outpoint.txid] ??= await getPrevTxHex(electrs, input.outpoint.txid)
      }

      const { psbtBase64, feeInputIndexes } = simpleTransferToPsbt(currentReview.plan, {
        addresses: wallet.addresses,
        feeWallet: {
          kind: connectedWallet.kind,
          address: connectedWallet.address,
          publicKeyHex: connectedWallet.publicKeyHex,
        },
        prevTxHexByTxid,
      })

      const nextSession = new SignSession(wallet.config, wallet.addresses)
      await nextSession.loadPsbt(psbtBase64)

      if (nextSession.analysisError) {
        signError = nextSession.analysisError
        return
      }

      nextSession.attachFeeWallet(connectedWallet, feeInputIndexes)
      session = nextSession
      phase = 'sign'
    } catch (error) {
      signError = errorMessage(error)
    } finally {
      buildingPsbt = false
    }
  }

  let footer = $derived.by(() => {
    if (phase === 'form') {
      return {
        label: buildingPsbt ? 'Preparing transaction' : 'Transfer inscription',
        icon: 'fa-paper-plane',
        enabled: preview.plan !== null && !buildingPsbt,
        busy: buildingPsbt,
        action: () => void goToSign(),
      }
    }

    if (session && session.artifacts) {
      return { label: 'Done', icon: 'fa-check', enabled: true, busy: false, action: closeModal }
    }
    return {
      label: 'Collect signatures above',
      icon: null,
      enabled: false,
      busy: false,
      action: () => {},
    }
  })
</script>

{#snippet itemsContainer(displayGroups: TransferReviewGroup[])}
  {#if displayGroups.length > 0}
    <div class="flex flex-col gap-2 px-4 pt-4">
      {#each displayGroups as group (group.outpoint)}
        <div
          class="flex items-center gap-3 rounded-xl border border-os-border/60 bg-os-dark/60 p-3"
        >
          <div class="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-os-border">
            <InscriptionThumb
              inscriptionId={group.primary.id}
              contentType={group.primary.contentType}
              iconSizeClass="text-sm"
            />
          </div>
          <div class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold leading-tight text-os-text-light">
              {group.primary.number !== null
                ? `#${group.primary.number.toLocaleString('en-US')}`
                : 'Inscription'}
              {#if group.cohabitants.length > 1}
                <span class="ml-1 text-[11px] font-medium text-os-text">
                  +{group.cohabitants.length - 1} on the same output
                </span>
              {/if}
            </span>
            <span
              class="mt-1 flex items-center gap-1.5 text-[11px] text-os-text"
              style="font-variant-numeric: tabular-nums"
            >
              <SatsAmount sats={group.primary.valueSats} />
              {#if group.primary.offsetSats > 0}
                <span class="text-os-warning"
                  >offset {group.primary.offsetSats.toLocaleString('en-US')}</span
                >
              {/if}
            </span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet formPhase()}
  {@render itemsContainer(groups)}

  <div class="min-h-4 flex-1"></div>

  <div class="border-t border-os-border px-4 pt-3 pb-4">
    <div class="mb-2 flex items-center justify-between">
      <span class="text-[13px] font-semibold uppercase tracking-wide text-os-text-light">
        Recipient address
      </span>
    </div>
    <input
      type="text"
      bind:value={recipient}
      use:focusWhenVisible
      oninput={() => (recipientTouched = true)}
      placeholder="bc1..."
      spellcheck="false"
      class="os-input w-full"
    />
    {#if recipientError}
      <p class="mt-2 text-xs text-os-error">{recipientError}</p>
    {:else if recipientTouched && recipient.trim() && !isModernAddress(recipient)}
      <p class="mt-2 text-xs text-os-warning">
        <i class="fa-solid fa-triangle-exclamation mr-1"></i>
        Legacy address. Double-check the recipient wallet supports inscriptions.
      </p>
    {/if}
  </div>

  <div class="border-t border-os-border px-4">
    <FeeWalletRow />
  </div>

  <div
    class="flex min-h-[52px] flex-wrap items-center justify-between gap-2 border-t border-os-border px-4 py-2"
  >
    <span class="flex items-center gap-2.5 text-[13px] text-os-text">
      <i class="fa-solid fa-gauge-high text-xs"></i>
      Fee rate
    </span>
    <span
      class="flex h-8 items-center overflow-hidden rounded-lg border border-os-border bg-os-dark"
    >
      {#if feePreset === 'custom'}
        <input
          type="number"
          bind:value={customFeeRate}
          use:focusWhenVisible={50}
          min="1"
          max={MAX_FEE_RATE_SAT_VB}
          step="0.1"
          placeholder="12"
          class="h-full w-14 border-0 bg-transparent pl-2.5 pr-1 text-right font-mono text-xs text-os-text-light [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span class="text-[10px] text-os-text">sat/vB</span>
        <span class="mx-1.5 h-4 w-px bg-os-border"></span>
      {/if}
      <OsSelect
        options={feeOptions}
        value={feePreset}
        onValueChange={(value) => {
          if (value === 'fast' || value === 'medium' || value === 'slow' || value === 'custom') {
            feePreset = value
          }
        }}
        frameless
        ariaLabel="Fee rate"
      />
    </span>
  </div>

  <div class="border-t border-os-border px-4 py-3" style="font-variant-numeric: tabular-nums">
    <div class="flex min-h-[26px] items-center justify-between">
      <span class="text-sm font-semibold text-os-text-light">Total</span>
      {#if preview.plan}
        <SatsAmount sats={preview.plan.feeSats} class="text-sm font-semibold text-os-text-light" />
      {:else}
        <span class="text-sm font-semibold text-os-text">&mdash;</span>
      {/if}
    </div>

    {#if preview.error}
      <p class="mt-2 text-xs text-os-error">{preview.error}</p>
    {/if}
    {#if signError && phase === 'form'}
      <p class="mt-2 text-xs text-os-error">{signError}</p>
    {/if}
    {#if feeRateSatVb !== null && feeRateSatVb > MAX_FEE_RATE_SAT_VB}
      <p class="mt-2 text-xs text-os-error">
        <i class="fa-solid fa-triangle-exclamation mr-1"></i>
        Fee rates above {MAX_FEE_RATE_SAT_VB} sat/vB are blocked.
      </p>
    {/if}
  </div>
{/snippet}

{#snippet signPhase()}
  {#if session && review}
    {@render itemsContainer(review.groups)}

    <div class="min-h-4 flex-1"></div>

    <div
      class="flex min-h-[48px] items-center justify-between gap-3 border-t border-os-border px-4"
    >
      <span class="text-[13px] text-os-text">To</span>
      <span class="truncate font-mono text-xs text-os-text-light" title={review.recipient}>
        <TruncatedId value={review.recipient} head={12} tail={10} />
      </span>
    </div>

    <div
      class="flex min-h-[48px] items-center justify-between gap-3 border-t border-os-border px-4"
      style="font-variant-numeric: tabular-nums"
    >
      <span class="text-[13px] text-os-text">
        Total ({review.plan.vsize} vB at {review.plan.feeRateSatVb} sat/vB)
      </span>
      <SatsAmount sats={review.plan.feeSats} class="text-[13px] text-os-text-light" />
    </div>

    {#if session.feeWalletStep}
      <div
        class="flex min-h-[52px] items-center justify-between gap-3 border-t border-os-border px-4 py-2"
      >
        <span class="flex min-w-0 items-center gap-2.5">
          <img
            src={WALLET_PROVIDER_META[session.feeWalletStep.wallet.provider].image}
            alt=""
            class="h-5 w-5 shrink-0 rounded-full"
          />
          <span class="truncate text-[13px] text-os-text-light">
            {WALLET_PROVIDER_META[session.feeWalletStep.wallet.provider].label}
          </span>
        </span>

        {#if session.feeWalletStep.status === 'signed'}
          <span class="flex items-center gap-1.5 text-[11px] text-os-success">
            <i class="fa-solid fa-circle-check"></i>
            Signed
          </span>
        {:else if session.feeWalletStep.status === 'busy'}
          <span class="flex items-center gap-1.5 text-[11px] text-os-text-light">
            <span class="os-spinner"></span>
            Waiting
          </span>
        {:else}
          <button
            class="os-row-btn os-row-btn-primary"
            onclick={() => void session?.signWithConnectedWallet()}
          >
            Sign fees
          </button>
        {/if}
      </div>
      {#if session.feeWalletStep.error}
        <p class="px-4 pb-2 text-[11px] text-os-error">{session.feeWalletStep.error}</p>
      {/if}
    {/if}

    {#each session.rows as row, rowIndex (row.cosigner.xfp)}
      {@const gate = session.canSignWith(row)}
      <div
        class="flex min-h-[52px] items-center justify-between gap-3 border-t border-os-border px-4 py-2"
      >
        <span class="flex min-w-0 items-center gap-2.5">
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-os-purple/15 text-os-purple"
          >
            <i class="fa-solid {row.device ? DEVICE_ICONS[row.device] : 'fa-font'} text-[11px]"></i>
          </span>
          <span class="truncate text-[13px] text-os-text-light">{row.cosigner.name}</span>
          <span class="shrink-0 font-mono text-[10px] text-os-text">{row.cosigner.xfp}</span>
        </span>

        {#if row.device === null && (row.status === 'pending' || row.status === 'error')}
          <span class="flex shrink-0 items-center gap-2">
            <button
              class="os-row-btn os-row-btn-surface"
              onclick={() => void psbtClipboard.copy('psbt', session?.partialPsbtBase64() ?? '')}
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
            onSign={() => void session?.signWith(rowIndex)}
            onRetry={() => session?.retry(rowIndex)}
          />
        {/if}
      </div>
      {#if row.status === 'busy' && row.messages.length > 0}
        <p class="-mt-1 px-4 pb-2.5 text-[11px] leading-relaxed text-os-text">
          {row.messages[row.messages.length - 1]}
        </p>
      {/if}
      {#if row.status === 'error' && row.error}
        <p class="px-4 pb-2 text-[11px] text-os-error">{row.error}</p>
      {/if}
      {#if session && row.device === null && importOpenXfp === row.cosigner.xfp && (row.status === 'pending' || row.status === 'error')}
        <div class="-mt-1 px-4 pb-3">
          <ImportSignedPanel {session} onImported={() => (importOpenXfp = null)} />
        </div>
      {/if}
    {/each}

    {#if session.artifacts}
      <div
        class="flex min-h-[48px] items-center justify-between gap-3 border-t border-os-border px-4"
      >
        <span class="flex items-center gap-2 text-[13px] text-os-success">
          <i class="fa-solid fa-circle-check"></i>
          Transaction ready
        </span>
        <span class="truncate font-mono text-[11px] text-os-text" title={session.artifacts.txid}>
          <TruncatedId value={session.artifacts.txid} head={10} tail={8} />
        </span>
      </div>
      <div class="flex flex-wrap items-center gap-2 border-t border-os-border px-4 py-3">
        <button
          class="os-row-btn"
          onclick={() => navigator.clipboard.writeText(session?.artifacts?.rawTxHex ?? '')}
        >
          <i class="fa-solid fa-copy text-[10px]"></i>
          Copy hex
        </button>
        <button
          class="os-row-btn"
          onclick={() => navigator.clipboard.writeText(session?.artifacts?.finalPsbtBase64 ?? '')}
        >
          <i class="fa-solid fa-copy text-[10px]"></i>
          Copy PSBT
        </button>
        <a href={BROADCAST_URL} target="_blank" rel="noopener noreferrer" class="os-row-btn">
          <i class="fa-solid fa-tower-broadcast text-[10px]"></i>
          Broadcast
        </a>
      </div>
    {/if}

    {#if signError}
      <p class="border-t border-os-border px-4 py-2 text-xs text-os-error">{signError}</p>
    {/if}
  {/if}
{/snippet}

{#snippet drawerContent()}
  <div class="relative flex shrink-0 items-center gap-2 border-b border-os-border px-4 py-3.5">
    <h2 class="text-[15px] font-bold text-os-text-light">
      {phase === 'sign' ? 'Sign transfer' : 'Transfer'}
      {#if inscriptionCount > 1}
        <span class="ml-1.5 text-[12px] font-medium text-os-text">
          {inscriptionCount} inscriptions
        </span>
      {/if}
    </h2>
    <button
      class="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg text-os-text transition hover:bg-os-hover hover:text-os-text-light"
      onclick={closeModal}
      aria-label="Close"
    >
      <i class="fa-solid fa-xmark text-sm"></i>
    </button>
  </div>

  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    {#if !allFound}
      <div class="flex flex-col gap-2 p-4">
        {#if $vault.loading}
          <div class="flex items-center gap-2 text-sm text-os-text">
            <span class="os-spinner"></span>
            Loading vault…
          </div>
        {:else}
          <p class="text-sm text-os-text">Some of these inscriptions are not in your vault.</p>
        {/if}
      </div>
    {:else if phase === 'form'}
      {@render formPhase()}
    {:else}
      {@render signPhase()}
    {/if}
  </div>

  <button
    class="flex h-14 w-full flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition {footer.enabled
      ? 'cursor-pointer bg-os-orange/90 text-white hover:bg-os-orange'
      : 'cursor-not-allowed bg-os-hover text-os-text/60'}"
    disabled={!footer.enabled}
    onclick={footer.action}
  >
    {#if footer.busy}
      <span class="os-spinner"></span>
    {:else if footer.icon}
      <i class="fa-solid {footer.icon} text-[11px]"></i>
    {/if}
    {footer.label}
  </button>
{/snippet}

<OsModal
  onClose={closeModal}
  title="Transfer inscription"
  panelClass="fixed inset-0 z-[61] pointer-events-none"
  disableContentTransition
  onOpenAutoFocus={(event) => event.preventDefault()}
>
  <button
    type="button"
    tabindex="-1"
    class="pointer-events-auto absolute inset-0 cursor-default"
    aria-label="Close transfer"
    onclick={closeModal}
  ></button>

  <div
    class="pointer-events-auto absolute top-0 right-0 bottom-0 hidden w-full max-w-md flex-col border-l border-os-border bg-os-card md:flex"
    transition:fly={{ x: 400, duration: 300 }}
  >
    {@render drawerContent()}
  </div>

  <div
    class="pointer-events-auto absolute inset-0 flex flex-col bg-os-card md:hidden"
    transition:fly={{ y: 80, duration: 250 }}
  >
    {@render drawerContent()}
  </div>
</OsModal>
