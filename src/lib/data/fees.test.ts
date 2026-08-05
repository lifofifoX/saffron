import { describe, expect, it } from 'vitest'

import type { ElectrsClient } from '$lib/clients/electrs'

import { loadFeePresets } from './fees'

describe('loadFeePresets', () => {
  it('drops remote estimates above the signing safety limit', async () => {
    const electrs = {
      getFeeEstimates: () => Promise.resolve({ '1': 900, '3': 25.04, '6': 0.2 }),
    } as unknown as ElectrsClient

    await expect(loadFeePresets(electrs)).resolves.toEqual({
      fast: null,
      medium: 25,
      slow: 1,
    })
  })
})
