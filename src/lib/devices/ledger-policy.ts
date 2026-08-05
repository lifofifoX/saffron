import type { WalletConfig } from '$lib/engine/config/schema'
import { updateLedgerPolicyHmac } from '$lib/persistence/wallet-store'

import { translateDeviceError } from './errors'
import type { DeviceProgress } from './kinds'
import { ledgerPolicyName, registerLedgerWalletPolicy } from './ledger-direct'

export async function registerLedgerPolicy(p: {
  vaultId: string
  walletConfig: WalletConfig
  cosigner: WalletConfig['extendedPublicKeys'][number]
  onProgress?: (progress: DeviceProgress) => void
}): Promise<string> {
  const onProgress = p.onProgress ?? (() => {})

  onProgress({ state: 'connecting', device: 'LEDGER' })

  try {
    const policyName = ledgerPolicyName(p.walletConfig)
    onProgress({
      state: 'awaitingDevice',
      device: 'LEDGER',
      messages: [
        'Unlock the Ledger, open the Bitcoin app, and quit Ledger Live.',
        `Approve the vault policy named ${policyName} on the device. Check the name and each key.`,
      ],
    })

    const policyHmac = await registerLedgerWalletPolicy(p.walletConfig, p.cosigner)
    updateLedgerPolicyHmac(p.vaultId, p.cosigner.xfp, policyHmac, policyName)

    onProgress({ state: 'done', device: 'LEDGER' })
    return policyHmac
  } catch (error) {
    const message = translateDeviceError('LEDGER', error)
    onProgress({ state: 'error', device: 'LEDGER', message })
    throw new Error(message, { cause: error })
  }
}
