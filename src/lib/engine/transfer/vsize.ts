import { scriptOutputVsize } from '$lib/engine/dust'

// Worst-case DER signature incl. sighash byte. Using the ceiling keeps the
// planner and the deduct-fee invariant internally consistent, like ord's
// fixed 64-byte Schnorr assumption.
const SIGNATURE_BYTES = 73
const PUBKEY_BYTES = 33

export const TX_BASE_VBYTES = 10.5
const INPUT_NON_WITNESS_BYTES = 41

export function multisigWitnessScriptBytes(totalSigners: number): number {
  return 3 + (1 + PUBKEY_BYTES) * totalSigners
}

export function multisigWitnessBytes(requiredSigners: number, totalSigners: number): number {
  const witnessScript = multisigWitnessScriptBytes(totalSigners)
  const witnessScriptPushLength = witnessScript < 253 ? 1 : 3

  return 1 + 1 + requiredSigners * (1 + SIGNATURE_BYTES) + witnessScriptPushLength + witnessScript
}

export function multisigInputVbytes(requiredSigners: number, totalSigners: number): number {
  return INPUT_NON_WITNESS_BYTES + multisigWitnessBytes(requiredSigners, totalSigners) / 4
}

export function outputVbytes(script: Uint8Array): number {
  return scriptOutputVsize(script)
}

export function estimateVsize(shape: {
  inputCount: number
  outputScripts: Uint8Array[]
  requiredSigners: number
  totalSigners: number
}): number {
  const inputs = shape.inputCount * multisigInputVbytes(shape.requiredSigners, shape.totalSigners)
  const outputs = shape.outputScripts.reduce((sum, script) => sum + outputVbytes(script), 0)

  return Math.ceil(TX_BASE_VBYTES + inputs + outputs)
}

export function feeForVsize(feeRateSatVb: number, vsize: number): number {
  if (!Number.isFinite(feeRateSatVb) || feeRateSatVb < 0) {
    throw new Error(`invalid fee rate: ${feeRateSatVb}`)
  }

  return Math.round(feeRateSatVb * vsize)
}

export function additionalInputVbytes(requiredSigners: number, totalSigners: number): number {
  return Math.ceil(multisigInputVbytes(requiredSigners, totalSigners))
}
