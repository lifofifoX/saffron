import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { CosignerConfig, WalletConfig } from '$lib/engine/config/schema'

import type { DeviceSignature } from './sign'

// Wallet policy construction mirrors the original registration recipe exactly,
// since the device HMAC binds to the byte-exact policy: keys as
// [xfp/path]xpub sorted lexicographically by xpub and template
// wsh(sortedmulti(m,@0/**,...)). The name is recognizable on-device, stable
// across cosmetic vault renames, unique to the policy, and fits Ledger's
// 16-byte ASCII limit.
export function ledgerPolicyName(config: WalletConfig): string {
  const identity = JSON.stringify({
    addressType: config.addressType,
    quorum: config.quorum,
    keys: config.extendedPublicKeys
      .map(({ bip32Path, xfp, xpub }) => ({ bip32Path, xfp: xfp.toLowerCase(), xpub }))
      .sort((a, b) => a.xpub.localeCompare(b.xpub)),
  })
  return `Saffron-${bytesToHex(sha256(new TextEncoder().encode(identity))).slice(0, 8)}`
}

export function registeredLedgerPolicyHmac(config: WalletConfig, xfp: string): string | undefined {
  const policyName = ledgerPolicyName(config)
  return config.ledgerPolicyHmacs.find(
    (entry) => entry.xfp.toLowerCase() === xfp.toLowerCase() && entry.policyName === policyName,
  )?.policyHmac
}

export function buildWalletPolicy(
  config: WalletConfig,
  WalletPolicyClass: typeof import('@ledgerhq/ledger-bitcoin').WalletPolicy,
) {
  if (config.addressType !== 'P2WSH') {
    throw new Error('Ledger signing currently supports multisig vaults only')
  }

  const keys = config.extendedPublicKeys
    .map((cosigner) => {
      const path = cosigner.bip32Path.startsWith('m')
        ? cosigner.bip32Path.slice(1)
        : cosigner.bip32Path
      return { xpub: cosigner.xpub, key: `[${cosigner.xfp.toLowerCase()}${path}]${cosigner.xpub}` }
    })
    .sort((a, b) => a.xpub.localeCompare(b.xpub))
    .map((entry) => entry.key)

  const signers = keys.map((_, index) => `@${index}/**`).join(',')
  const template = `wsh(sortedmulti(${config.quorum.requiredSigners},${signers}))`

  return new WalletPolicyClass(ledgerPolicyName(config), template, keys)
}

function assertCosignerInPolicy(config: WalletConfig, cosigner: CosignerConfig): void {
  const matches = config.extendedPublicKeys.filter(
    (candidate) =>
      candidate.xfp.toLowerCase() === cosigner.xfp.toLowerCase() &&
      candidate.xpub === cosigner.xpub &&
      candidate.bip32Path === cosigner.bip32Path,
  )
  if (matches.length !== 1) {
    throw new Error('the selected Ledger cosigner is not uniquely present in this vault policy')
  }
}

async function assertLedgerCosigner(
  app: import('@ledgerhq/ledger-bitcoin').AppClient,
  cosigner: CosignerConfig,
): Promise<void> {
  const deviceXfp = (await app.getMasterFingerprint()).toLowerCase()
  if (deviceXfp !== cosigner.xfp.toLowerCase()) {
    throw new Error(
      `This Ledger has fingerprint ${deviceXfp}, but the selected vault key is ${cosigner.xfp.toLowerCase()}. Connect the selected Ledger and retry.`,
    )
  }

  const deviceXpub = await app.getExtendedPubkey(cosigner.bip32Path)
  if (deviceXpub !== cosigner.xpub) {
    throw new Error(
      `This Ledger derives a different key at ${cosigner.bip32Path} than the selected vault key. Connect the same Ledger account used during setup and retry.`,
    )
  }
}

async function withLedgerApp<T>(
  run: (
    app: import('@ledgerhq/ledger-bitcoin').AppClient,
    lib: typeof import('@ledgerhq/ledger-bitcoin'),
  ) => Promise<T>,
): Promise<T> {
  const [{ default: TransportWebUSB }, ledger] = await Promise.all([
    import('@ledgerhq/hw-transport-webusb'),
    import('@ledgerhq/ledger-bitcoin'),
  ])

  const transport = await TransportWebUSB.create()
  try {
    const app = new ledger.AppClient(transport)
    return await run(app, ledger)
  } finally {
    await transport.close().catch(() => {})
  }
}

export async function exportLedgerXpub(bip32Path: string): Promise<{ xpub: string; xfp: string }> {
  return withLedgerApp(async (app) => {
    const xfp = (await app.getMasterFingerprint()).toLowerCase()
    const xpub = await app.getExtendedPubkey(bip32Path)
    return { xpub, xfp }
  })
}

export async function registerLedgerWalletPolicy(
  config: WalletConfig,
  cosigner: CosignerConfig,
): Promise<string> {
  assertCosignerInPolicy(config, cosigner)
  return withLedgerApp(async (app, ledger) => {
    await assertLedgerCosigner(app, cosigner)
    const policy = buildWalletPolicy(config, ledger.WalletPolicy)
    const [, hmac] = await app.registerWallet(policy)
    return bytesToHex(hmac)
  })
}

export async function signPsbtWithLedger(p: {
  walletConfig: WalletConfig
  cosigner: CosignerConfig
  policyHmac: string | undefined
  psbtV2Base64: string
}): Promise<DeviceSignature[]> {
  assertCosignerInPolicy(p.walletConfig, p.cosigner)
  if (!p.policyHmac) {
    throw new Error(
      'Register the vault policy on this Ledger first, under Settings, then retry signing.',
    )
  }

  return withLedgerApp(async (app, ledger) => {
    await assertLedgerCosigner(app, p.cosigner)
    const policy = buildWalletPolicy(p.walletConfig, ledger.WalletPolicy)
    const results = await app.signPsbt(
      p.psbtV2Base64,
      policy,
      Buffer.from(hexToBytes(p.policyHmac ?? '')),
    )

    return results.map(([inputIndex, partialSignature]) => ({
      inputIndex,
      pubkeyHex: bytesToHex(partialSignature.pubkey),
      signatureHex: bytesToHex(partialSignature.signature),
    }))
  })
}
