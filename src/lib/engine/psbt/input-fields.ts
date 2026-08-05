import { hexToBytes } from '@noble/hashes/utils.js'

import { bip32PathToSequence, xfpToFingerprintNumber } from '$lib/engine/paths'
import type { MultisigAddressInfo } from '$lib/engine/types'

export const RBF_SEQUENCE = 0xfffffffd

// PSBT input fields that let devices recognize a vault address: the witness
// script for multisig, plus the full-cosigner derivation table.
export function multisigInputFields(info: MultisigAddressInfo): {
  witnessScript?: Uint8Array
  bip32Derivation: [Uint8Array, { fingerprint: number; path: number[] }][]
} {
  return {
    ...(info.witnessScriptHex !== undefined
      ? { witnessScript: hexToBytes(info.witnessScriptHex) }
      : {}),
    bip32Derivation: info.bip32Derivation.map((entry) => [
      hexToBytes(entry.pubkeyHex),
      {
        fingerprint: xfpToFingerprintNumber(entry.xfp),
        path: bip32PathToSequence(entry.path),
      },
    ]),
  }
}
