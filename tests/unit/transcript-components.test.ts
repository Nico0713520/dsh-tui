import { describe, expect, it } from "vitest"
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import {
  renderAssistantMessage,
  renderDiagnostic,
  renderHistoryBoundary,
  renderUserMessage,
} from "../../src/ui/transcript-components.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

describe("transcript hierarchy", () => {
  it("renders a bounded CJK user message with a single brand rail", () => {
    const component = renderUserMessage("你好，帮我检查这个很长的终端界面。".repeat(4), createUiTheme("terminal"))
    const lines = component.render(48)
    const plain = lines.map(stripTerminalSequences)

    expect(plain.join("\n")).toContain("你好")
    expect(plain.every((line) => line.startsWith("▌ "))).toBe(true)
    expect(lines.every((line) => visibleWidth(line) <= 48)).toBe(true)
  })

  it("uses a distinct pale surface only in DeepSeek Light", () => {
    const terminal = renderUserMessage("hello", createUiTheme("terminal")).render(48).join("\n")
    const light = renderUserMessage("hello", createUiTheme("deepseek")).render(48).join("\n")

    expect(light).not.toBe(terminal)
    expect(light).toContain("\x1b[48;2;238;243;255m")
  })

  it("keeps assistant prose avatar-free and Markdown-aware", () => {
    const lines = renderAssistantMessage("## Result\n\nDone.", createUiTheme("terminal")).render(48)
    const plain = stripTerminalSequences(lines.join("\n"))

    expect(plain).toContain("Result")
    expect(plain).toContain("Done.")
    expect(plain).not.toMatch(/assistant|❯/i)
    expect(lines.every((line) => visibleWidth(line) <= 48)).toBe(true)
  })

  it("keeps diagnostics and history boundaries secondary and bounded", () => {
    for (const component of [
      renderDiagnostic("backend unavailable ".repeat(10), createUiTheme("terminal")),
      renderHistoryBoundary("history abcdef12 (read-only)", createUiTheme("terminal")),
    ]) {
      const lines = component.render(32)
      expect(lines.every((line) => visibleWidth(line) <= 32)).toBe(true)
    }
    expect(stripTerminalSequences(renderDiagnostic("warning", createUiTheme("terminal")).render(32).join("")))
      .toContain("! warning")
  })
})
