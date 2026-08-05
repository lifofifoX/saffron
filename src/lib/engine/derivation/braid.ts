import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { HDKey } from '@scure/bip32'
import * as btc from '@scure/btc-signer'

import type { WalletConfig } from '$lib/engine/config/schema'
import type {
  Branch,
  CosignerKeyDerivation,
  MultisigAddressInfo,
  WalletAddresses,
} from '$lib/engine/types'
import { INSCRIPTIONS_BRANCH, PAYMENTS_BRANCH } from '$lib/engine/types'

export function childPubkeyHex(xpub: string, branch: number, index: number): string {
  const child = HDKey.fromExtendedKey(xpub).deriveChild(branch).deriveChild(index)
  if (!child.publicKey) throw new Error('xpub derived no public key')
  return bytesToHex(child.publicKey)
}

export function deriveBranchAddress(config: WalletConfig, branch: Branch): MultisigAddressInfo {
  const index = config.startingAddressIndex ?? 0

  const bip32Derivation: CosignerKeyDerivation[] = config.extendedPublicKeys.map((cosigner) => ({
    pubkeyHex: childPubkeyHex(cosigner.xpub, branch, index),
    xfp: cosigner.xfp.toLowerCase(),
    path: `${cosigner.bip32Path}/${branch}/${index}`,
  }))

  if (config.addressType === 'P2WPKH') {
    const derivation = bip32Derivation[0]
    if (config.extendedPublicKeys.length !== 1 || !derivation) {
      throw new Error('P2WPKH vaults hold exactly one key')
    }

    const payment = btc.p2wpkh(hexToBytes(derivation.pubkeyHex))
    if (!payment.address) throw new Error('failed to construct the vault address')

    return {
      kind: 'p2wpkh',
      branch,
      address: payment.address,
      scriptPubkeyHex: bytesToHex(payment.script),
      requiredSigners: 1,
      sortedPubkeysHex: [derivation.pubkeyHex],
      bip32Derivation,
    }
  }

  // BIP67 sortedmulti: lexicographic pubkey order defines the script.
  const sortedPubkeysHex = bip32Derivation.map((entry) => entry.pubkeyHex).sort()
  const sortedPubkeys = sortedPubkeysHex.map((hex) => hexToBytes(hex))

  const payment = btc.p2wsh(btc.p2ms(config.quorum.requiredSigners, sortedPubkeys))
  if (!payment.address || !payment.witnessScript) {
    throw new Error('failed to construct the vault address')
  }

  return {
    kind: 'p2wsh',
    branch,
    address: payment.address,
    scriptPubkeyHex: bytesToHex(payment.script),
    witnessScriptHex: bytesToHex(payment.witnessScript),
    requiredSigners: config.quorum.requiredSigners,
    sortedPubkeysHex,
    bip32Derivation,
  }
}

export function deriveWalletAddresses(config: WalletConfig): WalletAddresses {
  return {
    inscriptions: deriveBranchAddress(config, INSCRIPTIONS_BRANCH),
    payments: deriveBranchAddress(config, PAYMENTS_BRANCH),
  }
}
