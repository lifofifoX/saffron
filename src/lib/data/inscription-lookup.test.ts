import { describe, expect, it, vi } from 'vitest'

import type { OrdClient } from '$lib/clients/ord'
import type { OrdInscription, OrdOutput } from '$lib/clients/ord-contracts'

import { getInscriptionsAtOutpoint } from './inscription-lookup'

const ID = `${'4'.repeat(64)}i0`

function output(
  txid: string,
  inscriptions: OrdOutput['inscriptions'],
  overrides: Partial<OrdOutput> = {},
): OrdOutput {
  return {
    outpoint: `${txid}:0`,
    value: 100,
    spent: false,
    inscriptions,
    runes: {},
    ...overrides,
  }
}

function detail(txid: string): OrdInscription {
  return { id: ID, satpoint: `${txid}:0:99`, value: 100 }
}

describe('getInscriptionsAtOutpoint', () => {
  it('does not cache an incomplete bulk response', async () => {
    const txid = 'c'.repeat(64)
    const getOutput = vi.fn().mockResolvedValue(output(txid, [ID]))
    const getInscriptionsBulk = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([detail(txid)])
    const ord = { getOutput, getInscriptionsBulk } as unknown as OrdClient

    await expect(getInscriptionsAtOutpoint(ord, txid, 0, 100)).rejects.toThrow(/returned 0 .* 1/i)
    await expect(getInscriptionsAtOutpoint(ord, txid, 0, 100)).resolves.toEqual([
      { id: ID, offsetSats: 99 },
    ])
    expect(getOutput).toHaveBeenCalledTimes(2)
    expect(getInscriptionsBulk).toHaveBeenCalledTimes(2)
  })

  it('does not persist an explicitly empty inscription list', async () => {
    const txid = 'd'.repeat(64)
    const getOutput = vi
      .fn()
      .mockResolvedValueOnce(output(txid, null))
      .mockResolvedValueOnce(output(txid, []))
      .mockResolvedValueOnce(output(txid, [ID]))
    const getInscriptionsBulk = vi.fn().mockResolvedValue([detail(txid)])
    const ord = { getOutput, getInscriptionsBulk } as unknown as OrdClient

    await expect(getInscriptionsAtOutpoint(ord, txid, 0, 100)).rejects.toThrow(/explicitly report/i)
    await expect(getInscriptionsAtOutpoint(ord, txid, 0, 100)).resolves.toEqual([])
    await expect(getInscriptionsAtOutpoint(ord, txid, 0, 100)).resolves.toEqual([
      { id: ID, offsetSats: 99 },
    ])
    expect(getOutput).toHaveBeenCalledTimes(3)
    expect(getInscriptionsBulk).toHaveBeenCalledTimes(1)
  })

  it('rejects a response for a different outpoint', async () => {
    const txid = 'e'.repeat(64)
    const wrong = output(txid, [])
    wrong.outpoint = `${txid}:1`
    const ord = {
      getOutput: vi.fn().mockResolvedValue(wrong),
      getInscriptionsBulk: vi.fn(),
    } as unknown as OrdClient

    await expect(getInscriptionsAtOutpoint(ord, txid, 0, 100)).rejects.toThrow(/expected/i)
  })

  it('does not share answers between Ord clients', async () => {
    const txid = '9'.repeat(64)
    const first = {
      getOutput: vi.fn().mockResolvedValue(output(txid, [])),
      getInscriptionsBulk: vi.fn(),
    } as unknown as OrdClient
    const second = {
      getOutput: vi.fn().mockResolvedValue(output(txid, [ID])),
      getInscriptionsBulk: vi.fn().mockResolvedValue([detail(txid)]),
    } as unknown as OrdClient

    await expect(getInscriptionsAtOutpoint(first, txid, 0, 100)).resolves.toEqual([])
    await expect(getInscriptionsAtOutpoint(second, txid, 0, 100)).resolves.toEqual([
      { id: ID, offsetSats: 99 },
    ])
    expect(first.getOutput).toHaveBeenCalledTimes(1)
    expect(second.getOutput).toHaveBeenCalledTimes(1)
    expect(second.getInscriptionsBulk).toHaveBeenCalledTimes(1)
  })

  it('rejects an Ord output value that differs from the verified prevout', async () => {
    const txid = '8'.repeat(64)
    const ord = {
      getOutput: vi.fn().mockResolvedValue(output(txid, [], { value: 101 })),
      getInscriptionsBulk: vi.fn(),
    } as unknown as OrdClient

    await expect(getInscriptionsAtOutpoint(ord, txid, 0, 100)).rejects.toThrow(
      /returned value 101 .* expected 100/i,
    )
  })
})
