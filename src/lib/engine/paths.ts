import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/utils.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

export const HARDENED_OFFSET = 0x80000000

export function bip32PathToSequence(path: string): number[] {
  const trimmed = path.trim()
  if (trimmed === '' || trimmed === 'm') return []

  const withoutPrefix = trimmed.startsWith('m/') ? trimmed.slice(2) : trimmed
  return withoutPrefix.split('/').map((segment) => {
    const hardened = segment.endsWith("'") || segment.endsWith('h')
    const indexRaw = hardened ? segment.slice(0, -1) : segment

    const index = Number.parseInt(indexRaw, 10)
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= HARDENED_OFFSET ||
      String(index) !== indexRaw
    ) {
      throw new Error(`invalid bip32 path segment: ${segment}`)
    }

    return hardened ? index + HARDENED_OFFSET : index
  })
}

export function bip32SequenceToPath(sequence: number[]): string {
  const segments = sequence.map((value) => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error(`invalid bip32 sequence value: ${value}`)
    }

    return value >= HARDENED_OFFSET ? `${value - HARDENED_OFFSET}'` : String(value)
  })

  return ['m', ...segments].join('/')
}

export function appendBip32Suffix(accountPath: string, branch: number, index: number): string {
  const base = accountPath.trim().replace(/\/+$/, '')
  return `${base}/${branch}/${index}`
}

export function xfpToFingerprintNumber(xfp: string): number {
  if (!/^[0-9a-f]{8}$/i.test(xfp)) throw new Error(`invalid xfp: ${xfp}`)
  return Number(bytesToNumberBE(hexToBytes(xfp.toLowerCase())))
}

export function fingerprintNumberToXfp(fingerprint: number): string {
  if (!Number.isInteger(fingerprint) || fingerprint < 0 || fingerprint > 0xffffffff) {
    throw new Error(`invalid fingerprint: ${fingerprint}`)
  }

  return bytesToHex(numberToBytesBE(fingerprint, 4))
}
