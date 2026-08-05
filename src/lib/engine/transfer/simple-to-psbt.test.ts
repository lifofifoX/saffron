import { sha256 } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { pubECDSA, pubSchnorr } from '@scure/btc-signer/utils.js'
import { describe, expect, it } from 'vitest'

import { deriveWalletAddresses } from '$lib/engine/derivation/braid'
import { finalizeIfReady } from '$lib/engine/psbt/finalize'
import { parsePsbt } from '$lib/engine/psbt/parse'
import { quorumStatus } from '$lib/engine/psbt/signatures'
import {
  FIXTURE_KEY_ORIGIN_PATH,
  fixtureCosigners,
  fixtureWalletConfig,
} from '$lib/engine/testing/fixtures'
import { decodeRawTx } from '$lib/engine/testing/decode'
import { buildFundingTx } from '$lib/engine/testing/funding'

import { planSimpleTransfer } from './simple'
import { feeWalletInputFields, simpleTransferToPsbt } from './simple-to-psbt'

describe('simpleTransferToPsbt', () => {
  const config = fixtureWalletConfig(2, 3)
  const cosigners = fixtureCosigners(3)
  const addresses = deriveWalletAddresses(config)

  // The "fee wallet" is a plain p2wpkh key, standing in for Xverse/Unisat.
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

  it('builds, signs with quorum plus wallet, finalizes, and preserves the mapping', () => {
    const vaultFunding = buildFundingTx([
      { valueSats: 9_999, scriptHex: addresses.inscriptions.scriptPubkeyHex },
    ])
    const walletFunding = buildFundingTx([{ valueSats: 30_000, scriptHex: walletScriptHex }])

    const plan = planSimpleTransfer({
      items: [
        {
          outpoint: { txid: vaultFunding.txid, vout: 0 },
          valueSats: 9_999,
          inscriptionIds: ['insc'],
          recipientScriptHex,
        },
      ],
      quorum: config.quorum,
      inscriptionsScriptHex: addresses.inscriptions.scriptPubkeyHex,
      feeWallet: {
        kind: 'p2wpkh',
        cardinalUtxos: [{ outpoint: { txid: walletFunding.txid, vout: 0 }, valueSats: 30_000 }],
        changeScriptHex: walletScriptHex,
      },
      feeRateSatVb: 7,
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

    expect(feeInputIndexes).toEqual([1])

    const { transaction } = parsePsbt(psbtBase64)

    // Vault quorum signs the vault input only.
    for (const cosigner of cosigners.slice(0, 2)) {
      const child = cosigner.master.derive(`${FIXTURE_KEY_ORIGIN_PATH}/0/0`)
      if (!child.privateKey) throw new Error('missing key')
      transaction.signIdx(child.privateKey, 0)
    }

    expect(quorumStatus(transaction, addresses).met).toBe(true)
    // Wallet input unsigned: not finalizable yet.
    expect(finalizeIfReady(transaction, addresses)).toBeNull()

    // The "extension" signs its own p2wpkh input.
    transaction.signIdx(walletPrivateKey, 1)

    const artifacts = finalizeIfReady(transaction, addresses)
    expect(artifacts).not.toBeNull()
    if (!artifacts) return

    const parsed = decodeRawTx(artifacts.rawTxHex)

    // Value and index preservation for the vault mapping.
    expect(Number(parsed.outputs[0]?.amount)).toBe(9_999)
    expect(Buffer.from(parsed.outputs[0]?.script ?? []).toString('hex')).toBe(recipientScriptHex)

    // Wallet change is last and the fee is exactly the plan's.
    expect(Buffer.from(parsed.outputs.at(-1)?.script ?? []).toString('hex')).toBe(walletScriptHex)
    expect(artifacts.feeSats).toBe(plan.feeSats)

    // Vault input carries the multisig witness, wallet input a singlesig one.
    expect(parsed.inputs[0]?.finalScriptWitness).toHaveLength(4)
    expect(parsed.inputs[1]?.finalScriptWitness).toHaveLength(2)
  })

  it('supports taproot fee wallets with tapInternalKey', () => {
    const taprootPrivateKey = sha256(new TextEncoder().encode('saffron-fixture-taproot-wallet'))
    const taprootPublicKey = pubSchnorr(taprootPrivateKey)
    const taprootPayment = btc.p2tr(taprootPublicKey)
    const taprootScriptHex = Buffer.from(taprootPayment.script).toString('hex')

    const vaultFunding = buildFundingTx([
      { valueSats: 546, scriptHex: addresses.inscriptions.scriptPubkeyHex },
    ])
    const walletFunding = buildFundingTx([{ valueSats: 25_000, scriptHex: taprootScriptHex }])

    const plan = planSimpleTransfer({
      items: [
        {
          outpoint: { txid: vaultFunding.txid, vout: 0 },
          valueSats: 546,
          inscriptionIds: ['insc'],
          recipientScriptHex,
        },
      ],
      quorum: config.quorum,
      inscriptionsScriptHex: addresses.inscriptions.scriptPubkeyHex,
      feeWallet: {
        kind: 'p2tr',
        cardinalUtxos: [{ outpoint: { txid: walletFunding.txid, vout: 0 }, valueSats: 25_000 }],
        changeScriptHex: taprootScriptHex,
      },
      feeRateSatVb: 4,
    })

    const { psbtBase64 } = simpleTransferToPsbt(plan, {
      addresses,
      feeWallet: {
        kind: 'p2tr',
        address: taprootPayment.address ?? '',
        publicKeyHex: Buffer.from(taprootPublicKey).toString('hex'),
      },
      prevTxHexByTxid: { [vaultFunding.txid]: vaultFunding.hex },
    })

    const { transaction } = parsePsbt(psbtBase64)

    for (const cosigner of cosigners.slice(0, 2)) {
      const child = cosigner.master.derive(`${FIXTURE_KEY_ORIGIN_PATH}/0/0`)
      if (!child.privateKey) throw new Error('missing key')
      transaction.signIdx(child.privateKey, 0)
    }
    transaction.signIdx(taprootPrivateKey, 1)

    const artifacts = finalizeIfReady(transaction, addresses)
    expect(artifacts).not.toBeNull()
    if (!artifacts) return

    const parsed = decodeRawTx(artifacts.rawTxHex)
    expect(parsed.inputs[1]?.finalScriptWitness).toHaveLength(1)
    expect(parsed.inputs[1]?.finalScriptWitness?.[0]?.length).toBeGreaterThanOrEqual(64)
  })

  it('rejects a fee wallet address that does not match its public key', () => {
    const otherPrivateKey = sha256(new TextEncoder().encode('saffron-fixture-other-fee-wallet'))
    const otherPayment = btc.p2wpkh(pubECDSA(otherPrivateKey))

    expect(() =>
      feeWalletInputFields({
        kind: 'p2wpkh',
        address: otherPayment.address ?? '',
        publicKeyHex: Buffer.from(walletPublicKey).toString('hex'),
      }),
    ).toThrow('fee wallet address does not match its public key')
  })
})
