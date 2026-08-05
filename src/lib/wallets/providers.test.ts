import { sha256 } from '@noble/hashes/sha2.js'
import * as btc from '@scure/btc-signer'
import { pubECDSA } from '@scure/btc-signer/utils.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('sats-connect', () => ({
  AddressPurpose: { Payment: 'payment', Ordinals: 'ordinals' },
  request,
}))

import { connectXverse } from './providers'

describe('connectXverse', () => {
  beforeEach(() => request.mockReset())

  it('requests only the payment address needed for fee inputs', async () => {
    const privateKey = sha256(new TextEncoder().encode('saffron-xverse-payment-test'))
    const publicKey = pubECDSA(privateKey)
    const payment = btc.p2wpkh(publicKey)

    request.mockResolvedValue({
      status: 'success',
      result: {
        addresses: [
          {
            purpose: 'payment',
            address: payment.address,
            publicKey: Buffer.from(publicKey).toString('hex'),
          },
        ],
      },
    })

    await expect(connectXverse()).resolves.toMatchObject({
      provider: 'xverse',
      kind: 'p2wpkh',
      address: payment.address,
    })
    expect(request).toHaveBeenCalledWith('wallet_connect', {
      addresses: ['payment'],
      message: 'Connect to saffron to pay transfer fees',
    })
  })
})
