import { hexToBytes } from '@noble/hashes/utils.js'
import type { CosignerConfig, WalletConfig } from '$lib/engine/config/schema'
import { childPubkeyHex } from '$lib/engine/derivation/braid'
import type { Branch } from '$lib/engine/types'

import { translateDeviceError } from './errors'
import type { DeviceKind, DeviceProgress } from './kinds'
import { connectGuidance } from './messages'
import { registeredLedgerPolicyHmac, signPsbtWithLedger } from './ledger-direct'

export type DeviceInputContext = {
  inputIndex: number
  branch: Branch
  valueSats: number
}

export type DeviceSignature = {
  inputIndex: number
  pubkeyHex: string
  signatureHex: string
}

// A hardware signer is expected to sign every vault input with the exact
// child of the selected cosigner. Validate the whole response before the
// caller mutates its working PSBT so a partial or misattributed response is
// all-or-nothing.
export function validateDeviceSignatureSet(p: {
  signatures: DeviceSignature[]
  inputs: DeviceInputContext[]
  cosigner: CosignerConfig
  childIndex: number
  alreadyCoveredInputIndexes?: number[]
}): DeviceSignature[] {
  if (p.inputs.length === 0) throw new Error('the transaction has no vault inputs to sign')

  const expected = new Map<number, string>()
  for (const input of p.inputs) {
    if (expected.has(input.inputIndex)) {
      throw new Error(`vault input ${input.inputIndex} appears more than once`)
    }
    expected.set(
      input.inputIndex,
      childPubkeyHex(p.cosigner.xpub, input.branch, p.childIndex).toLowerCase(),
    )
  }

  const covered = new Set<number>()
  for (const inputIndex of p.alreadyCoveredInputIndexes ?? []) {
    if (!expected.has(inputIndex)) {
      throw new Error(`existing signature coverage includes unexpected input ${inputIndex}`)
    }
    covered.add(inputIndex)
  }

  const returned = new Set<number>()
  for (const signature of p.signatures) {
    const expectedPubkey = expected.get(signature.inputIndex)
    if (!expectedPubkey) {
      throw new Error(
        `the device returned a signature for unexpected input ${signature.inputIndex}`,
      )
    }
    if (returned.has(signature.inputIndex)) {
      throw new Error(
        `the device returned more than one signature for input ${signature.inputIndex}`,
      )
    }
    if (signature.pubkeyHex.toLowerCase() !== expectedPubkey) {
      throw new Error(
        `the device signed input ${signature.inputIndex} with a key other than the selected cosigner`,
      )
    }
    returned.add(signature.inputIndex)
    covered.add(signature.inputIndex)
  }

  const missing = [...expected.keys()].filter((inputIndex) => !covered.has(inputIndex))
  if (missing.length > 0) {
    throw new Error(`the device did not sign every vault input (missing ${missing.join(', ')})`)
  }

  return p.signatures
}

// Bare DER signatures get the SIGHASH_ALL byte appended so they slot into
// PSBT partialSig entries; caravan device paths sometimes strip it.
export function ensureSighashByte(signatureHex: string): string {
  const bytes = hexToBytes(signatureHex)
  if (bytes.length < 8 || bytes[0] !== 0x30) return signatureHex

  const derLength = (bytes[1] ?? 0) + 2
  if (bytes.length === derLength) return `${signatureHex}01`

  return signatureHex
}

function guidanceForSigning(device: DeviceKind, needsPolicyRegistration: boolean): string[] {
  const messages = [...connectGuidance(device)]

  if (device === 'LEDGER' && needsPolicyRegistration) {
    messages.push(
      'First time signing: approve the vault policy on the Ledger, then the transaction.',
    )
  }

  messages.push(
    device === 'LEDGER'
      ? 'Review and approve the transaction on your Ledger.'
      : 'Review and approve the transaction in the Trezor window and on the device.',
  )

  return messages
}

export async function signPsbtWithDevice(p: {
  device: DeviceKind
  cosigner: CosignerConfig
  walletConfig: WalletConfig
  psbtV2Base64: string
  inputs: DeviceInputContext[]
  alreadyCoveredInputIndexes?: number[]
  onProgress?: (progress: DeviceProgress) => void
}): Promise<DeviceSignature[]> {
  const { device, cosigner, walletConfig } = p
  const onProgress = p.onProgress ?? (() => {})

  const policyHmac = registeredLedgerPolicyHmac(walletConfig, cosigner.xfp)

  onProgress({ state: 'connecting', device })

  try {
    if (device !== 'LEDGER') {
      throw new Error('only Ledger signing goes through this path')
    }

    onProgress({
      state: 'awaitingDevice',
      device,
      messages: guidanceForSigning(device, !policyHmac),
    })

    const signatures = await signPsbtWithLedger({
      walletConfig,
      cosigner,
      policyHmac,
      psbtV2Base64: p.psbtV2Base64,
    })

    const normalized = signatures.map((signature) => ({
      ...signature,
      signatureHex: ensureSighashByte(signature.signatureHex),
    }))

    validateDeviceSignatureSet({
      signatures: normalized,
      inputs: p.inputs,
      cosigner,
      childIndex: walletConfig.startingAddressIndex,
      ...(p.alreadyCoveredInputIndexes
        ? { alreadyCoveredInputIndexes: p.alreadyCoveredInputIndexes }
        : {}),
    })

    onProgress({ state: 'done', device })
    return normalized
  } catch (error) {
    const message = translateDeviceError(device, error)
    onProgress({ state: 'error', device, message })
    throw new Error(message, { cause: error })
  }
}
