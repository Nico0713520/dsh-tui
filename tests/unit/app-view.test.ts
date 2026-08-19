import { describe, expect, it } from "vitest"
import { visibleWidth } from "@earendil-works/pi-tui"
import type { AppState } from "../../src/controller.ts"
import { headerText, statusText, toolResultText } from "../../src/ui/app-view.ts"

const state: AppState = {
  phase: "ready",
  sessionId: "session-1234",
  usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 },
  costUsd: 0.000123,
  activeOverlay: null,
  backendMessage: null,
  transcript: [],
  partialAssistantText: "",
}

describe("TUI presentation", () => {
  it("keeps header copy within narrow terminal widths", () => {
    expect(visibleWidth(headerText(48))).toBeLessThanOrEqual(48)
    expect(visibleWidth(headerText(64))).toBeLessThanOrEqual(64)
    expect(visibleWidth(headerText(80))).toBeLessThanOrEqual(80)
  })

  it("renders starting instead of falsely reporting ready", () => {
    const text = statusText({ ...state, phase: "starting", sessionId: null }, { mode: "acp", model: "deepseek-v4-flash" }, 48)
    expect(text).toContain("starting")
    expect(text).not.toContain("ready")
    expect(visibleWidth(text)).toBeLessThanOrEqual(48)
  })

  it("truncates tool results to the visible terminal width", () => {
    const text = toolResultText({ kind: "tool-result", name: "tool", text: "结果 ".repeat(100), isError: false }, 48)
    expect(visibleWidth(text)).toBeLessThanOrEqual(48)
  })
})
