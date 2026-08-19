import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import { LatestRenderGate } from "../../src/ui/render-backpressure.ts"

class FakeOutput extends EventEmitter {
  writableNeedDrain = false
}

describe("LatestRenderGate", () => {
  it("coalesces blocked updates to the newest state and flushes it after drain", () => {
    const output = new FakeOutput()
    const flushed: number[] = []
    const gate = new LatestRenderGate<number>(output, (value) => flushed.push(value))
    output.writableNeedDrain = true

    for (let value = 0; value < 100; value += 1) gate.submit(value)
    expect(flushed).toEqual([])
    expect(output.listenerCount("drain")).toBe(1)

    output.writableNeedDrain = false
    output.emit("drain")
    expect(flushed).toEqual([99])
    expect(output.listenerCount("drain")).toBe(0)
  })

  it("never drops the newest unblocked value and removes listeners on dispose", () => {
    const output = new FakeOutput()
    const flushed: string[] = []
    const gate = new LatestRenderGate<string>(output, (value) => flushed.push(value))
    output.writableNeedDrain = true
    gate.submit("partial")
    gate.submit("committed", true)

    expect(flushed).toEqual(["committed"])
    expect(output.listenerCount("drain")).toBe(0)
    gate.dispose()
    gate.submit("after dispose")
    expect(flushed).toEqual(["committed"])
  })

  it("keeps idle event-to-view handoff P95 below 50ms", () => {
    const output = new FakeOutput()
    const started = new Map<number, number>()
    const latencies: number[] = []
    const gate = new LatestRenderGate<number>(output, (value) => {
      latencies.push(performance.now() - (started.get(value) ?? 0))
    })
    for (let sample = 0; sample < 50; sample += 1) {
      started.set(sample, performance.now())
      gate.submit(sample)
    }
    const sorted = [...latencies].sort((left, right) => left - right)
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY
    expect(p95).toBeLessThan(50)
  })
})
