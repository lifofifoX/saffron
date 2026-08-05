import { base64 } from '@scure/base'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as btc from '@scure/btc-signer'

import { addressToScriptHex } from '$lib/engine/address'
import { txidOfRawTx } from '$lib/engine/txid'
import type { WalletAddresses } from '$lib/engine/types'

import { TransferError } from './errors'
import type { FeeWalletKind, SimpleTransferPlan } from './simple'
import { multisigInputFields, RBF_SEQUENCE } from '$lib/engine/psbt/input-fields'

export type FeeWalletSpendInfo = {
  kind: FeeWalletKind
  address: string
  publicKeyHex: string
}

export function xOnly(publicKey: Uint8Array): Uint8Array {
  return publicKey.length === 33 ? publicKey.slice(1) : publicKey
}

// PSBT fields for one of the fee wallet's own inputs, per its address type.
export function feeWalletInputFields(feeWallet: FeeWalletSpendInfo): {
  script: Uint8Array
  extra: Record<string, unknown>
} {
  const publicKey = hexToBytes(feeWalletKindNormalizedPubkey(feeWallet))
  let result: { script: Uint8Array; extra: Record<string, unknown> }

  if (feeWallet.kind === 'p2tr') {
    const payment = btc.p2tr(xOnly(publicKey))
    result = { script: payment.script, extra: { tapInternalKey: xOnly(publicKey) } }
  } else if (feeWallet.kind === 'p2wpkh') {
    const payment = btc.p2wpkh(publicKey)
    result = { script: payment.script, extra: {} }
  } else {
    const inner = btc.p2wpkh(publicKey)
    const payment = btc.p2sh(inner)
    result = { script: payment.script, extra: { redeemScript: inner.script } }
  }

  let addressScriptHex: string
  try {
    addressScriptHex = addressToScriptHex(feeWallet.address)
  } catch {
    throw new TransferError('INVALID_ADDRESS', 'fee wallet address is invalid')
  }

  if (bytesToHex(result.script) !== addressScriptHex) {
    throw new TransferError('INVALID_ADDRESS', 'fee wallet address does not match its public key')
  }

  return result
}

function feeWalletKindNormalizedPubkey(feeWallet: FeeWalletSpendInfo): string {
  const trimmed = feeWallet.publicKeyHex.trim().toLowerCase()
  if (!/^(?:[0-9a-f]{64}|0[23][0-9a-f]{64})$/.test(trimmed)) {
    throw new TransferError('INVALID_ADDRESS', 'fee wallet public key is invalid')
  }

  return trimmed
}

export function simpleTransferToPsbt(
  plan: SimpleTransferPlan,
  context: {
    addresses: WalletAddresses
    feeWallet: FeeWalletSpendInfo
    prevTxHexByTxid: Record<string, string>
  },
): { psbtBase64: string; feeInputIndexes: number[] } {
  const { addresses, feeWallet, prevTxHexByTxid } = context
  const vaultInfo = addresses.inscriptions

  const transaction = new btc.Transaction({ version: 2, lockTime: 0, allowUnknownOutputs: false })

  for (const input of plan.vaultInputs) {
    const prevTxHex = prevTxHexByTxid[input.outpoint.txid]
    if (!prevTxHex) {
      throw new TransferError(
        'BUILD_INVARIANT_VIOLATION',
        `missing previous transaction for ${input.outpoint.txid}`,
      )
    }

    const prevTxBytes = hexToBytes(prevTxHex)
    if (txidOfRawTx(prevTxBytes) !== input.outpoint.txid) {
      throw new TransferError(
        'BUILD_INVARIANT_VIOLATION',
        `previous transaction hex does not hash to ${input.outpoint.txid}`,
      )
    }

    transaction.addInput({
      txid: input.outpoint.txid,
      index: input.outpoint.vout,
      sequence: RBF_SEQUENCE,
      witnessUtxo: {
        script: hexToBytes(vaultInfo.scriptPubkeyHex),
        amount: BigInt(input.valueSats),
      },
      nonWitnessUtxo: prevTxBytes,
      ...multisigInputFields(vaultInfo),
    })
  }

  const walletFields = feeWalletInputFields(feeWallet)
  const feeInputIndexes: number[] = []

  for (const input of plan.feeInputs) {
    feeInputIndexes.push(transaction.inputsLength)

    transaction.addInput({
      txid: input.outpoint.txid,
      index: input.outpoint.vout,
      sequence: RBF_SEQUENCE,
      witnessUtxo: { script: walletFields.script, amount: BigInt(input.valueSats) },
      ...walletFields.extra,
    })
  }

  for (const output of plan.outputs) {
    transaction.addOutput({
      script: hexToBytes(output.scriptHex),
      amount: BigInt(output.valueSats),
    })
  }

  return {
    psbtBase64: base64.encode(transaction.toPSBT(0)),
    feeInputIndexes,
  }
}
