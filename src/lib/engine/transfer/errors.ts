import { errorMessage } from '$lib/utils/error-message'
import { MAX_FEE_RATE_SAT_VB } from '$lib/security/fee-policy'

export type TransferErrorCode =
  | 'DUPLICATE_ADDRESS'
  | 'DUST_OUTPUT'
  | 'INVALID_ADDRESS'
  | 'INVALID_FEE_RATE'
  | 'NOT_ENOUGH_CARDINAL_UTXOS'
  | 'NOT_IN_WALLET'
  | 'VALUE_OVERFLOW'
  | 'BUILD_INVARIANT_VIOLATION'

export class TransferError extends Error {
  code: TransferErrorCode
  details: Record<string, unknown>

  constructor(code: TransferErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.code = code
    this.details = details
  }
}

export function transferErrorMessage(error: unknown): string {
  if (error instanceof TransferError) {
    switch (error.code) {
      case 'NOT_ENOUGH_CARDINAL_UTXOS':
        return 'Not enough spendable sats on the payments address to cover the fee. Top it up and refresh.'
      case 'DUPLICATE_ADDRESS':
        return 'The recipient must be different from your vault addresses.'
      case 'DUST_OUTPUT':
        return 'The inscription output would be below the dust limit for the recipient address type.'
      case 'INVALID_FEE_RATE':
        return `Enter a fee rate above zero and no more than ${MAX_FEE_RATE_SAT_VB} sat/vB.`
      case 'VALUE_OVERFLOW':
        return 'Amounts overflowed, refusing to build this transaction.'
      case 'BUILD_INVARIANT_VIOLATION':
        return `Internal safety check failed (${error.message}). No transaction was built.`
      default:
        return error.message
    }
  }

  return errorMessage(error)
}
