import { afterEach, describe, expect, it, vi } from "vitest"
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import { DeepPulseClock, ElapsedClock, deepPulseFrame } from "../../src/ui/deep-pulse.ts"

afterEach(() => {
  vi.useRealTimers()
})

describe("Deep Pulse", () => {
  it("uses responsive static fallbacks and never exceeds terminal width", () => {
    expect(deepPulseFrame({ columns: 30, frame: 0, motion: "full", tty: true, completion: false })).toBe("")
    const staticFrame = deepPulseFrame({ columns: 48, frame: 0, motion: "off", tty: true, completion: false })
    expect(stripTerminalSequences(staticFrame)).toBe("dsh-tui")
    expect(deepPulseFrame({ columns: 48, frame: 0, motion: "full", tty: false, completion: false })).toBe(staticFrame)

    for (const columns of [34, 48, 52, 80]) {
      for (let frame = 0; frame <= 12; frame += 1) {
        expect(visibleWidth(deepPulseFrame({ columns, frame, motion: "full", tty: true, completion: false }))).toBeLessThanOrEqual(columns)
      }
    }
  })

  it("animates at 80ms, caps the sweep, and disposes every timer", () => {
    vi.useFakeTimers()
    const ticks: Array<{ frame: number; completion: boolean }> = []
    const clock = new DeepPulseClock("full", (tick) => ticks.push(tick))

    clock.start()
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1_000)
    expect(ticks.length).toBeLessThanOrEqual(11)
    expect(vi.getTimerCount()).toBe(0)

    clock.start()
    clock.collapse()
    expect(vi.getTimerCount()).toBe(0)

    clock.complete()
    expect(ticks.at(-1)?.completion).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(160)
    expect(vi.getTimerCount()).toBe(0)

    clock.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps four sweep frames visible when the backend becomes ready immediately", () => {
    vi.useFakeTimers()
    const ticks: Array<{ frame: number; completion: boolean }> = []
    const clock = new DeepPulseClock("full", (tick) => ticks.push(tick))

    clock.start()
    clock.complete()
    vi.advanceTimersByTime(240)

    expect(ticks.filter((tick) => !tick.completion).map((tick) => tick.frame)).toEqual([0, 1, 2, 3])
    expect(ticks.at(-1)?.completion).toBe(true)
    clock.dispose()
  })

  it("uses only the completion pulse in reduced mode and no timer when off", () => {
    vi.useFakeTimers()
    const reducedTicks: Array<{ completion: boolean }> = []
    const reduced = new DeepPulseClock("reduced", (tick) => reducedTicks.push(tick))
    reduced.start()
    expect(vi.getTimerCount()).toBe(0)
    reduced.complete()
    expect(reducedTicks.some((tick) => tick.completion)).toBe(true)

    const off = new DeepPulseClock("off", () => {})
    off.start()
    off.complete()
    expect(vi.getTimerCount()).toBe(1)
    vi.runAllTimers()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("ticks elapsed time once per second and stops cleanly", () => {
    vi.useFakeTimers()
    let now = 10_000
    const ticks: number[] = []
    const clock = new ElapsedClock((seconds) => ticks.push(seconds), () => now)
    clock.start()
    now = 11_250
    vi.advanceTimersByTime(1_000)
    expect(ticks).toEqual([0, 1])
    clock.stop()
    expect(vi.getTimerCount()).toBe(0)
    clock.dispose()
  })
})
