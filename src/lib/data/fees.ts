import type { ElectrsClient } from '$lib/clients/electrs'
import { MAX_FEE_RATE_SAT_VB } from '$lib/security/fee-policy'

export type FeePresets = {
  fast: number | null
  medium: number | null
  slow: number | null
}

function presetFromEstimates(estimates: Record<string, number>, target: number): number | null {
  const value = estimates[String(target)]
  if (typeof value !== 'number' || !Number.isFinite(value)) return null

  if (value > MAX_FEE_RATE_SAT_VB) return null

  return Math.max(1, Math.round(value * 10) / 10)
}

export async function loadFeePresets(electrs: ElectrsClient): Promise<FeePresets> {
  const estimates = await electrs.getFeeEstimates()

  return {
    fast: presetFromEstimates(estimates, 1),
    medium: presetFromEstimates(estimates, 3),
    slow: presetFromEstimates(estimates, 6),
  }
}
