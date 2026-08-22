import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import { LatestRenderGate } from "../../src/ui/render-backpressure.ts"

class FakeOutput extends EventEmitter {
  writableNeedDrain = false
}

class FakeScheduler {
  nowMs = 0
  private nextId = 1
  private readonly timers = new Map<number, { at: number; callback: () => void }>()

  readonly now = (): number => this.nowMs

  readonly setTimer = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId
    this.nextId += 1
    this.timers.set(id, { at: this.nowMs + Math.max(0, delayMs), callback })
    return id as unknown as ReturnType<typeof setTimeout>
  }

  readonly clearTimer = (timer: ReturnType<typeof setTimeout>): void => {
    this.timers.delete(timer as unknown as number)
  }

  advance(ms: number): void {
    this.nowMs += ms
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.nowMs)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
      if (!due) return
      this.timers.delete(due[0])
      due[1].callback()
    }
  }

  get count(): number {
    return this.timers.size
  }
}

function createGate<T>(output: FakeOutput, flushed: T[], scheduler: FakeScheduler): LatestRenderGate<T> {
  return new LatestRenderGate(output, (value) => flushed.push(value), {
    frameMs: 33,
    now: scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
  })
}

describe("LatestRenderGate", () => {
  it("flushes the first unblocked state immediately", () => {
    const output = new FakeOutput()
    const scheduler = new FakeScheduler()
    const flushed: number[] = []
    const gate = createGate(output, flushed, scheduler)

    gate.submit(1)

    expect(flushed).toEqual([1])
    expect(scheduler.count).toBe(0)
  })

  it("coalesces same-frame states and flushes only the newest one", () => {
    const output = new FakeOutput()
    const scheduler = new FakeScheduler()
    const flushed: number[] = []
    const gate = createGate(output, flushed, scheduler)
    gate.submit(-1)

    for (let value = 0; value < 100; value += 1) gate.submit(value)
    expect(flushed).toEqual([-1])
    expect(scheduler.count).toBe(1)

    scheduler.advance(32)
    expect(flushed).toEqual([-1])
    scheduler.advance(1)
    expect(flushed).toEqual([-1, 99])
  })

  it("flushes priority immediately and cancels a pending frame", () => {
    const output = new FakeOutput()
    const scheduler = new FakeScheduler()
    const flushed: string[] = []
    const gate = createGate(output, flushed, scheduler)
    gate.submit("first")
    gate.submit("partial")

    gate.submit("ready", true)

    expect(flushed).toEqual(["first", "ready"])
    expect(scheduler.count).toBe(0)
    scheduler.advance(100)
    expect(flushed).toEqual(["first", "ready"])
  })

  it("coalesces blocked updates to the newest state and flushes it after drain", () => {
    const output = new FakeOutput()
    const scheduler = new FakeScheduler()
    const flushed: number[] = []
    const gate = createGate(output, flushed, scheduler)
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
    const scheduler = new FakeScheduler()
    const flushed: string[] = []
    const gate = createGate(output, flushed, scheduler)
    output.writableNeedDrain = true
    gate.submit("partial")
    gate.submit("committed", true)

    expect(flushed).toEqual(["committed"])
    expect(output.listenerCount("drain")).toBe(0)
    gate.dispose()
    gate.submit("after dispose")
    expect(flushed).toEqual(["committed"])
  })

  it("removes drain listeners and frame timers on dispose", () => {
    const output = new FakeOutput()
    const scheduler = new FakeScheduler()
    const flushed: number[] = []
    const gate = createGate(output, flushed, scheduler)
    gate.submit(1)
    gate.submit(2)
    expect(scheduler.count).toBe(1)

    output.writableNeedDrain = true
    gate.submit(3)
    expect(output.listenerCount("drain")).toBe(1)

    gate.dispose()
    expect(scheduler.count).toBe(0)
    expect(output.listenerCount("drain")).toBe(0)
    scheduler.advance(100)
    output.emit("drain")
    expect(flushed).toEqual([1])
  })
})
