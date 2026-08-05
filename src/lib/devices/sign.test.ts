import { describe, expect, it } from 'vitest'

import { childPubkeyHex } from '$lib/engine/derivation/braid'
import { fixtureWalletConfig } from '$lib/engine/testing/fixtures'

import { validateDeviceSignatureSet, type DeviceSignature } from './sign'

describe('validateDeviceSignatureSet', () => {
  const config = fixtureWalletConfig(2, 3)
  const cosigner = config.extendedPublicKeys[0]!
  const inputs = [
    { inputIndex: 0, branch: 0 as const, valueSats: 1_000 },
    { inputIndex: 2, branch: 1 as const, valueSats: 2_000 },
  ]
  const signatures: DeviceSignature[] = inputs.map((input) => ({
    inputIndex: input.inputIndex,
    pubkeyHex: childPubkeyHex(cosigner.xpub, input.branch, 0),
    signatureHex: '00',
  }))

  it('accepts exact selected-cosigner coverage of every vault input', () => {
    expect(validateDeviceSignatureSet({ signatures, inputs, cosigner, childIndex: 0 })).toEqual(
      signatures,
    )

    expect(
      validateDeviceSignatureSet({
        signatures: signatures.slice(1),
        inputs,
        cosigner,
        childIndex: 0,
        alreadyCoveredInputIndexes: [0],
      }),
    ).toEqual(signatures.slice(1))
  })

  it('rejects incomplete, unexpected, duplicate, and misattributed responses', () => {
    expect(() =>
      validateDeviceSignatureSet({
        signatures: signatures.slice(0, 1),
        inputs,
        cosigner,
        childIndex: 0,
      }),
    ).toThrow('did not sign every vault input')

    expect(() =>
      validateDeviceSignatureSet({
        signatures: [...signatures, { ...signatures[0]!, inputIndex: 1 }],
        inputs,
        cosigner,
        childIndex: 0,
      }),
    ).toThrow('unexpected input 1')

    expect(() =>
      validateDeviceSignatureSet({
        signatures: [...signatures, signatures[0]!],
        inputs,
        cosigner,
        childIndex: 0,
      }),
    ).toThrow('more than one signature for input 0')

    const otherCosigner = config.extendedPublicKeys[1]!
    expect(() =>
      validateDeviceSignatureSet({
        signatures: [
          {
            ...signatures[0]!,
            pubkeyHex: childPubkeyHex(otherCosigner.xpub, 0, 0),
          },
          signatures[1]!,
        ],
        inputs,
        cosigner,
        childIndex: 0,
      }),
    ).toThrow('key other than the selected cosigner')
  })
})
