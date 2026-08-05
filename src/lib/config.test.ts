import { describe, expect, it } from 'vitest'

import { endpointsSchema } from './config'

describe('endpoint security', () => {
  const defaults = {
    ordBaseUrl: 'https://ord.example',
    electrsBaseUrl: 'https://electrs.example',
    contentBaseUrl: 'https://content.example',
  }

  it('accepts HTTPS and strips trailing slashes', () => {
    expect(
      endpointsSchema.parse({ ...defaults, ordBaseUrl: 'https://ord.example///' }).ordBaseUrl,
    ).toBe('https://ord.example')
  })

  it.each(['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080'])(
    'allows the loopback development endpoint %s',
    (ordBaseUrl) => {
      expect(endpointsSchema.safeParse({ ...defaults, ordBaseUrl }).success).toBe(true)
    },
  )

  it.each(['http://ord.example', 'javascript:alert(1)', 'data:text/plain,backup'])(
    'rejects the insecure endpoint %s',
    (ordBaseUrl) => {
      expect(endpointsSchema.safeParse({ ...defaults, ordBaseUrl }).success).toBe(false)
    },
  )
})
