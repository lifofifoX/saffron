export type DeviceKind = 'TREZOR' | 'LEDGER'

export const DEVICE_LABELS: Record<DeviceKind, string> = {
  TREZOR: 'Trezor',
  LEDGER: 'Ledger',
}

export const DEVICE_ICONS: Record<DeviceKind, string> = {
  TREZOR: 'fa-shield',
  LEDGER: 'fa-key',
}

export type DeviceProgress =
  | { state: 'idle' }
  | { state: 'connecting'; device: DeviceKind }
  | { state: 'awaitingDevice'; device: DeviceKind; messages: string[] }
  | { state: 'done'; device: DeviceKind }
  | { state: 'error'; device: DeviceKind; message: string }
