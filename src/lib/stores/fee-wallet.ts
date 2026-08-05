import { get, writable } from 'svelte/store'

import { currentElectrsClient, currentOrdClient } from '$lib/data/clients'
import { loadPaymentUtxos, type PaymentUtxo } from '$lib/data/payments'
import {
  type ConnectedFeeWallet,
  connectFeeWallet,
  type FeeWalletProvider,
} from '$lib/wallets/providers'

// Wallet extensions reject with plain objects as often as Errors.
function describeWalletError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : typeof error === 'string'
          ? error
          : ''

  if (/reject|cancel|denied|closed/i.test(message)) return 'Connection request was canceled.'
  if (message) return message

  try {
    return JSON.stringify(error).slice(0, 200)
  } catch {
    return 'The wallet returned an unexpected error.'
  }
}

export type FeeWalletState = {
  wallet: ConnectedFeeWallet | null
  spendable: PaymentUtxo[]
  spendableSats: number
  pendingSats: number
  loading: boolean
  error: string | null
}

const initialState: FeeWalletState = {
  wallet: null,
  spendable: [],
  spendableSats: 0,
  pendingSats: 0,
  loading: false,
  error: null,
}

export const feeWallet = writable<FeeWalletState>(initialState)

export async function connectAndLoadFeeWallet(provider: FeeWalletProvider): Promise<void> {
  feeWallet.update((state) => ({ ...state, loading: true, error: null }))

  try {
    const wallet = await connectFeeWallet(provider)
    feeWallet.update((state) => ({ ...state, wallet }))
    await refreshFeeWalletSpendables()
  } catch (error) {
    feeWallet.update((state) => ({
      ...state,
      loading: false,
      error: describeWalletError(error),
    }))
  }
}

// The fee wallet's spendables go through the same safety intersection as
// everything else: electrs-confirmed AND ord-cardinal, value for value, so an
// inscription sitting in the fee wallet can never be burned as fees.
export async function refreshFeeWalletSpendables(): Promise<void> {
  const { wallet } = get(feeWallet)
  if (!wallet) return

  feeWallet.update((state) => ({ ...state, loading: true, error: null }))

  try {
    const snapshot = await loadPaymentUtxos(
      currentOrdClient(),
      currentElectrsClient(),
      wallet.address,
    )

    feeWallet.update((state) => ({
      ...state,
      spendable: snapshot.spendable,
      spendableSats: snapshot.spendableSats,
      pendingSats: snapshot.pendingSats,
      loading: false,
      error: null,
    }))
  } catch (error) {
    feeWallet.update((state) => ({
      ...state,
      loading: false,
      error: describeWalletError(error),
    }))
  }
}

export function disconnectFeeWallet(): void {
  feeWallet.set(initialState)
}
