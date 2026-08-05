// @vitest-environment happy-dom
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'

import { fixtureWalletConfig } from '$lib/engine/testing/fixtures'
import { activeVaultId, clearAllVaults, walletEnvelope } from '$lib/stores/wallet-config'

import {
  buildEnvelope,
  exportWalletConfigJson,
  importWalletConfigJson,
  loadVerifiedWallet,
  saveWalletConfig,
  updateLedgerPolicyHmac,
  WalletConfigError,
} from './wallet-store'

describe('wallet persistence', () => {
  beforeEach(() => {
    clearAllVaults()
  })

  it('builds an envelope with derived address snapshot', () => {
    const { envelope, addresses } = buildEnvelope(fixtureWalletConfig())

    expect(envelope.schemaVersion).toBe(1)
    expect(envelope.derivedAddresses.inscriptions).toBe(addresses.inscriptions.address)
    expect(envelope.derivedAddresses.payments).toBe(addresses.payments.address)
  })

  it('rejects invalid configs with issue details', () => {
    const broken = fixtureWalletConfig()
    broken.quorum.requiredSigners = 9

    expect(() => buildEnvelope(broken)).toThrow(WalletConfigError)
  })

  it('round-trips config JSON byte-compatibly through export/import', () => {
    saveWalletConfig(fixtureWalletConfig())

    const exported = exportWalletConfigJson()
    const reimported = importWalletConfigJson(exported)

    expect(reimported).toEqual(fixtureWalletConfig())
    expect(JSON.parse(exported)).not.toHaveProperty('schemaVersion')
    expect(JSON.parse(exported)).not.toHaveProperty('derivedAddresses')
  })

  it('accepts a full envelope on import', () => {
    const { envelope } = buildEnvelope(fixtureWalletConfig())
    const config = importWalletConfigJson(JSON.stringify(envelope))

    expect(config.name).toBe('saffron-fixture-vault')
  })

  it('rejects an invalid signing path in a previously stored envelope', () => {
    const { envelope } = buildEnvelope(fixtureWalletConfig())
    envelope.config.extendedPublicKeys[0]!.bip32Path = 'm/not-a-child'
    walletEnvelope.set(envelope)

    expect(() => loadVerifiedWallet()).toThrow(/saved wallet config failed validation/)
  })

  it('replaces ledger policy hmacs by fingerprint', () => {
    saveWalletConfig(fixtureWalletConfig())
    const [firstCosigner] = fixtureWalletConfig().extendedPublicKeys
    if (!firstCosigner) throw new Error('missing fixture cosigner')
    const vaultId = get(activeVaultId)
    if (!vaultId) throw new Error('missing active vault id')

    updateLedgerPolicyHmac(vaultId, firstCosigner.xfp, 'aa'.repeat(32), 'Saffron-11111111')
    updateLedgerPolicyHmac(vaultId, firstCosigner.xfp, 'bb'.repeat(32), 'Saffron-22222222')

    const envelope = get(walletEnvelope)
    expect(envelope?.config.ledgerPolicyHmacs).toEqual([
      {
        xfp: firstCosigner.xfp,
        policyHmac: 'bb'.repeat(32),
        policyName: 'Saffron-22222222',
      },
    ])
  })

  it('rejects stale async writes after the active vault changes', () => {
    saveWalletConfig(fixtureWalletConfig(2, 3))
    const staleVaultId = get(activeVaultId)
    if (!staleVaultId) throw new Error('missing first vault id')

    saveWalletConfig(fixtureWalletConfig(1, 1))
    const currentBefore = get(walletEnvelope)

    const [firstCosigner] = fixtureWalletConfig(2, 3).extendedPublicKeys
    if (!firstCosigner) throw new Error('missing fixture cosigner')

    expect(() =>
      updateLedgerPolicyHmac(staleVaultId, firstCosigner.xfp, 'aa'.repeat(32), 'Saffron-11111111'),
    ).toThrow('active vault changed while the operation was in progress')
    expect(get(walletEnvelope)).toEqual(currentBefore)
  })
})
