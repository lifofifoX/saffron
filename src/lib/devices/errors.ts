import type { DeviceKind } from './kinds'

function collectErrorTexts(error: unknown, texts: string[] = [], depth = 0): string[] {
  if (depth > 5 || error === null || error === undefined) return texts

  if (typeof error === 'string') {
    texts.push(error)
    return texts
  }

  if (typeof error === 'object') {
    const candidate = error as {
      message?: unknown
      statusText?: unknown
      errorCode?: unknown
      cause?: unknown
      originalError?: unknown
    }

    if (typeof candidate.message === 'string') texts.push(candidate.message)
    if (typeof candidate.statusText === 'string') texts.push(candidate.statusText)
    if (typeof candidate.errorCode === 'string') texts.push(candidate.errorCode)

    collectErrorTexts(candidate.cause, texts, depth + 1)
    collectErrorTexts(candidate.originalError, texts, depth + 1)
  }

  return texts
}

export function translateDeviceError(device: DeviceKind, error: unknown): string {
  const texts = collectErrorTexts(error)
  const combined = texts.join(' | ').toLowerCase()

  if (device === 'LEDGER') {
    if (combined.includes('6a80')) {
      return 'The Ledger rejected the request (0x6a80). Update the Bitcoin app, and re-register the vault policy if this happens while signing.'
    }
    if (combined.includes('6a87')) {
      return 'This Bitcoin app version does not support wallet policies. Update it in Ledger Live, then quit Ledger Live.'
    }
    if (combined.includes('6985')) {
      return 'Request rejected on the Ledger.'
    }
    if (combined.includes('locked') || combined.includes('0x5515')) {
      return 'The Ledger is locked. Unlock it and open the Bitcoin app.'
    }
    if (combined.includes('fido') || combined.includes('hid')) {
      return 'Chrome could not reach the Ledger. Unlock it, open the Bitcoin app, quit Ledger Live, then try again.'
    }
    if (combined.includes('no device selected') || combined.includes('access')) {
      return 'No Ledger access granted. Pick your device in the browser prompt.'
    }
  }

  if (device === 'TREZOR') {
    if (combined.includes('popup closed') || combined.includes('window closed')) {
      return 'The Trezor window was closed before finishing.'
    }
    if (
      combined.includes('cancelled') ||
      combined.includes('canceled') ||
      combined.includes('action was interrupted')
    ) {
      return 'Request cancelled on the Trezor.'
    }
    if (combined.includes('permissions not granted') || combined.includes('denied')) {
      return 'Access was not granted in the Trezor window.'
    }
    if (combined.includes('device is used in other window') || combined.includes('session')) {
      return 'The Trezor is busy in another app (close Trezor Suite tabs using it), then retry.'
    }
    if (combined.includes('transport') || combined.includes('bridge')) {
      return 'Could not reach the Trezor. Check the USB connection and that Trezor Bridge or WebUSB access is available.'
    }
  }

  const first = texts.find((text) => text.trim().length > 0)
  return first ?? 'Device request failed.'
}
