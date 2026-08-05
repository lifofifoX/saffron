import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from 'vite-plugin-wasm'
import { defineConfig } from 'vitest/config'

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
  optimizeDeps: {
    exclude: ['bitbox-api', 'jadets'],
  },
  server: { host: '127.0.0.1', port: 5177, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
})
