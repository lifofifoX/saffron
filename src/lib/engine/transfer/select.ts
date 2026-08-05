import { formatOutpoint, type Outpoint } from '$lib/engine/outpoints'

import { TransferError } from './errors'

export type CardinalUtxo = {
  outpoint: Outpoint
  valueSats: number
}

// Port of ord's select_cardinal_utxo: closest absolute difference to the
// target, with a preference tier for staying under (padding) or over (fees).
export function selectCardinalUtxo(
  pool: Map<string, CardinalUtxo>,
  targetValue: number,
  preferUnder: boolean,
): CardinalUtxo {
  let bestMatch: CardinalUtxo | null = null

  for (const utxo of pool.values()) {
    if (bestMatch === null) {
      bestMatch = utxo
      continue
    }

    const bestValue = bestMatch.valueSats
    const currentValue = utxo.valueSats

    const absDiff = (a: number, b: number) => Math.abs(a - b)
    const isCloser = absDiff(currentValue, targetValue) < absDiff(bestValue, targetValue)

    const notPreferenceButCloser = preferUnder
      ? bestValue > targetValue && isCloser
      : bestValue < targetValue && isCloser

    const isPreferenceAndCloser = preferUnder
      ? currentValue <= targetValue && isCloser
      : currentValue >= targetValue && isCloser

    const newlyMeetsPreference = preferUnder
      ? bestValue > targetValue && currentValue <= targetValue
      : bestValue < targetValue && currentValue >= targetValue

    if (isPreferenceAndCloser || notPreferenceButCloser || newlyMeetsPreference) {
      bestMatch = utxo
    }
  }

  if (!bestMatch) {
    throw new TransferError('NOT_ENOUGH_CARDINAL_UTXOS', 'no cardinal utxos available')
  }

  pool.delete(formatOutpoint(bestMatch.outpoint))
  return bestMatch
}
