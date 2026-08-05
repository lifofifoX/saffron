import type { ElectrsClient } from '$lib/clients/electrs'
import type { OrdClient } from '$lib/clients/ord'
import { verifiedCardinalOutputs } from '$lib/data/ord-integrity'
import { PAYMENTS_BRANCH } from '$lib/engine/types'

export type PaymentUtxo = {
  txid: string
  vout: number
  valueSats: number
  branch: typeof PAYMENTS_BRANCH
  confirmations: number | null
}

export type PaymentsSnapshot = {
  spendable: PaymentUtxo[]
  spendableSats: number
  pendingSats: number
  excludedOutpoints: string[]
}

// Spendable = electrs-confirmed ∩ ord-cardinal with per-outpoint value equality.
// A UTXO missing from the cardinal set may carry an inscription or rune; a value
// mismatch means index skew — either way it must never fund fees.
export async function loadPaymentUtxos(
  ord: OrdClient,
  electrs: ElectrsClient,
  paymentsAddress: string,
): Promise<PaymentsSnapshot> {
  const [electrsUtxos, cardinalOutputs] = await Promise.all([
    electrs.getAddressUtxos(paymentsAddress),
    ord.getOutputsForAddress(paymentsAddress, 'cardinal'),
  ])

  const verifiedCardinals = verifiedCardinalOutputs(cardinalOutputs)
  const cardinalValueByOutpoint = new Map(
    verifiedCardinals.outputs.map((output) => [output.outpoint, output.value]),
  )

  const spendable: PaymentUtxo[] = []
  const excludedOutpoints: string[] = []
  let pendingSats = 0

  for (const utxo of electrsUtxos) {
    const outpoint = `${utxo.txid}:${utxo.vout}`

    if (!utxo.status.confirmed) {
      pendingSats += utxo.value
      continue
    }

    const cardinalValue = cardinalValueByOutpoint.get(outpoint)
    if (cardinalValue === undefined || cardinalValue !== utxo.value) {
      excludedOutpoints.push(outpoint)
      continue
    }

    spendable.push({
      txid: utxo.txid,
      vout: utxo.vout,
      valueSats: utxo.value,
      branch: PAYMENTS_BRANCH,
      confirmations: null,
    })
  }

  spendable.sort((a, b) => b.valueSats - a.valueSats)

  return {
    spendable,
    spendableSats: spendable.reduce((sum, utxo) => sum + utxo.valueSats, 0),
    pendingSats,
    excludedOutpoints,
  }
}
