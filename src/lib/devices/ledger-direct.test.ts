import { describe, expect, it } from 'vitest'

import { fixtureWalletConfig } from '$lib/engine/testing/fixtures'

import { buildWalletPolicy, ledgerPolicyName, registeredLedgerPolicyHmac } from './ledger-direct'

describe('ledgerPolicyName', () => {
  it('is recognizable, stable, unique to the policy, and within the device limit', () => {
    const config = fixtureWalletConfig(2, 3)
    config.uuid = 'a6fa66ad-9f3d-4e4c-bf62-f83263fb35b4'

    const name = ledgerPolicyName(config)
    expect(name).toMatch(/^Saffron-[0-9a-f]{8}$/)
    expect(new TextEncoder().encode(name)).toHaveLength(16)

    const renamed = { ...config, name: 'A cosmetic rename' }
    expect(ledgerPolicyName(renamed)).toBe(name)

    const changedPolicy = {
      ...config,
      quorum: { ...config.quorum, requiredSigners: 1 },
    }
    expect(ledgerPolicyName(changedPolicy)).not.toBe(name)
  })

  it('only reuses an HMAC bound to the current byte-exact policy name', () => {
    const config = fixtureWalletConfig(2, 3)
    const cosigner = config.extendedPublicKeys[0]!
    const policyName = ledgerPolicyName(config)
    config.ledgerPolicyHmacs = [
      { xfp: cosigner.xfp, policyHmac: '11'.repeat(32) },
      { xfp: cosigner.xfp, policyHmac: '22'.repeat(32), policyName: 'Saffron-deadbeef' },
    ]
    expect(registeredLedgerPolicyHmac(config, cosigner.xfp)).toBeUndefined()

    config.ledgerPolicyHmacs.push({
      xfp: cosigner.xfp,
      policyHmac: '33'.repeat(32),
      policyName,
    })
    expect(registeredLedgerPolicyHmac(config, cosigner.xfp)).toBe('33'.repeat(32))
  })
})

// The device HMAC binds to the byte-exact serialized policy. If any dependency
// upgrade changes these bytes, every previously registered Ledger silently
// stops matching and must be re-registered, so the encoding is pinned here.
describe('wallet policy serialization', () => {
  it('serializes a 2-of-3 vault to stable bytes', async () => {
    const { WalletPolicy } = await import('@ledgerhq/ledger-bitcoin')

    const config = fixtureWalletConfig(2, 3)
    config.uuid = 'a6fa66ad-9f3d-4e4c-bf62-f83263fb35b4'

    const policy = buildWalletPolicy(config, WalletPolicy)

    expect(policy.name).toBe(ledgerPolicyName(config))
    expect(policy.descriptorTemplate).toMatchInlineSnapshot(
      `"wsh(sortedmulti(2,@0/**,@1/**,@2/**))"`,
    )
    expect(policy.keys).toMatchInlineSnapshot(`
      [
        "[0fde24b9/48'/0'/0'/2']xpub6E4grgT62ivHahWxpFcGiKvvbgrnGxohuPVrFbCumAbYJWqSj2xnSygdAkaQcJZqMXK6jito3ZDezhQNgFALy5ESEyj3nJfotVCaFfgd8Kq",
        "[42a80f68/48'/0'/0'/2']xpub6FKVteBkTVAnt8maXvARmg9zjaDmKXBA8jKSxjyyecoiXbZVUU5Uk7LxieRcjpe793GVZMGriSbWZW2gJ9sV2q8LoYuQyRaQUJMF1q7FjrX",
        "[32d17141/48'/0'/0'/2']xpub6FLoBXC4KnB4vj29N9Mmw9bnuUCWKDGy3R85kPPz1SjwamMSNfuri7TztetANMCHs9GBL83wGWsQEEgiCvmEgRb8i2Hh262DGhEmAC2ZoYT",
      ]
    `)
    expect(policy.serialize().toString('hex')).toMatchInlineSnapshot(
      `"021053616666726f6e2d38353130643765392545cff6017af8edc8b6bb6cdb8634ff05e1a82a7f7962d114045d2bd666e1a16e033581cda1d637cc9ea67d10e35f1cbd65e5599a418e1101bd333674d9adb9cf9d"`,
    )
  })
})
