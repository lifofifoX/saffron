import { sha256 } from '@noble/hashes/sha2.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import * as btc from '@scure/btc-signer'
import { pubECDSA } from '@scure/btc-signer/utils.js'
import { describe, expect, it } from 'vitest'

import { finalizeInputs, mergeWalletSignedInputs } from './signatures'

describe('finalizeInputs', () => {
  it('finalizes past an empty finalScriptSig artifact left by wallet PSBTs', () => {
    const priv = sha256(new TextEncoder().encode('saffron-fixture-fee-wallet'))
    const pub = pubECDSA(priv)
    const payment = btc.p2wpkh(pub)

    const tx = new btc.Transaction()
    tx.addInput({
      txid: '6dfefd62be9350eed94058c3a40c32d44d97577a654ebf9dddc809a09b14c9f1',
      index: 4,
      witnessUtxo: { script: payment.script, amount: 36_356n },
      sequence: 0xfffffffd,
    })
    tx.addOutputAddress(payment.address ?? '', 36_112n)
    tx.signIdx(priv, 0)

    // Some wallets return finalized-looking empty fields alongside partialSig.
    tx.updateInput(0, { finalScriptSig: new Uint8Array(0) }, true)

    finalizeInputs(tx, [0])

    const input = tx.getInput(0)
    expect(input.finalScriptWitness?.length).toBeGreaterThan(0)
    expect(input.finalScriptWitness?.every((item) => item.length > 0)).toBe(true)
  })
})

describe('mergeWalletSignedInputs', () => {
  it('accepts a finalized P2SH-P2WPKH wallet response for the same unsigned transaction', () => {
    const priv = sha256(new TextEncoder().encode('saffron-fixture-p2sh-fee-wallet'))
    const inner = btc.p2wpkh(pubECDSA(priv))
    const payment = btc.p2sh(inner)

    const working = new btc.Transaction()
    working.addInput({
      txid: '0e88474c26e384307a5e514333ad1493cc2a0a6914d1d8d6a4c26f34f1ed683f',
      index: 1,
      witnessUtxo: { script: payment.script, amount: 50_000n },
      redeemScript: inner.script,
      sequence: 0xfffffffd,
    })
    working.addOutputAddress(payment.address ?? '', 49_500n)

    const walletResponse = btc.Transaction.fromPSBT(working.toPSBT(0))
    expect(walletResponse.signIdx(priv, 0)).toBe(true)
    walletResponse.finalizeIdx(0)

    // Finalizing P2SH adds scriptSig and changes txid, but not the unsigned transaction.
    expect(walletResponse.id).not.toBe(working.id)
    expect(mergeWalletSignedInputs(working, walletResponse.toPSBT(0), [0])).toBe(1)

    const input = working.getInput(0)
    expect(input.finalScriptSig?.length).toBeGreaterThan(0)
    expect(input.finalScriptWitness?.length).toBeGreaterThan(0)
    expect(working.id).toBe(walletResponse.id)
  })

  it('rejects a finalized witness whose signature does not verify', () => {
    const priv = sha256(new TextEncoder().encode('saffron-fixture-invalid-fee-wallet'))
    const payment = btc.p2wpkh(pubECDSA(priv))
    const working = new btc.Transaction()
    working.addInput({
      txid: '88'.repeat(32),
      index: 0,
      witnessUtxo: { script: payment.script, amount: 50_000n },
    })
    working.addOutputAddress(payment.address ?? '', 49_500n)

    const malicious = btc.Transaction.fromPSBT(working.toPSBT(0))
    malicious.updateInput(0, { finalScriptWitness: [Uint8Array.of(1)] }, true)

    expect(() => mergeWalletSignedInputs(working, malicious.toPSBT(0), [0])).toThrow(
      /invalid witness/,
    )
    expect(working.getInput(0).finalScriptWitness).toBeUndefined()
  })

  it('requires every requested input and leaves the working PSBT untouched on failure', () => {
    const priv = sha256(new TextEncoder().encode('saffron-fixture-complete-fee-wallet'))
    const payment = btc.p2wpkh(pubECDSA(priv))
    const working = new btc.Transaction()
    for (const [index, txidByte] of ['77', '66'].entries()) {
      working.addInput({
        txid: txidByte.repeat(32),
        index,
        witnessUtxo: { script: payment.script, amount: 25_000n },
      })
    }
    working.addOutputAddress(payment.address ?? '', 49_000n)

    const incomplete = btc.Transaction.fromPSBT(working.toPSBT(0))
    incomplete.signIdx(priv, 0)

    expect(() => mergeWalletSignedInputs(working, incomplete.toPSBT(0), [0, 1])).toThrow(
      'wallet did not sign input 1',
    )
    expect(working.getInput(0).partialSig).toBeUndefined()
  })

  it('rejects new signatures on an unrequested input', () => {
    const priv = sha256(new TextEncoder().encode('saffron-fixture-indexed-fee-wallet'))
    const payment = btc.p2wpkh(pubECDSA(priv))
    const working = new btc.Transaction()
    for (const [index, txidByte] of ['55', '44'].entries()) {
      working.addInput({
        txid: txidByte.repeat(32),
        index,
        witnessUtxo: { script: payment.script, amount: 25_000n },
      })
    }
    working.addOutputAddress(payment.address ?? '', 49_000n)

    const overreaching = btc.Transaction.fromPSBT(working.toPSBT(0))
    overreaching.signIdx(priv, 0)
    overreaching.signIdx(priv, 1)

    expect(() => mergeWalletSignedInputs(working, overreaching.toPSBT(0), [0])).toThrow(
      'wallet modified unrequested input 1',
    )
  })

  it('allows a wallet response to omit signatures added locally after its request snapshot', () => {
    const feePriv = sha256(new TextEncoder().encode('saffron-fixture-request-fee-wallet'))
    const vaultPriv = sha256(new TextEncoder().encode('saffron-fixture-request-vault-key'))
    const feePayment = btc.p2wpkh(pubECDSA(feePriv))
    const vaultPayment = btc.p2wpkh(pubECDSA(vaultPriv))
    const working = new btc.Transaction()
    working.addInput({
      txid: '54'.repeat(32),
      index: 0,
      witnessUtxo: { script: feePayment.script, amount: 25_000n },
    })
    working.addInput({
      txid: '43'.repeat(32),
      index: 1,
      witnessUtxo: { script: vaultPayment.script, amount: 25_000n },
    })
    working.addOutputAddress(feePayment.address ?? '', 49_000n)

    const requestSnapshot = working.toPSBT(0)
    working.signIdx(vaultPriv, 1)
    const walletResponse = btc.Transaction.fromPSBT(requestSnapshot)
    walletResponse.signIdx(feePriv, 0)

    expect(mergeWalletSignedInputs(working, walletResponse.toPSBT(0), [0])).toBe(1)
    expect(working.getInput(0).partialSig).toHaveLength(1)
    expect(working.getInput(1).partialSig).toHaveLength(1)
  })

  it('verifies taproot key-path signatures before merging', () => {
    const priv = sha256(new TextEncoder().encode('saffron-fixture-taproot-fee-wallet'))
    const internalKey = schnorr.getPublicKey(priv)
    const payment = btc.p2tr(internalKey)
    const working = new btc.Transaction()
    working.addInput({
      txid: '33'.repeat(32),
      index: 0,
      witnessUtxo: { script: payment.script, amount: 50_000n },
      tapInternalKey: internalKey,
    })
    working.addOutputAddress(payment.address ?? '', 49_500n)

    const walletResponse = btc.Transaction.fromPSBT(working.toPSBT(0))
    walletResponse.signIdx(priv, 0)

    expect(mergeWalletSignedInputs(working, walletResponse.toPSBT(0), [0])).toBe(1)
    expect(working.getInput(0).tapKeySig).toHaveLength(64)
  })

  it('rejects high-S ECDSA signatures from a fee wallet', () => {
    const priv = sha256(new TextEncoder().encode('saffron-fixture-high-s-fee-wallet'))
    const pubkey = pubECDSA(priv)
    const payment = btc.p2wpkh(pubkey)
    const working = new btc.Transaction()
    working.addInput({
      txid: '22'.repeat(32),
      index: 0,
      witnessUtxo: { script: payment.script, amount: 50_000n },
    })
    working.addOutputAddress(payment.address ?? '', 49_500n)

    const signed = btc.Transaction.fromPSBT(working.toPSBT(0))
    signed.signIdx(priv, 0)
    const lowSignature = signed.getInput(0).partialSig?.[0]?.[1]
    if (!lowSignature) throw new Error('missing fixture signature')
    const parsed = secp256k1.Signature.fromBytes(lowSignature.subarray(0, -1), 'der')
    const highSignature = new secp256k1.Signature(
      parsed.r,
      secp256k1.Point.Fn.ORDER - parsed.s,
    ).toBytes('der')

    const malicious = btc.Transaction.fromPSBT(working.toPSBT(0))
    malicious.updateInput(
      0,
      { partialSig: [[pubkey, Uint8Array.from([...highSignature, 0x01])]] },
      true,
    )

    expect(() => mergeWalletSignedInputs(working, malicious.toPSBT(0), [0])).toThrow(
      'invalid signature',
    )
  })
})
