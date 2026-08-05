import type * as btc from '@scure/btc-signer'
import { SigHash } from '@scure/btc-signer'

// BIP143 SIGHASH_ALL digest for a segwit v0 input, computed from the PSBT's
// own unsigned transaction. This is the digest hardware devices actually sign,
// so signature verification pins to it.
export function bip143SighashAll(p: {
  transaction: btc.Transaction
  inputIndex: number
  scriptCode: Uint8Array
  amountSats: bigint
}): Uint8Array {
  // Despite the name, preimageWitnessV0 returns the final double-SHA256 digest.
  return p.transaction.preimageWitnessV0(p.inputIndex, p.scriptCode, SigHash.ALL, p.amountSats)
}
