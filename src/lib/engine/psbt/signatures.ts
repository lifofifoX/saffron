import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hash160 } from '@scure/btc-signer/utils.js'
import * as btc from '@scure/btc-signer'

import type { MultisigAddressInfo, WalletAddresses } from '$lib/engine/types'

import { bip143SighashAll } from './bip143'
import { classifyInputs } from './classify'
import { parsePsbt } from './parse'

export type CollectedSignature = {
  inputIndex: number
  pubkeyHex: string
  signatureHex: string
}

export type QuorumStatus = {
  perInput: { inputIndex: number; have: number; need: number }[]
  met: boolean
}

function infoForBranch(branch: 0 | 1, addresses: WalletAddresses): MultisigAddressInfo {
  return branch === 0 ? addresses.inscriptions : addresses.payments
}

export function collectSignatures(transaction: btc.Transaction): CollectedSignature[] {
  const signatures: CollectedSignature[] = []

  for (let inputIndex = 0; inputIndex < transaction.inputsLength; inputIndex += 1) {
    const input = transaction.getInput(inputIndex)
    for (const [pubkey, signature] of input.partialSig ?? []) {
      signatures.push({
        inputIndex,
        pubkeyHex: bytesToHex(pubkey),
        signatureHex: bytesToHex(signature),
      })
    }
  }

  return signatures
}

// Cryptographically verify a device-produced signature against the PSBT before
// merging it — a silently-wrong signature must never look like progress.
// Returns the witness-script pubkey the signature verifies against, or null.
export function verifySignatureForInput(p: {
  psbtBase64: string
  inputIndex: number
  signatureHex: string
  inputValueSats: number
}): string | null {
  const { transaction } = parsePsbt(p.psbtBase64)
  return verifySignatureForTransactionInput({
    transaction,
    inputIndex: p.inputIndex,
    signatureHex: p.signatureHex,
    inputValueSats: p.inputValueSats,
  })
}

function verifySignatureForTransactionInput(p: {
  transaction: btc.Transaction
  inputIndex: number
  signatureHex: string
  inputValueSats: number
}): string | null {
  const { transaction } = p
  const input = transaction.getInput(p.inputIndex)

  let scriptCode: Uint8Array
  let candidatePubkeys: Uint8Array[]

  if (input.witnessScript) {
    const decoded = btc.OutScript.decode(input.witnessScript)
    if (decoded.type !== 'ms') return null

    scriptCode = input.witnessScript
    candidatePubkeys = [...decoded.pubkeys]
  } else {
    const spentScript = input.witnessUtxo?.script
    if (!spentScript) return null

    const decoded = btc.OutScript.decode(spentScript)
    if (decoded.type !== 'wpkh') return null

    candidatePubkeys = (input.bip32Derivation ?? [])
      .map(([pubkey]) => pubkey)
      .filter((pubkey) => bytesToHex(hash160(pubkey)) === bytesToHex(decoded.hash))
    if (candidatePubkeys.length === 0) return null

    scriptCode = Uint8Array.from(
      Buffer.concat([
        Buffer.from([0x76, 0xa9, 0x14]),
        Buffer.from(decoded.hash),
        Buffer.from([0x88, 0xac]),
      ]),
    )
  }

  const signatureBytes = hexToBytes(p.signatureHex)
  if (signatureBytes.length < 9) return null

  const sighashByte = signatureBytes[signatureBytes.length - 1]
  if (sighashByte !== 0x01) return null

  let compactSignature: Uint8Array
  try {
    compactSignature = secp256k1.Signature.fromBytes(signatureBytes.subarray(0, -1), 'der').toBytes(
      'compact',
    )
  } catch {
    return null
  }

  const amountSats = input.witnessUtxo?.amount ?? BigInt(p.inputValueSats)
  const digest = bip143SighashAll({
    transaction,
    inputIndex: p.inputIndex,
    scriptCode,
    amountSats,
  })

  for (const pubkey of candidatePubkeys) {
    try {
      if (secp256k1.verify(compactSignature, digest, pubkey, { lowS: true, prehash: false })) {
        return bytesToHex(pubkey).toLowerCase()
      }
    } catch {
      continue
    }
  }

  return null
}

function equalBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (!left || !right) return left === right
  return bytesToHex(left) === bytesToHex(right)
}

function walletAddedUnrequestedSignature(
  source: ReturnType<btc.Transaction['getInput']>,
  working: ReturnType<btc.Transaction['getInput']>,
): boolean {
  const workingPartials = new Set(
    (working.partialSig ?? []).map(
      ([pubkey, signature]) => `${bytesToHex(pubkey)}:${bytesToHex(signature)}`,
    ),
  )
  if (
    (source.partialSig ?? []).some(
      ([pubkey, signature]) =>
        !workingPartials.has(`${bytesToHex(pubkey)}:${bytesToHex(signature)}`),
    )
  ) {
    return true
  }

  const workingTapScripts = new Set(
    (working.tapScriptSig ?? []).map(
      ([key, signature]) =>
        `${bytesToHex(key.pubKey)}:${bytesToHex(key.leafHash)}:${bytesToHex(signature)}`,
    ),
  )
  if (
    (source.tapScriptSig ?? []).some(
      ([key, signature]) =>
        !workingTapScripts.has(
          `${bytesToHex(key.pubKey)}:${bytesToHex(key.leafHash)}:${bytesToHex(signature)}`,
        ),
    )
  ) {
    return true
  }

  if (source.tapKeySig?.length && !equalBytes(source.tapKeySig, working.tapKeySig)) return true
  if (source.finalScriptSig?.length && !equalBytes(source.finalScriptSig, working.finalScriptSig)) {
    return true
  }
  if (source.finalScriptWitness?.length) {
    const expected = working.finalScriptWitness
    if (
      !expected ||
      source.finalScriptWitness.length !== expected.length ||
      source.finalScriptWitness.some((item, index) => !equalBytes(item, expected[index]))
    ) {
      return true
    }
  }

  return false
}

function p2wpkhScriptCode(pubkeyHash: Uint8Array): Uint8Array {
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      Buffer.from(pubkeyHash),
      Buffer.from([0x88, 0xac]),
    ]),
  )
}

function parseLowSEcdsaSignature(signature: Uint8Array): Uint8Array | null {
  if (signature.length < 9 || signature.at(-1) !== 0x01) return null

  try {
    const parsed = secp256k1.Signature.fromBytes(signature.subarray(0, -1), 'der')
    if (parsed.hasHighS()) return null
    return parsed.toBytes('compact')
  } catch {
    return null
  }
}

function validateEcdsaWalletSignature(p: {
  transaction: btc.Transaction
  inputIndex: number
  source: ReturnType<btc.Transaction['getInput']>
  pubkeyHash: Uint8Array
  redeemScript?: Uint8Array
}): Parameters<btc.Transaction['updateInput']>[1] {
  const { transaction, inputIndex, source, pubkeyHash, redeemScript } = p
  const workingInput = transaction.getInput(inputIndex)
  const candidates: { pubkey: Uint8Array; signature: Uint8Array }[] = []

  if (source.partialSig?.length) {
    if (source.partialSig.length !== 1) {
      throw new Error(`wallet input ${inputIndex} returned multiple signatures`)
    }
    const [candidate] = source.partialSig
    if (candidate) candidates.push({ pubkey: candidate[0], signature: candidate[1] })
  }

  if (source.finalScriptWitness?.length) {
    if (source.finalScriptWitness.length !== 2) {
      throw new Error(`wallet input ${inputIndex} returned an invalid witness`)
    }
    const [signature, pubkey] = source.finalScriptWitness
    if (!signature || !pubkey)
      throw new Error(`wallet input ${inputIndex} returned an invalid witness`)
    candidates.push({ pubkey, signature })
  }

  if (candidates.length === 0) throw new Error(`wallet did not sign input ${inputIndex}`)

  const first = candidates[0]
  if (!first) throw new Error(`wallet did not sign input ${inputIndex}`)
  if (
    candidates.some(
      (candidate) =>
        !equalBytes(candidate.pubkey, first.pubkey) ||
        !equalBytes(candidate.signature, first.signature),
    )
  ) {
    throw new Error(`wallet input ${inputIndex} returned conflicting signatures`)
  }

  if (!equalBytes(hash160(first.pubkey), pubkeyHash)) {
    throw new Error(`wallet input ${inputIndex} signature key does not match its spent output`)
  }

  const compactSignature = parseLowSEcdsaSignature(first.signature)
  if (!compactSignature) throw new Error(`wallet input ${inputIndex} returned an invalid signature`)

  const amount = workingInput.witnessUtxo?.amount
  if (amount === undefined) throw new Error(`wallet input ${inputIndex} has no verified amount`)
  const digest = bip143SighashAll({
    transaction,
    inputIndex,
    scriptCode: p2wpkhScriptCode(pubkeyHash),
    amountSats: amount,
  })
  if (!secp256k1.verify(compactSignature, digest, first.pubkey, { lowS: true, prehash: false })) {
    throw new Error(`wallet input ${inputIndex} signature failed verification`)
  }

  if (redeemScript) {
    if (source.finalScriptWitness?.length) {
      if (!source.finalScriptSig?.length) {
        throw new Error(`wallet input ${inputIndex} is missing its redeem script`)
      }
      const pushes = btc.Script.decode(source.finalScriptSig)
      if (
        pushes.length !== 1 ||
        !(pushes[0] instanceof Uint8Array) ||
        !equalBytes(pushes[0], redeemScript)
      ) {
        throw new Error(`wallet input ${inputIndex} returned the wrong redeem script`)
      }
    } else if (source.finalScriptSig?.length) {
      throw new Error(`wallet input ${inputIndex} returned an unexpected final script`)
    }
  } else if (source.finalScriptSig?.length) {
    throw new Error(`wallet input ${inputIndex} returned an unexpected final script`)
  }

  const update: Parameters<btc.Transaction['updateInput']>[1] = {}
  if (source.partialSig?.length) update.partialSig = source.partialSig
  if (source.finalScriptWitness?.length) update.finalScriptWitness = source.finalScriptWitness
  if (source.finalScriptSig?.length) update.finalScriptSig = source.finalScriptSig
  return update
}

function validateTaprootWalletSignature(p: {
  transaction: btc.Transaction
  inputIndex: number
  source: ReturnType<btc.Transaction['getInput']>
  outputPubkey: Uint8Array
}): Parameters<btc.Transaction['updateInput']>[1] {
  const { transaction, inputIndex, source, outputPubkey } = p
  const candidates: Uint8Array[] = []
  if (source.tapKeySig?.length) candidates.push(source.tapKeySig)
  if (source.finalScriptWitness?.length) {
    if (source.finalScriptWitness.length !== 1 || !source.finalScriptWitness[0]) {
      throw new Error(`wallet input ${inputIndex} returned an unsupported taproot witness`)
    }
    candidates.push(source.finalScriptWitness[0])
  }
  if (source.partialSig?.length || source.tapScriptSig?.length || source.finalScriptSig?.length) {
    throw new Error(`wallet input ${inputIndex} returned unsupported signing data`)
  }
  if (candidates.length === 0) throw new Error(`wallet did not sign input ${inputIndex}`)

  const first = candidates[0]
  if (!first || candidates.some((candidate) => !equalBytes(candidate, first))) {
    throw new Error(`wallet input ${inputIndex} returned conflicting signatures`)
  }
  if (first.length !== 64 && first.length !== 65) {
    throw new Error(`wallet input ${inputIndex} returned an invalid taproot signature`)
  }

  const sighash = first.length === 65 ? first[64] : 0x00
  if (sighash === undefined || (sighash !== 0x00 && sighash !== 0x01)) {
    throw new Error(`wallet input ${inputIndex} used an unsupported sighash`)
  }
  // BIP341 forbids explicitly appending SIGHASH_DEFAULT.
  if (first.length === 65 && sighash === 0x00) {
    throw new Error(`wallet input ${inputIndex} returned a non-canonical taproot signature`)
  }

  const prevouts = Array.from({ length: transaction.inputsLength }, (_, index) => {
    const prevout = transaction.getInput(index).witnessUtxo
    if (!prevout) throw new Error(`input ${index} has no verified witness UTXO`)
    return prevout
  })
  const digest = transaction.preimageWitnessV1(
    inputIndex,
    prevouts.map((prevout) => prevout.script),
    sighash,
    prevouts.map((prevout) => prevout.amount),
  )
  if (!schnorr.verify(first.subarray(0, 64), digest, outputPubkey)) {
    throw new Error(`wallet input ${inputIndex} signature failed verification`)
  }

  const update: Parameters<btc.Transaction['updateInput']>[1] = {}
  if (source.tapKeySig?.length) update.tapKeySig = source.tapKeySig
  if (source.finalScriptWitness?.length) update.finalScriptWitness = source.finalScriptWitness
  return update
}

function validatedWalletInputUpdate(
  transaction: btc.Transaction,
  source: ReturnType<btc.Transaction['getInput']>,
  inputIndex: number,
): Parameters<btc.Transaction['updateInput']>[1] {
  const workingInput = transaction.getInput(inputIndex)
  const spentScript = workingInput.witnessUtxo?.script
  if (!spentScript) throw new Error(`wallet input ${inputIndex} has no verified spent output`)

  const decoded = btc.OutScript.decode(spentScript)
  if (decoded.type === 'wpkh') {
    return validateEcdsaWalletSignature({
      transaction,
      inputIndex,
      source,
      pubkeyHash: decoded.hash,
    })
  }

  if (decoded.type === 'sh') {
    const redeemScript = workingInput.redeemScript
    if (!redeemScript || !equalBytes(hash160(redeemScript), decoded.hash)) {
      throw new Error(`wallet input ${inputIndex} has an invalid redeem script`)
    }
    const inner = btc.OutScript.decode(redeemScript)
    if (inner.type !== 'wpkh') {
      throw new Error(`wallet input ${inputIndex} is not a supported nested SegWit input`)
    }
    return validateEcdsaWalletSignature({
      transaction,
      inputIndex,
      source,
      pubkeyHash: inner.hash,
      redeemScript,
    })
  }

  if (decoded.type === 'tr') {
    return validateTaprootWalletSignature({
      transaction,
      inputIndex,
      source,
      outputPubkey: decoded.pubkey,
    })
  }

  throw new Error(`wallet input ${inputIndex} uses an unsupported script type`)
}

export function mergeSignature(
  transaction: btc.Transaction,
  signature: CollectedSignature,
): boolean {
  const input = transaction.getInput(signature.inputIndex)
  const existing = input.partialSig ?? []

  const alreadyPresent = existing.some(([pubkey]) => bytesToHex(pubkey) === signature.pubkeyHex)
  if (alreadyPresent) return false

  transaction.updateInput(
    signature.inputIndex,
    {
      partialSig: [[hexToBytes(signature.pubkeyHex), hexToBytes(signature.signatureHex)]],
    },
    true,
  )

  return true
}

// Copies the fee wallet's signature data for its own inputs out of the PSBT
// it returned, after checking it is the same transaction.
export function mergeWalletSignedInputs(
  working: btc.Transaction,
  signedRaw: string | Uint8Array,
  inputIndexes: number[],
): number {
  const signed = parsePsbt(signedRaw)
  if (bytesToHex(signed.transaction.unsignedTx) !== bytesToHex(working.unsignedTx)) {
    throw new Error('the wallet returned a different transaction')
  }

  const requested = new Set(inputIndexes)
  if (requested.size !== inputIndexes.length || inputIndexes.length === 0) {
    throw new Error('wallet signing input indexes must be unique and non-empty')
  }
  for (const inputIndex of inputIndexes) {
    if (!Number.isSafeInteger(inputIndex) || inputIndex < 0 || inputIndex >= working.inputsLength) {
      throw new Error(`invalid wallet signing input ${inputIndex}`)
    }
  }

  for (let inputIndex = 0; inputIndex < working.inputsLength; inputIndex += 1) {
    if (requested.has(inputIndex)) continue
    if (
      walletAddedUnrequestedSignature(
        signed.transaction.getInput(inputIndex),
        working.getInput(inputIndex),
      )
    ) {
      throw new Error(`the wallet modified unrequested input ${inputIndex}`)
    }
  }

  // Validate every requested input before mutating the working PSBT so a
  // partial or malformed response cannot leave the signing session half-updated.
  const updates = inputIndexes.map((inputIndex) => ({
    inputIndex,
    update: validatedWalletInputUpdate(
      working,
      signed.transaction.getInput(inputIndex),
      inputIndex,
    ),
  }))

  let changed = 0
  for (const { inputIndex, update } of updates) {
    working.updateInput(inputIndex, update, true)
    changed += 1
  }

  return changed
}

// Finalizes single-sig inputs (fee wallet p2wpkh/p2tr) once their signatures
// are merged, producing the final witnesses other signers need to verify them.
export function finalizeInputs(transaction: btc.Transaction, inputIndexes: number[]): void {
  for (const inputIndex of inputIndexes) {
    const input = transaction.getInput(inputIndex)
    if (input.finalScriptWitness?.length || input.finalScriptSig?.length) continue
    transaction.finalizeIdx(inputIndex)

    const finalized = transaction.getInput(inputIndex)
    if (!finalized.finalScriptWitness?.length) {
      throw new Error(`wallet input ${inputIndex} did not finalize`)
    }
  }
}

export function quorumStatus(
  transaction: btc.Transaction,
  addresses: WalletAddresses,
): QuorumStatus {
  const perInput: QuorumStatus['perInput'] = []
  let met = true

  for (const classified of classifyInputs(transaction, addresses)) {
    if (classified.class.kind !== 'ours') continue

    const info = infoForBranch(classified.class.branch, addresses)
    const validPubkeys = new Set(info.sortedPubkeysHex)

    const input = transaction.getInput(classified.inputIndex)
    const verifiedPubkeys = new Set<string>()
    let allSignaturesValid = true

    for (const [pubkey, signature] of input.partialSig ?? []) {
      const declaredPubkey = bytesToHex(pubkey)
      const verifiedPubkey =
        classified.valueSats === null
          ? null
          : verifySignatureForTransactionInput({
              transaction,
              inputIndex: classified.inputIndex,
              signatureHex: bytesToHex(signature),
              inputValueSats: classified.valueSats,
            })

      if (
        !validPubkeys.has(declaredPubkey) ||
        verifiedPubkey === null ||
        verifiedPubkey !== declaredPubkey
      ) {
        allSignaturesValid = false
        continue
      }

      verifiedPubkeys.add(declaredPubkey)
    }

    const have = verifiedPubkeys.size

    perInput.push({ inputIndex: classified.inputIndex, have, need: info.requiredSigners })
    if (!allSignaturesValid || have < info.requiredSigners) met = false
  }

  if (perInput.length === 0) met = false

  return { perInput, met }
}
