import * as btc from '@scure/btc-signer'
import { describe, expect, it } from 'vitest'

import { configErrors, validateWalletConfig } from '$lib/engine/config/validate'
import { deriveWalletAddresses } from '$lib/engine/derivation/braid'
import { fixtureCosigners, fixtureWalletConfig } from '$lib/engine/testing/fixtures'

// Legacy 1-of-1 P2WSH vaults are no longer created (Trezor firmware cannot
// sign them), but restored configs must keep deriving the same addresses.
describe('single-key (1-of-1) P2WSH vault', () => {
  const config = fixtureWalletConfig(1, 1)
  const [cosigner] = fixtureCosigners(1)
  const addresses = deriveWalletAddresses(config)

  it('validates and derives distinct P2WSH addresses', () => {
    expect(configErrors(validateWalletConfig(config))).toEqual([])
    expect(addresses.inscriptions.address.startsWith('bc1q')).toBe(true)
    expect(addresses.inscriptions.address).not.toBe(addresses.payments.address)
    expect(addresses.inscriptions.sortedPubkeysHex).toHaveLength(1)
    expect(addresses.inscriptions.requiredSigners).toBe(1)
  })

  it('matches an independent scure 1-of-1 construction', () => {
    if (!cosigner) throw new Error('missing fixture cosigner')

    const child = cosigner.account.deriveChild(0).deriveChild(0)
    if (!child.publicKey) throw new Error('missing pubkey')

    const payment = btc.p2wsh(btc.p2ms(1, [child.publicKey]))
    expect(addresses.inscriptions.address).toBe(payment.address)
  })
})
