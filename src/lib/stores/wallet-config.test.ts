// @vitest-environment happy-dom
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'

import { fixtureSingleKeyConfig, fixtureWalletConfig } from '$lib/engine/testing/fixtures'
import { buildEnvelope } from '$lib/persistence/wallet-store'

import {
  addVaultEnvelope,
  addVaultToFile,
  clearAllVaults,
  emptyVaultsFile,
  forgetWallet,
  removeActiveFromFile,
  setActiveVault,
  vaultList,
  vaultAddresses,
  vaultsFile,
  walletEnvelope,
  wrapLegacyEnvelope,
} from './wallet-config'

const multisigEnvelope = () => buildEnvelope(fixtureWalletConfig()).envelope
const singleKeyEnvelope = () => buildEnvelope(fixtureSingleKeyConfig()).envelope

describe('vaults file operations', () => {
  it('wraps a legacy envelope as the single active vault', () => {
    const file = wrapLegacyEnvelope(multisigEnvelope(), 'legacy-id')

    expect(file.activeId).toBe('legacy-id')
    expect(file.vaults).toHaveLength(1)
    expect(file.vaults[0]?.envelope.config.name).toBe(fixtureWalletConfig().name)
  })

  it('adds distinct vaults and activates the newest', () => {
    let file = addVaultToFile(emptyVaultsFile(), multisigEnvelope(), 'a')
    file = addVaultToFile(file, singleKeyEnvelope(), 'b')

    expect(file.vaults.map((record) => record.id)).toEqual(['a', 'b'])
    expect(file.activeId).toBe('b')
  })

  it('replaces instead of duplicating a vault with the same address', () => {
    let file = addVaultToFile(emptyVaultsFile(), multisigEnvelope(), 'a')
    file = addVaultToFile(file, singleKeyEnvelope(), 'b')

    const renamed = multisigEnvelope()
    renamed.config = { ...renamed.config, name: 'renamed vault' }
    file = addVaultToFile(file, renamed, 'c')

    expect(file.vaults).toHaveLength(2)
    expect(file.activeId).toBe('a')
    expect(file.vaults[0]?.envelope.config.name).toBe('renamed vault')
  })

  it('removing the active vault activates the next one', () => {
    let file = addVaultToFile(emptyVaultsFile(), multisigEnvelope(), 'a')
    file = addVaultToFile(file, singleKeyEnvelope(), 'b')

    file = removeActiveFromFile(file)
    expect(file.activeId).toBe('a')
    expect(file.vaults).toHaveLength(1)

    file = removeActiveFromFile(file)
    expect(file.activeId).toBeNull()
    expect(file.vaults).toHaveLength(0)
  })
})

describe('active vault store contract', () => {
  beforeEach(() => {
    clearAllVaults()
  })

  it('exposes the active vault through walletEnvelope', () => {
    addVaultEnvelope(multisigEnvelope())
    addVaultEnvelope(singleKeyEnvelope())

    expect(get(walletEnvelope)?.config.addressType).toBe('P2WPKH')

    const entries = get(vaultList)
    expect(entries).toHaveLength(2)

    const multisigEntry = entries.find((entry) => entry.quorumLabel !== 'single key')
    expect(multisigEntry).toBeDefined()
    if (!multisigEntry) return

    setActiveVault(multisigEntry.id)
    expect(get(walletEnvelope)?.config.addressType).toBe('P2WSH')
  })

  it('walletEnvelope.set updates only the active vault', () => {
    addVaultEnvelope(multisigEnvelope())
    addVaultEnvelope(singleKeyEnvelope())

    const active = get(walletEnvelope)
    if (!active) throw new Error('expected an active vault')

    walletEnvelope.set({
      ...active,
      config: { ...active.config, name: 'renamed in place' },
    })

    const entries = get(vaultList)
    expect(entries.find((entry) => entry.active)?.name).toBe('renamed in place')
    expect(entries.filter((entry) => entry.name === 'renamed in place')).toHaveLength(1)
    expect(get(vaultsFile).vaults).toHaveLength(2)
  })

  it('does not expose a persisted address snapshot that fails re-derivation', () => {
    const tampered = multisigEnvelope()
    tampered.derivedAddresses = {
      ...tampered.derivedAddresses,
      inscriptions: singleKeyEnvelope().derivedAddresses.inscriptions,
    }
    addVaultEnvelope(tampered)

    expect(get(vaultAddresses)).toBeNull()
    expect(get(vaultList)).toEqual([
      expect.objectContaining({ address: null, addressIntegrityOk: false }),
    ])
  })

  it('does not expose addresses for a stored config with an invalid signing path', () => {
    const invalid = multisigEnvelope()
    invalid.config.extendedPublicKeys[0]!.bip32Path = 'm/not-a-child'
    addVaultEnvelope(invalid)

    expect(get(vaultAddresses)).toBeNull()
    expect(get(vaultList)).toEqual([
      expect.objectContaining({ address: null, addressIntegrityOk: false }),
    ])
  })

  it('forgetting the active vault falls back to the remaining one', () => {
    addVaultEnvelope(multisigEnvelope())
    addVaultEnvelope(singleKeyEnvelope())

    forgetWallet()

    expect(get(walletEnvelope)?.config.addressType).toBe('P2WSH')
    expect(get(vaultsFile).vaults).toHaveLength(1)

    forgetWallet()
    expect(get(walletEnvelope)).toBeNull()
  })
})
