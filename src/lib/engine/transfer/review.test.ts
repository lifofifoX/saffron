import { describe, expect, it } from 'vitest'

import { scriptHexToAddress } from '$lib/engine/address'
import type { InscriptionHolding } from '$lib/engine/types'

import type { SimpleTransferPlan } from './simple'
import { snapshotSimpleTransferReview, type TransferReviewGroup } from './review'

const RECIPIENT_SCRIPT = `0014${'33'.repeat(20)}`
const RECIPIENT = scriptHexToAddress(RECIPIENT_SCRIPT)
const TXID_A = '11'.repeat(32)
const TXID_B = '22'.repeat(32)

function holding(id: string, txid: string, valueSats: number): InscriptionHolding {
  return {
    id,
    number: 1,
    satpoint: `${txid}:0:0`,
    outpoint: `${txid}:0`,
    offsetSats: 0,
    valueSats,
    contentType: 'image/png',
    charms: [],
    parents: [],
  }
}

function plan(): SimpleTransferPlan {
  return {
    vaultInputs: [
      { outpoint: { txid: TXID_A, vout: 0 }, valueSats: 1_000 },
      { outpoint: { txid: TXID_B, vout: 0 }, valueSats: 2_000 },
    ],
    feeInputs: [],
    outputs: [
      { scriptHex: RECIPIENT_SCRIPT, valueSats: 1_000, role: 'recipient' },
      { scriptHex: RECIPIENT_SCRIPT, valueSats: 2_000, role: 'recipient' },
    ],
    feeSats: 300,
    vsize: 200,
    feeRateSatVb: 1.5,
  }
}

describe('snapshotSimpleTransferReview', () => {
  it('derives the destination and item order from an immutable plan snapshot', () => {
    const originalPlan = plan()
    const first = holding(`${TXID_A}i0`, TXID_A, 1_000)
    const second = holding(`${TXID_B}i0`, TXID_B, 2_000)
    const groups: TransferReviewGroup[] = [
      { outpoint: second.outpoint, primary: second, cohabitants: [second] },
      { outpoint: first.outpoint, primary: first, cohabitants: [first] },
    ]

    const review = snapshotSimpleTransferReview(originalPlan, groups)

    expect(review.recipient).toBe(RECIPIENT)
    expect(review.groups.map((group) => group.outpoint)).toEqual([`${TXID_A}:0`, `${TXID_B}:0`])

    originalPlan.outputs[0]!.scriptHex = `0014${'44'.repeat(20)}`
    first.number = 999

    expect(review.recipient).toBe(RECIPIENT)
    expect(review.groups[0]?.primary.number).toBe(1)
    expect(Object.isFrozen(review)).toBe(true)
    expect(Object.isFrozen(review.plan.outputs)).toBe(true)
    expect(Object.isFrozen(review.groups)).toBe(true)
  })

  it('rejects display items that do not match the planned inputs', () => {
    const originalPlan = plan()
    const first = holding(`${TXID_A}i0`, TXID_A, 999)

    expect(() =>
      snapshotSimpleTransferReview(originalPlan, [
        { outpoint: first.outpoint, primary: first, cohabitants: [first] },
      ]),
    ).toThrow('missing planned input')
  })
})
