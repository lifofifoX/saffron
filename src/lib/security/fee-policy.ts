import * as btc from '@scure/btc-signer'

// Shared product limits for every signing path. Rates above this were already
// presented as "unusually high" in the transfer UI; they now fail closed.
export const MAX_FEE_RATE_SAT_VB = 500

// Arbitrary imported PSBTs also fail closed when the fee consumes a material
// portion of their inputs, even if their effective rate cannot be estimated.
export const MAX_IMPORTED_FEE_SHARE = 0.1

const MAX_DER_SIGNATURE_BYTES = 73
const COMPRESSED_PUBKEY_BYTES = 33

function compactSizeLength(value: number): number {
  if (value < 0xfd) return 1
  if (value <= 0xffff) return 3
  if (value <= 0xffffffff) return 5
  return 9
}

function serializedStackBytes(stack: Uint8Array[]): number {
  return (
    compactSizeLength(stack.length) +
    stack.reduce((sum, item) => sum + compactSizeLength(item.length) + item.length, 0)
  )
}

function multisigWitnessBytes(requiredSigners: number, totalSigners: number): number {
  const witnessScriptBytes = 3 + (1 + COMPRESSED_PUBKEY_BYTES) * totalSigners
  const stack = [
    new Uint8Array(0),
    ...Array.from({ length: requiredSigners }, () => new Uint8Array(MAX_DER_SIGNATURE_BYTES)),
    new Uint8Array(witnessScriptBytes),
  ]
  return serializedStackBytes(stack)
}

function prevoutScript(input: ReturnType<btc.Transaction['getInput']>): Uint8Array | undefined {
  if (input.witnessUtxo) return input.witnessUtxo.script
  if (!input.nonWitnessUtxo || input.index === undefined) return undefined

  try {
    return input.nonWitnessUtxo.outputs[input.index]?.script
  } catch {
    return undefined
  }
}

type EstimatedInput = {
  baseScriptSigBytes: number
  witnessBytes: number | null
  usesWitness: boolean
}

function estimateInput(input: ReturnType<btc.Transaction['getInput']>): EstimatedInput | null {
  const finalScriptSigBytes = input.finalScriptSig?.length ?? 0
  if (input.finalScriptWitness?.length) {
    return {
      baseScriptSigBytes: finalScriptSigBytes,
      witnessBytes: serializedStackBytes(input.finalScriptWitness),
      usesWitness: true,
    }
  }

  const script = prevoutScript(input)
  if (!script) return null
  const decoded = btc.OutScript.decode(script)

  if (decoded.type === 'wpkh') {
    return {
      baseScriptSigBytes: finalScriptSigBytes,
      witnessBytes: serializedStackBytes([
        new Uint8Array(MAX_DER_SIGNATURE_BYTES),
        new Uint8Array(COMPRESSED_PUBKEY_BYTES),
      ]),
      usesWitness: true,
    }
  }

  if (decoded.type === 'tr' && !input.tapLeafScript?.length) {
    return {
      baseScriptSigBytes: finalScriptSigBytes,
      witnessBytes: serializedStackBytes([new Uint8Array(64)]),
      usesWitness: true,
    }
  }

  if (decoded.type === 'wsh' && input.witnessScript) {
    const witness = btc.OutScript.decode(input.witnessScript)
    if (witness.type !== 'ms') return null
    return {
      baseScriptSigBytes: finalScriptSigBytes,
      witnessBytes: multisigWitnessBytes(witness.m, witness.pubkeys.length),
      usesWitness: true,
    }
  }

  if (decoded.type === 'sh' && input.redeemScript) {
    const redeem = btc.OutScript.decode(input.redeemScript)
    if (redeem.type !== 'wpkh') return null
    // One canonical push of the 22-byte P2WPKH redeem script.
    const scriptSigBytes = 1 + input.redeemScript.length
    return {
      baseScriptSigBytes: finalScriptSigBytes || scriptSigBytes,
      witnessBytes: serializedStackBytes([
        new Uint8Array(MAX_DER_SIGNATURE_BYTES),
        new Uint8Array(COMPRESSED_PUBKEY_BYTES),
      ]),
      usesWitness: true,
    }
  }

  if (decoded.type === 'pkh') {
    // Canonical pushes of a worst-case DER signature and compressed pubkey.
    return {
      baseScriptSigBytes:
        finalScriptSigBytes || 1 + MAX_DER_SIGNATURE_BYTES + 1 + COMPRESSED_PUBKEY_BYTES,
      witnessBytes: null,
      usesWitness: false,
    }
  }

  return null
}

// Estimates final virtual size only for script types Saffron can reason about.
// Unknown scripts return null instead of creating a misleading fee rate.
export function estimateSignedVsize(transaction: btc.Transaction): number | null {
  const inputs = Array.from({ length: transaction.inputsLength }, (_, index) =>
    estimateInput(transaction.getInput(index)),
  )
  if (inputs.some((input) => input === null)) return null

  const knownInputs = inputs.filter((input): input is EstimatedInput => input !== null)
  const baseScriptDelta = knownInputs.reduce(
    (sum, input) =>
      sum +
      input.baseScriptSigBytes +
      compactSizeLength(input.baseScriptSigBytes) -
      compactSizeLength(0),
    0,
  )
  const usesWitness = knownInputs.some((input) => input.usesWitness)
  const witnessWeight = usesWitness
    ? 2 +
      knownInputs.reduce(
        (sum, input) => sum + (input.usesWitness ? (input.witnessBytes ?? 0) : 1),
        0,
      )
    : 0

  const weight = (transaction.unsignedTx.length + baseScriptDelta) * 4 + witnessWeight
  return Math.ceil(weight / 4)
}
