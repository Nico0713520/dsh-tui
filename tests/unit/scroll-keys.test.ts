import { describe, expect, it } from "vitest"
import { resolveScrollKey } from "../../src/ui/scroll-keys.ts"

const PAGE_UP = "\x1b[5~"
const PAGE_DOWN = "\x1b[6~"
const CTRL_HOME = "\x1b[1;5H"
const CTRL_END = "\x1b[1;5F"
const SHIFT_UP = "\x1b[1;2A"
const SHIFT_DOWN = "\x1b[1;2B"

describe("transcript scroll keys", () => {
  it("maps page and shifted-arrow keys to bounded relative movement", () => {
    expect(resolveScrollKey(PAGE_UP, 24)).toEqual({ kind: "by", lines: -24 })
    expect(resolveScrollKey(PAGE_DOWN, 24)).toEqual({ kind: "by", lines: 24 })
    expect(resolveScrollKey(PAGE_UP, 0)).toEqual({ kind: "by", lines: -1 })
    expect(resolveScrollKey(SHIFT_UP, 24)).toEqual({ kind: "by", lines: -1 })
    expect(resolveScrollKey(SHIFT_DOWN, 24)).toEqual({ kind: "by", lines: 1 })
  })

  it("maps Ctrl+Home and Ctrl+End without stealing editor Home and End", () => {
    expect(resolveScrollKey(CTRL_HOME, 24)).toEqual({ kind: "start", lines: 0 })
    expect(resolveScrollKey(CTRL_END, 24)).toEqual({ kind: "end", lines: 0 })
    expect(resolveScrollKey("\x1b[H", 24)).toBeNull()
    expect(resolveScrollKey("\x1b[F", 24)).toBeNull()
  })

  it("ignores unrelated editor input", () => {
    for (const input of ["a", "\r", "\x1b", "\x1b[A", "\x1b[B"]) {
      expect(resolveScrollKey(input, 24)).toBeNull()
    }
  })
})
