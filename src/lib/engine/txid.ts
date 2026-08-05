import * as btc from '@scure/btc-signer'

import { LIBERAL_PSBT_OPTIONS } from '$lib/engine/psbt/parse'

// The txid hashes the legacy serialization; hashing raw segwit bytes directly
// yields the wtxid instead. scure strips the witness for us.
export function txidOfRawTx(rawTxBytes: Uint8Array): string {
  return btc.Transaction.fromRaw(rawTxBytes, LIBERAL_PSBT_OPTIONS).id
}
