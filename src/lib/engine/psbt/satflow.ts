import { formatOutpoint, type Outpoint, sameOutpoint } from '$lib/engine/outpoints'

export type SatFlowInput = {
  outpoint: Outpoint
  valueSats: number
}

export type SatFlowOutput = {
  scriptHex: string
  valueSats: number
}

export type TrackedSat = {
  label: string
  outpoint: Outpoint
  offsetSats: number
}

export type SatLanding = {
  label: string
  outputIndex: number | 'fee'
  offsetInOutput: number
}

// Independent FIFO accounting over the final input/output lists. Deliberately
// shares no arithmetic with the transfer planner so it can veto planner bugs.
export function traceSatFlow(
  inputs: SatFlowInput[],
  outputs: SatFlowOutput[],
  trackedSats: TrackedSat[],
): SatLanding[] {
  const inputStartByOutpoint = new Map<string, number>()
  let cumulativeInput = 0

  for (const input of inputs) {
    inputStartByOutpoint.set(formatOutpoint(input.outpoint), cumulativeInput)
    cumulativeInput += input.valueSats
  }

  return trackedSats.map((sat) => {
    const inputStart = inputStartByOutpoint.get(formatOutpoint(sat.outpoint))
    if (inputStart === undefined) {
      throw new Error(`tracked sat ${sat.label} is not spent by any input`)
    }

    const inputMatch = inputs.find((input) => sameOutpoint(input.outpoint, sat.outpoint))
    if (!inputMatch || sat.offsetSats >= inputMatch.valueSats) {
      throw new Error(`tracked sat ${sat.label} offset exceeds its input value`)
    }

    const absolutePosition = inputStart + sat.offsetSats

    let outputStart = 0
    for (const [outputIndex, output] of outputs.entries()) {
      const outputEnd = outputStart + output.valueSats
      if (absolutePosition < outputEnd) {
        return { label: sat.label, outputIndex, offsetInOutput: absolutePosition - outputStart }
      }
      outputStart = outputEnd
    }

    return {
      label: sat.label,
      outputIndex: 'fee' as const,
      offsetInOutput: absolutePosition - outputStart,
    }
  })
}
