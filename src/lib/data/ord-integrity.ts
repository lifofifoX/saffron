import type { OrdInscription, OrdOutput } from '$lib/clients/ord-contracts'
import { parseSatpoint } from '$lib/engine/outpoints'

export class OrdIntegrityError extends Error {}

export type ExpectedInscription = {
  id: string
  outpoint: string
  outputValue: number
}

export type MatchedInscription = ExpectedInscription & {
  detail: OrdInscription
  offsetSats: number
}

function isExplicitlyEmptyRunes(runes: OrdOutput['runes']): boolean {
  if (Array.isArray(runes)) return runes.length === 0
  return runes !== null && runes !== undefined && Object.keys(runes).length === 0
}

// A `type=cardinal` route is only a hint from the server. Require the object
// itself to explicitly prove that both inscription and rune collections are
// present and empty before it can fund fees or contribute to cardinal totals.
export function isExplicitCardinalOutput(output: OrdOutput): boolean {
  return (
    Array.isArray(output.inscriptions) &&
    output.inscriptions.length === 0 &&
    isExplicitlyEmptyRunes(output.runes)
  )
}

export function verifiedCardinalOutputs(outputs: readonly OrdOutput[]): {
  outputs: OrdOutput[]
  complete: boolean
} {
  const byOutpoint = new Map<string, OrdOutput>()
  const seen = new Set<string>()
  let complete = true

  for (const output of outputs) {
    if (seen.has(output.outpoint)) {
      byOutpoint.delete(output.outpoint)
      complete = false
      continue
    }
    seen.add(output.outpoint)

    if (output.spent) continue
    if (!isExplicitCardinalOutput(output)) {
      complete = false
      continue
    }

    byOutpoint.set(output.outpoint, output)
  }

  return { outputs: [...byOutpoint.values()], complete }
}

// Bulk inscription responses may be reordered, but they must be an exact
// one-to-one answer for the advertised ids and locations. Returning a subset
// is not safe: callers could otherwise cache or display an incomplete view.
export function matchInscriptionDetails(
  expected: readonly ExpectedInscription[],
  details: readonly OrdInscription[],
): MatchedInscription[] {
  const expectedById = new Map<string, ExpectedInscription>()
  for (const entry of expected) {
    if (expectedById.has(entry.id)) {
      throw new OrdIntegrityError(`ord advertised duplicate inscription ${entry.id}`)
    }
    expectedById.set(entry.id, entry)
  }

  if (details.length !== expectedById.size) {
    throw new OrdIntegrityError(
      `ord returned ${details.length} inscription details for ${expectedById.size} advertised ids`,
    )
  }

  const matched: MatchedInscription[] = []
  const seen = new Set<string>()

  for (const detail of details) {
    if (seen.has(detail.id)) {
      throw new OrdIntegrityError(`ord returned duplicate details for inscription ${detail.id}`)
    }
    seen.add(detail.id)

    const advertised = expectedById.get(detail.id)
    if (!advertised) {
      throw new OrdIntegrityError(`ord returned unexpected inscription ${detail.id}`)
    }

    let satpoint: ReturnType<typeof parseSatpoint>
    try {
      satpoint = parseSatpoint(detail.satpoint)
    } catch (error) {
      throw new OrdIntegrityError(`ord returned an invalid satpoint for inscription ${detail.id}`, {
        cause: error,
      })
    }

    const detailOutpoint = `${satpoint.txid}:${satpoint.vout}`
    if (detailOutpoint !== advertised.outpoint) {
      throw new OrdIntegrityError(
        `ord placed inscription ${detail.id} at ${detailOutpoint}, expected ${advertised.outpoint}`,
      )
    }
    if (satpoint.offsetSats >= advertised.outputValue) {
      throw new OrdIntegrityError(
        `ord placed inscription ${detail.id} outside its ${advertised.outputValue}-sat output`,
      )
    }
    if (
      detail.value !== null &&
      detail.value !== undefined &&
      detail.value !== advertised.outputValue
    ) {
      throw new OrdIntegrityError(
        `ord returned a mismatched output value for inscription ${detail.id}`,
      )
    }

    matched.push({ ...advertised, detail, offsetSats: satpoint.offsetSats })
  }

  if (seen.size !== expectedById.size) {
    throw new OrdIntegrityError('ord omitted advertised inscription details')
  }

  return matched
}
