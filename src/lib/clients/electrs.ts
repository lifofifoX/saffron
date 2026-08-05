import { z } from 'zod'

import { fetchJson, fetchText } from './http'

const txidSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-f0-9]{64}$/)

const txStatusSchema = z.looseObject({
  confirmed: z.boolean(),
  block_height: z.number().int().nonnegative().nullable().optional(),
  block_time: z.number().int().nonnegative().nullable().optional(),
})

const addressUtxoSchema = z.looseObject({
  txid: txidSchema,
  vout: z.number().int().nonnegative(),
  status: txStatusSchema,
  value: z.number().int().nonnegative(),
})

const feeEstimatesSchema = z.record(z.string().min(1), z.number().nonnegative())

export type ElectrsUtxo = z.infer<typeof addressUtxoSchema>

export class ElectrsClient {
  constructor(private baseUrl: string) {}

  async getAddressUtxos(address: string): Promise<ElectrsUtxo[]> {
    const payload = await fetchJson(`${this.baseUrl}/address/${encodeURIComponent(address)}/utxo`)
    return z.array(addressUtxoSchema).parse(payload)
  }

  async getTxHex(txid: string): Promise<string> {
    const hex = (await fetchText(`${this.baseUrl}/tx/${txid}/hex`)).trim().toLowerCase()
    if (!/^[0-9a-f]+$/.test(hex) || hex.length < 20) {
      throw new Error(`invalid raw tx hex for ${txid}`)
    }

    return hex
  }

  async getFeeEstimates(): Promise<Record<string, number>> {
    const payload = await fetchJson(`${this.baseUrl}/fee-estimates`)
    return feeEstimatesSchema.parse(payload)
  }
}
