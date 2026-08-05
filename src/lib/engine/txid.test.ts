import * as btc from '@scure/btc-signer'
import { describe, expect, it } from 'vitest'

import { txidOfRawTx } from './txid'

// Real mainnet transaction, segwit-serialized as esplora returns it.
const SEGWIT_TX_HEX =
  '02000000000102e34b456d7d5c5a110de7365155b0d12360a232ca17bbce42858a7d826b4dcde70000000000fdffffff67da5c74a509cd65f871874f2e714843a0ab8a1f75f5c251c57416c0a315ad930600000000fdffffff024a010000000000002200207735487a1018a05e1d3d5f7e726ab35ed45dc7a86b9ceec9127c340c0aa340fdb1a4140000000000160014b90161cc7c5751d3263aee1111b45b92daa48cf3014039ba2a509e7f19bd8b1c1069c364f3c9193140c87d185c5d9ab8f415310dbc47f48328f60f8e6059057a559a0892435e24bf807f56f67cda2fa050ee0871e1ed0247304402201dd30c3e65a9c75d54920274d27e1c1e476554922a0120e16e19de44df05d3bd022036a04aef71dd7f11fa9ed7402b3d425e91dc9c54ca7011741a8f08bd9db76228012103d0af24420d3c712f8d709bd11079b12f2814c753e58af98d5d805b85b866eb4100000000'
const SEGWIT_TXID = 'd4a37478efe899e5e7a80a1b9e7c5bc047122f829eaa6444bd3f7f1df7155d68'

describe('txidOfRawTx', () => {
  it('computes the txid of a segwit-serialized transaction, not the wtxid', () => {
    const bytes = Uint8Array.from(Buffer.from(SEGWIT_TX_HEX, 'hex'))
    expect(txidOfRawTx(bytes)).toBe(SEGWIT_TXID)
  })

  it('matches scure Transaction.id for the same bytes', () => {
    const bytes = Uint8Array.from(Buffer.from(SEGWIT_TX_HEX, 'hex'))
    const parsed = btc.Transaction.fromRaw(bytes, {
      allowUnknownOutputs: true,
      allowUnknownInputs: true,
    })
    expect(txidOfRawTx(bytes)).toBe(parsed.id)
  })

  it('handles legacy-serialized transactions unchanged', () => {
    const decoded = btc.RawTx.decode(Uint8Array.from(Buffer.from(SEGWIT_TX_HEX, 'hex')))
    const legacyBytes = btc.RawTx.encode({
      version: decoded.version,
      segwitFlag: false,
      inputs: decoded.inputs,
      outputs: decoded.outputs,
      lockTime: decoded.lockTime,
    })
    expect(txidOfRawTx(legacyBytes)).toBe(SEGWIT_TXID)
  })
})
