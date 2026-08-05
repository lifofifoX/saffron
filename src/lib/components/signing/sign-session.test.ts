import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { base64 } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { pubECDSA } from '@scure/btc-signer/utils.js'
import { describe, expect, it } from 'vitest'

import { deriveWalletAddresses } from '$lib/engine/derivation/braid'
import type { PsbtAnalysis } from '$lib/engine/psbt/analyze'
import { classifyInputs, classifyOutputs } from '$lib/engine/psbt/classify'
import { parsePsbt } from '$lib/engine/psbt/parse'
import {
  FIXTURE_KEY_ORIGIN_PATH,
  fixtureCosigners,
  fixtureWalletConfig,
} from '$lib/engine/testing/fixtures'
import { buildFundingTx } from '$lib/engine/testing/funding'
import { planSimpleTransfer } from '$lib/engine/transfer/simple'
import { simpleTransferToPsbt } from '$lib/engine/transfer/simple-to-psbt'

import { SignSession } from './sign-session.svelte'

describe('SignSession', () => {
  it('does not allow signing an analysis with a danger warning', () => {
    const config = fixtureWalletConfig(2, 3)
    const addresses = deriveWalletAddresses(config)
    const session = new SignSession(config, addresses)
    const transaction = new btc.Transaction()
    transaction.addInput({ txid: '11'.repeat(32), index: 0 })
    transaction.addOutput({
      script: hexToBytes(addresses.inscriptions.scriptPubkeyHex),
      amount: 1_000n,
    })

    const analysis: PsbtAnalysis = {
      inputs: [],
      outputs: [],
      feeSats: 0,
      feeRateSatVb: null,
      trezorEligible: true,
      inscriptionFindings: [],
      warnings: [{ severity: 'danger', message: 'Unsafe transaction' }],
    }

    session.workingTransaction = transaction
    session.analysis = analysis

    expect(session.canSignWith(session.rows[0]!)).toEqual({
      allowed: false,
      reason: 'Transaction has a danger warning',
    })
  })

  it('does not ask the connected fee wallet to sign an analysis with a danger warning', async () => {
    const config = fixtureWalletConfig(2, 3)
    const addresses = deriveWalletAddresses(config)
    const session = new SignSession(config, addresses)
    const transaction = new btc.Transaction()
    transaction.addInput({ txid: '11'.repeat(32), index: 0 })
    transaction.addOutput({
      script: hexToBytes(addresses.inscriptions.scriptPubkeyHex),
      amount: 1_000n,
    })

    session.workingTransaction = transaction
    session.analysis = {
      inputs: [],
      outputs: [],
      feeSats: 0,
      feeRateSatVb: null,
      trezorEligible: true,
      inscriptionFindings: [],
      warnings: [{ severity: 'danger', message: 'Unsafe transaction' }],
    }
    session.attachFeeWallet(
      {
        provider: 'unisat',
        kind: 'p2wpkh',
        address: 'not-used',
        publicKeyHex: 'not-used',
      },
      [0],
    )

    await session.signWithConnectedWallet()

    expect(session.feeWalletStep?.status).toBe('error')
    expect(session.feeWalletStep?.error).toBe('Transaction has a danger warning')
  })

  describe('importSignedPsbt', () => {
    function buildSessionWithWorkingPsbt(vaultInputCount = 1) {
      const config = fixtureWalletConfig(2, 3)
      const pastedIndex = 1
      const pasted = config.extendedPublicKeys[pastedIndex]
      if (!pasted) throw new Error('missing fixture cosigner')
      pasted.method = 'text'

      const cosigners = fixtureCosigners(3)
      const addresses = deriveWalletAddresses(config)

      const walletPrivateKey = sha256(new TextEncoder().encode('saffron-fixture-fee-wallet'))
      const walletPayment = btc.p2wpkh(pubECDSA(walletPrivateKey))
      const walletScriptHex = bytesToHex(walletPayment.script)

      const vaultOutputs = Array.from({ length: vaultInputCount }, (_, index) => ({
        valueSats: 9_999 + index,
        scriptHex: addresses.inscriptions.scriptPubkeyHex,
      }))
      const vaultFunding = buildFundingTx(vaultOutputs)
      const walletFunding = buildFundingTx([{ valueSats: 30_000, scriptHex: walletScriptHex }])

      const plan = planSimpleTransfer({
        items: vaultOutputs.map((output, index) => ({
          outpoint: { txid: vaultFunding.txid, vout: index },
          valueSats: output.valueSats,
          inscriptionIds: [`insc-${index}`],
          recipientScriptHex: bytesToHex(
            btc.OutScript.encode({
              type: 'wpkh',
              hash: new Uint8Array(20).fill(9 + index),
            }),
          ),
        })),
        quorum: config.quorum,
        inscriptionsScriptHex: addresses.inscriptions.scriptPubkeyHex,
        feeWallet: {
          kind: 'p2wpkh',
          cardinalUtxos: [{ outpoint: { txid: walletFunding.txid, vout: 0 }, valueSats: 30_000 }],
          changeScriptHex: walletScriptHex,
        },
        feeRateSatVb: 5,
      })

      const { psbtBase64 } = simpleTransferToPsbt(plan, {
        addresses,
        feeWallet: {
          kind: 'p2wpkh',
          address: walletPayment.address ?? '',
          publicKeyHex: bytesToHex(pubECDSA(walletPrivateKey)),
        },
        prevTxHexByTxid: { [vaultFunding.txid]: vaultFunding.hex },
      })

      const session = new SignSession(config, addresses)
      const parsed = parsePsbt(psbtBase64)
      session.workingTransaction = parsed.transaction
      session.workingBase64 = psbtBase64
      session.analysis = {
        inputs: classifyInputs(parsed.transaction, addresses),
        outputs: classifyOutputs(parsed.transaction, addresses),
        feeSats: plan.feeSats,
        feeRateSatVb: plan.feeRateSatVb,
        trezorEligible: false,
        inscriptionFindings: [],
        warnings: [],
      } satisfies PsbtAnalysis

      return { session, psbtBase64, cosigners, pastedIndex }
    }

    function signElsewhere(
      psbtBase64: string,
      cosigner: ReturnType<typeof fixtureCosigners>[0],
      inputIndexes = [0],
    ) {
      const external = parsePsbt(psbtBase64).transaction
      const child = cosigner.master.derive(`${FIXTURE_KEY_ORIGIN_PATH}/0/0`)
      if (!child.privateKey) throw new Error('missing key')
      for (const inputIndex of inputIndexes) external.signIdx(child.privateKey, inputIndex)
      return base64.encode(external.toPSBT(0))
    }

    it('verifies and merges signatures from an externally signed PSBT', () => {
      const { session, psbtBase64, cosigners, pastedIndex } = buildSessionWithWorkingPsbt()
      const cosigner = cosigners[pastedIndex]
      if (!cosigner) throw new Error('missing cosigner')

      const added = session.importSignedPsbt(signElsewhere(psbtBase64, cosigner))

      expect(added).toBe(1)
      expect(session.rows[pastedIndex]?.status).toBe('signed')
      expect(session.rows[0]?.status).toBe('pending')

      expect(() => session.importSignedPsbt(signElsewhere(psbtBase64, cosigner))).toThrow(
        'No new signatures',
      )
    })

    it('rejects a signed PSBT for a different transaction', () => {
      const { session, cosigners } = buildSessionWithWorkingPsbt()
      const cosigner = cosigners[1]
      if (!cosigner) throw new Error('missing cosigner')

      const other = buildSessionWithWorkingPsbt()
      const foreign = parsePsbt(other.psbtBase64).transaction
      foreign.updateOutput(0, { amount: 9_998n }, true)
      const child = cosigner.master.derive(`${FIXTURE_KEY_ORIGIN_PATH}/0/0`)
      if (!child.privateKey) throw new Error('missing key')
      const foreignBase64 = base64.encode(foreign.toPSBT(0))

      expect(() => session.importSignedPsbt(foreignBase64)).toThrow(
        'That PSBT is for a different transaction.',
      )
    })

    it('does not mark a cosigner signed until every vault input is covered', () => {
      const { session, psbtBase64, cosigners, pastedIndex } = buildSessionWithWorkingPsbt(2)
      const cosigner = cosigners[pastedIndex]
      if (!cosigner) throw new Error('missing cosigner')

      expect(session.importSignedPsbt(signElsewhere(psbtBase64, cosigner, [0]))).toBe(1)
      expect(session.rows[pastedIndex]?.status).toBe('pending')
      expect(session.rows[pastedIndex]?.addedSignatures).toBe(1)

      expect(session.importSignedPsbt(signElsewhere(psbtBase64, cosigner, [1]))).toBe(1)
      expect(session.rows[pastedIndex]?.status).toBe('signed')
      expect(session.rows[pastedIndex]?.addedSignatures).toBe(2)
    })
  })
})
