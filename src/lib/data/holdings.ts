import type { OrdClient } from '$lib/clients/ord'
import {
  matchInscriptionDetails,
  OrdIntegrityError,
  type ExpectedInscription,
  verifiedCardinalOutputs,
} from '$lib/data/ord-integrity'
import type { InscriptionHolding } from '$lib/engine/types'

export type HoldingsSnapshot = {
  inscriptions: InscriptionHolding[]
  inscribedValueSats: number
  strayCardinalSats: number
  stale: boolean
}

async function loadOnce(ord: OrdClient, inscriptionsAddress: string) {
  const [inscribedOutputs, cardinalOutputs] = await Promise.all([
    ord.getOutputsForAddress(inscriptionsAddress, 'inscribed'),
    ord.getOutputsForAddress(inscriptionsAddress, 'cardinal'),
  ])

  const unspentOutputs = inscribedOutputs.filter((output) => !output.spent)
  const holdings: InscriptionHolding[] = []
  let consistent = true

  try {
    const expected: ExpectedInscription[] = []
    const seenOutpoints = new Set<string>()
    for (const output of unspentOutputs) {
      if (seenOutpoints.has(output.outpoint)) {
        throw new OrdIntegrityError(`ord returned duplicate output ${output.outpoint}`)
      }
      seenOutpoints.add(output.outpoint)

      if (!Array.isArray(output.inscriptions) || output.inscriptions.length === 0) {
        throw new OrdIntegrityError(
          `ord did not explicitly advertise inscriptions for ${output.outpoint}`,
        )
      }
      expected.push(
        ...output.inscriptions.map((id) => ({
          id,
          outpoint: output.outpoint,
          outputValue: output.value,
        })),
      )
    }

    const ids = expected.map(({ id }) => id)
    const details = ids.length > 0 ? await ord.getInscriptionsBulk(ids) : []
    const matched = matchInscriptionDetails(expected, details)

    holdings.push(
      ...matched.map(({ detail, outpoint, offsetSats, outputValue }) => ({
        id: detail.id,
        number: detail.number ?? null,
        satpoint: detail.satpoint,
        outpoint,
        offsetSats,
        valueSats: outputValue,
        contentType: detail.effective_content_type ?? detail.content_type ?? null,
        charms: detail.charms ?? [],
        parents: detail.parents ?? [],
      })),
    )
  } catch (error) {
    if (!(error instanceof OrdIntegrityError)) throw error
    consistent = false
  }

  holdings.sort((a, b) => (b.number ?? 0) - (a.number ?? 0))

  const verifiedCardinals = verifiedCardinalOutputs(cardinalOutputs)
  if (!verifiedCardinals.complete) consistent = false
  const strayCardinalSats = verifiedCardinals.outputs.reduce((sum, output) => sum + output.value, 0)

  const inscribedValueSats = unspentOutputs.reduce((sum, output) => sum + output.value, 0)

  return { holdings, inscribedValueSats, strayCardinalSats, consistent }
}

export async function loadHoldings(
  ord: OrdClient,
  inscriptionsAddress: string,
): Promise<HoldingsSnapshot> {
  const first = await loadOnce(ord, inscriptionsAddress)
  if (first.consistent) {
    return {
      inscriptions: first.holdings,
      inscribedValueSats: first.inscribedValueSats,
      strayCardinalSats: first.strayCardinalSats,
      stale: false,
    }
  }

  // Replica skew or a mid-refresh transfer: retry the whole cycle once.
  const second = await loadOnce(ord, inscriptionsAddress)
  return {
    inscriptions: second.holdings,
    inscribedValueSats: second.inscribedValueSats,
    strayCardinalSats: second.strayCardinalSats,
    stale: !second.consistent,
  }
}
