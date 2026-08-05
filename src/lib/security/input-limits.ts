const MEBIBYTE = 1024 * 1024

export const INPUT_LIMITS = {
  psbtDecodedBytes: 8 * MEBIBYTE,
  psbtTextCharacters: 16 * MEBIBYTE,
  psbtFileBytes: 16 * MEBIBYTE,
  walletBackupTextCharacters: 1 * MEBIBYTE,
  walletBackupFileBytes: 1 * MEBIBYTE,
} as const

function formatMaximum(maximum: number, unit: 'bytes' | 'characters'): string {
  return unit === 'bytes'
    ? `${maximum / MEBIBYTE} MiB`
    : `${maximum.toLocaleString('en-US')} characters`
}

function assertSize(
  actual: number,
  maximum: number,
  label: string,
  unit: 'bytes' | 'characters',
): void {
  if (!Number.isSafeInteger(actual) || actual < 0) {
    throw new Error(`invalid ${label} size`)
  }
  if (actual > maximum) {
    throw new Error(`${label} is too large (maximum ${formatMaximum(maximum, unit)})`)
  }
}

export function assertPsbtDecodedSize(bytes: number): void {
  assertSize(bytes, INPUT_LIMITS.psbtDecodedBytes, 'Decoded PSBT', 'bytes')
}

export function assertPsbtTextSize(characters: number): void {
  assertSize(characters, INPUT_LIMITS.psbtTextCharacters, 'PSBT text', 'characters')
}

export function assertPsbtFileSize(bytes: number): void {
  assertSize(bytes, INPUT_LIMITS.psbtFileBytes, 'PSBT file', 'bytes')
}

export function assertWalletBackupTextSize(characters: number): void {
  assertSize(characters, INPUT_LIMITS.walletBackupTextCharacters, 'Vault backup text', 'characters')
}

export function assertWalletBackupFileSize(bytes: number): void {
  assertSize(bytes, INPUT_LIMITS.walletBackupFileBytes, 'Vault backup file', 'bytes')
}
