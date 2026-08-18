export interface Usage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
}

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

export function addUsage(total: Usage, sample: Usage): Usage {
  return {
    inputTokens: count(total.inputTokens) + count(sample.inputTokens),
    outputTokens: count(total.outputTokens) + count(sample.outputTokens),
    cacheReadTokens: count(total.cacheReadTokens) + count(sample.cacheReadTokens),
  }
}

const RATES: Record<string, readonly [cacheHit: number, input: number, output: number]> = {
  "deepseek-v4-flash": [0.014, 0.44, 1.32],
  "deepseek-v4-pro": [0.044, 1.32, 3.96],
}

function isPeak(at: Date): boolean {
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes()
  return minute >= 750 && minute < 990
}

export function estimateCostUsd(model: string, usage: Usage, at = new Date()): number | null {
  const rates = RATES[model]
  if (!rates) return null
  const factor = isPeak(at) ? 1 : 0.5
  const [cacheRate, inputRate, outputRate] = rates
  const cost = (
    count(usage.cacheReadTokens) * cacheRate
    + count(usage.inputTokens) * inputRate
    + count(usage.outputTokens) * outputRate
  ) / 1_000_000 * factor
  return Number(cost.toFixed(8))
}
