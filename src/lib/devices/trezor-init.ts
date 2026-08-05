import { loadTrezorConnect } from './trezor-module'
import { errorMessage } from '$lib/utils/error-message'
import { browser } from '$app/environment'

// Pin the hosted popup to the exact client version. The rolling /9/ deployment
// has dropped external-input witness fields in the past, which the firmware
// then rejects as unverifiable.
const TREZOR_CONNECT_SRC = 'https://connect.trezor.io/9.7.3/'

let trezorInitialized = false

// Trezor Connect accepts exactly one init, and whoever calls first sets the
// manifest the popup displays. Claimed at app boot.
export async function initTrezorConnectAsSaffron(): Promise<void> {
  if (!browser || trezorInitialized) return

  const TrezorConnect = await loadTrezorConnect()

  try {
    await TrezorConnect.init({
      connectSrc: TREZOR_CONNECT_SRC,
      coreMode: 'auto',
      lazyLoad: true,
      manifest: {
        appName: 'Saffron',
        appUrl: window.location.origin,
        email: 'support@ord.net',
      },
    })
  } catch (error) {
    const message = errorMessage(error)
    if (!/already initialized/i.test(message)) throw error
  }

  trezorInitialized = true
}
