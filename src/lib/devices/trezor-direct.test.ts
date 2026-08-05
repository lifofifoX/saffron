import { describe, expect, it } from 'vitest'

import { deriveBranchAddress, deriveWalletAddresses } from '$lib/engine/derivation/braid'
import type { WalletConfig } from '$lib/engine/config/schema'
import { bip32PathToSequence } from '$lib/engine/paths'
import { fixtureWalletConfig } from '$lib/engine/testing/fixtures'

import { prepareTrezorSignRequest, type TrezorMixedInput } from './trezor-direct'

describe('prepareTrezorSignRequest', () => {
  it('preserves version, locktime, sequences, branch policies, and child indexes', () => {
    const config = fixtureWalletConfig(2, 3)
    const cosigner = config.extendedPublicKeys[0]!
    const addresses = deriveWalletAddresses(config)
    const childSeven = deriveBranchAddress(
      { ...config, startingAddressIndex: 7 } as unknown as WalletConfig,
      1,
    )

    const inputs: TrezorMixedInput[] = [
      {
        kind: 'vault',
        txid: '11'.repeat(32),
        vout: 0,
        valueSats: 1_000,
        branch: 0,
        sequence: 0xfffffffe,
        vaultInfo: addresses.inscriptions,
      },
      {
        kind: 'external',
        txid: '22'.repeat(32),
        vout: 1,
        valueSats: 2_000,
        scriptPubkeyHex: '0014' + '33'.repeat(20),
        witnessHex: '00',
        sequence: 0xffffffff,
      },
      {
        kind: 'vault',
        txid: '44'.repeat(32),
        vout: 2,
        valueSats: 3_000,
        branch: 1,
        sequence: 7,
        vaultInfo: childSeven,
      },
    ]

    const request = prepareTrezorSignRequest({
      cosigner,
      inputs,
      outputs: [{ address: addresses.inscriptions.address, valueSats: 5_500 }],
      version: 1,
      locktime: 840_000,
    })

    expect(request.version).toBe(1)
    expect(request.locktime).toBe(840_000)
    expect(request.expectedInputIndexes).toEqual([0, 2])
    expect(request.inputs.map((input) => input.sequence)).toEqual([0xfffffffe, 0xffffffff, 7])
    expect(request.inputs[0]?.address_n).toEqual(bip32PathToSequence(`${cosigner.bip32Path}/0/0`))
    expect(request.inputs[2]?.address_n).toEqual(bip32PathToSequence(`${cosigner.bip32Path}/1/7`))
    expect(
      request.inputs[0]?.multisig?.pubkeys.map((entry) =>
        typeof entry.node === 'string' ? entry.node : entry.node.public_key,
      ),
    ).toEqual(addresses.inscriptions.sortedPubkeysHex)
    expect(
      request.inputs[2]?.multisig?.pubkeys.map((entry) =>
        typeof entry.node === 'string' ? entry.node : entry.node.public_key,
      ),
    ).toEqual(childSeven.sortedPubkeysHex)
  })

  it('rejects unsupported fields before a device session', () => {
    const config = fixtureWalletConfig(2, 3)
    const cosigner = config.extendedPublicKeys[0]!
    const addresses = deriveWalletAddresses(config)
    const input: TrezorMixedInput = {
      kind: 'vault',
      txid: '11'.repeat(32),
      vout: 0,
      valueSats: 1_000,
      branch: 0,
      sequence: 0xfffffffd,
      vaultInfo: addresses.inscriptions,
    }

    expect(() =>
      prepareTrezorSignRequest({ cosigner, inputs: [input], outputs: [], version: 3, locktime: 0 }),
    ).toThrow('does not support transaction version 3')
    expect(() =>
      prepareTrezorSignRequest({
        cosigner,
        inputs: [{ ...input, sequence: -1 }],
        outputs: [],
        version: 2,
        locktime: 0,
      }),
    ).toThrow('unsupported sequence')
    expect(() =>
      prepareTrezorSignRequest({
        cosigner,
        inputs: [{ ...input, vaultInfo: addresses.payments }],
        outputs: [],
        version: 2,
        locktime: 0,
      }),
    ).toThrow('mismatched address policy')
  })
})
