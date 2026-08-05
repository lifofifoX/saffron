import { errorMessage } from '$lib/utils/error-message'
import { get, writable } from 'svelte/store'

import { browser } from '$app/environment'
import { currentElectrsClient, currentOrdClient } from '$lib/data/clients'
import { type FeePresets, loadFeePresets } from '$lib/data/fees'
import { loadHoldings } from '$lib/data/holdings'
import type { InscriptionHolding } from '$lib/engine/types'
import { vaultAddresses } from '$lib/stores/wallet-config'

export type VaultState = {
  inscriptions: InscriptionHolding[]
  inscribedValueSats: number
  strayCardinalSats: number
  holdingsStale: boolean
  feePresets: FeePresets
  loading: boolean
  error: string | null
  lastUpdated: number | null
}

const initialState: VaultState = {
  inscriptions: [],
  inscribedValueSats: 0,
  strayCardinalSats: 0,
  holdingsStale: false,
  feePresets: { fast: null, medium: null, slow: null },
  loading: false,
  error: null,
  lastUpdated: null,
}

export const vault = writable<VaultState>(initialState)

let inFlight: Promise<void> | null = null
let inFlightAddress: string | null = null

export function refreshVault(): Promise<void> {
  const addresses = get(vaultAddresses)
  if (!addresses) {
    vault.set(initialState)
    return Promise.resolve()
  }

  const targetAddress = addresses.inscriptions
  if (inFlight && inFlightAddress === targetAddress) return inFlight

  const stillCurrent = () => get(vaultAddresses)?.inscriptions === targetAddress

  vault.update((state) => ({ ...state, loading: true, error: null }))

  const ord = currentOrdClient()
  const electrs = currentElectrsClient()
  ord.resetPin()

  inFlightAddress = targetAddress
  inFlight = Promise.all([
    loadHoldings(ord, targetAddress),
    loadFeePresets(electrs).catch(() => ({ fast: null, medium: null, slow: null })),
  ])
    .then(([holdings, feePresets]) => {
      if (!stillCurrent()) return
      vault.set({
        inscriptions: holdings.inscriptions,
        inscribedValueSats: holdings.inscribedValueSats,
        strayCardinalSats: holdings.strayCardinalSats,
        holdingsStale: holdings.stale,
        feePresets,
        loading: false,
        error: null,
        lastUpdated: Date.now(),
      })
    })
    .catch((error: unknown) => {
      if (!stillCurrent()) return
      const message = errorMessage(error)
      vault.update((state) => ({ ...state, loading: false, error: message }))
    })
    .finally(() => {
      if (inFlightAddress === targetAddress) {
        inFlight = null
        inFlightAddress = null
      }
    })

  return inFlight
}

// Switching vaults must not show the previous vault's inscriptions: reset and
// refetch whenever the active address changes.
if (browser) {
  let lastAddress: string | null = null
  let initialized = false

  vaultAddresses.subscribe((addresses) => {
    const next = addresses?.inscriptions ?? null
    const isFirst = !initialized
    initialized = true

    if (next === lastAddress) return
    lastAddress = next

    if (isFirst) return

    vault.set(initialState)
    if (next) void refreshVault()
  })
}
