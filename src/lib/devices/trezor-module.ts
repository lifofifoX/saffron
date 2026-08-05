export type TrezorConnectApi = (typeof import('@trezor/connect-web'))['default']

function hasInit(value: unknown): value is TrezorConnectApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { init?: unknown }).init === 'function'
  )
}

// @trezor/connect-web is CommonJS, and bundlers disagree on how to unwrap it.
// esbuild hands back the real export as .default, while rolldown follows Node
// and hands back module.exports, leaving the export nested one level deeper.
// Resolve both shapes so a bundler change cannot silently break device support.
export async function loadTrezorConnect(): Promise<TrezorConnectApi> {
  const imported: unknown = (await import('@trezor/connect-web')).default

  if (hasInit(imported)) return imported

  if (typeof imported === 'object' && imported !== null && 'default' in imported) {
    const nested: unknown = (imported as { default: unknown }).default
    if (hasInit(nested)) return nested
  }

  throw new Error('could not load Trezor Connect')
}
