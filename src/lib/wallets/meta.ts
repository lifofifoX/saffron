import type { FeeWalletProvider } from '$lib/wallets/providers'

export const WALLET_PROVIDER_META: Record<FeeWalletProvider, { label: string; image: string }> = {
  xverse: { label: 'Xverse', image: '/images/wallets/xverse.png' },
  unisat: { label: 'Unisat', image: '/images/wallets/unisat.png' },
}
