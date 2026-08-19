import { describe, expect, it } from "vitest"
import { TurnPerf } from "../../src/perf.ts"

describe("TurnPerf", () => {
  it("reports only monotonic timing deltas and keeps first marks", () => {
    const perf = new TurnPerf()
    perf.start(100)
    perf.mark("first-live-event", 140)
    perf.mark("first-live-event", 999)
    perf.mark("first-live-text", 160)
    perf.mark("first-live-text-paint", 172)
    perf.mark("acp-committed", 300)
    perf.mark("settled", 310)

    expect(perf.report()).toBe("backend 40ms · text 60ms · paint 12ms · settle 210ms")
  })

  it("omits unavailable spans and resets without retaining payloads", () => {
    const perf = new TurnPerf()
    perf.start(10)
    perf.mark("settled", 25)
    expect(perf.report()).toBe("settle 15ms")
    perf.reset()
    expect(perf.report()).toBe("")
    expect(JSON.stringify(perf)).not.toContain("prompt")
  })
})
