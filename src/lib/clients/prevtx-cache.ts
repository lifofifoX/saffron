import type { ElectrsClient } from './electrs'

const cache = new Map<string, string>()
const pending = new Map<string, Promise<string>>()

// Raw transactions are immutable, so entries never expire.
export function getPrevTxHex(client: ElectrsClient, txid: string): Promise<string> {
  const cached = cache.get(txid)
  if (cached) return Promise.resolve(cached)

  const inFlight = pending.get(txid)
  if (inFlight) return inFlight

  const request = client
    .getTxHex(txid)
    .then((hex) => {
      cache.set(txid, hex)
      return hex
    })
    .finally(() => {
      pending.delete(txid)
    })

  pending.set(txid, request)
  return request
}
