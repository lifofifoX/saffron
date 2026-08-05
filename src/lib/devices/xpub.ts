import { loadTrezorConnect } from './trezor-module'
import { fingerprintNumberToXfp } from '$lib/engine/paths'

import { translateDeviceError } from './errors'
import type { DeviceKind, DeviceProgress } from './kinds'
import { exportLedgerXpub } from './ledger-direct'
import { connectGuidance, exportGuidance } from './messages'
import { initTrezorConnectAsSaffron } from './trezor-init'

export type DeviceXpubResult = {
  device: DeviceKind
  xpub: string
  xfp: string
  bip32Path: string
}

export async function exportDeviceXpub(p: {
  device: DeviceKind
  bip32Path: string
  onProgress?: (progress: DeviceProgress) => void
}): Promise<DeviceXpubResult> {
  const { device, bip32Path } = p
  const onProgress = p.onProgress ?? (() => {})

  onProgress({ state: 'connecting', device })

  try {
    if (device === 'TREZOR') {
      await initTrezorConnectAsSaffron()
      const TrezorConnect = await loadTrezorConnect()

      onProgress({
        state: 'awaitingDevice',
        device,
        messages: [...connectGuidance(device), exportGuidance(device)],
      })

      const accountResult = await TrezorConnect.getPublicKey({ path: bip32Path, coin: 'btc' })
      if (!accountResult.success) throw new Error(accountResult.payload.error)

      // The master fingerprint comes from any depth-1 node's parent fingerprint.
      // No coin here: with a coin, connect requires paths of depth 3 or more.
      const purpose = bip32Path.split('/')[1] ?? "84'"
      const rootResult = await TrezorConnect.getPublicKey({ path: `m/${purpose}` })
      if (!rootResult.success) throw new Error(rootResult.payload.error)

      const xpub = accountResult.payload.xpub
      const xfp = fingerprintNumberToXfp(rootResult.payload.fingerprint).toLowerCase()
      if (!xpub || !xfp) throw new Error('device returned an incomplete public key export')

      onProgress({ state: 'done', device })
      return { device, xpub, xfp, bip32Path }
    }

    onProgress({
      state: 'awaitingDevice',
      device,
      messages: [...connectGuidance(device), exportGuidance(device)],
    })

    const { xpub, xfp } = await exportLedgerXpub(bip32Path)
    if (!xpub || !xfp) throw new Error('device returned an incomplete public key export')

    onProgress({ state: 'done', device })
    return { device, xpub, xfp, bip32Path }
  } catch (error) {
    const message = translateDeviceError(device, error)
    onProgress({ state: 'error', device, message })
    throw new Error(message, { cause: error })
  }
}
