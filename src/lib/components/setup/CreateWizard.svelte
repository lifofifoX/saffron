<script lang="ts">
  import Banner from '$lib/components/common/Banner.svelte'
  import { errorMessage } from '$lib/utils/error-message'
  import { goto } from '$app/navigation'
  import TruncatedId from '$lib/components/common/TruncatedId.svelte'
  import { OsSelect } from '$lib/components/common/ui'
  import { HDKey } from '@scure/bip32'

  import DeviceSlotCard, { type SlotState } from '$lib/components/setup/DeviceSlotCard.svelte'
  import {
    DEFAULT_KEY_ORIGIN_PATH,
    SINGLE_KEY_DEFAULT_ACCOUNT,
    SINGLE_KEY_MAX_ACCOUNT,
    singleKeyOriginPath,
    type WalletConfig,
  } from '$lib/engine/config/schema'
  import { DEVICE_LABELS, type DeviceKind } from '$lib/devices/kinds'
  import { exportDeviceXpub } from '$lib/devices/xpub'
  import { buildEnvelope, saveWalletConfig, WalletConfigError } from '$lib/persistence/wallet-store'
  import { addToast } from '$lib/stores/ui'

  const MAX_TOTAL_SIGNERS = 5

  let vaultName = $state('My vault')
  let totalSigners = $state(3)
  let singleKeyAccount = $state(SINGLE_KEY_DEFAULT_ACCOUNT)
  let requiredSigners = $state(2)
  let slots = $state<SlotState[]>(createSlots(3))
  let createError = $state('')

  function createSlots(count: number): SlotState[] {
    return Array.from({ length: count }, () => ({
      device: null,
      status: 'empty' as const,
      messages: [],
      error: '',
      result: null,
    }))
  }

  function setSingleKeyAccount(next: number) {
    if (next === singleKeyAccount) return
    singleKeyAccount = next
    slots = createSlots(totalSigners)
  }

  function setTotalSigners(next: number) {
    totalSigners = next
    if (requiredSigners > next) requiredSigners = next

    const existing = slots.filter((slot) => slot.status === 'done').slice(0, next)
    slots = [...existing, ...createSlots(next - existing.length)]
  }

  let completedSlots = $derived(slots.filter((slot) => slot.status === 'done'))
  let anyBusy = $derived(slots.some((slot) => slot.status === 'busy'))
  let allCollected = $derived(completedSlots.length === totalSigners)

  let preview = $derived.by(() => {
    if (!allCollected) return null

    try {
      const { envelope } = buildEnvelope(draftConfig())
      return envelope.derivedAddresses
    } catch {
      return null
    }
  })

  const draftUuid = crypto.randomUUID()

  function draftConfig(): WalletConfig {
    const deviceCounts: Record<DeviceKind, number> = { TREZOR: 0, LEDGER: 0 }

    return {
      name: vaultName.trim() || 'My vault',
      uuid: draftUuid,
      addressType: totalSigners === 1 ? 'P2WPKH' : 'P2WSH',
      network: 'mainnet',
      quorum: { requiredSigners, totalSigners },
      extendedPublicKeys: completedSlots.map((slot, slotIndex) => {
        const result = slot.result
        if (!result) throw new Error('slot missing device result')

        if (result.device) deviceCounts[result.device] += 1
        return {
          name: result.device
            ? `${DEVICE_LABELS[result.device]} ${deviceCounts[result.device]}`
            : `Key ${slotIndex + 1}`,
          bip32Path: result.bip32Path,
          xpub: result.xpub,
          xfp: result.xfp,
          method:
            result.device === 'TREZOR'
              ? ('trezor' as const)
              : result.device === 'LEDGER'
                ? ('ledger' as const)
                : ('text' as const),
        }
      }),
      startingAddressIndex: 0,
      ledgerPolicyHmacs: [],
    }
  }

  function addManualKey(
    slotIndex: number,
    entry: { xpub: string; xfp: string; bip32Path: string },
  ) {
    const slot = slots[slotIndex]
    if (!slot || anyBusy) return

    slot.error = ''

    try {
      if (!/^[0-9a-f]{8}$/i.test(entry.xfp)) {
        throw new Error('the fingerprint must be 8 hex characters')
      }
      if (!entry.xpub.startsWith('xpub')) {
        throw new Error('expected a mainnet xpub (not Ypub/Zpub)')
      }
      HDKey.fromExtendedKey(entry.xpub)

      if (!/^m(\/\d+'?)+$/.test(entry.bip32Path)) {
        throw new Error("the derivation path must look like m/48'/0'/0'/2'")
      }

      const duplicate = slots.some(
        (other, otherIndex) =>
          otherIndex !== slotIndex && other.result?.xfp === entry.xfp.toLowerCase(),
      )
      if (duplicate) throw new Error('this key is already used in another slot')

      slot.device = null
      slot.status = 'done'
      slot.result = {
        device: null,
        xpub: entry.xpub,
        xfp: entry.xfp.toLowerCase(),
        bip32Path: entry.bip32Path,
      }
    } catch (error) {
      slot.status = 'error'
      slot.error = errorMessage(error)
    }
  }

  async function connectSlot(slotIndex: number, device: DeviceKind) {
    const slot = slots[slotIndex]
    if (!slot || anyBusy) return

    slot.device = device
    slot.status = 'busy'
    slot.error = ''
    slot.messages = []
    createError = ''

    try {
      const result = await exportDeviceXpub({
        device,
        bip32Path:
          totalSigners === 1 ? singleKeyOriginPath(singleKeyAccount) : DEFAULT_KEY_ORIGIN_PATH,
        onProgress: (progress) => {
          if (progress.state === 'awaitingDevice') slot.messages = progress.messages
        },
      })

      const duplicate = slots.some(
        (other, otherIndex) => otherIndex !== slotIndex && other.result?.xfp === result.xfp,
      )
      if (duplicate) {
        slot.status = 'error'
        slot.error = `This ${DEVICE_LABELS[device]} (${result.xfp}) is already used by another key slot.`
        slot.result = null
        return
      }

      slot.result = result
      slot.status = 'done'
    } catch (error) {
      slot.status = 'error'
      slot.error = errorMessage(error)
    } finally {
      slot.messages = []
    }
  }

  function clearSlot(slotIndex: number) {
    const slot = slots[slotIndex]
    if (!slot) return

    slot.device = null
    slot.status = 'empty'
    slot.error = ''
    slot.result = null
  }

  function createVault() {
    createError = ''

    try {
      saveWalletConfig(draftConfig())
      addToast('Vault created')
      void goto('/')
    } catch (error) {
      if (error instanceof WalletConfigError) {
        createError = [error.message, ...error.issues].join('. ')
        return
      }

      createError = errorMessage(error)
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="rounded-xl border border-os-border bg-os-card p-5 flex flex-col gap-4">
    <div class="flex items-center gap-2">
      <i class="fa-solid fa-shield-halved text-os-purple text-sm"></i>
      <h2 class="text-sm font-bold">Vault keys</h2>
    </div>

    <div class="grid gap-3 sm:grid-cols-3">
      <label class="flex flex-col gap-1.5">
        <span class="os-label">Name</span>
        <input
          type="text"
          bind:value={vaultName}
          maxlength={40}
          class="h-10 w-full rounded-lg border border-os-border bg-os-dark px-3 text-sm text-os-text-light transition hover:border-os-hover focus:border-os-orange/50 focus:outline-none"
        />
      </label>

      <div class="flex flex-col gap-1.5">
        <span class="os-label">Total keys</span>
        <OsSelect
          options={Array.from({ length: MAX_TOTAL_SIGNERS }, (_, optionIndex) => ({
            value: String(optionIndex + 1),
            label: optionIndex === 0 ? 'Single key' : `${optionIndex + 1} keys`,
          }))}
          value={String(totalSigners)}
          onValueChange={(value) => setTotalSigners(Number(value))}
          large
          triggerClass="w-full"
          ariaLabel="Total keys"
          align="start"
        />
      </div>

      {#if totalSigners === 1}
        <div class="flex flex-col gap-1.5">
          <span class="os-label">Account</span>
          <OsSelect
            options={Array.from({ length: SINGLE_KEY_MAX_ACCOUNT + 1 }, (_, accountIndex) => {
              const account = SINGLE_KEY_MAX_ACCOUNT - accountIndex
              return {
                value: String(account),
                label:
                  account === SINGLE_KEY_DEFAULT_ACCOUNT
                    ? `Account ${account} (recommended)`
                    : `Account ${account}`,
                ...(account <= 10 ? { description: 'May appear in other wallet apps' } : {}),
              }
            })}
            value={String(singleKeyAccount)}
            onValueChange={(value) => setSingleKeyAccount(Number(value))}
            large
            triggerClass="w-full"
            ariaLabel="Account"
            align="start"
          />
        </div>
      {/if}

      {#if totalSigners > 1}
        <div class="flex flex-col gap-1.5">
          <span class="os-label"> Signatures required </span>
          <OsSelect
            options={Array.from({ length: totalSigners }, (_, optionIndex) => ({
              value: String(optionIndex + 1),
              label: `${optionIndex + 1} of ${totalSigners}`,
            }))}
            value={String(requiredSigners)}
            onValueChange={(value) => (requiredSigners = Number(value))}
            large
            triggerClass="w-full"
            ariaLabel="Signatures required"
            align="start"
          />
        </div>
      {/if}
    </div>

    <p class="text-xs text-os-text">
      {#if totalSigners === 1}
        One Trezor signs every spend. The vault lives on the account you pick under m/84'/0'. High
        accounts like the default never appear in other wallet apps, keeping your inscriptions out
        of ordinary wallets.
      {:else}
        Every spend from the vault needs {requiredSigners} of {totalSigners} keys. Each key lives on a
        Ledger or Trezor. Connect one per slot below. The same device can only fill one slot.
      {/if}
    </p>
  </div>

  <div class="grid gap-3 md:grid-cols-2">
    {#each slots as slot, slotIndex (slotIndex)}
      <DeviceSlotCard
        index={slotIndex}
        {slot}
        disabled={anyBusy}
        trezorOnly={totalSigners === 1}
        expectedPath={totalSigners === 1
          ? singleKeyOriginPath(singleKeyAccount)
          : DEFAULT_KEY_ORIGIN_PATH}
        onConnect={(device) => void connectSlot(slotIndex, device)}
        onManual={(entry) => addManualKey(slotIndex, entry)}
        onClear={() => clearSlot(slotIndex)}
      />
    {/each}
  </div>

  {#if createError}
    <Banner severity="error">{createError}</Banner>
  {/if}

  {#if allCollected}
    <div class="rounded-xl border border-os-border bg-os-card p-5 flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-vault text-os-purple text-sm"></i>
        <h2 class="text-sm font-bold">Your vault address</h2>
      </div>

      {#if preview}
        <div class="flex items-center gap-2 text-[11px]">
          <span class="w-4 text-center leading-none text-os-purple">◉</span>
          <TruncatedId
            value={preview.inscriptions}
            head={20}
            tail={14}
            class="text-os-text-light"
          />
        </div>

        <p class="text-xs text-os-text">
          Send inscriptions here. The address is controlled by
          {totalSigners === 1 ? 'your key' : `your ${requiredSigners}-of-${totalSigners} keys`}, and
          transfer fees always come from your hot wallet.
        </p>

        <button class="os-row-btn os-row-btn-primary rounded-lg self-start" onclick={createVault}>
          <i class="fa-solid fa-vault text-[10px]"></i>
          Create vault
        </button>
      {:else}
        <p class="text-xs text-os-error">Could not derive addresses from the collected keys.</p>
      {/if}
    </div>
  {/if}
</div>
