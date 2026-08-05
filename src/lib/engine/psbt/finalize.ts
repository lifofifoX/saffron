import { base64 } from '@scure/base'
import { bytesToHex } from '@noble/hashes/utils.js'
import * as btc from '@scure/btc-signer'

import type { WalletAddresses } from '$lib/engine/types'

import { classifyInputs } from './classify'
import { LIBERAL_PSBT_OPTIONS } from './parse'
import { quorumStatus } from './signatures'

export type FinalizedArtifacts = {
  finalPsbtBase64: string
  rawTxHex: string
  txid: string
  vsize: number
  feeSats: number
}

export function finalizeIfReady(
  transaction: btc.Transaction,
  addresses: WalletAddresses,
): FinalizedArtifacts | null {
  const inputs = classifyInputs(transaction, addresses)
  if (inputs.length === 0) return null
  if (!inputs.some((input) => input.class.kind === 'ours')) return null

  const quorum = quorumStatus(transaction, addresses)
  if (!quorum.met) return null

  // Non-vault inputs (the fee wallet's) must carry their own signatures;
  // finalize on a clone so a failure leaves the working PSBT untouched.
  // Inputs already carrying final scripts (wallet-signed fee inputs) are kept
  // as they are, since finalizeIdx rejects inputs without partial signatures.
  const clone = btc.Transaction.fromPSBT(transaction.toPSBT(0), LIBERAL_PSBT_OPTIONS)
  try {
    for (let inputIndex = 0; inputIndex < clone.inputsLength; inputIndex += 1) {
      const input = clone.getInput(inputIndex)
      if (input.finalScriptWitness?.length || input.finalScriptSig?.length) continue
      clone.finalizeIdx(inputIndex)
    }
  } catch {
    return null
  }

  const rawTx = clone.extract()

  return {
    finalPsbtBase64: base64.encode(clone.toPSBT(0)),
    rawTxHex: bytesToHex(rawTx),
    txid: clone.id,
    vsize: clone.vsize,
    feeSats: Number(clone.fee),
  }
}
