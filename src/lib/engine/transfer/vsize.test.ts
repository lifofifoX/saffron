import * as btc from '@scure/btc-signer'
import { describe, expect, it } from 'vitest'

import {
  additionalInputVbytes,
  estimateVsize,
  feeForVsize,
  multisigInputVbytes,
  multisigWitnessScriptBytes,
} from './vsize'

const P2WSH_SCRIPT = btc.OutScript.encode({ type: 'wsh', hash: new Uint8Array(32) })

describe('p2wsh multisig vsize', () => {
  it('computes the sortedmulti witness script size', () => {
    expect(multisigWitnessScriptBytes(3)).toBe(105)
    expect(multisigWitnessScriptBytes(2)).toBe(71)
  })

  it('estimates 2-of-3 input weight near the known value', () => {
    const vbytes = multisigInputVbytes(2, 3)
    expect(vbytes).toBeGreaterThan(100)
    expect(vbytes).toBeLessThan(110)
  })

  it('scales monotonically with quorum size and input count', () => {
    for (const [m, n] of [
      [1, 2],
      [2, 2],
      [2, 3],
      [3, 5],
    ] as const) {
      const one = estimateVsize({
        inputCount: 1,
        outputScripts: [P2WSH_SCRIPT, P2WSH_SCRIPT],
        requiredSigners: m,
        totalSigners: n,
      })
      const five = estimateVsize({
        inputCount: 5,
        outputScripts: [P2WSH_SCRIPT, P2WSH_SCRIPT],
        requiredSigners: m,
        totalSigners: n,
      })

      expect(five).toBeGreaterThan(one)
      expect(five - one).toBe(Math.ceil(4 * multisigInputVbytes(m, n)))
    }
  })

  it('rounds fees like ord FeeRate::fee', () => {
    expect(feeForVsize(2.5, 211)).toBe(528)
    expect(feeForVsize(1, 100)).toBe(100)
    expect(() => feeForVsize(-1, 100)).toThrow()
  })

  it('exposes marginal input cost as a ceiling', () => {
    expect(additionalInputVbytes(2, 3)).toBe(Math.ceil(multisigInputVbytes(2, 3)))
  })
})
