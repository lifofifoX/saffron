import hashlibCrypto from 'node:crypto'

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { pubECDSA } from '@scure/btc-signer/utils.js'
import { describe, expect, it } from 'vitest'

import { ensureSighashByte } from '$lib/devices/sign'
import { deriveWalletAddresses } from '$lib/engine/derivation/braid'
import { finalizeIfReady } from '$lib/engine/psbt/finalize'
import { parsePsbt } from '$lib/engine/psbt/parse'
import {
  finalizeInputs,
  mergeSignature,
  verifySignatureForInput,
} from '$lib/engine/psbt/signatures'
import {
  fixtureCosigner,
  FIXTURE_SINGLE_KEY_PATH,
  fixtureSingleKeyConfig,
} from '$lib/engine/testing/fixtures'
import { buildFundingTx } from '$lib/engine/testing/funding'

import { planSimpleTransfer } from './simple'
import { simpleTransferToPsbt } from './simple-to-psbt'

function sha256d(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes))
}

function hash160(bytes: Uint8Array): Buffer {
  return hashlibCrypto
    .createHash('ripemd160')
    .update(Buffer.from(sha256(bytes)))
    .digest()
}

function uint32LE(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value >>> 0)
  return buffer
}

function uint64LE(value: number): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64LE(BigInt(value))
  return buffer
}

describe('single key P2WPKH vault', () => {
  const config = fixtureSingleKeyConfig()
  const cosigner = fixtureCosigner('key-1', 'cosigner-1', FIXTURE_SINGLE_KEY_PATH)
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

  it('derives a bech32 p2wpkh vault address with no witness script', () => {
    expect(addresses.inscriptions.kind).toBe('p2wpkh')
    expect(addresses.inscriptions.address.startsWith('bc1q')).toBe(true)
    expect(addresses.inscriptions.witnessScriptHex).toBeUndefined()
    expect(addresses.inscriptions.requiredSigners).toBe(1)
  })

  it('signs the firmware-view digest and completes the transfer', () => {
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

    const { psbtBase64, feeInputIndexes } = simpleTransferToPsbt(plan, {
      addresses,
      feeWallet: {
        kind: 'p2wpkh',
        address: walletPayment.address ?? '',
        publicKeyHex: Buffer.from(walletPublicKey).toString('hex'),
      },
      prevTxHexByTxid: { [vaultFunding.txid]: vaultFunding.hex },
    })

    const childKey = cosigner.account.deriveChild(0).deriveChild(0)
    if (!childKey.privateKey || !childKey.publicKey) throw new Error('missing fixture key')
    const childPubkey = Buffer.from(childKey.publicKey)

    // The firmware signs p2wpkh inputs over a p2pkh script code.
    const scriptCode = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      hash160(childKey.publicKey),
      Buffer.from([0x88, 0xac]),
    ])

    const prevouts = Buffer.concat([
      Buffer.from(vaultFunding.txid, 'hex').reverse(),
      uint32LE(0),
      Buffer.from(walletFunding.txid, 'hex').reverse(),
      uint32LE(0),
    ])
    const sequences = Buffer.concat([uint32LE(0xfffffffd), uint32LE(0xfffffffd)])
    const outputs = Buffer.concat(
      plan.outputs.map((output) => {
        const script = Buffer.from(output.scriptHex, 'hex')
        return Buffer.concat([uint64LE(output.valueSats), Buffer.from([script.length]), script])
      }),
    )

    const preimage = Buffer.concat([
      uint32LE(2),
      Buffer.from(sha256d(prevouts)),
      Buffer.from(sha256d(sequences)),
      Buffer.from(vaultFunding.txid, 'hex').reverse(),
      uint32LE(0),
      Buffer.from([scriptCode.length]),
      scriptCode,
      uint64LE(330),
      uint32LE(0xfffffffd),
      Buffer.from(sha256d(outputs)),
      uint32LE(0),
      uint32LE(1),
    ])
    const digest = sha256d(preimage)

    const signature = secp256k1.sign(digest, childKey.privateKey, { lowS: true, format: 'der', prehash: false })
    const signatureHex = ensureSighashByte(Buffer.from(signature).toString('hex'))

    const validated = verifySignatureForInput({
      psbtBase64,
      inputIndex: 0,
      signatureHex,
      inputValueSats: 330,
    })
    expect(validated).toBe(childPubkey.toString('hex'))

    const { transaction } = parsePsbt(psbtBase64)
    expect(
      mergeSignature(transaction, {
        inputIndex: 0,
        pubkeyHex: childPubkey.toString('hex'),
        signatureHex,
      }),
    ).toBe(true)

    for (const feeIndex of feeInputIndexes) {
      transaction.signIdx(walletPrivateKey, feeIndex)
    }
    // The live flow finalizes fee inputs as soon as the wallet signs them;
    // finalizeIfReady must accept inputs that are already final.
    finalizeInputs(transaction, feeInputIndexes)

    const artifacts = finalizeIfReady(transaction, addresses)
    expect(artifacts).not.toBeNull()
    expect(artifacts?.rawTxHex.length).toBeGreaterThan(0)
  })
})
