export const DEFAULT_TIMEOUT_MS = 15_000
export const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024

export class HttpError extends Error {
  status: number
  url: string

  constructor(message: string, status: number, url: string) {
    super(message)
    this.status = status
    this.url = url
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  maxResponseBytes?: number
}

async function readResponseBody(response: Response, maxBytes: number, url: string) {
  const advertisedLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    await response.body?.cancel()
    throw new Error(`response exceeded ${maxBytes} bytes for ${url}`)
  }

  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new Error(`response exceeded ${maxBytes} bytes for ${url}`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return body
}

export async function httpRequest(url: string, options: RequestOptions = {}): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES

  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    clearTimeout(timeout)
    throw new RangeError('maxResponseBytes must be a positive integer')
  }

  try {
    const init: RequestInit = { method: options.method ?? 'GET', signal: controller.signal }
    if (options.headers) init.headers = options.headers
    if (options.body !== undefined) init.body = JSON.stringify(options.body)

    const response = await fetch(url, init)
    const body = await readResponseBody(response, maxResponseBytes, url)

    if (!response.ok) {
      const text = new TextDecoder().decode(body)
      throw new HttpError(
        `request failed (${response.status}) for ${url}${text ? `: ${text.slice(0, 200)}` : ''}`,
        response.status,
        url,
      )
    }

    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    return new Response(body.byteLength > 0 ? body : null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchJson(url: string, options: RequestOptions = {}): Promise<unknown> {
  const response = await httpRequest(url, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers },
  })

  return response.json() as Promise<unknown>
}

export async function fetchText(url: string, options: RequestOptions = {}): Promise<string> {
  const response = await httpRequest(url, options)
  return response.text()
}
