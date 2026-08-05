export type Branch = 0 | 1

export const INSCRIPTIONS_BRANCH: Branch = 0
export const PAYMENTS_BRANCH: Branch = 1

export type CosignerKeyDerivation = {
  pubkeyHex: string
  xfp: string
  path: string
}

export type VaultScriptKind = 'p2wsh' | 'p2wpkh'

export type MultisigAddressInfo = {
  kind: VaultScriptKind
  branch: Branch
  address: string
  scriptPubkeyHex: string
  witnessScriptHex?: string
  requiredSigners: number
  sortedPubkeysHex: string[]
  bip32Derivation: CosignerKeyDerivation[]
}

export type WalletAddresses = {
  inscriptions: MultisigAddressInfo
  payments: MultisigAddressInfo
}

export type InscriptionHolding = {
  id: string
  number: number | null
  satpoint: string
  outpoint: string
  offsetSats: number
  valueSats: number
  contentType: string | null
  charms: string[]
  parents: string[]
}
