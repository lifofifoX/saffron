import { redirect } from '@sveltejs/kit'

import { walletEnvelopeSchema } from '$lib/engine/config/schema'
import { readPersistedValue } from '$lib/stores/persistence'
import {
  LEGACY_WALLET_STORAGE_KEY,
  VAULTS_STORAGE_KEY,
  vaultsFileSchema,
} from '$lib/stores/wallet-config'

export function requireWallet(): void {
  const file = readPersistedValue(VAULTS_STORAGE_KEY, null, vaultsFileSchema.nullable())
  if (file && file.vaults.some((record) => record.id === file.activeId)) return

  // A legacy single-vault install migrates on first store load; do not bounce
  // it to setup in the meantime.
  const legacy = readPersistedValue(
    LEGACY_WALLET_STORAGE_KEY,
    null,
    walletEnvelopeSchema.nullable(),
  )
  if (legacy !== null) return

  redirect(307, '/setup')
}
