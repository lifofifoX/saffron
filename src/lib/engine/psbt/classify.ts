import { bytesToHex } from '@noble/hashes/utils.js'
import type * as btc from '@scure/btc-signer'

import type { Branch, WalletAddresses } from '$lib/engine/types'
import { INSCRIPTIONS_BRANCH, PAYMENTS_BRANCH } from '$lib/engine/types'

export type InputClass = { kind: 'ours'; branch: Branch } | { kind: 'external' }

export type ClassifiedInput = {
  inputIndex: number
  txid: string
  vout: number
  valueSats: number | null
  spentScriptHex: string | null
  class: InputClass
  hasWitnessScript: boolean
  hasNonWitnessUtxo: boolean
  hasBip32Derivation: boolean
  signatureCount: number
}

export type ClassifiedOutput = {
  outputIndex: number
  scriptHex: string | null
  valueSats: number
  class: InputClass
}

type DecodedPrevTx = {
  outputs?: { amount: bigint; script: Uint8Array }[]
}

export function branchForScriptHex(
  scriptHex: string | null,
  addresses: WalletAddresses,
): InputClass {
  if (scriptHex === addresses.inscriptions.scriptPubkeyHex) {
    return { kind: 'ours', branch: INSCRIPTIONS_BRANCH }
  }
  if (scriptHex === addresses.payments.scriptPubkeyHex) {
    return { kind: 'ours', branch: PAYMENTS_BRANCH }
  }

  return { kind: 'external' }
}

export function spentOutputForInput(input: {
  index?: number
  witnessUtxo?: { amount: bigint; script: Uint8Array }
  nonWitnessUtxo?: DecodedPrevTx
}): { scriptHex: string; valueSats: number } | null {
  if (input.witnessUtxo) {
    return {
      scriptHex: bytesToHex(input.witnessUtxo.script),
      valueSats: Number(input.witnessUtxo.amount),
    }
  }

  const prevOutputs = input.nonWitnessUtxo?.outputs
  if (prevOutputs && input.index !== undefined) {
    const prevOutput = prevOutputs[input.index]
    if (prevOutput) {
      return {
        scriptHex: bytesToHex(prevOutput.script),
        valueSats: Number(prevOutput.amount),
      }
    }
  }

  return null
}

export function classifyInputs(
  transaction: btc.Transaction,
  addresses: WalletAddresses,
): ClassifiedInput[] {
  const inputs: ClassifiedInput[] = []

  for (let inputIndex = 0; inputIndex < transaction.inputsLength; inputIndex += 1) {
    const input = transaction.getInput(inputIndex)
    const txid = input.txid ? bytesToHex(input.txid) : ''
    const spent = spentOutputForInput(input)

    inputs.push({
      inputIndex,
      txid,
      vout: input.index ?? 0,
      valueSats: spent?.valueSats ?? null,
      spentScriptHex: spent?.scriptHex ?? null,
      class: branchForScriptHex(spent?.scriptHex ?? null, addresses),
      hasWitnessScript: input.witnessScript !== undefined,
      hasNonWitnessUtxo: input.nonWitnessUtxo !== undefined,
      hasBip32Derivation: (input.bip32Derivation?.length ?? 0) > 0,
      signatureCount: input.partialSig?.length ?? 0,
    })
  }

  return inputs
}

export function classifyOutputs(
  transaction: btc.Transaction,
  addresses: WalletAddresses,
): ClassifiedOutput[] {
  const outputs: ClassifiedOutput[] = []

  for (let outputIndex = 0; outputIndex < transaction.outputsLength; outputIndex += 1) {
    const output = transaction.getOutput(outputIndex)
    const scriptHex = output.script ? bytesToHex(output.script) : null

    outputs.push({
      outputIndex,
      scriptHex,
      valueSats: Number(output.amount ?? 0n),
      class: branchForScriptHex(scriptHex, addresses),
    })
  }

  return outputs
}
