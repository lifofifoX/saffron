import { hexToBytes } from '@noble/hashes/utils.js'
import * as btc from '@scure/btc-signer'

import { LIBERAL_PSBT_OPTIONS } from '$lib/engine/psbt/parse'

// Decodes a finalized raw transaction for assertions: outputs and inputs as
// plain arrays, with witness stacks and display-order txids.
export function decodeRawTx(rawTxHex: string) {
  const transaction = btc.Transaction.fromRaw(hexToBytes(rawTxHex), LIBERAL_PSBT_OPTIONS)

  return {
    transaction,
    vsize: transaction.vsize,
    id: transaction.id,
    outputs: Array.from({ length: transaction.outputsLength }, (_, index) =>
      transaction.getOutput(index),
    ),
    inputs: Array.from({ length: transaction.inputsLength }, (_, index) =>
      transaction.getInput(index),
    ),
  }
}
