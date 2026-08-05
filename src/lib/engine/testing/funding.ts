import { sha256 } from '@noble/hashes/sha2.js'

// Minimal legacy (non-witness) transaction serializer for test funding txs —
// enough to act as a valid nonWitnessUtxo whose hash matches its txid.

type FundingOutput = {
  valueSats: number
  scriptHex: string
}

function varint(value: number): Buffer {
  if (value < 0xfd) return Buffer.from([value])
  if (value <= 0xffff) {
    const buffer = Buffer.alloc(3)
    buffer[0] = 0xfd
    buffer.writeUInt16LE(value, 1)
    return buffer
  }

  throw new Error('varint too large for test funding tx')
}

export function buildFundingTx(outputs: FundingOutput[]): { hex: string; txid: string } {
  const parts: Buffer[] = []

  const version = Buffer.alloc(4)
  version.writeUInt32LE(2)
  parts.push(version)

  parts.push(varint(1))
  parts.push(Buffer.alloc(32))
  const prevIndex = Buffer.alloc(4)
  prevIndex.writeUInt32LE(0xffffffff)
  parts.push(prevIndex)
  parts.push(varint(0))
  const sequence = Buffer.alloc(4)
  sequence.writeUInt32LE(0xffffffff)
  parts.push(sequence)

  parts.push(varint(outputs.length))
  for (const output of outputs) {
    const value = Buffer.alloc(8)
    value.writeBigUInt64LE(BigInt(output.valueSats))
    parts.push(value)

    const script = Buffer.from(output.scriptHex, 'hex')
    parts.push(varint(script.length))
    parts.push(script)
  }

  parts.push(Buffer.alloc(4))

  const raw = Buffer.concat(parts)
  const txid = Buffer.from(sha256(sha256(raw)))
    .reverse()
    .toString('hex')

  return { hex: raw.toString('hex'), txid }
}
