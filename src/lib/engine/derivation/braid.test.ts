import * as btc from '@scure/btc-signer'
import { describe, expect, it } from 'vitest'

import { configErrors, validateWalletConfig } from '$lib/engine/config/validate'
import { walletConfigSchema } from '$lib/engine/config/schema'
import { fixtureCosigners, fixtureWalletConfig } from '$lib/engine/testing/fixtures'
import { INSCRIPTIONS_BRANCH, PAYMENTS_BRANCH } from '$lib/engine/types'

import { deriveWalletAddresses } from './braid'

function independentScureAddress(requiredSigners: number, branch: number, index: number) {
  const cosigners = fixtureCosigners(3)

  const pubkeysHex = cosigners
    .map((cosigner) => {
      const child = cosigner.account.deriveChild(branch).deriveChild(index)
      if (!child.publicKey) throw new Error('missing pubkey')
      return Buffer.from(child.publicKey).toString('hex')
    })
    .sort()

  const pubkeys = pubkeysHex.map((hex) => Uint8Array.from(Buffer.from(hex, 'hex')))
  const payment = btc.p2wsh(btc.p2ms(requiredSigners, pubkeys))

  return {
    address: payment.address,
    scriptPubkeyHex: Buffer.from(payment.script).toString('hex'),
    witnessScriptHex: payment.witnessScript
      ? Buffer.from(payment.witnessScript).toString('hex')
      : null,
    sortedPubkeysHex: pubkeysHex,
  }
}

describe('deriveWalletAddresses', () => {
  const config = fixtureWalletConfig(2, 3)
  const addresses = deriveWalletAddresses(config)

  it('derives two distinct P2WSH mainnet addresses', () => {
    expect(addresses.inscriptions.address.startsWith('bc1q')).toBe(true)
    expect(addresses.payments.address.startsWith('bc1q')).toBe(true)
    expect(addresses.inscriptions.address).not.toBe(addresses.payments.address)
    expect(addresses.inscriptions.branch).toBe(INSCRIPTIONS_BRANCH)
    expect(addresses.payments.branch).toBe(PAYMENTS_BRANCH)
  })

  it('matches an independent scure-btc-signer construction on both branches', () => {
    for (const branch of [0, 1] as const) {
      const derivedInfo = branch === 0 ? addresses.inscriptions : addresses.payments
      const scureInfo = independentScureAddress(2, branch, 0)

      expect(derivedInfo.address).toBe(scureInfo.address)
      expect(derivedInfo.scriptPubkeyHex).toBe(scureInfo.scriptPubkeyHex)
      expect(derivedInfo.witnessScriptHex).toBe(scureInfo.witnessScriptHex)
      expect(derivedInfo.sortedPubkeysHex).toEqual(scureInfo.sortedPubkeysHex)
    }
  })

  it('carries full cosigner bip32Derivation with real fingerprints', () => {
    for (const info of [addresses.inscriptions, addresses.payments]) {
      expect(info.bip32Derivation).toHaveLength(3)

      for (const entry of info.bip32Derivation) {
        expect(entry.path).toMatch(new RegExp(`^m/48'/0'/0'/2'/${info.branch}/0$`))
        expect(entry.xfp).toMatch(/^[0-9a-f]{8}$/)
        expect(entry.xfp).not.toBe('00000000')
        expect(entry.pubkeyHex).toMatch(/^[0-9a-f]{66}$/)
      }

      const configXfps = config.extendedPublicKeys.map((cosigner) => cosigner.xfp).sort()
      const derivationXfps = info.bip32Derivation.map((entry) => entry.xfp).sort()
      expect(derivationXfps).toEqual(configXfps)
    }
  })

  it('passes config validation with no errors', () => {
    const issues = validateWalletConfig(fixtureWalletConfig(2, 3))
    expect(configErrors(issues)).toEqual([])
  })

  it('flags broken configs', () => {
    const broken = fixtureWalletConfig(2, 3)
    broken.quorum.requiredSigners = 4
    const withDuplicate = fixtureWalletConfig(2, 3)
    const [firstKey] = withDuplicate.extendedPublicKeys
    if (firstKey) withDuplicate.extendedPublicKeys[1] = { ...firstKey, name: 'key-2' }

    expect(configErrors(validateWalletConfig(broken)).length).toBeGreaterThan(0)
    expect(configErrors(validateWalletConfig(withDuplicate)).length).toBeGreaterThan(0)
  })

  it('rejects unsupported starting address indexes', () => {
    const unsupported = { ...fixtureWalletConfig(2, 3), startingAddressIndex: 1 }

    expect(walletConfigSchema.safeParse(unsupported).success).toBe(false)
  })

  it('treats invalid and depth-mismatched key origins as errors', () => {
    const invalidPath = fixtureWalletConfig(2, 3)
    invalidPath.extendedPublicKeys[0]!.bip32Path = 'm/not-a-child'

    const wrongDepth = fixtureWalletConfig(2, 3)
    wrongDepth.extendedPublicKeys[0]!.bip32Path = "m/48'/0'/0'"

    expect(configErrors(validateWalletConfig(invalidPath))).toContainEqual(
      expect.stringContaining('invalid key origin'),
    )
    expect(configErrors(validateWalletConfig(wrongDepth))).toContainEqual(
      expect.stringContaining('does not match path'),
    )
  })

  it('rejects an xpub whose child index does not match its claimed path', () => {
    const mismatched = fixtureWalletConfig(2, 3)
    const [firstCosigner] = fixtureCosigners(1)
    if (!firstCosigner) throw new Error('missing cosigner')

    mismatched.extendedPublicKeys[0]!.xpub =
      firstCosigner.master.derive("m/48'/0'/0'/1'").publicExtendedKey

    expect(configErrors(validateWalletConfig(mismatched))).toContainEqual(
      expect.stringContaining('xpub child index does not match path'),
    )
  })
})
