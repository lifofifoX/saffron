import { describe, expect, it, vi } from 'vitest'

import type { OrdClient } from '$lib/clients/ord'
import type { OrdInscription, OrdOutput, OrdOutputType } from '$lib/clients/ord-contracts'

import { loadHoldings } from './holdings'

const TXID = 'f'.repeat(64)
const ID_A = `${'5'.repeat(64)}i0`
const ID_B = `${'6'.repeat(64)}i0`

const inscribedOutput: OrdOutput = {
  outpoint: `${TXID}:0`,
  value: 200,
  spent: false,
  inscriptions: [ID_A, ID_B],
  runes: {},
}

function detail(id: string, offset: number): OrdInscription {
  return { id, satpoint: `${TXID}:0:${offset}`, value: 200 }
}

function ordClient(
  bulk: ReturnType<typeof vi.fn>,
  inscribedOutputs: OrdOutput[] = [inscribedOutput],
): OrdClient {
  return {
    getOutputsForAddress: vi.fn(async (_address: string, type: OrdOutputType) =>
      type === 'inscribed' ? inscribedOutputs : [],
    ),
    getInscriptionsBulk: bulk,
  } as unknown as OrdClient
}

describe('loadHoldings', () => {
  it('retries an incomplete detail response and accepts only the complete retry', async () => {
    const bulk = vi
      .fn()
      .mockResolvedValueOnce([detail(ID_A, 0)])
      .mockResolvedValueOnce([detail(ID_B, 50), detail(ID_A, 0)])

    const snapshot = await loadHoldings(ordClient(bulk), 'bc1qtest')

    expect(snapshot.stale).toBe(false)
    expect(snapshot.inscriptions.map(({ id }) => id).sort()).toEqual([ID_A, ID_B].sort())
    expect(bulk).toHaveBeenCalledTimes(2)
  })

  it('does not expose a partial holding set after two incomplete responses', async () => {
    const bulk = vi.fn().mockResolvedValue([detail(ID_A, 0)])

    const snapshot = await loadHoldings(ordClient(bulk), 'bc1qtest')

    expect(snapshot.stale).toBe(true)
    expect(snapshot.inscriptions).toEqual([])
    expect(snapshot.inscribedValueSats).toBe(200)
    expect(bulk).toHaveBeenCalledTimes(2)
  })

  it('rejects a detail whose satpoint offset lies outside its output', async () => {
    const bulk = vi.fn().mockResolvedValue([detail(ID_A, 0), detail(ID_B, 200)])

    const snapshot = await loadHoldings(ordClient(bulk), 'bc1qtest')

    expect(snapshot.stale).toBe(true)
    expect(snapshot.inscriptions).toEqual([])
  })
})
