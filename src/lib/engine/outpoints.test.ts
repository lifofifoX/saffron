import { describe, expect, it } from 'vitest'

import { formatOutpoint, formatSatpoint, parseOutpoint, parseSatpoint } from './outpoints'

const TXID = 'a'.repeat(64)

describe('outpoints', () => {
  it('round-trips outpoints', () => {
    const outpoint = parseOutpoint(`${TXID}:7`)
    expect(outpoint).toEqual({ txid: TXID, vout: 7 })
    expect(formatOutpoint(outpoint)).toBe(`${TXID}:7`)
  })

  it('round-trips satpoints with offsets', () => {
    const satpoint = parseSatpoint(`${TXID}:2:1234`)
    expect(satpoint).toEqual({ txid: TXID, vout: 2, offsetSats: 1234 })
    expect(formatSatpoint(satpoint)).toBe(`${TXID}:2:1234`)
  })

  it('rejects malformed values', () => {
    expect(() => parseOutpoint(TXID)).toThrow()
    expect(() => parseOutpoint(`${TXID}:x`)).toThrow()
    expect(() => parseOutpoint(`${TXID.slice(1)}:0`)).toThrow()
    expect(() => parseOutpoint(`${TXID}:01`)).toThrow()
    expect(() => parseSatpoint(`${TXID}:0`)).toThrow()
    expect(() => parseSatpoint(`${TXID}:0:-1`)).toThrow()
  })
})
