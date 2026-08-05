import { describe, expect, it, vi } from 'vitest'

import type { ElectrsClient, ElectrsUtxo } from '$lib/clients/electrs'
import type { OrdClient } from '$lib/clients/ord'
import type { OrdOutput } from '$lib/clients/ord-contracts'

import { loadPaymentUtxos } from './payments'

function electrsUtxo(txid: string): ElectrsUtxo {
  return { txid, vout: 0, value: 100, status: { confirmed: true } }
}

function cardinal(txid: string, overrides: Partial<OrdOutput> = {}): OrdOutput {
  return {
    outpoint: `${txid}:0`,
    value: 100,
    spent: false,
    inscriptions: [],
    runes: {},
    ...overrides,
  }
}

describe('loadPaymentUtxos', () => {
  it('spends only unique outputs with explicit empty inscriptions and runes', async () => {
    const safe = '1'.repeat(64)
    const missingInscriptions = '2'.repeat(64)
    const nullRunes = '3'.repeat(64)
    const advertisedInscription = '4'.repeat(64)
    const advertisedRune = '5'.repeat(64)
    const duplicate = '6'.repeat(64)
    const inscriptionId = `${'7'.repeat(64)}i0`

    const electrsUtxos = [
      safe,
      missingInscriptions,
      nullRunes,
      advertisedInscription,
      advertisedRune,
      duplicate,
    ].map(electrsUtxo)
    const cardinalOutputs: OrdOutput[] = [
      cardinal(safe),
      { outpoint: `${missingInscriptions}:0`, value: 100, spent: false, runes: {} },
      cardinal(nullRunes, { runes: null }),
      cardinal(advertisedInscription, { inscriptions: [inscriptionId] }),
      cardinal(advertisedRune, { runes: { TEST: 1 } }),
      cardinal(duplicate),
      cardinal(duplicate),
    ]
    const ord = {
      getOutputsForAddress: vi.fn().mockResolvedValue(cardinalOutputs),
    } as unknown as OrdClient
    const electrs = {
      getAddressUtxos: vi.fn().mockResolvedValue(electrsUtxos),
    } as unknown as ElectrsClient

    const snapshot = await loadPaymentUtxos(ord, electrs, 'bc1qtest')

    expect(snapshot.spendable.map(({ txid }) => txid)).toEqual([safe])
    expect(snapshot.excludedOutpoints.sort()).toEqual(
      [missingInscriptions, nullRunes, advertisedInscription, advertisedRune, duplicate]
        .map((txid) => `${txid}:0`)
        .sort(),
    )
  })
})
