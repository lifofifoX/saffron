import { afterEach, describe, expect, it, vi } from 'vitest'

import { OrdClient } from './ord'

const ID = `${'a'.repeat(64)}i0`
const OTHER_ID = `${'b'.repeat(64)}i1`

function detail(id: string) {
  return { id, satpoint: `${'c'.repeat(64)}:0:0`, value: 100 }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OrdClient.getInscription', () => {
  it('rejects invalid inscription ids before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(new OrdClient('https://ord.test').getInscription('../output')).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects inscription details for a different id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(detail(OTHER_ID))))

    await expect(new OrdClient('https://ord.test').getInscription(ID)).rejects.toThrow(
      new RegExp(`returned inscription ${OTHER_ID}, expected ${ID}`),
    )
  })

  it('returns inscription details bound to the requested id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(detail(ID)))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new OrdClient('https://ord.test').getInscription(ID)).resolves.toMatchObject({
      id: ID,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `https://ord.test/inscription/${ID}`,
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
