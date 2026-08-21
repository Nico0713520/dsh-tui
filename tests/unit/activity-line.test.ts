import { describe, expect, it } from "vitest"
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import { activityLineText, thinkingTraceText } from "../../src/ui/activity-line.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

const theme = createUiTheme("terminal")

describe("activity line", () => {
  it("shows truthful activity without invented reasoning", () => {
    const text = activityLineText(
      { kind: "thinking" },
      { columns: 48, frame: 2, elapsedSeconds: 3, theme },
    )
    const plain = stripTerminalSequences(text)

    expect(plain).toContain("Thinking")
    expect(plain).toContain("3s")
    expect(plain).not.toMatch(/because|reasoning/i)
    expect(visibleWidth(text)).toBeLessThanOrEqual(48)
  })

  it("renders committed duration as a quiet trace", () => {
    const text = thinkingTraceText(1_250, 32, theme)
    expect(stripTerminalSequences(text)).toContain("Thought for 1.3s")
    expect(visibleWidth(text)).toBeLessThanOrEqual(32)
  })

  it("omits idle activity and remains bounded at every width", () => {
    expect(activityLineText({ kind: "idle" }, { columns: 48, frame: 0, elapsedSeconds: 0, theme })).toBe("")
    for (const columns of [120, 80, 48, 32]) {
      const text = activityLineText(
        { kind: "tool", name: "读取非常长的文件名称" },
        { columns, frame: 0, elapsedSeconds: 12, theme },
      )
      expect(visibleWidth(text)).toBeLessThanOrEqual(columns)
    }
  })

  it("changes only emphasis between visual frames", () => {
    const frames = [0, 1, 2, 3].map((frame) => stripTerminalSequences(activityLineText(
      { kind: "thinking" },
      { columns: 48, frame, elapsedSeconds: 2, theme },
    )))
    expect(new Set(frames).size).toBe(1)
  })
})
