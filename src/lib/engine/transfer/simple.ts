import { hexToBytes } from '@noble/hashes/utils.js'
import { dustThresholdSatsForScript } from '$lib/engine/dust'
import { formatOutpoint, type Outpoint } from '$lib/engine/outpoints'
import { traceSatFlow } from '$lib/engine/psbt/satflow'
import { MAX_FEE_RATE_SAT_VB } from '$lib/security/fee-policy'

import { TransferError } from './errors'
import { type CardinalUtxo, selectCardinalUtxo } from './select'
import { feeForVsize, multisigInputVbytes, outputVbytes, TX_BASE_VBYTES } from './vsize'

// Per-input virtual sizes for the fee wallet's singlesig spends, matching
// ord.net's production constants.
export const FEE_INPUT_VBYTES = {
  p2tr: 57.5,
  p2wpkh: 68,
  'p2sh-p2wpkh': 91,
} as const

export type FeeWalletKind = keyof typeof FEE_INPUT_VBYTES

export type VaultTransferItem = {
  outpoint: Outpoint
  valueSats: number
  inscriptionIds: string[]
  recipientScriptHex: string
}

export type SimpleTransferRequest = {
  items: VaultTransferItem[]
  quorum: { requiredSigners: number; totalSigners: number }
  inscriptionsScriptHex: string
  feeWallet: {
    kind: FeeWalletKind
    cardinalUtxos: CardinalUtxo[]
    changeScriptHex: string
  }
  feeRateSatVb: number
}

export type SimpleTransferPlan = {
  vaultInputs: { outpoint: Outpoint; valueSats: number }[]
  feeInputs: { outpoint: Outpoint; valueSats: number }[]
  outputs: { scriptHex: string; valueSats: number; role: 'recipient' | 'walletChange' }[]
  feeSats: number
  vsize: number
  feeRateSatVb: number
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TransferError('BUILD_INVARIANT_VIOLATION', message)
}

// Marketplace-style transfer: vault input i maps to output i with an identical
// value, so every sat of every vault UTXO (inscriptions at any offset,
// cohabitants included) provably lands in the same-index output. The connected
// fee wallet appends its own cardinal inputs after the vault inputs and takes
// change last; the fee comes entirely from the wallet, never from vault sats.
export function planSimpleTransfer(request: SimpleTransferRequest): SimpleTransferPlan {
  const { items, quorum, feeRateSatVb, feeWallet } = request

  if (items.length === 0) {
    throw new TransferError('NOT_IN_WALLET', 'nothing selected to transfer')
  }
  if (!Number.isFinite(feeRateSatVb) || feeRateSatVb <= 0) {
    throw new TransferError('INVALID_FEE_RATE', `invalid fee rate ${feeRateSatVb}`)
  }
  if (feeRateSatVb > MAX_FEE_RATE_SAT_VB) {
    throw new TransferError(
      'INVALID_FEE_RATE',
      `fee rate ${feeRateSatVb} exceeds the ${MAX_FEE_RATE_SAT_VB} sat/vB safety limit`,
    )
  }

  const seenOutpoints = new Set<string>()
  for (const item of items) {
    const key = formatOutpoint(item.outpoint)
    if (seenOutpoints.has(key)) {
      throw new TransferError('NOT_IN_WALLET', `duplicate transfer of ${key}`)
    }
    seenOutpoints.add(key)

    if (!Number.isSafeInteger(item.valueSats) || item.valueSats <= 0) {
      throw new TransferError('VALUE_OVERFLOW', `unsafe value for ${key}`)
    }
    if (item.recipientScriptHex === request.inscriptionsScriptHex) {
      throw new TransferError('DUPLICATE_ADDRESS', 'recipient equals the vault address')
    }
    if (item.recipientScriptHex === feeWallet.changeScriptHex) {
      throw new TransferError('DUPLICATE_ADDRESS', 'recipient equals the fee wallet address')
    }

    const recipientScript = hexToBytes(item.recipientScriptHex)
    if (item.valueSats < dustThresholdSatsForScript(recipientScript)) {
      throw new TransferError(
        'DUST_OUTPUT',
        `${key} is below the dust limit for that recipient address type`,
      )
    }
  }

  const vaultInputs = items.map((item) => ({ outpoint: item.outpoint, valueSats: item.valueSats }))
  const outputs: SimpleTransferPlan['outputs'] = items.map((item) => ({
    scriptHex: item.recipientScriptHex,
    valueSats: item.valueSats,
    role: 'recipient' as const,
  }))

  const feeInputVbytes = FEE_INPUT_VBYTES[feeWallet.kind]
  const changeScript = hexToBytes(feeWallet.changeScriptHex)
  const changeDust = dustThresholdSatsForScript(changeScript)

  const pool = new Map(feeWallet.cardinalUtxos.map((utxo) => [formatOutpoint(utxo.outpoint), utxo]))
  const feeInputs: SimpleTransferPlan['feeInputs'] = []

  const vsizeWith = (feeInputCount: number, withChange: boolean) => {
    const vaultVbytes =
      vaultInputs.length * multisigInputVbytes(quorum.requiredSigners, quorum.totalSigners)
    const outputVbytesTotal =
      outputs.reduce((sum, output) => sum + outputVbytes(hexToBytes(output.scriptHex)), 0) +
      (withChange ? outputVbytes(changeScript) : 0)

    return Math.ceil(
      TX_BASE_VBYTES + vaultVbytes + feeInputCount * feeInputVbytes + outputVbytesTotal,
    )
  }

  let feeTotal = 0
  while (feeTotal < feeForVsize(feeRateSatVb, vsizeWith(feeInputs.length, true)) + changeDust) {
    const needed =
      feeForVsize(feeRateSatVb, vsizeWith(feeInputs.length + 1, true)) + changeDust - feeTotal

    const utxo = selectCardinalUtxo(pool, Math.max(1, needed), false)
    feeInputs.push({ outpoint: utxo.outpoint, valueSats: utxo.valueSats })
    feeTotal += utxo.valueSats
  }

  const vsize = vsizeWith(feeInputs.length, true)
  const feeSats = feeForVsize(feeRateSatVb, vsize)
  const changeSats = feeTotal - feeSats

  invariant(changeSats >= changeDust, 'fee wallet change clears the dust limit')
  outputs.push({
    scriptHex: feeWallet.changeScriptHex,
    valueSats: changeSats,
    role: 'walletChange',
  })

  // Independent FIFO double-check: every inscription on every vault input must
  // land in the same-index output at its original offset.
  const allInputs = [...vaultInputs, ...feeInputs]

  for (const [index, item] of items.entries()) {
    const landings = traceSatFlow(
      allInputs.map((input) => ({ outpoint: input.outpoint, valueSats: input.valueSats })),
      outputs.map((output) => ({ scriptHex: output.scriptHex, valueSats: output.valueSats })),
      [
        { label: 'first', outpoint: item.outpoint, offsetSats: 0 },
        { label: 'last', outpoint: item.outpoint, offsetSats: item.valueSats - 1 },
      ],
    )

    for (const landing of landings) {
      invariant(
        landing.outputIndex === index,
        `satflow: vault input ${index} maps entirely to output ${index}`,
      )
    }
  }

  const totalIn = allInputs.reduce((sum, input) => sum + input.valueSats, 0)
  const totalOut = outputs.reduce((sum, output) => sum + output.valueSats, 0)
  invariant(totalIn - totalOut === feeSats, 'fee accounting is exact')

  return { vaultInputs, feeInputs, outputs, feeSats, vsize, feeRateSatVb }
}
