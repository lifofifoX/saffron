import { get } from 'svelte/store'

import {
  parseWalletConfigJson,
  serializeWalletConfig,
  type WalletConfig,
  type WalletEnvelope,
  walletEnvelopeSchema,
} from '$lib/engine/config/schema'
import { configErrors, validateWalletConfig } from '$lib/engine/config/validate'
import { deriveWalletAddresses } from '$lib/engine/derivation/braid'
import type { WalletAddresses } from '$lib/engine/types'
import { assertWalletBackupTextSize } from '$lib/security/input-limits'
import { addVaultEnvelope, vaultsFile, walletEnvelope } from '$lib/stores/wallet-config'

export class WalletConfigError extends Error {
  issues: string[]

  constructor(message: string, issues: string[] = []) {
    super(message)
    this.issues = issues
  }
}

export function buildEnvelope(config: WalletConfig): {
  envelope: WalletEnvelope
  addresses: WalletAddresses
} {
  const issues = configErrors(validateWalletConfig(config))
  if (issues.length > 0) {
    throw new WalletConfigError('wallet config failed validation', issues)
  }

  const addresses = deriveWalletAddresses(config)

  return {
    envelope: {
      schemaVersion: 1,
      config,
      derivedAddresses: {
        inscriptions: addresses.inscriptions.address,
        payments: addresses.payments.address,
      },
      savedAt: new Date().toISOString(),
    },
    addresses,
  }
}

// Adds the vault (or re-activates and refreshes an existing one with the same
// address) and makes it the active vault.
export function saveWalletConfig(config: WalletConfig): WalletAddresses {
  const { envelope, addresses } = buildEnvelope(config)
  addVaultEnvelope(envelope)
  return addresses
}

export function importWalletConfigJson(json: string): WalletConfig {
  assertWalletBackupTextSize(json.length)
  const raw: unknown = JSON.parse(json)

  const asEnvelope = walletEnvelopeSchema.safeParse(raw)
  if (asEnvelope.success) return asEnvelope.data.config

  return parseWalletConfigJson(json)
}

export function exportWalletConfigJson(): string {
  const envelope = get(walletEnvelope)
  if (!envelope) throw new WalletConfigError('no wallet configured')

  return serializeWalletConfig(envelope.config)
}

// Re-derives from the stored config and hard-fails on address drift — catches
// library upgrades or corrupted configs before any transaction is planned.
export function loadVerifiedWallet(): {
  config: WalletConfig
  addresses: WalletAddresses
} | null {
  const envelope = get(walletEnvelope)
  if (!envelope) return null

  const issues = configErrors(validateWalletConfig(envelope.config))
  if (issues.length > 0) {
    throw new WalletConfigError('saved wallet config failed validation', issues)
  }

  const addresses = deriveWalletAddresses(envelope.config)
  if (
    addresses.inscriptions.address !== envelope.derivedAddresses.inscriptions ||
    addresses.payments.address !== envelope.derivedAddresses.payments
  ) {
    throw new WalletConfigError(
      'derived addresses no longer match the saved wallet. Do not send funds until this is resolved.',
    )
  }

  return { config: envelope.config, addresses }
}

function updateExpectedVault(
  expectedVaultId: string,
  update: (envelope: WalletEnvelope) => WalletEnvelope,
): void {
  vaultsFile.update((file) => {
    if (file.activeId !== expectedVaultId) {
      throw new WalletConfigError('active vault changed while the operation was in progress')
    }

    const target = file.vaults.find((record) => record.id === expectedVaultId)
    if (!target) throw new WalletConfigError('the target vault no longer exists')

    return {
      ...file,
      vaults: file.vaults.map((record) =>
        record.id === expectedVaultId ? { ...record, envelope: update(record.envelope) } : record,
      ),
    }
  })
}

export function renameVault(name: string): void {
  const trimmed = name.trim()
  if (!trimmed) throw new WalletConfigError('the vault name cannot be empty')

  const envelope = get(walletEnvelope)
  if (!envelope) throw new WalletConfigError('no wallet configured')

  walletEnvelope.set({
    ...envelope,
    config: { ...envelope.config, name: trimmed },
    savedAt: new Date().toISOString(),
  })
}

export function renameCosigner(xfp: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) throw new WalletConfigError('the key name cannot be empty')

  const envelope = get(walletEnvelope)
  if (!envelope) throw new WalletConfigError('no wallet configured')

  const normalizedXfp = xfp.toLowerCase()

  walletEnvelope.set({
    ...envelope,
    config: {
      ...envelope.config,
      extendedPublicKeys: envelope.config.extendedPublicKeys.map((cosigner) =>
        cosigner.xfp.toLowerCase() === normalizedXfp ? { ...cosigner, name: trimmed } : cosigner,
      ),
    },
    savedAt: new Date().toISOString(),
  })
}

export function updateLedgerPolicyHmac(
  expectedVaultId: string,
  xfp: string,
  policyHmac: string,
  policyName: string,
): void {
  const normalizedXfp = xfp.toLowerCase()
  updateExpectedVault(expectedVaultId, (envelope) => {
    const others = envelope.config.ledgerPolicyHmacs.filter(
      (entry) => entry.xfp.toLowerCase() !== normalizedXfp,
    )

    return {
      ...envelope,
      config: {
        ...envelope.config,
        ledgerPolicyHmacs: [...others, { xfp: normalizedXfp, policyHmac, policyName }],
      },
      savedAt: new Date().toISOString(),
    }
  })
}
