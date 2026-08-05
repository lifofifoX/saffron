import type { DeviceKind } from './kinds'

export function connectGuidance(device: DeviceKind): string[] {
  if (device === 'LEDGER') {
    return [
      'Plug in and unlock your Ledger.',
      'Open the Bitcoin app on the device.',
      'Quit Ledger Live if it is running.',
    ]
  }

  return [
    'Plug in and unlock your Trezor.',
    'A Trezor Connect window will open. Allow access and follow its prompts.',
  ]
}

export function exportGuidance(device: DeviceKind): string {
  if (device === 'LEDGER') return 'Approve the public key export on your Ledger if prompted.'
  return 'Approve the public key export in the Trezor window.'
}
