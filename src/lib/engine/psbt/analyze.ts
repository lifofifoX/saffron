import { hexToBytes } from '@noble/hashes/utils.js'
import type * as btc from '@scure/btc-signer'

import { dustThresholdSatsForScript } from '$lib/engine/dust'
import { traceSatFlow, type TrackedSat } from '$lib/engine/psbt/satflow'
import type { WalletAddresses } from '$lib/engine/types'
import {
  estimateSignedVsize,
  MAX_FEE_RATE_SAT_VB,
  MAX_IMPORTED_FEE_SHARE,
} from '$lib/security/fee-policy'

import {
  type ClassifiedInput,
  type ClassifiedOutput,
  classifyInputs,
  classifyOutputs,
} from './classify'
import { enrichPsbt } from './enrich'

export type InscriptionFinding = {
  inscriptionId: string
  inputIndex: number
  outputIndex: number | 'fee'
  landsInVault: boolean
  landingScriptHex: string | null
}

export type PsbtWarning = {
  severity: 'info' | 'warning' | 'danger'
  message: string
}

export type PsbtAnalysis = {
  inputs: ClassifiedInput[]
  outputs: ClassifiedOutput[]
  feeSats: number | null
  feeRateSatVb: number | null
  trezorEligible: boolean
  inscriptionFindings: InscriptionFinding[]
  warnings: PsbtWarning[]
}

export async function analyzePsbt(
  transaction: btc.Transaction,
  addresses: WalletAddresses,
  deps: {
    getPrevTxHex: (txid: string) => Promise<string>
    getInscriptionsAtOutpoint: (
      txid: string,
      vout: number,
      valueSats: number,
    ) => Promise<{ id: string; offsetSats: number }[]>
  },
): Promise<PsbtAnalysis> {
  const { trezorEligible } = await enrichPsbt(transaction, addresses, {
    getPrevTxHex: deps.getPrevTxHex,
  })

  const inputs = classifyInputs(transaction, addresses)
  const outputs = classifyOutputs(transaction, addresses)
  const warnings: PsbtWarning[] = []

  const inputValuesKnown = inputs.every((input) => input.valueSats !== null)
  const totalIn = inputValuesKnown
    ? inputs.reduce((sum, input) => sum + (input.valueSats ?? 0), 0)
    : null
  const totalOut = outputs.reduce((sum, output) => sum + output.valueSats, 0)
  const feeSats = totalIn === null ? null : totalIn - totalOut
  const estimatedVsize = feeSats !== null && feeSats >= 0 ? estimateSignedVsize(transaction) : null
  const feeRateSatVb =
    feeSats !== null && estimatedVsize !== null
      ? Math.round((feeSats / estimatedVsize) * 10) / 10
      : null

  if (feeSats === null) {
    warnings.push({
      severity: 'warning',
      message: 'Fee unknown: some external inputs do not reveal their value.',
    })
  } else if (feeSats < 0) {
    warnings.push({
      severity: 'danger',
      message:
        'Outputs spend more than the known inputs provide. This transaction cannot be valid.',
    })
  } else {
    const feeShare = totalIn && totalIn > 0 ? feeSats / totalIn : 0
    const excessiveRate = feeRateSatVb !== null && feeRateSatVb > MAX_FEE_RATE_SAT_VB
    const excessiveShare = feeShare > MAX_IMPORTED_FEE_SHARE

    if (excessiveRate || excessiveShare) {
      const details = [
        `${feeSats.toLocaleString('en-US')} sats`,
        `${(feeShare * 100).toFixed(1)}% of inputs`,
      ]
      if (feeRateSatVb !== null) details.push(`${feeRateSatVb} sat/vB`)

      warnings.push({
        severity: 'danger',
        message: `Excessive transaction fee (${details.join(', ')}). Signing is blocked.`,
      })
    }
  }

  const externalCount = inputs.filter((input) => input.class.kind === 'external').length
  if (externalCount > 0) {
    warnings.push({
      severity: 'info',
      message: `${externalCount} input${externalCount === 1 ? '' : 's'} belong to other wallets. A Trezor cannot sign this transaction, use a Ledger.`,
    })
  }

  const trackedSats: TrackedSat[] = []
  const inputIndexByOutpoint = new Map<string, number>()

  for (const input of inputs) {
    if (!input.txid) continue
    if (input.valueSats === null) {
      throw new Error(`could not resolve input ${input.inputIndex} value`)
    }
    inputIndexByOutpoint.set(`${input.txid}:${input.vout}`, input.inputIndex)

    try {
      const found = await deps.getInscriptionsAtOutpoint(input.txid, input.vout, input.valueSats)
      for (const inscription of found) {
        trackedSats.push({
          label: inscription.id,
          outpoint: { txid: input.txid, vout: input.vout },
          offsetSats: inscription.offsetSats,
        })
      }
    } catch (error) {
      throw new Error(`could not check input ${input.inputIndex} for inscriptions`, {
        cause: error,
      })
    }
  }

  const inscriptionFindings: InscriptionFinding[] = []

  if (trackedSats.length > 0 && inputValuesKnown) {
    const landings = traceSatFlow(
      inputs.map((input) => ({
        outpoint: { txid: input.txid, vout: input.vout },
        valueSats: input.valueSats ?? 0,
      })),
      outputs.map((output) => ({ scriptHex: output.scriptHex ?? '', valueSats: output.valueSats })),
      trackedSats,
    )

    for (const landing of landings) {
      const trackedSat = trackedSats.find((sat) => sat.label === landing.label)
      const resolvedInputIndex = trackedSat
        ? (inputIndexByOutpoint.get(`${trackedSat.outpoint.txid}:${trackedSat.outpoint.vout}`) ?? 0)
        : 0

      if (landing.outputIndex === 'fee') {
        inscriptionFindings.push({
          inscriptionId: landing.label,
          inputIndex: resolvedInputIndex,
          outputIndex: 'fee',
          landsInVault: false,
          landingScriptHex: null,
        })
        warnings.push({
          severity: 'danger',
          message: `Inscription ${landing.label.slice(0, 12)}… would be DESTROYED as transaction fees. Do not sign this.`,
        })
        continue
      }

      const landingOutput = outputs[landing.outputIndex]
      const landsInVault = landingOutput?.class.kind === 'ours'

      inscriptionFindings.push({
        inscriptionId: landing.label,
        inputIndex: resolvedInputIndex,
        outputIndex: landing.outputIndex,
        landsInVault,
        landingScriptHex: landingOutput?.scriptHex ?? null,
      })

      if (!landsInVault) {
        warnings.push({
          severity: 'warning',
          message: `Inscription ${landing.label.slice(0, 12)}… leaves your vault in output ${landing.outputIndex}. Make sure that is intended.`,
        })
      }

      if (landingOutput && landingOutput.scriptHex) {
        const outputScript = hexToBytes(landingOutput.scriptHex)
        const distanceToEnd = landingOutput.valueSats - landing.offsetInOutput
        if (distanceToEnd <= dustThresholdSatsForScript(outputScript)) {
          warnings.push({
            severity: 'warning',
            message: `Inscription ${landing.label.slice(0, 12)}… sits within dust range of the end of output ${landing.outputIndex}. Fragile placement.`,
          })
        }
      }
    }
  } else if (trackedSats.length > 0 && !inputValuesKnown) {
    warnings.push({
      severity: 'danger',
      message:
        'Inscriptions are being spent but sat flow cannot be verified without all input values.',
    })
  }

  return {
    inputs,
    outputs,
    feeSats,
    feeRateSatVb,
    trezorEligible,
    inscriptionFindings,
    warnings,
  }
}
