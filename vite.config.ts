import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from 'vite-plugin-wasm'
import { defineConfig } from 'vitest/config'

const trezorDefines = {
  'process.env.TREZOR_CONNECT_URL': JSON.stringify(process.env.TREZOR_CONNECT_URL ?? ''),
  'process.env.TREZOR_BLOCKBOOK_URL': JSON.stringify(process.env.TREZOR_BLOCKBOOK_URL ?? ''),
  'process.env.TREZOR_DEV': JSON.stringify(process.env.TREZOR_DEV ?? ''),
  'process.env.TREZOR_APP_NAME': JSON.stringify('Saffron'),
}

export default defineConfig({
  plugins: [
    nodePolyfills({
      protocolImports: true,
      // rolldown's own runtime imports createRequire from node:module, which
      // the polyfill would replace with an empty mock.
      exclude: ['module'],
      globals: { Buffer: true, global: true, process: true },
    }),
    wasm(),
    tailwindcss(),
    sveltekit(),
  ],
  assetsInclude: ['**/*.wasm'],
  build: { target: 'esnext' },
  define: { ...trezorDefines },
  optimizeDeps: {
    exclude: ['bitbox-api', 'jadets'],
    esbuildOptions: {
      define: { ...trezorDefines, 'process.browser': 'true' },
      target: 'esnext',
    },
  },
  server: { host: '127.0.0.1', port: 5177, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
})
