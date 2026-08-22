import { describe, expect, it } from "vitest"
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import { turnSummaryText } from "../../src/ui/turn-summary.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

const theme = createUiTheme("terminal")

describe("turnSummaryText", () => {
  it("renders only verified duration and tool counts", () => {
    const done = stripTerminalSequences(turnSummaryText({
      kind: "turn-summary",
      status: "done",
      durationMs: 84_000,
      toolCount: 7,
      failedToolCount: 1,
    }, 80, theme))
    const interrupted = stripTerminalSequences(turnSummaryText({
      kind: "turn-summary",
      status: "cancelled",
      durationMs: 12_400,
      toolCount: 3,
      failedToolCount: 0,
    }, 80, theme))

    expect(done).toBe("✓ Done · 7 tools · 1 failed · 1m 24s")
    expect(interrupted).toBe("! Interrupted · 3 tools · 12.4s")
  })

  it("keeps every result bounded at narrow widths", () => {
    const text = turnSummaryText({
      kind: "turn-summary",
      status: "outcome-unknown",
      durationMs: 8_100,
      toolCount: 2,
      failedToolCount: 0,
    }, 32, theme)
    expect(visibleWidth(text)).toBeLessThanOrEqual(32)
    expect(stripTerminalSequences(text)).toContain("Outcome unknown")
  })
})
