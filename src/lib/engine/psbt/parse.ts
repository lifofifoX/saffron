import { base64 } from '@scure/base'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as btc from '@scure/btc-signer'
import { assertPsbtDecodedSize, assertPsbtTextSize } from '$lib/security/input-limits'

const PSBT_MAGIC_BASE64_PREFIX = 'cHNidP'
const PSBT_MAGIC_HEX_PREFIX = '70736274ff'

export type ParsedPsbt = {
  transaction: btc.Transaction
  originalVersion: 0 | 2
  workingBase64: string
}

export const LIBERAL_PSBT_OPTIONS = {
  allowUnknownInputs: true,
  allowUnknownOutputs: true,
  disableScriptCheck: true,
  allowLegacyWitnessUtxo: true,
} as const

export function psbtBytesFromUserInput(raw: string | Uint8Array): Uint8Array {
  if (raw instanceof Uint8Array) {
    assertPsbtDecodedSize(raw.length)
    return raw
  }

  assertPsbtTextSize(raw.length)
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error('empty PSBT input')

  if (trimmed.startsWith(PSBT_MAGIC_BASE64_PREFIX)) {
    const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0
    const estimatedBytes = Math.floor((trimmed.length * 3) / 4) - padding
    assertPsbtDecodedSize(estimatedBytes)
    const decoded = base64.decode(trimmed)
    assertPsbtDecodedSize(decoded.length)
    return decoded
  }

  const hexCandidate = trimmed.toLowerCase().replace(/\s+/g, '')
  if (hexCandidate.startsWith(PSBT_MAGIC_HEX_PREFIX) && /^[0-9a-f]+$/.test(hexCandidate)) {
    assertPsbtDecodedSize(Math.ceil(hexCandidate.length / 2))
    const decoded = hexToBytes(hexCandidate)
    assertPsbtDecodedSize(decoded.length)
    return decoded
  }

  throw new Error('not a recognizable PSBT (expected base64 or hex starting with the PSBT magic)')
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  const first = bytes[offset]
  if (first === undefined) throw new Error('truncated PSBT')
  if (first < 0xfd) return { value: first, next: offset + 1 }
  if (first === 0xfd) {
    return { value: (bytes[offset + 1] ?? 0) | ((bytes[offset + 2] ?? 0) << 8), next: offset + 3 }
  }

  throw new Error('unsupported PSBT key length')
}

function readPsbtVersion(bytes: Uint8Array): 0 | 2 {
  // Walk the global key-value map looking for PSBT_GLOBAL_VERSION (0xfb),
  // which only v2 PSBTs carry.
  let offset = 5

  while (offset < bytes.length) {
    const keyLength = readVarint(bytes, offset)
    if (keyLength.value === 0) break

    const keyType = bytes[keyLength.next]
    if (keyType === 0xfb) return 2

    const valueOffset = keyLength.next + keyLength.value
    const valueLength = readVarint(bytes, valueOffset)
    offset = valueLength.next + valueLength.value
  }

  return 0
}

export function parsePsbt(raw: string | Uint8Array): ParsedPsbt {
  const bytes = psbtBytesFromUserInput(raw)
  if (bytes.length < 10 || bytesToHex(bytes.slice(0, 5)) !== PSBT_MAGIC_HEX_PREFIX) {
    throw new Error('input does not start with the PSBT magic bytes')
  }

  const originalVersion = readPsbtVersion(bytes)
  const transaction = btc.Transaction.fromPSBT(bytes, LIBERAL_PSBT_OPTIONS)

  return {
    transaction,
    originalVersion,
    workingBase64: base64.encode(transaction.toPSBT(0)),
  }
}
