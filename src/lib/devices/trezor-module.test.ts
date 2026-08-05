import { describe, expect, it } from 'vitest'

import { loadTrezorConnect } from './trezor-module'

// @trezor/connect-web is CommonJS and bundlers unwrap it differently. Vite 8
// (rolldown) exposed module.exports where Vite 7 (esbuild) exposed the real
// export, which broke every device call with "init is not a function".
describe('loadTrezorConnect', () => {
  it('resolves the API through CommonJS interop', async () => {
    const connect = await loadTrezorConnect()

    expect(typeof connect.init).toBe('function')
    expect(typeof connect.getPublicKey).toBe('function')
    expect(typeof connect.signTransaction).toBe('function')
  })
})
