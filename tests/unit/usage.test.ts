import { describe, expect, it } from "vitest"
import { addUsage, estimateCostUsd } from "../../src/usage.ts"

describe("usage and pricing", () => {
  it("adds token samples without subtracting cache reads from input", () => {
    expect(addUsage(
      { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 },
      { inputTokens: 27, outputTokens: 5, cacheReadTokens: 256 },
    )).toEqual({ inputTokens: 37, outputTokens: 7, cacheReadTokens: 259 })
  })

  it("charges disjoint input and cache tokens at the peak boundary", () => {
    const peak = new Date("2026-08-18T13:00:00.000Z")
    expect(estimateCostUsd(
      "deepseek-v4-flash",
      { inputTokens: 27, cacheReadTokens: 256, outputTokens: 0 },
      peak,
    )).toBe(0.00001546)
  })

  it("uses half rates off peak and returns null for unknown models", () => {
    const offPeak = new Date("2026-08-18T12:29:00.000Z")
    expect(estimateCostUsd("deepseek-v4-flash", { inputTokens: 1_000_000 }, offPeak)).toBe(0.22)
    expect(estimateCostUsd("unknown-model", { inputTokens: 1 }, offPeak)).toBeNull()
  })
})
