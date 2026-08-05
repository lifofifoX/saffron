import { z } from 'zod'

import { persistedStore } from '$lib/stores/persistence'

// The ord API is a trust boundary and the source of inscription membership,
// so it defaults to your own node rather than someone else's server.
export const DEFAULT_ENDPOINTS = {
  ordBaseUrl: 'http://localhost:8080',
  electrsBaseUrl: 'https://mempool.space/api',
  contentBaseUrl: 'https://ordinals.com',
} as const

export type Endpoints = {
  ordBaseUrl: string
  electrsBaseUrl: string
  contentBaseUrl: string
}

function isSecureOrLoopbackUrl(value: string): boolean {
  const url = new URL(value)
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false

  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
}

// Endpoints feed fetch URLs and iframe sources. Production endpoints must use
// TLS; cleartext HTTP is reserved for a browser talking to its own loopback.
const httpUrl = z
  .string()
  .url()
  .refine(
    isSecureOrLoopbackUrl,
    'must use https:// (http:// is only allowed for localhost or a loopback address)',
  )
  .transform((value) => value.replace(/\/+$/, ''))

export const endpointsSchema = z.object({
  ordBaseUrl: httpUrl,
  electrsBaseUrl: httpUrl,
  contentBaseUrl: httpUrl,
})

export const endpoints = persistedStore<Endpoints>(
  'saffron:endpoints',
  { ...DEFAULT_ENDPOINTS },
  endpointsSchema,
)

export const EXPLORER_TX_URL = 'https://mempool.space/tx'
export const EXPLORER_ADDRESS_URL = 'https://mempool.space/address'
export const ORDINALS_ADDRESS_URL = 'https://ordinals.com/address'
export const BROADCAST_URL = 'https://mempool.space/tx/push'
export const ORD_NET_INSCRIPTION_URL = 'https://ord.net/inscription'
