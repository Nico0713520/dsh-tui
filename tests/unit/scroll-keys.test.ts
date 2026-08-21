import { describe, expect, it } from "vitest"
import { resolveScrollKey } from "../../src/ui/app-view.ts"

const PAGE_UP = "\x1b[5~"
const PAGE_DOWN = "\x1b[6~"
const HOME = "\x1b[H"
const END = "\x1b[F"
const SHIFT_UP = "\x1b[1;2A"
const SHIFT_DOWN = "\x1b[1;2B"

describe("transcript scroll keys", () => {
  it("maps page keys to viewport-sized jumps", () => {
    expect(resolveScrollKey(PAGE_UP, 24)).toEqual({ kind: "by", lines: -24 })
    expect(resolveScrollKey(PAGE_DOWN, 24)).toEqual({ kind: "by", lines: 24 })
  })

  it("clamps degenerate viewport heights to at least one line", () => {
    expect(resolveScrollKey(PAGE_UP, 0)).toEqual({ kind: "by", lines: -1 })
    expect(resolveScrollKey(PAGE_DOWN, 0)).toEqual({ kind: "by", lines: 1 })
  })

  it("maps shifted arrows to single-line scrolls", () => {
    expect(resolveScrollKey(SHIFT_UP, 24)).toEqual({ kind: "by", lines: -1 })
    expect(resolveScrollKey(SHIFT_DOWN, 24)).toEqual({ kind: "by", lines: 1 })
  })

  it("maps home and end to absolute jumps", () => {
    expect(resolveScrollKey(HOME, 24)).toEqual({ kind: "start", lines: 0 })
    expect(resolveScrollKey(END, 24)).toEqual({ kind: "end", lines: 0 })
  })

  it("accepts common terminal variants of home and end", () => {
    expect(resolveScrollKey("\x1b[1~", 24)).toEqual({ kind: "start", lines: 0 })
    expect(resolveScrollKey("\x1bOH", 24)).toEqual({ kind: "start", lines: 0 })
    expect(resolveScrollKey("\x1b[4~", 24)).toEqual({ kind: "end", lines: 0 })
    expect(resolveScrollKey("\x1bOF", 24)).toEqual({ kind: "end", lines: 0 })
  })

  it("ignores unrelated editor input", () => {
    expect(resolveScrollKey("a", 24)).toBeNull()
    expect(resolveScrollKey("\r", 24)).toBeNull()
    expect(resolveScrollKey("\x1b", 24)).toBeNull()
    expect(resolveScrollKey("\x1b[A", 24)).toBeNull()
    expect(resolveScrollKey("\x1b[B", 24)).toBeNull()
  })
})
