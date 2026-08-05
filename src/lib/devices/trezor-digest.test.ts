import { sha256 } from '@noble/hashes/sha2.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import * as btc from '@scure/btc-signer'
import { pubECDSA } from '@scure/btc-signer/utils.js'
import { describe, expect, it } from 'vitest'

import { scriptHexToAddress } from '$lib/engine/address'
import { deriveWalletAddresses } from '$lib/engine/derivation/braid'
import { verifySignatureForInput } from '$lib/engine/psbt/signatures'
import { fixtureCosigners, fixtureWalletConfig } from '$lib/engine/testing/fixtures'
import { buildFundingTx } from '$lib/engine/testing/funding'
import { planSimpleTransfer } from '$lib/engine/transfer/simple'
import { simpleTransferToPsbt } from '$lib/engine/transfer/simple-to-psbt'

import { ensureSighashByte } from './sign'

function sha256d(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes))
}

function uint32LE(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value)
  return buffer
}

function uint64LE(value: number): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64LE(BigInt(value))
  return buffer
}

function txidLE(txid: string): Buffer {
  return Buffer.from(txid, 'hex').reverse()
}

// Simulates the Trezor firmware: it reconstructs the transaction purely from
// the signTransaction parameters, so this digest is what the device signs.
function firmwareBip143Digest(p: {
  version: number
  locktime: number
  inputs: { txid: string; vout: number; sequence: number }[]
  signedInputIndex: number
  signedInputAmount: number
  scriptCode: Buffer
  outputs: { address: string; valueSats: number }[]
}): Uint8Array {
  const prevouts = Buffer.concat(
    p.inputs.map((input) => Buffer.concat([txidLE(input.txid), uint32LE(input.vout)])),
  )
  const sequences = Buffer.concat(p.inputs.map((input) => uint32LE(input.sequence)))

  const outputs = Buffer.concat(
    p.outputs.map((output) => {
      const script = Buffer.from(
        btc.OutScript.encode(
          btc.Address().decode(output.address) as Parameters<typeof btc.OutScript.encode>[0],
        ),
      )
      return Buffer.concat([uint64LE(output.valueSats), Buffer.from([script.length]), script])
    }),
  )

  const signedInput = p.inputs[p.signedInputIndex]
  if (!signedInput) throw new Error('missing signed input')

  const preimage = Buffer.concat([
    uint32LE(p.version),
    Buffer.from(sha256d(prevouts)),
    Buffer.from(sha256d(sequences)),
    txidLE(signedInput.txid),
    uint32LE(signedInput.vout),
    Buffer.from([p.scriptCode.length]),
    p.scriptCode,
    uint64LE(p.signedInputAmount),
    uint32LE(signedInput.sequence),
    Buffer.from(sha256d(outputs)),
    uint32LE(p.locktime),
    uint32LE(1),
  ])

  return sha256d(preimage)
}

describe('trezor firmware digest cross-check', () => {
  it('a signature over the firmware-view digest verifies against the PSBT', () => {
    const config = fixtureWalletConfig(2, 3)
    const cosigners = fixtureCosigners(3)
    const addresses = deriveWalletAddresses(config)

    const walletPrivateKey = sha256(new TextEncoder().encode('saffron-fixture-fee-wallet'))
    const walletPublicKey = pubECDSA(walletPrivateKey)
    const walletPayment = btc.p2wpkh(walletPublicKey)
    const walletScriptHex = Buffer.from(walletPayment.script).toString('hex')

    const recipientScriptHex = Buffer.from(
      btc.OutScript.encode({
        type: 'tr',
        pubkey: Uint8Array.from(
          Buffer.from('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
        ),
      }),
    ).toString('hex')

    const vaultFunding = buildFundingTx([
      { valueSats: 330, scriptHex: addresses.inscriptions.scriptPubkeyHex },
    ])
    const walletFunding = buildFundingTx([{ valueSats: 36_356, scriptHex: walletScriptHex }])

    const plan = planSimpleTransfer({
      items: [
        {
          outpoint: { txid: vaultFunding.txid, vout: 0 },
          valueSats: 330,
          inscriptionIds: ['insc'],
          recipientScriptHex,
        },
      ],
      quorum: config.quorum,
      inscriptionsScriptHex: addresses.inscriptions.scriptPubkeyHex,
      feeWallet: {
        kind: 'p2wpkh',
        cardinalUtxos: [{ outpoint: { txid: walletFunding.txid, vout: 0 }, valueSats: 36_356 }],
        changeScriptHex: walletScriptHex,
      },
      feeRateSatVb: 1.1,
    })

    const { psbtBase64 } = simpleTransferToPsbt(plan, {
      addresses,
      feeWallet: {
        kind: 'p2wpkh',
        address: walletPayment.address ?? '',
        publicKeyHex: Buffer.from(walletPublicKey).toString('hex'),
      },
      prevTxHexByTxid: { [vaultFunding.txid]: vaultFunding.hex },
    })

    // The firmware builds this script from the multisig struct we send.
    if (!addresses.inscriptions.witnessScriptHex) throw new Error('missing witness script')
    const scriptCode = Buffer.from(addresses.inscriptions.witnessScriptHex, 'hex')

    const trezorInputs = [
      { txid: vaultFunding.txid, vout: 0, sequence: 0xfffffffd },
      { txid: walletFunding.txid, vout: 0, sequence: 0xfffffffd },
    ]
    const trezorOutputs = plan.outputs.map((output) => ({
      address: scriptHexToAddress(output.scriptHex),
      valueSats: output.valueSats,
    }))

    // Address round trip must reproduce the exact scripts of the PSBT outputs.
    for (const [outputIndex, output] of plan.outputs.entries()) {
      const trezorOutput = trezorOutputs[outputIndex]
      if (!trezorOutput) throw new Error('missing output')
      const reencoded = Buffer.from(
        btc.OutScript.encode(
          btc.Address().decode(trezorOutput.address) as Parameters<typeof btc.OutScript.encode>[0],
        ),
      ).toString('hex')
      expect(reencoded).toBe(output.scriptHex)
    }

    const digest = firmwareBip143Digest({
      version: 2,
      locktime: 0,
      inputs: trezorInputs,
      signedInputIndex: 0,
      signedInputAmount: 330,
      scriptCode,
      outputs: trezorOutputs,
    })

    const childKey = cosigners[0]?.account.deriveChild(0).deriveChild(0)
    if (!childKey?.privateKey || !childKey.publicKey) throw new Error('missing fixture key')

    const signature = secp256k1.sign(digest, childKey.privateKey, { lowS: true, format: 'der', prehash: false })
    const signatureHex = ensureSighashByte(Buffer.from(signature).toString('hex'))

    const validated = verifySignatureForInput({
      psbtBase64,
      inputIndex: 0,
      signatureHex,
      inputValueSats: 330,
    })

    expect(validated).toBe(Buffer.from(childKey.publicKey).toString('hex'))
  })
})
