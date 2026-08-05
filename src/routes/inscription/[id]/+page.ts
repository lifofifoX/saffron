import { requireWallet } from '$lib/guards'

export function load() {
  requireWallet()
}
