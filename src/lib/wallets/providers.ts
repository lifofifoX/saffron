import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { base64 } from '@scure/base'

import { addressToScriptHex } from '$lib/engine/address'
import type { FeeWalletKind } from '$lib/engine/transfer/simple'
import { feeWalletInputFields } from '$lib/engine/transfer/simple-to-psbt'

const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff]

// The extension's return value is untrusted input: require well-formed
// encoding and the PSBT magic before anything downstream parses it.
function decodeSignedPsbt(raw: string, encoding: 'hex' | 'base64', source: string): Uint8Array {
  let bytes: Uint8Array
  try {
    bytes = encoding === 'hex' ? hexToBytes(raw) : base64.decode(raw)
  } catch {
    throw new Error(`${source} returned a malformed signing response`)
  }

  if (bytes.length < 5 || !PSBT_MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new Error(`${source} returned data that is not a PSBT`)
  }

  return bytes
}

export type FeeWalletProvider = 'xverse' | 'unisat'

export type ConnectedFeeWallet = {
  provider: FeeWalletProvider
  kind: FeeWalletKind
  address: string
  publicKeyHex: string
}

// x-only (taproot) or compressed pubkey hex.
const PUBLIC_KEY_RE = /^(?:[0-9a-f]{64}|0[23][0-9a-f]{64})$/i

// Classifies and fully validates a wallet-supplied address: it must decode as
// a real mainnet address, not merely carry a known prefix.
export function feeWalletKindForAddress(address: string): FeeWalletKind {
  const lower = address.trim().toLowerCase()

  try {
    addressToScriptHex(lower)
  } catch {
    throw new Error('the wallet returned an address that does not decode as mainnet Bitcoin')
  }

  if (lower.startsWith('bc1p')) return 'p2tr'
  if (lower.startsWith('bc1q')) return 'p2wpkh'
  if (lower.startsWith('3')) return 'p2sh-p2wpkh'

  throw new Error(`unsupported fee wallet address type: ${address.slice(0, 6)}…`)
}

function normalizePublicKey(address: string, publicKey: string): string {
  const trimmed = publicKey.trim().toLowerCase()
  if (!PUBLIC_KEY_RE.test(trimmed)) {
    throw new Error('wallet returned an invalid public key')
  }

  if (address.toLowerCase().startsWith('bc1p') && trimmed.length === 66) {
    return trimmed.slice(2)
  }

  return trimmed
}

function connectedFeeWallet(
  provider: FeeWalletProvider,
  address: string,
  publicKey: string,
): ConnectedFeeWallet {
  const wallet = {
    provider,
    kind: feeWalletKindForAddress(address),
    address,
    publicKeyHex: normalizePublicKey(address, publicKey),
  }

  feeWalletInputFields(wallet)
  return wallet
}

type UnisatApi = {
  requestAccounts: () => Promise<string[]>
  getPublicKey: () => Promise<string>
  signPsbt?: (
    psbtHex: string,
    options: {
      autoFinalized: false
      toSignInputs: {
        index: number
        address: string
        publicKey?: string
        disableTweakSigner?: boolean
      }[]
    },
  ) => Promise<string>
}

function unisatApi(): UnisatApi {
  const api = (window as Window & { unisat?: UnisatApi }).unisat
  if (!api) throw new Error('Unisat is not installed in this browser.')
  return api
}

export function detectProviders(): Record<FeeWalletProvider, boolean> {
  if (typeof window === 'undefined') return { xverse: false, unisat: false }

  const win = window as Window & {
    BitcoinProvider?: object
    XverseProviders?: object
    unisat?: object
  }
  return {
    xverse: Boolean(win.BitcoinProvider || win.XverseProviders),
    unisat: Boolean(win.unisat),
  }
}

export async function connectXverse(): Promise<ConnectedFeeWallet> {
  const { AddressPurpose, request } = await import('sats-connect')

  const response = await request('wallet_connect', {
    addresses: [AddressPurpose.Payment],
    message: 'Connect to saffron to pay transfer fees',
  })

  if (response.status !== 'success') {
    throw new Error('Xverse connection was declined.')
  }

  const payment = response.result.addresses.find(
    (entry) => entry.purpose === AddressPurpose.Payment,
  )
  if (!payment?.address || !payment.publicKey) {
    throw new Error('Xverse did not return a payment address.')
  }

  return connectedFeeWallet('xverse', payment.address, payment.publicKey)
}

export async function connectUnisat(): Promise<ConnectedFeeWallet> {
  const api = unisatApi()

  const accounts = await api.requestAccounts()
  const address = accounts[0]
  if (!address) throw new Error('Unisat did not return an account.')

  const publicKey = await api.getPublicKey()

  return connectedFeeWallet('unisat', address, publicKey)
}

export async function connectFeeWallet(provider: FeeWalletProvider): Promise<ConnectedFeeWallet> {
  return provider === 'xverse' ? connectXverse() : connectUnisat()
}

// Asks the extension to sign exactly the fee inputs it owns; returns the
// signed PSBT for saffron to verify and merge. autoFinalized stays off so the
// coordinated finalize happens in one place.
export async function signWithFeeWallet(
  wallet: ConnectedFeeWallet,
  psbtBase64: string,
  inputIndexes: number[],
): Promise<string> {
  if (inputIndexes.length === 0) throw new Error('no fee inputs to sign')

  if (wallet.provider === 'unisat') {
    const api = unisatApi()
    if (typeof api.signPsbt !== 'function') {
      throw new Error('This Unisat version cannot sign PSBTs.')
    }

    const psbtHex = bytesToHex(base64.decode(psbtBase64))
    const signedHex = await api.signPsbt(psbtHex, {
      autoFinalized: false,
      toSignInputs: inputIndexes.map((index) => ({
        index,
        address: wallet.address,
        publicKey: wallet.publicKeyHex,
      })),
    })

    return base64.encode(decodeSignedPsbt(signedHex, 'hex', 'Unisat'))
  }

  const { BitcoinNetworkType, signTransaction } = await import('sats-connect')

  const signedBase64 = await new Promise<string>((resolve, reject) => {
    void signTransaction({
      payload: {
        network: { type: BitcoinNetworkType.Mainnet },
        message: 'Pay the network fee for a saffron vault transfer',
        psbtBase64,
        broadcast: false,
        inputsToSign: [{ address: wallet.address, signingIndexes: inputIndexes }],
      },
      onFinish: (response) => resolve(response.psbtBase64),
      onCancel: () => reject(new Error('Signing was cancelled in Xverse.')),
    }).catch(reject)
  })

  return base64.encode(decodeSignedPsbt(signedBase64, 'base64', 'Xverse'))
}
