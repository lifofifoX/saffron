import { HDKey } from '@scure/bip32'

import { bip32PathToSequence } from '$lib/engine/paths'

import { DEFAULT_KEY_ORIGIN_PATH, SINGLE_KEY_MAX_ACCOUNT, type WalletConfig } from './schema'

export type ConfigIssue = {
  level: 'error' | 'warning'
  message: string
}

export function validateWalletConfig(config: WalletConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const { requiredSigners, totalSigners } = config.quorum

  if (config.addressType === 'P2WPKH' && totalSigners !== 1) {
    issues.push({ level: 'error', message: 'P2WPKH vaults hold exactly one key' })
  }

  if (requiredSigners > totalSigners) {
    issues.push({ level: 'error', message: 'quorum requires more signers than total keys' })
  }

  if (config.extendedPublicKeys.length !== totalSigners) {
    issues.push({
      level: 'error',
      message: `config lists ${config.extendedPublicKeys.length} keys but quorum expects ${totalSigners}`,
    })
  }

  const xfps = new Set<string>()
  const xpubs = new Set<string>()

  for (const cosigner of config.extendedPublicKeys) {
    const normalizedXfp = cosigner.xfp.toLowerCase()
    if (xfps.has(normalizedXfp)) {
      issues.push({ level: 'error', message: `duplicate fingerprint ${cosigner.xfp}` })
    }
    xfps.add(normalizedXfp)

    if (xpubs.has(cosigner.xpub)) {
      issues.push({ level: 'error', message: `duplicate xpub for ${cosigner.name}` })
    }
    xpubs.add(cosigner.xpub)

    if (normalizedXfp === '00000000') {
      issues.push({
        level: 'warning',
        message: `${cosigner.name} has a placeholder fingerprint, so device signing will not match it`,
      })
    }

    let pathSequence: number[] | null = null
    try {
      pathSequence = bip32PathToSequence(cosigner.bip32Path)
    } catch (error) {
      issues.push({
        level: 'error',
        message: `${cosigner.name}: invalid key origin ${cosigner.bip32Path} (${error instanceof Error ? error.message : 'parse failed'})`,
      })
    }

    if (!cosigner.xpub.startsWith('xpub')) {
      issues.push({
        level: 'error',
        message: `${cosigner.name}: expected a mainnet xpub (got ${cosigner.xpub.slice(0, 4)}…). Export the plain xpub instead of Ypub/Zpub.`,
      })
      continue
    }

    let parsed: HDKey
    try {
      parsed = HDKey.fromExtendedKey(cosigner.xpub)
    } catch (error) {
      issues.push({
        level: 'error',
        message: `${cosigner.name}: invalid xpub (${error instanceof Error ? error.message : 'parse failed'})`,
      })
      continue
    }

    if (pathSequence !== null && parsed.depth !== pathSequence.length) {
      issues.push({
        level: 'error',
        message: `${cosigner.name}: xpub depth ${parsed.depth} does not match path ${cosigner.bip32Path}`,
      })
    }

    const expectedChildIndex = pathSequence?.at(-1)
    if (expectedChildIndex !== undefined && parsed.index !== expectedChildIndex) {
      issues.push({
        level: 'error',
        message: `${cosigner.name}: xpub child index does not match path ${cosigner.bip32Path}`,
      })
    }

    if (pathSequence !== null && config.addressType === 'P2WPKH') {
      const match = cosigner.bip32Path.match(/^m\/84'\/0'\/(\d+)'$/)
      const account = match?.[1] !== undefined ? Number(match[1]) : null
      if (account === null || account > SINGLE_KEY_MAX_ACCOUNT) {
        issues.push({
          level: 'warning',
          message: `${cosigner.name}: unusual key origin ${cosigner.bip32Path}. The device must derive this exact path when signing`,
        })
      }
    } else if (pathSequence !== null && cosigner.bip32Path !== DEFAULT_KEY_ORIGIN_PATH) {
      issues.push({
        level: 'warning',
        message: `${cosigner.name}: non-standard key origin ${cosigner.bip32Path}. The device must derive this exact path when signing`,
      })
    }
  }

  return issues
}

export function configErrors(issues: ConfigIssue[]): string[] {
  return issues.filter((issue) => issue.level === 'error').map((issue) => issue.message)
}
