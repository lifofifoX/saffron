import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as btc from '@scure/btc-signer'

import { multisigInputFields } from '$lib/engine/psbt/input-fields'
import { txidOfRawTx } from '$lib/engine/txid'
import type { MultisigAddressInfo, WalletAddresses } from '$lib/engine/types'

import { branchForScriptHex, classifyInputs } from './classify'

function infoForBranch(branch: 0 | 1, addresses: WalletAddresses): MultisigAddressInfo {
  return branch === 0 ? addresses.inscriptions : addresses.payments
}

export type EnrichmentReport = {
  enrichedInputIndexes: number[]
  trezorEligible: boolean
}

type VerifiedPrevout = {
  prevTxBytes: Uint8Array
  amount: bigint
}

type CanonicalVaultFields = ReturnType<typeof multisigInputFields>

function assertCanonicalVaultMetadata(
  inputIndex: number,
  input: ReturnType<btc.Transaction['getInput']>,
  canonical: CanonicalVaultFields,
): void {
  if (
    input.witnessScript &&
    (!canonical.witnessScript ||
      bytesToHex(input.witnessScript) !== bytesToHex(canonical.witnessScript))
  ) {
    throw new Error(`input ${inputIndex} witnessScript does not match the vault`)
  }

  const canonicalDerivations = new Map(
    canonical.bip32Derivation.map(([pubkey, derivation]) => [bytesToHex(pubkey), derivation]),
  )

  for (const [pubkey, derivation] of input.bip32Derivation ?? []) {
    const expected = canonicalDerivations.get(bytesToHex(pubkey))
    if (
      !expected ||
      derivation.fingerprint !== expected.fingerprint ||
      derivation.path.length !== expected.path.length ||
      derivation.path.some((value, index) => value !== expected.path[index])
    ) {
      throw new Error(`input ${inputIndex} bip32Derivation does not match the vault`)
    }
  }
}

async function verifyInputPrevouts(
  transaction: btc.Transaction,
  inputs: ReturnType<typeof classifyInputs>,
  deps: { getPrevTxHex: (txid: string) => Promise<string> },
): Promise<Map<number, VerifiedPrevout>> {
  const prevTxByTxid = new Map<string, Promise<Uint8Array>>()
  const verified = new Map<number, VerifiedPrevout>()

  const getVerifiedPrevTx = (txid: string): Promise<Uint8Array> => {
    const existing = prevTxByTxid.get(txid)
    if (existing) return existing

    const pending = deps.getPrevTxHex(txid).then((prevTxHex) => {
      const prevTxBytes = hexToBytes(prevTxHex)
      if (txidOfRawTx(prevTxBytes) !== txid) {
        throw new Error(`previous tx hex does not hash to ${txid}`)
      }
      return prevTxBytes
    })
    prevTxByTxid.set(txid, pending)
    return pending
  }

  for (const classified of inputs) {
    const rawInput = transaction.getInput(classified.inputIndex)
    if (!classified.txid || rawInput.index === undefined) {
      throw new Error(`input ${classified.inputIndex} has no complete outpoint`)
    }

    let prevTxBytes: Uint8Array
    if (rawInput.nonWitnessUtxo) {
      prevTxBytes = btc.RawTx.encode(rawInput.nonWitnessUtxo)
      if (txidOfRawTx(prevTxBytes) !== classified.txid) {
        throw new Error(
          `input ${classified.inputIndex} nonWitnessUtxo does not hash to ${classified.txid}`,
        )
      }
      if (!prevTxByTxid.has(classified.txid)) {
        prevTxByTxid.set(classified.txid, Promise.resolve(prevTxBytes))
      }
    } else {
      prevTxBytes = await getVerifiedPrevTx(classified.txid)
    }

    const prevTx = btc.RawTx.decode(prevTxBytes)
    const prevOutput = prevTx.outputs[rawInput.index]
    if (!prevOutput) {
      throw new Error(
        `input ${classified.inputIndex} references missing output ${classified.txid}:${rawInput.index}`,
      )
    }

    if (
      rawInput.witnessUtxo &&
      (rawInput.witnessUtxo.amount !== prevOutput.amount ||
        bytesToHex(rawInput.witnessUtxo.script) !== bytesToHex(prevOutput.script))
    ) {
      throw new Error(
        `input ${classified.inputIndex} witnessUtxo does not match ${classified.txid}:${rawInput.index}`,
      )
    }

    verified.set(classified.inputIndex, {
      prevTxBytes,
      amount: prevOutput.amount,
    })
  }

  return verified
}

// Fills every field the Trezor translation path hard-requires on OUR inputs:
// nonWitnessUtxo, witnessScript, witnessUtxo, and full-cosigner bip32Derivation.
// Every input's supplied UTXO metadata is first checked against a txid-verified
// previous transaction; external inputs missing all metadata receive that tx.
export async function enrichPsbt(
  transaction: btc.Transaction,
  addresses: WalletAddresses,
  deps: { getPrevTxHex: (txid: string) => Promise<string> },
): Promise<EnrichmentReport> {
  const initialInputs = classifyInputs(transaction, addresses)
  const verifiedPrevouts = await verifyInputPrevouts(transaction, initialInputs, deps)

  // Inputs with no UTXO metadata still need their verified prevout attached so
  // classification, fee accounting, and sat flow use the chain-committed value.
  for (const classified of initialInputs) {
    const rawInput = transaction.getInput(classified.inputIndex)
    if (rawInput.witnessUtxo || rawInput.nonWitnessUtxo) continue

    const verifiedPrevout = verifiedPrevouts.get(classified.inputIndex)
    if (!verifiedPrevout) throw new Error('could not verify the spent output')
    transaction.updateInput(
      classified.inputIndex,
      { nonWitnessUtxo: verifiedPrevout.prevTxBytes },
      true,
    )
  }

  const inputs = classifyInputs(transaction, addresses)
  const enrichedInputIndexes: number[] = []

  for (const classified of inputs) {
    if (classified.class.kind !== 'ours') continue

    const info = infoForBranch(classified.class.branch, addresses)
    const rawInput = transaction.getInput(classified.inputIndex)
    const canonicalFields = multisigInputFields(info)

    try {
      assertCanonicalVaultMetadata(classified.inputIndex, rawInput, canonicalFields)

      const update: Parameters<btc.Transaction['updateInput']>[1] = {
        ...canonicalFields,
      }

      const verifiedPrevout = verifiedPrevouts.get(classified.inputIndex)
      if (!verifiedPrevout) throw new Error('could not verify the spent output')

      if (!rawInput.nonWitnessUtxo) {
        update.nonWitnessUtxo = verifiedPrevout.prevTxBytes
      }

      if (!rawInput.witnessUtxo) {
        update.witnessUtxo = {
          script: hexToBytes(info.scriptPubkeyHex),
          amount: verifiedPrevout.amount,
        }
      }

      transaction.updateInput(classified.inputIndex, update, true)

      enrichedInputIndexes.push(classified.inputIndex)
    } catch (error) {
      throw new Error(`could not safely enrich vault input ${classified.inputIndex}`, {
        cause: error,
      })
    }
  }

  for (let outputIndex = 0; outputIndex < transaction.outputsLength; outputIndex += 1) {
    const output = transaction.getOutput(outputIndex)
    const scriptHex = output.script ? bytesToHex(output.script) : null
    const outputClass = branchForScriptHex(scriptHex, addresses)
    if (outputClass.kind !== 'ours') continue

    const info = infoForBranch(outputClass.branch, addresses)
    try {
      transaction.updateOutput(outputIndex, multisigInputFields(info), true)
    } catch {
      // Output enrichment is best-effort — display niceties only.
    }
  }

  const finalInputs = classifyInputs(transaction, addresses)
  const trezorEligible =
    finalInputs.length > 0 &&
    finalInputs.every(
      (input) =>
        input.class.kind === 'ours' &&
        input.hasWitnessScript &&
        input.hasNonWitnessUtxo &&
        input.hasBip32Derivation,
    )

  return { enrichedInputIndexes, trezorEligible }
}
