import * as btc from '@scure/btc-signer'
import { describe, expect, it } from 'vitest'

import { TransferError } from './errors'
import { planSimpleTransfer, type SimpleTransferRequest } from './simple'
import { feeForVsize } from './vsize'

const VAULT_SCRIPT = Buffer.from(
  btc.OutScript.encode({ type: 'wsh', hash: new Uint8Array(32).fill(1) }),
).toString('hex')
const WALLET_CHANGE = Buffer.from(
  btc.OutScript.encode({ type: 'wpkh', hash: new Uint8Array(20).fill(2) }),
).toString('hex')
const GENERATOR_X_ONLY = Uint8Array.from(
  Buffer.from('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
)
const RECIPIENT = Buffer.from(
  btc.OutScript.encode({ type: 'tr', pubkey: GENERATOR_X_ONLY }),
).toString('hex')

const TXID_A = 'a'.repeat(64)
const TXID_B = 'b'.repeat(64)
const TXID_C = 'c'.repeat(64)

function baseRequest(overrides: Partial<SimpleTransferRequest> = {}): SimpleTransferRequest {
  return {
    items: [
      {
        outpoint: { txid: TXID_A, vout: 0 },
        valueSats: 7_777,
        inscriptionIds: ['insc-a'],
        recipientScriptHex: RECIPIENT,
      },
    ],
    quorum: { requiredSigners: 2, totalSigners: 3 },
    inscriptionsScriptHex: VAULT_SCRIPT,
    feeWallet: {
      kind: 'p2wpkh',
      cardinalUtxos: [
        { outpoint: { txid: TXID_B, vout: 1 }, valueSats: 50_000 },
        { outpoint: { txid: TXID_C, vout: 0 }, valueSats: 1_200 },
      ],
      changeScriptHex: WALLET_CHANGE,
    },
    feeRateSatVb: 8,
    ...overrides,
  }
}

describe('planSimpleTransfer', () => {
  it('maps several vault items to matching indexes in order', () => {
    const plan = planSimpleTransfer(
      baseRequest({
        items: [
          {
            outpoint: { txid: TXID_A, vout: 0 },
            valueSats: 7_777,
            inscriptionIds: ['insc-a'],
            recipientScriptHex: RECIPIENT,
          },
          {
            outpoint: { txid: TXID_A, vout: 1 },
            valueSats: 546,
            inscriptionIds: ['insc-b', 'insc-b2'],
            recipientScriptHex: RECIPIENT,
          },
        ],
      }),
    )

    expect(plan.vaultInputs).toHaveLength(2)
    expect(plan.outputs[0]).toEqual({ scriptHex: RECIPIENT, valueSats: 7_777, role: 'recipient' })
    expect(plan.outputs[1]).toEqual({ scriptHex: RECIPIENT, valueSats: 546, role: 'recipient' })
    expect(plan.vaultInputs[0]?.outpoint.vout).toBe(0)
    expect(plan.vaultInputs[1]?.outpoint.vout).toBe(1)
  })

  it('preserves vault values at matching indexes with wallet-funded fees', () => {
    const plan = planSimpleTransfer(baseRequest())

    expect(plan.vaultInputs).toHaveLength(1)
    expect(plan.outputs[0]).toEqual({ scriptHex: RECIPIENT, valueSats: 7_777, role: 'recipient' })
    expect(plan.outputs.at(-1)?.role).toBe('walletChange')

    const totalIn = [...plan.vaultInputs, ...plan.feeInputs].reduce(
      (sum, input) => sum + input.valueSats,
      0,
    )
    const totalOut = plan.outputs.reduce((sum, output) => sum + output.valueSats, 0)
    expect(totalIn - totalOut).toBe(plan.feeSats)
    expect(plan.feeSats).toBe(feeForVsize(8, plan.vsize))

    // The fee never touches vault sats.
    const feeTotal = plan.feeInputs.reduce((sum, input) => sum + input.valueSats, 0)
    const change = plan.outputs.at(-1)?.valueSats ?? 0
    expect(feeTotal - change).toBe(plan.feeSats)
  })

  it('moves multiple UTXOs to same-index recipients, offsets and cohabitants intact', () => {
    const plan = planSimpleTransfer(
      baseRequest({
        items: [
          {
            outpoint: { txid: TXID_A, vout: 0 },
            valueSats: 10_000,
            inscriptionIds: ['a1', 'a2-offset-9000'],
            recipientScriptHex: RECIPIENT,
          },
          {
            outpoint: { txid: TXID_A, vout: 1 },
            valueSats: 546,
            inscriptionIds: ['b1'],
            recipientScriptHex: WALLET_CHANGE.replace('14', '14').replace(
              WALLET_CHANGE.slice(4, 8),
              'abcd',
            ),
          },
        ],
      }),
    )

    expect(plan.outputs[0]?.valueSats).toBe(10_000)
    expect(plan.outputs[1]?.valueSats).toBe(546)
    expect(plan.feeInputs.length).toBeGreaterThan(0)
  })

  it('rejects sending to the vault or the fee wallet itself', () => {
    expect(() =>
      planSimpleTransfer(
        baseRequest({
          items: [
            {
              outpoint: { txid: TXID_A, vout: 0 },
              valueSats: 1_000,
              inscriptionIds: [],
              recipientScriptHex: VAULT_SCRIPT,
            },
          ],
        }),
      ),
    ).toThrow(TransferError)

    expect(() =>
      planSimpleTransfer(
        baseRequest({
          items: [
            {
              outpoint: { txid: TXID_A, vout: 0 },
              valueSats: 1_000,
              inscriptionIds: [],
              recipientScriptHex: WALLET_CHANGE,
            },
          ],
        }),
      ),
    ).toThrow(TransferError)
  })

  it('errors when the fee wallet cannot cover the fee plus dust change', () => {
    expect(() =>
      planSimpleTransfer(
        baseRequest({
          feeWallet: {
            kind: 'p2wpkh',
            cardinalUtxos: [{ outpoint: { txid: TXID_B, vout: 1 }, valueSats: 200 }],
            changeScriptHex: WALLET_CHANGE,
          },
        }),
      ),
    ).toThrow(/NOT_ENOUGH|cardinal/i)
  })

  it('accounts fee-input sizes per wallet kind', () => {
    const p2tr = planSimpleTransfer(
      baseRequest({
        feeWallet: {
          kind: 'p2tr',
          cardinalUtxos: [{ outpoint: { txid: TXID_B, vout: 1 }, valueSats: 50_000 }],
          changeScriptHex: WALLET_CHANGE,
        },
      }),
    )
    const p2sh = planSimpleTransfer(
      baseRequest({
        feeWallet: {
          kind: 'p2sh-p2wpkh',
          cardinalUtxos: [{ outpoint: { txid: TXID_B, vout: 1 }, valueSats: 50_000 }],
          changeScriptHex: WALLET_CHANGE,
        },
      }),
    )

    expect(p2sh.vsize).toBeGreaterThan(p2tr.vsize)
    expect(p2sh.feeSats).toBeGreaterThan(p2tr.feeSats)
  })

  it('rejects fee rates above the product safety limit', () => {
    expect(() => planSimpleTransfer(baseRequest({ feeRateSatVb: 500.1 }))).toThrow(/safety limit/)
  })
})
