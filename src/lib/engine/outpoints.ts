export type Outpoint = {
  txid: string
  vout: number
}

export type SatPoint = Outpoint & {
  offsetSats: number
}

const TXID_PATTERN = /^[0-9a-f]{64}$/

export function isValidTxid(value: string): boolean {
  return TXID_PATTERN.test(value)
}

export function formatOutpoint(outpoint: Outpoint): string {
  return `${outpoint.txid}:${outpoint.vout}`
}

export function parseOutpoint(value: string): Outpoint {
  const parts = value.split(':')
  if (parts.length !== 2) throw new Error(`invalid outpoint: ${value}`)

  const [txid, voutRaw] = parts
  if (!txid || !voutRaw || !isValidTxid(txid)) throw new Error(`invalid outpoint txid: ${value}`)

  const vout = Number.parseInt(voutRaw, 10)
  if (!Number.isInteger(vout) || vout < 0 || String(vout) !== voutRaw) {
    throw new Error(`invalid outpoint vout: ${value}`)
  }

  return { txid, vout }
}

export function formatSatpoint(satpoint: SatPoint): string {
  return `${satpoint.txid}:${satpoint.vout}:${satpoint.offsetSats}`
}

export function parseSatpoint(value: string): SatPoint {
  const parts = value.split(':')
  if (parts.length !== 3) throw new Error(`invalid satpoint: ${value}`)

  const [txid, voutRaw, offsetRaw] = parts
  if (!txid || !voutRaw || !offsetRaw) throw new Error(`invalid satpoint: ${value}`)
  const outpoint = parseOutpoint(`${txid}:${voutRaw}`)

  const offsetSats = Number.parseInt(offsetRaw, 10)
  if (!Number.isSafeInteger(offsetSats) || offsetSats < 0 || String(offsetSats) !== offsetRaw) {
    throw new Error(`invalid satpoint offset: ${value}`)
  }

  return { ...outpoint, offsetSats }
}

export function sameOutpoint(a: Outpoint, b: Outpoint): boolean {
  return a.txid === b.txid && a.vout === b.vout
}
