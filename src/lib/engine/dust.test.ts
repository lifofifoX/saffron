import * as btc from '@scure/btc-signer'
import { describe, expect, it } from 'vitest'

import { dustThresholdSatsForScript, scriptOutputVsize } from './dust'

const P2WPKH_SCRIPT = btc.OutScript.encode({ type: 'wpkh', hash: new Uint8Array(20) })
const P2WSH_SCRIPT = btc.OutScript.encode({ type: 'wsh', hash: new Uint8Array(32) })
const P2TR_SCRIPT = btc.OutScript.encode({ type: 'tr', pubkey: new Uint8Array(32).fill(2) })
const P2PKH_SCRIPT = btc.OutScript.encode({ type: 'pkh', hash: new Uint8Array(20) })

describe('dust thresholds', () => {
  it('matches Bitcoin Core policy values per script type', () => {
    expect(dustThresholdSatsForScript(P2PKH_SCRIPT)).toBe(546)
    expect(dustThresholdSatsForScript(P2WPKH_SCRIPT)).toBe(294)
    expect(dustThresholdSatsForScript(P2WSH_SCRIPT)).toBe(330)
    expect(dustThresholdSatsForScript(P2TR_SCRIPT)).toBe(330)
  })

  it('computes serialized output sizes', () => {
    expect(scriptOutputVsize(P2WPKH_SCRIPT)).toBe(31)
    expect(scriptOutputVsize(P2WSH_SCRIPT)).toBe(43)
    expect(scriptOutputVsize(P2PKH_SCRIPT)).toBe(34)
  })
})
