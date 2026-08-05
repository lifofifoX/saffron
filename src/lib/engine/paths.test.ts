import { describe, expect, it } from 'vitest'

import {
  appendBip32Suffix,
  bip32PathToSequence,
  bip32SequenceToPath,
  fingerprintNumberToXfp,
  HARDENED_OFFSET,
  xfpToFingerprintNumber,
} from './paths'

describe('bip32 paths', () => {
  it('parses the multisig key origin path', () => {
    expect(bip32PathToSequence("m/48'/0'/0'/2'")).toEqual([
      48 + HARDENED_OFFSET,
      HARDENED_OFFSET,
      HARDENED_OFFSET,
      2 + HARDENED_OFFSET,
    ])
  })

  it('round-trips paths including unhardened suffixes', () => {
    const path = "m/48'/0'/0'/2'/1/0"
    expect(bip32SequenceToPath(bip32PathToSequence(path))).toBe(path)
  })

  it('appends branch and index suffixes', () => {
    expect(appendBip32Suffix("m/48'/0'/0'/2'", 1, 0)).toBe("m/48'/0'/0'/2'/1/0")
  })

  it('rejects invalid segments', () => {
    expect(() => bip32PathToSequence('m/x')).toThrow()
    expect(() => bip32PathToSequence(`m/${HARDENED_OFFSET}`)).toThrow()
  })
})

describe('xfp conversion', () => {
  it('round-trips fingerprints', () => {
    expect(xfpToFingerprintNumber('f57ec65d')).toBe(0xf57ec65d)
    expect(fingerprintNumberToXfp(0xf57ec65d)).toBe('f57ec65d')
    expect(fingerprintNumberToXfp(0x0000abcd)).toBe('0000abcd')
  })

  it('rejects malformed fingerprints', () => {
    expect(() => xfpToFingerprintNumber('123')).toThrow()
    expect(() => xfpToFingerprintNumber('gggggggg')).toThrow()
  })
})
