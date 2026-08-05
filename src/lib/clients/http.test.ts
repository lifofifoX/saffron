import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchJson, fetchText } from './http'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('HTTP response limits', () => {
  it('keeps the timeout active while consuming the response body', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal
        const body = new ReadableStream({
          start(controller) {
            signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
          },
        })
        return Promise.resolve(new Response(body))
      }),
    )

    const request = expect(
      fetchText('https://example.test/slow', { timeoutMs: 10 }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(10)

    await request
  })

  it('rejects a response whose declared length exceeds the configured limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('large', {
          headers: { 'Content-Length': '5' },
        }),
      ),
    )

    await expect(fetchText('https://example.test/large', { maxResponseBytes: 4 })).rejects.toThrow(
      /exceeded 4 bytes/,
    )
  })

  it('rejects a streamed response that grows beyond the configured limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('abc'))
              controller.enqueue(new TextEncoder().encode('def'))
              controller.close()
            },
          }),
        ),
      ),
    )

    await expect(fetchText('https://example.test/stream', { maxResponseBytes: 5 })).rejects.toThrow(
      /exceeded 5 bytes/,
    )
  })

  it('returns parsed JSON within the configured limits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(fetchJson('https://example.test/json')).resolves.toEqual({ ok: true })
  })
})
