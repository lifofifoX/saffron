import { describe, expect, it } from 'vitest'

import {
  assertPsbtDecodedSize,
  assertPsbtFileSize,
  assertPsbtTextSize,
  assertWalletBackupFileSize,
  assertWalletBackupTextSize,
  INPUT_LIMITS,
} from './input-limits'

describe('untrusted input limits', () => {
  const cases = [
    ['decoded PSBT', assertPsbtDecodedSize, INPUT_LIMITS.psbtDecodedBytes],
    ['PSBT text', assertPsbtTextSize, INPUT_LIMITS.psbtTextCharacters],
    ['PSBT file', assertPsbtFileSize, INPUT_LIMITS.psbtFileBytes],
    ['vault backup text', assertWalletBackupTextSize, INPUT_LIMITS.walletBackupTextCharacters],
    ['vault backup file', assertWalletBackupFileSize, INPUT_LIMITS.walletBackupFileBytes],
  ] as const

  it.each(cases)('accepts %s at the product limit', (_label, assertLimit, maximum) => {
    expect(() => assertLimit(maximum)).not.toThrow()
  })

  it.each(cases)('rejects %s one unit above the product limit', (_label, assertLimit, maximum) => {
    expect(() => assertLimit(maximum + 1)).toThrow(/too large/)
  })

  it('rejects invalid size metadata', () => {
    expect(() => assertPsbtFileSize(-1)).toThrow(/invalid/)
    expect(() => assertPsbtFileSize(Number.POSITIVE_INFINITY)).toThrow(/invalid/)
  })
})
