import type { OrdClient } from '$lib/clients/ord'
import {
  matchInscriptionDetails,
  OrdIntegrityError,
  type ExpectedInscription,
} from '$lib/data/ord-integrity'

type LookupResult = { id: string; offsetSats: number }[]

export async function getInscriptionsAtOutpoint(
  ord: OrdClient,
  txid: string,
  vout: number,
  expectedValueSats: number,
): Promise<LookupResult> {
  const outpoint = `${txid}:${vout}`

  const output = await ord.getOutput(outpoint)
  if (output.outpoint !== outpoint) {
    throw new OrdIntegrityError(`ord returned output ${output.outpoint}, expected ${outpoint}`)
  }
  if (!Array.isArray(output.inscriptions)) {
    throw new OrdIntegrityError(`ord did not explicitly report inscriptions for ${outpoint}`)
  }
  if (output.value !== expectedValueSats) {
    throw new OrdIntegrityError(
      `ord returned value ${output.value} for ${outpoint}, expected ${expectedValueSats}`,
    )
  }

  const ids = output.inscriptions

  if (ids.length === 0) {
    return []
  }

  const details = await ord.getInscriptionsBulk(ids)
  const expected: ExpectedInscription[] = ids.map((id) => ({
    id,
    outpoint,
    outputValue: output.value,
  }))
  const found = matchInscriptionDetails(expected, details).map(({ id, offsetSats }) => ({
    id,
    offsetSats,
  }))

  return found
}
