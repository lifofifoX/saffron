import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as btc from '@scure/btc-signer'

export function addressToScriptHex(address: string): string {
  const decoded = btc.Address(btc.NETWORK).decode(address.trim())
  if (!decoded) throw new Error('unrecognized address')

  return bytesToHex(btc.OutScript.encode(decoded))
}

export function validateRecipientAddress(address: string): string | null {
  const trimmed = address.trim()
  if (trimmed.length === 0) return 'Enter a recipient address.'

  try {
    addressToScriptHex(trimmed)
  } catch {
    return 'Not a valid mainnet Bitcoin address.'
  }

  return null
}

export function scriptHexToAddress(scriptHex: string): string {
  const script = hexToBytes(scriptHex)
  const decoded = btc.OutScript.decode(script)
  return btc
    .Address(btc.NETWORK)
    .encode(decoded as Parameters<ReturnType<typeof btc.Address>['encode']>[0])
}

export function isModernAddress(address: string): boolean {
  const lower = address.trim().toLowerCase()
  return lower.startsWith('bc1')
}
