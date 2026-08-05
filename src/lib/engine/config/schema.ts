import { z } from 'zod'

export const XFP_PATTERN = /^[0-9a-f]{8}$/i
export const DEFAULT_KEY_ORIGIN_PATH = "m/48'/0'/0'/2'"
// Single key vaults live on a bip84 account of the user's choosing. The
// default is the firmware maximum, which wallet apps never reach through
// sequential account discovery.
export const SINGLE_KEY_DEFAULT_ACCOUNT = 100
export const SINGLE_KEY_MAX_ACCOUNT = 100

export function singleKeyOriginPath(account: number): string {
  return `m/84'/0'/${account}'`
}

export const cosignerMethodSchema = z.enum(['trezor', 'ledger', 'text', 'unknown'])

export const cosignerConfigSchema = z.object({
  name: z.string().min(1),
  bip32Path: z.string().min(1),
  xpub: z.string().min(1),
  xfp: z.string().regex(XFP_PATTERN, 'xfp must be 8 hex characters'),
  method: cosignerMethodSchema.catch('unknown').default('unknown'),
})

export const ledgerPolicyHmacSchema = z.object({
  xfp: z.string().regex(XFP_PATTERN),
  policyHmac: z.string().regex(/^[0-9a-f]+$/i),
  // Older backups omit this field. Those HMACs are intentionally ignored so
  // a byte-different policy name can never reuse a stale device registration.
  policyName: z
    .string()
    .regex(/^[\x20-\x7e]{1,16}$/)
    .optional(),
})

export const walletConfigSchema = z.object({
  name: z.string().min(1),
  uuid: z.string().optional(),
  addressType: z.enum(['P2WSH', 'P2WPKH']),
  network: z.literal('mainnet'),
  quorum: z.object({
    requiredSigners: z.number().int().min(1).max(15),
    totalSigners: z.number().int().min(1).max(15),
  }),
  extendedPublicKeys: z.array(cosignerConfigSchema).min(1),
  // Every current signing flow derives branch/index */0.
  // Reject unsupported indexes at the config boundary instead of creating a
  // vault that the app can display but cannot later spend from.
  startingAddressIndex: z.literal(0).default(0),
  ledgerPolicyHmacs: z.array(ledgerPolicyHmacSchema).default([]),
  client: z.unknown().optional(),
})

export type CosignerConfig = z.infer<typeof cosignerConfigSchema>
export type WalletConfig = z.infer<typeof walletConfigSchema>

export const walletEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  config: walletConfigSchema,
  derivedAddresses: z.object({
    inscriptions: z.string(),
    payments: z.string(),
  }),
  savedAt: z.string(),
})

export type WalletEnvelope = z.infer<typeof walletEnvelopeSchema>

export function parseWalletConfigJson(json: string): WalletConfig {
  const raw: unknown = JSON.parse(json)
  return walletConfigSchema.parse(raw)
}

export function serializeWalletConfig(config: WalletConfig): string {
  return JSON.stringify(config, null, 2)
}
