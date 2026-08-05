import { derived, writable } from 'svelte/store'
import { z } from 'zod'

import { browser } from '$app/environment'
import {
  type WalletConfig,
  type WalletEnvelope,
  walletEnvelopeSchema,
} from '$lib/engine/config/schema'
import { configErrors, validateWalletConfig } from '$lib/engine/config/validate'
import { deriveWalletAddresses } from '$lib/engine/derivation/braid'
import { readPersistedValue, writePersistedValue } from '$lib/stores/persistence'

export const VAULTS_STORAGE_KEY = 'saffron.vaults.v1'

// Pre multi-vault storage. Kept in place after migration as a dormant backup,
// reads always prefer the vaults file.
export const LEGACY_WALLET_STORAGE_KEY = 'saffron.wallet.v1'

const vaultRecordSchema = z.object({
  id: z.string().min(1),
  envelope: walletEnvelopeSchema,
})

export const vaultsFileSchema = z.object({
  schemaVersion: z.literal(1),
  activeId: z.string().nullable(),
  vaults: z.array(vaultRecordSchema),
})

export type VaultsFile = z.infer<typeof vaultsFileSchema>

export function emptyVaultsFile(): VaultsFile {
  return { schemaVersion: 1, activeId: null, vaults: [] }
}

export function wrapLegacyEnvelope(envelope: WalletEnvelope, id: string): VaultsFile {
  return { schemaVersion: 1, activeId: id, vaults: [{ id, envelope }] }
}

// Adding a vault that derives to an already known address replaces that vault
// instead of creating a twin, so restoring the same backup twice stays clean.
export function addVaultToFile(file: VaultsFile, envelope: WalletEnvelope, id: string): VaultsFile {
  const address = envelope.derivedAddresses.inscriptions
  const existing = file.vaults.find(
    (record) => record.envelope.derivedAddresses.inscriptions === address,
  )

  if (existing) {
    return {
      ...file,
      activeId: existing.id,
      vaults: file.vaults.map((record) =>
        record.id === existing.id ? { ...record, envelope } : record,
      ),
    }
  }

  return { ...file, activeId: id, vaults: [...file.vaults, { id, envelope }] }
}

export function updateActiveInFile(
  file: VaultsFile,
  envelope: WalletEnvelope,
  fallbackId: string,
): VaultsFile {
  const active = file.vaults.find((record) => record.id === file.activeId)
  if (!active) return addVaultToFile(file, envelope, fallbackId)

  return {
    ...file,
    vaults: file.vaults.map((record) =>
      record.id === active.id ? { ...record, envelope } : record,
    ),
  }
}

export function removeActiveFromFile(file: VaultsFile): VaultsFile {
  const remaining = file.vaults.filter((record) => record.id !== file.activeId)
  return { ...file, activeId: remaining[0]?.id ?? null, vaults: remaining }
}

function readVaultsFile(): VaultsFile {
  const stored = readPersistedValue<VaultsFile | null>(
    VAULTS_STORAGE_KEY,
    null,
    vaultsFileSchema.nullable(),
  )
  if (stored) return stored

  const legacy = readPersistedValue<WalletEnvelope | null>(
    LEGACY_WALLET_STORAGE_KEY,
    null,
    walletEnvelopeSchema.nullable(),
  )
  if (legacy) return wrapLegacyEnvelope(legacy, crypto.randomUUID())

  return emptyVaultsFile()
}

export const vaultsFile = writable<VaultsFile>(readVaultsFile())

if (browser) {
  vaultsFile.subscribe((value) => {
    writePersistedValue(VAULTS_STORAGE_KEY, value)
  })
}

function activeEnvelopeOf(file: VaultsFile): WalletEnvelope | null {
  return file.vaults.find((record) => record.id === file.activeId)?.envelope ?? null
}

const activeEnvelope = derived(vaultsFile, activeEnvelopeOf)

// Keeps the single-vault store contract the rest of the app was built on:
// reads see the active vault, set() updates it, set(null) removes it.
export const walletEnvelope = {
  subscribe: activeEnvelope.subscribe,
  set(value: WalletEnvelope | null): void {
    vaultsFile.update((file) =>
      value === null
        ? removeActiveFromFile(file)
        : updateActiveInFile(file, value, crypto.randomUUID()),
    )
  },
}

export function addVaultEnvelope(envelope: WalletEnvelope): void {
  vaultsFile.update((file) => addVaultToFile(file, envelope, crypto.randomUUID()))
}

export function setActiveVault(id: string): void {
  vaultsFile.update((file) =>
    file.vaults.some((record) => record.id === id) ? { ...file, activeId: id } : file,
  )
}

export function clearAllVaults(): void {
  vaultsFile.set(emptyVaultsFile())
}

export function quorumLabelOf(config: WalletConfig): string {
  if (config.quorum.totalSigners === 1) return 'single key'
  return `${config.quorum.requiredSigners}-of-${config.quorum.totalSigners}`
}

type DerivedAddressSnapshot = WalletEnvelope['derivedAddresses']

// Persisted addresses are a cache, never an authority. Re-derive them from the
// config and expose them only when both saved values still match.
export function verifiedAddressesOf(envelope: WalletEnvelope): DerivedAddressSnapshot | null {
  try {
    if (configErrors(validateWalletConfig(envelope.config)).length > 0) return null

    const derivedAddresses = deriveWalletAddresses(envelope.config)
    const verified = {
      inscriptions: derivedAddresses.inscriptions.address,
      payments: derivedAddresses.payments.address,
    }

    if (
      verified.inscriptions !== envelope.derivedAddresses.inscriptions ||
      verified.payments !== envelope.derivedAddresses.payments
    ) {
      return null
    }

    return verified
  } catch {
    return null
  }
}

export const walletConfig = derived(walletEnvelope, (envelope) => envelope?.config ?? null)
export const hasWallet = derived(walletEnvelope, (envelope) => envelope !== null)
export const activeVaultId = derived(vaultsFile, (file) => file.activeId)

export const vaultList = derived(vaultsFile, (file) =>
  file.vaults.map((record) => {
    const addresses = verifiedAddressesOf(record.envelope)
    return {
      id: record.id,
      name: record.envelope.config.name,
      quorumLabel: quorumLabelOf(record.envelope.config),
      address: addresses?.inscriptions ?? null,
      addressIntegrityOk: addresses !== null,
      active: record.id === file.activeId,
    }
  }),
)

export const quorumLabel = derived(walletConfig, (config) =>
  config ? quorumLabelOf(config) : null,
)

export const vaultAddresses = derived(walletEnvelope, (envelope) => {
  if (!envelope) return null
  return verifiedAddressesOf(envelope)
})

export function forgetWallet(): void {
  walletEnvelope.set(null)
}
