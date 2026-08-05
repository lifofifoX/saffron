import { httpRequest } from './http'
import {
  type OrdInscription,
  inscriptionIdSchema,
  ordInscriptionSchema,
  ordInscriptionsResponseSchema,
  type OrdOutput,
  ordOutputSchema,
  ordOutputsResponseSchema,
  type OrdOutputType,
} from './ord-contracts'

const UPSTREAM_HEADER = 'x-ord-upstream'
const BULK_BATCH_SIZE = 50

export class OrdClient {
  private pinnedUpstream: string | null = null

  constructor(private baseUrl: string) {}

  // Pins follow-up requests to the replica that answered first, avoiding
  // cross-node read skew behind the load-balanced fleet.
  private headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.pinnedUpstream) headers[UPSTREAM_HEADER] = this.pinnedUpstream

    return headers
  }

  private capturePin(response: Response): void {
    if (this.pinnedUpstream) return

    const upstream = response.headers.get(UPSTREAM_HEADER)
    if (upstream) this.pinnedUpstream = upstream
  }

  resetPin(): void {
    this.pinnedUpstream = null
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await httpRequest(`${this.baseUrl}${path}`, { headers: this.headers() })
    this.capturePin(response)
    return response.json() as Promise<unknown>
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const response = await httpRequest(`${this.baseUrl}${path}`, {
      method: 'POST',
      body,
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
    })
    this.capturePin(response)
    return response.json() as Promise<unknown>
  }

  async getOutputsForAddress(address: string, type: OrdOutputType): Promise<OrdOutput[]> {
    const payload = await this.getJson(`/outputs/${encodeURIComponent(address)}?type=${type}`)
    return ordOutputsResponseSchema.parse(payload)
  }

  async getOutput(outpoint: string): Promise<OrdOutput> {
    const payload = await this.getJson(`/output/${outpoint}`)
    return ordOutputSchema.parse(payload)
  }

  async getInscription(id: string): Promise<OrdInscription> {
    const expectedId = inscriptionIdSchema.parse(id)
    const payload = await this.getJson(`/inscription/${encodeURIComponent(expectedId)}`)
    const inscription = ordInscriptionSchema.parse(payload)
    if (inscription.id !== expectedId) {
      throw new Error(`ord returned inscription ${inscription.id}, expected ${expectedId}`)
    }
    return inscription
  }

  async getInscriptionsBulk(ids: string[]): Promise<OrdInscription[]> {
    const results: OrdInscription[] = []

    for (let index = 0; index < ids.length; index += BULK_BATCH_SIZE) {
      const batch = ids.slice(index, index + BULK_BATCH_SIZE)
      const payload = await this.postJson('/inscriptions', batch)
      results.push(...ordInscriptionsResponseSchema.parse(payload))
    }

    return results
  }
}
