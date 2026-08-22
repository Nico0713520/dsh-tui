import { describe, expect, it } from "vitest"
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import type { TranscriptItem } from "../../src/controller.ts"
import { toolCardText } from "../../src/ui/tool-card.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

const theme = createUiTheme("terminal")
const result = {
  kind: "tool-result",
  name: "read_file",
  arguments: JSON.stringify({ path: "src/app.ts" }),
  text: "full tool output\nsecond line\nthird line",
  isError: false,
  durationMs: 1_250,
} satisfies TranscriptItem

describe("tool cards", () => {
  it("summarizes pending, success, and error states", () => {
    const pending = toolCardText(
      { kind: "tool-call", name: "read_file", arguments: result.arguments },
      { columns: 80, expanded: false, frame: 0, theme },
    )
    const success = toolCardText(result, { columns: 80, expanded: false, frame: 0, theme })
    const error = toolCardText(
      { ...result, isError: true, text: "permission denied" },
      { columns: 80, expanded: false, frame: 0, theme },
    )

    expect(stripTerminalSequences(pending)).toMatch(/◌ Read · read_file src\/app\.ts/)
    expect(stripTerminalSequences(success)).toMatch(/✓ Read · read_file src\/app\.ts · 1\.3s/)
    expect(stripTerminalSequences(error)).toMatch(/✕ Read · read_file src\/app\.ts · 1\.3s/)
    expect(toolCardText(result, { columns: 80, expanded: false, frame: 0, theme }))
      .toBe(toolCardText(result, { columns: 80, expanded: false, frame: 3, theme }))
  })

  it("keeps compact output to two rows and expanded output bounded", () => {
    const compact = toolCardText(result, { columns: 32, expanded: false, frame: 0, theme })
    const expanded = toolCardText(result, { columns: 32, expanded: true, frame: 0, theme })

    expect(compact.split("\n")).toHaveLength(2)
    expect(stripTerminalSequences(compact)).toContain("full tool output")
    expect(stripTerminalSequences(expanded)).toContain("third line")
    expect(expanded.split("\n").length).toBeLessThanOrEqual(9)
    expect(expanded.split("\n").every((line) => visibleWidth(line) <= 32)).toBe(true)
  })

  it("uses semantic surfaces in DeepSeek Light", () => {
    const light = createUiTheme("deepseek")
    expect(toolCardText(result, { columns: 48, expanded: false, frame: 0, theme: light }))
      .toContain("\x1b[48;2;234;247;240m")
  })
})
