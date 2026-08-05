import * as btc from '@scure/btc-signer'

export const DUST_RELAY_FEE_RATE_SAT_VB = 3
export const LEGACY_DUST_INPUT_VSIZE = 148
export const WITNESS_PROGRAM_DUST_INPUT_VSIZE = 67

export function scriptOutputVsize(script: Uint8Array): number {
  return 8 + btc.CompactSize.encode(BigInt(script.length)).length + script.length
}

export function isWitnessProgramScript(script: Uint8Array): boolean {
  const versionOpcode = script[0]
  const pushLength = script[1]
  if (versionOpcode === undefined || pushLength === undefined) return false

  const isWitnessVersion =
    versionOpcode === 0x00 || (versionOpcode >= 0x51 && versionOpcode <= 0x60)
  return isWitnessVersion && pushLength === script.length - 2 && pushLength >= 2 && pushLength <= 40
}

export function dustThresholdSatsForScript(script: Uint8Array): number {
  const spendVsize = isWitnessProgramScript(script)
    ? WITNESS_PROGRAM_DUST_INPUT_VSIZE
    : LEGACY_DUST_INPUT_VSIZE

  return DUST_RELAY_FEE_RATE_SAT_VB * (scriptOutputVsize(script) + spendVsize)
}
