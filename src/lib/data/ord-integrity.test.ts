import { describe, expect, it } from 'vitest'

import type { OrdInscription, OrdOutput } from '$lib/clients/ord-contracts'

import {
  isExplicitCardinalOutput,
  matchInscriptionDetails,
  verifiedCardinalOutputs,
} from './ord-integrity'

const TXID_A = 'a'.repeat(64)
const TXID_B = 'b'.repeat(64)
const ID_A = `${'1'.repeat(64)}i0`
const ID_B = `${'2'.repeat(64)}i0`

function output(overrides: Partial<OrdOutput> = {}): OrdOutput {
  return {
    outpoint: `${TXID_A}:0`,
    value: 100,
    spent: false,
    inscriptions: [],
    runes: {},
    ...overrides,
  }
}

function detail(
  id: string,
  satpoint: string,
  overrides: Partial<OrdInscription> = {},
): OrdInscription {
  return { id, satpoint, value: 100, ...overrides }
}

describe('cardinal output verification', () => {
  it('requires explicit empty inscription and rune collections', () => {
    expect(isExplicitCardinalOutput(output())).toBe(true)
    expect(isExplicitCardinalOutput(output({ inscriptions: null }))).toBe(false)
    expect(isExplicitCardinalOutput(output({ runes: null }))).toBe(false)
    expect(isExplicitCardinalOutput(output({ inscriptions: [ID_A] }))).toBe(false)
    expect(isExplicitCardinalOutput(output({ runes: { TEST: 1 } }))).toBe(false)

    const missingInscriptions = { outpoint: `${TXID_A}:1`, value: 100, spent: false, runes: {} }
    const missingRunes = { outpoint: `${TXID_A}:2`, value: 100, spent: false, inscriptions: [] }
    expect(isExplicitCardinalOutput(missingInscriptions)).toBe(false)
    expect(isExplicitCardinalOutput(missingRunes)).toBe(false)
  })

  it('rejects every copy of a duplicated cardinal outpoint', () => {
    const duplicate = output()
    const verified = verifiedCardinalOutputs([duplicate, { ...duplicate }])

    expect(verified).toEqual({ outputs: [], complete: false })
  })
})

describe('bulk inscription detail verification', () => {
  const expected = [
    { id: ID_A, outpoint: `${TXID_A}:0`, outputValue: 100 },
    { id: ID_B, outpoint: `${TXID_B}:1`, outputValue: 200 },
  ]

  it('accepts a complete unique response regardless of response order', () => {
    const matched = matchInscriptionDetails(expected, [
      detail(ID_B, `${TXID_B}:1:199`, { value: 200 }),
      detail(ID_A, `${TXID_A}:0:0`),
    ])

    expect(matched.map(({ id, offsetSats }) => ({ id, offsetSats }))).toEqual([
      { id: ID_B, offsetSats: 199 },
      { id: ID_A, offsetSats: 0 },
    ])
  })

  it.each([
    ['missing detail', [detail(ID_A, `${TXID_A}:0:0`)]],
    ['duplicate detail', [detail(ID_A, `${TXID_A}:0:0`), detail(ID_A, `${TXID_A}:0:0`)]],
    [
      'unexpected detail',
      [detail(ID_A, `${TXID_A}:0:0`), detail(`${'3'.repeat(64)}i0`, `${TXID_B}:1:0`)],
    ],
    [
      'wrong outpoint',
      [detail(ID_A, `${TXID_A}:0:0`), detail(ID_B, `${TXID_A}:0:1`, { value: 200 })],
    ],
    [
      'out-of-range offset',
      [detail(ID_A, `${TXID_A}:0:100`), detail(ID_B, `${TXID_B}:1:0`, { value: 200 })],
    ],
    [
      'mismatched value',
      [detail(ID_A, `${TXID_A}:0:0`, { value: 99 }), detail(ID_B, `${TXID_B}:1:0`, { value: 200 })],
    ],
  ])('rejects a %s response', (_label, details) => {
    expect(() => matchInscriptionDetails(expected, details)).toThrow()
  })
})
