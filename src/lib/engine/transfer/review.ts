import { scriptHexToAddress } from '$lib/engine/address'
import type { InscriptionHolding } from '$lib/engine/types'
import { formatOutpoint } from '$lib/engine/outpoints'

import type { SimpleTransferPlan } from './simple'

export type TransferReviewGroup = {
  outpoint: string
  primary: InscriptionHolding
  cohabitants: InscriptionHolding[]
}

export type SimpleTransferReview = {
  recipient: string
  plan: SimpleTransferPlan
  groups: TransferReviewGroup[]
}

function freezeHolding(holding: InscriptionHolding): InscriptionHolding {
  const snapshot = {
    ...holding,
    charms: [...holding.charms],
    parents: [...holding.parents],
  }
  Object.freeze(snapshot.charms)
  Object.freeze(snapshot.parents)
  Object.freeze(snapshot)
  return snapshot
}

function freezePlan(plan: SimpleTransferPlan): SimpleTransferPlan {
  const vaultInputs = plan.vaultInputs.map((input) => {
    const snapshot = { ...input, outpoint: { ...input.outpoint } }
    Object.freeze(snapshot.outpoint)
    Object.freeze(snapshot)
    return snapshot
  })
  const feeInputs = plan.feeInputs.map((input) => {
    const snapshot = { ...input, outpoint: { ...input.outpoint } }
    Object.freeze(snapshot.outpoint)
    Object.freeze(snapshot)
    return snapshot
  })
  const outputs = plan.outputs.map((output) => Object.freeze({ ...output }))

  Object.freeze(vaultInputs)
  Object.freeze(feeInputs)
  Object.freeze(outputs)

  const snapshot = { ...plan, vaultInputs, feeInputs, outputs }
  Object.freeze(snapshot)
  return snapshot
}

// Build review data only from the exact transfer plan being converted to a PSBT.
// The caller's live form fields are deliberately not accepted here.
export function snapshotSimpleTransferReview(
  plan: SimpleTransferPlan,
  availableGroups: TransferReviewGroup[],
): SimpleTransferReview {
  const recipientOutputs = plan.outputs.filter((output) => output.role === 'recipient')
  if (recipientOutputs.length !== plan.vaultInputs.length || recipientOutputs.length === 0) {
    throw new Error('transfer review does not match the planned vault inputs')
  }

  const recipientScriptHex = recipientOutputs[0]?.scriptHex
  if (
    !recipientScriptHex ||
    recipientOutputs.some((output) => output.scriptHex !== recipientScriptHex)
  ) {
    throw new Error('transfer review contains multiple recipient addresses')
  }

  const groupsByOutpoint = new Map(availableGroups.map((group) => [group.outpoint, group]))
  const groups = plan.vaultInputs.map((input) => {
    const outpoint = formatOutpoint(input.outpoint)
    const group = groupsByOutpoint.get(outpoint)
    if (!group || group.primary.valueSats !== input.valueSats) {
      throw new Error(`transfer review is missing planned input ${outpoint}`)
    }

    const snapshot = {
      outpoint,
      primary: freezeHolding(group.primary),
      cohabitants: group.cohabitants.map(freezeHolding),
    }
    Object.freeze(snapshot.cohabitants)
    Object.freeze(snapshot)
    return snapshot
  })

  Object.freeze(groups)
  const snapshot = {
    recipient: scriptHexToAddress(recipientScriptHex),
    plan: freezePlan(plan),
    groups,
  }
  Object.freeze(snapshot)
  return snapshot
}
