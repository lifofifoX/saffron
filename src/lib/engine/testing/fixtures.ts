import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha2.js'

import type { WalletConfig } from '$lib/engine/config/schema'
import { fingerprintNumberToXfp } from '$lib/engine/paths'

export const FIXTURE_KEY_ORIGIN_PATH = "m/48'/0'/0'/2'"

export type FixtureCosigner = {
  name: string
  master: HDKey
  account: HDKey
  xfp: string
  xpub: string
}

export function fixtureCosigner(
  name: string,
  seedLabel: string,
  keyOriginPath = FIXTURE_KEY_ORIGIN_PATH,
): FixtureCosigner {
  const seed = sha256(new TextEncoder().encode(`saffron-fixture-seed:${seedLabel}`))
  const master = HDKey.fromMasterSeed(seed)

  const account = master.derive(keyOriginPath)
  const xpub = account.publicExtendedKey

  return {
    name,
    master,
    account,
    xfp: fingerprintNumberToXfp(master.fingerprint),
    xpub,
  }
}

export function fixtureCosigners(count: number): FixtureCosigner[] {
  return Array.from({ length: count }, (_, index) =>
    fixtureCosigner(`key-${index + 1}`, `cosigner-${index + 1}`),
  )
}

export function fixtureWalletConfig(requiredSigners = 2, totalSigners = 3): WalletConfig {
  const cosigners = fixtureCosigners(totalSigners)

  return {
    name: 'saffron-fixture-vault',
    addressType: 'P2WSH',
    network: 'mainnet',
    quorum: { requiredSigners, totalSigners },
    extendedPublicKeys: cosigners.map((cosigner) => ({
      name: cosigner.name,
      bip32Path: FIXTURE_KEY_ORIGIN_PATH,
      xpub: cosigner.xpub,
      xfp: cosigner.xfp,
      method: 'text' as const,
    })),
    startingAddressIndex: 0,
    ledgerPolicyHmacs: [],
  }
}

export const FIXTURE_SINGLE_KEY_PATH = "m/84'/0'/100'"

export function fixtureSingleKeyConfig(): WalletConfig {
  const cosigner = fixtureCosigner('key-1', 'cosigner-1', FIXTURE_SINGLE_KEY_PATH)

  return {
    name: 'saffron-fixture-single',
    addressType: 'P2WPKH',
    network: 'mainnet',
    quorum: { requiredSigners: 1, totalSigners: 1 },
    extendedPublicKeys: [
      {
        name: cosigner.name,
        bip32Path: FIXTURE_SINGLE_KEY_PATH,
        xpub: cosigner.xpub,
        xfp: cosigner.xfp,
        method: 'trezor' as const,
      },
    ],
    startingAddressIndex: 0,
    ledgerPolicyHmacs: [],
  }
}
