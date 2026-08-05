import { bytesToHex } from '@noble/hashes/utils.js'
import { RawWitness } from '@scure/btc-signer'
import type { PROTO } from '@trezor/connect-web'

import type { CosignerConfig } from '$lib/engine/config/schema'
import { childPubkeyHex } from '$lib/engine/derivation/braid'
import { bip32PathToSequence, fingerprintNumberToXfp } from '$lib/engine/paths'
import type { MultisigAddressInfo } from '$lib/engine/types'

import { ensureSighashByte } from './sign'
import { translateDeviceError } from './errors'
import type { DeviceProgress } from './kinds'
import { connectGuidance } from './messages'
import { initTrezorConnectAsSaffron } from './trezor-init'

export type TrezorMixedInput =
  | {
      kind: 'vault'
      txid: string
      vout: number
      valueSats: number
      branch: 0 | 1
      sequence: number
      vaultInfo: MultisigAddressInfo
    }
  | {
      kind: 'external'
      txid: string
      vout: number
      valueSats: number
      scriptPubkeyHex: string
      sequence: number
      scriptSigHex?: string
      witnessHex?: string
    }

export type TrezorMixedOutput = {
  address: string
  valueSats: number
}

export type TrezorSignRequest = {
  inputs: PROTO.TxInputType[]
  outputs: PROTO.TxOutputType[]
  version: 1 | 2
  locktime: number
  expectedInputIndexes: number[]
}

// The finalized witness stack exactly as it appears in the transaction.
// Trezor verifies presigned external inputs from this encoding.
export function serializeWitnessStack(items: Uint8Array[]): string {
  return bytesToHex(RawWitness.encode(items))
}

async function assertTrezorCosigner(
  TrezorConnect: (typeof import('@trezor/connect-web'))['default'],
  cosigner: CosignerConfig,
): Promise<void> {
  const accountResult = await TrezorConnect.getPublicKey({
    path: cosigner.bip32Path,
    coin: 'btc',
  })
  if (!accountResult.success) throw new Error(accountResult.payload.error)
  if (accountResult.payload.xpub !== cosigner.xpub) {
    throw new Error(
      `This Trezor derives a different key at ${cosigner.bip32Path} than the selected vault key. Unlock the same passphrase or hidden wallet used during setup and retry.`,
    )
  }

  const purpose = cosigner.bip32Path.split('/')[1]
  if (!purpose) throw new Error(`unsupported Trezor key path: ${cosigner.bip32Path}`)
  const rootResult = await TrezorConnect.getPublicKey({ path: `m/${purpose}` })
  if (!rootResult.success) throw new Error(rootResult.payload.error)

  const deviceXfp = fingerprintNumberToXfp(rootResult.payload.fingerprint).toLowerCase()
  if (deviceXfp !== cosigner.xfp.toLowerCase()) {
    throw new Error(
      `This Trezor has fingerprint ${deviceXfp}, but the selected vault key is ${cosigner.xfp.toLowerCase()}. Connect the selected Trezor and retry.`,
    )
  }
}

function uint32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`unsupported ${label}: ${value}`)
  }
  return value
}

function selectedDerivation(
  cosigner: CosignerConfig,
  input: Extract<TrezorMixedInput, { kind: 'vault' }>,
) {
  if (input.vaultInfo.branch !== input.branch) {
    throw new Error(`vault input branch ${input.branch} has mismatched address policy`)
  }

  const matches = input.vaultInfo.bip32Derivation.filter(
    (candidate) => candidate.xfp.toLowerCase() === cosigner.xfp.toLowerCase(),
  )
  if (matches.length !== 1) {
    throw new Error(
      `vault branch ${input.branch} does not identify the selected cosigner exactly once`,
    )
  }

  const derivation = matches[0]
  if (!derivation) throw new Error('missing selected cosigner derivation')
  const prefix = `${cosigner.bip32Path}/${input.branch}/`
  if (!derivation.path.startsWith(prefix)) {
    throw new Error(`unsupported Trezor child path: ${derivation.path}`)
  }

  const indexText = derivation.path.slice(prefix.length)
  if (!/^\d+$/.test(indexText)) {
    throw new Error(`unsupported Trezor child path: ${derivation.path}`)
  }
  const childIndex = Number(indexText)
  if (!Number.isSafeInteger(childIndex) || childIndex >= 0x80000000) {
    throw new Error(`unsupported Trezor child index: ${indexText}`)
  }

  const expectedPubkey = childPubkeyHex(cosigner.xpub, input.branch, childIndex).toLowerCase()
  if (derivation.pubkeyHex.toLowerCase() !== expectedPubkey) {
    throw new Error(`vault branch ${input.branch} derivation does not match the selected xpub`)
  }
  if (!input.vaultInfo.sortedPubkeysHex.some((pubkey) => pubkey.toLowerCase() === expectedPubkey)) {
    throw new Error(`vault branch ${input.branch} policy does not contain the selected xpub`)
  }

  return derivation
}

// Build and validate the complete firmware view before opening Trezor
// Connect. Unsupported transaction versions or derivations fail locally
// rather than asking the user to approve a different transaction.
export function prepareTrezorSignRequest(p: {
  cosigner: CosignerConfig
  inputs: TrezorMixedInput[]
  outputs: TrezorMixedOutput[]
  version: number
  locktime: number
}): TrezorSignRequest {
  if (p.version !== 1 && p.version !== 2) {
    throw new Error(`Trezor signing does not support transaction version ${p.version}`)
  }

  const expectedInputIndexes: number[] = []
  const inputs = p.inputs.map((input, inputIndex): PROTO.TxInputType => {
    const sequence = uint32(input.sequence, `sequence for input ${inputIndex}`)
    if (input.kind === 'external') {
      if (!input.scriptPubkeyHex) {
        throw new Error(`external input ${inputIndex} is missing its scriptPubKey`)
      }
      return {
        prev_hash: input.txid,
        prev_index: input.vout,
        amount: String(input.valueSats),
        script_type: 'EXTERNAL' as const,
        script_pubkey: input.scriptPubkeyHex,
        ...(input.scriptSigHex ? { script_sig: input.scriptSigHex } : {}),
        ...(input.witnessHex ? { witness: input.witnessHex } : {}),
        sequence,
      }
    }

    expectedInputIndexes.push(inputIndex)
    const derivation = selectedDerivation(p.cosigner, input)
    const address_n = bip32PathToSequence(derivation.path)

    if (input.vaultInfo.kind === 'p2wpkh') {
      return {
        prev_hash: input.txid,
        prev_index: input.vout,
        amount: String(input.valueSats),
        script_type: 'SPENDWITNESS' as const,
        address_n,
        sequence,
      }
    }

    return {
      prev_hash: input.txid,
      prev_index: input.vout,
      amount: String(input.valueSats),
      script_type: 'SPENDWITNESS' as const,
      address_n,
      sequence,
      multisig: {
        m: input.vaultInfo.requiredSigners,
        pubkeys: input.vaultInfo.sortedPubkeysHex.map((publicKey) => ({
          address_n: [],
          node: {
            depth: 0,
            child_num: 0,
            fingerprint: 0,
            chain_code: '0'.repeat(64),
            public_key: publicKey,
          },
        })),
        signatures: Array(input.vaultInfo.sortedPubkeysHex.length).fill(''),
      },
    }
  })

  if (expectedInputIndexes.length === 0)
    throw new Error('the transaction has no vault inputs to sign')

  const outputs = p.outputs.map(
    (output): PROTO.TxOutputType => ({
      address: output.address,
      amount: String(output.valueSats),
      script_type: 'PAYTOADDRESS' as const,
    }),
  )

  return {
    inputs,
    outputs,
    version: p.version,
    locktime: uint32(p.locktime, 'locktime'),
    expectedInputIndexes,
  }
}

// Mixed wallet-funded transfers drive @trezor/connect-web directly: vault
// inputs as SPENDWITNESS with the sorted child pubkeys passed as raw nodes,
// fee-wallet inputs as EXTERNAL with their finalized witnesses.
export async function signMixedWithTrezor(p: {
  cosigner: CosignerConfig
  inputs: TrezorMixedInput[]
  outputs: TrezorMixedOutput[]
  version: number
  locktime: number
  onProgress?: (progress: DeviceProgress) => void
}): Promise<{ inputIndex: number; signatureHex: string }[]> {
  const onProgress = p.onProgress ?? (() => {})
  const request = prepareTrezorSignRequest(p)
  onProgress({ state: 'connecting', device: 'TREZOR' })

  try {
    await initTrezorConnectAsSaffron()
    const TrezorConnect = (await import('@trezor/connect-web')).default
    await assertTrezorCosigner(TrezorConnect, p.cosigner)

    onProgress({
      state: 'awaitingDevice',
      device: 'TREZOR',
      messages: [
        ...connectGuidance('TREZOR'),
        'Review and approve the transaction in the Trezor window and on the device.',
      ],
    })

    const result = await TrezorConnect.signTransaction({
      coin: 'btc',
      inputs: request.inputs,
      outputs: request.outputs,
      version: request.version,
      locktime: request.locktime,
      serialize: false,
      push: false,
    })

    if (!result.success) {
      throw new Error(result.payload.error)
    }

    const signatures: { inputIndex: number; signatureHex: string }[] = []
    const expected = new Set(request.expectedInputIndexes)
    for (const [inputIndex, signature] of (result.payload.signatures ?? []).entries()) {
      if (typeof signature !== 'string' || signature.length === 0) continue
      if (!expected.has(inputIndex)) {
        throw new Error(`the Trezor returned a signature for unexpected input ${inputIndex}`)
      }
      signatures.push({ inputIndex, signatureHex: ensureSighashByte(signature.toLowerCase()) })
    }

    const covered = new Set(signatures.map((signature) => signature.inputIndex))
    const missing = request.expectedInputIndexes.filter((inputIndex) => !covered.has(inputIndex))
    if (missing.length > 0) {
      throw new Error(`the Trezor did not sign every vault input (missing ${missing.join(', ')})`)
    }

    onProgress({ state: 'done', device: 'TREZOR' })
    return signatures
  } catch (error) {
    const message = translateDeviceError('TREZOR', error)
    onProgress({ state: 'error', device: 'TREZOR', message })
    throw new Error(message, { cause: error })
  }
}
