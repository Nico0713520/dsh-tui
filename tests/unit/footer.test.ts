import { describe, expect, it } from "vitest"
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import type { AppState } from "../../src/controller.ts"
import { footerText } from "../../src/ui/footer.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

const state: AppState = {
  phase: "ready",
  sessionId: "session-12345678",
  usage: { inputTokens: 100, outputTokens: 25, cacheReadTokens: 80 },
  costUsd: 0.001234,
  activeOverlay: null,
  backendMessage: null,
  transcript: [],
  partialAssistantText: "",
  queuedPrompt: null,
  activity: { kind: "idle" },
  interruption: null,
}

const options = {
  mode: "acp" as const,
  model: "deepseek-v4-flash",
  cwd: "/Users/example/workspace/dsh-tui",
  elapsedSeconds: 12,
}

describe("adaptive footer", () => {
  it("shows all observable details when space is available", () => {
    const active = { ...state, phase: "working", activity: { kind: "thinking" } } satisfies AppState
    const text = stripTerminalSequences(footerText(active, options, 160, createUiTheme("terminal")))
    expect(text).toContain("deepseek-v4-flash")
    expect(text).toContain("dsh-tui")
    expect(text).toContain("12s")
    expect(text).toContain("session-")
    expect(text).toContain("cached")
    expect(text).toContain("$")
  })

  it("omits meaningless elapsed time while idle", () => {
    const text = stripTerminalSequences(footerText(state, { ...options, elapsedSeconds: 0 }, 120, createUiTheme("terminal")))
    expect(text).not.toContain("0s")
  })

  it("removes cost, token, session, elapsed, then workspace as width shrinks", () => {
    const theme = createUiTheme("terminal")
    const rows = [160, 100, 80, 60, 32].map((columns) => ({
      columns,
      text: stripTerminalSequences(footerText(state, options, columns, theme)),
    }))

    expect(rows.every(({ columns, text }) => visibleWidth(text) <= columns)).toBe(true)
    expect(rows.at(-1)?.text).toContain("ready")
    expect(rows.at(-1)?.text).toContain("deep")
    expect(rows.at(-1)?.text).not.toContain("cached")
  })

  it("lets a transient notice replace lower-priority metrics", () => {
    const text = stripTerminalSequences(footerText(
      state,
      { ...options, notice: "Ctrl+C again to exit" },
      48,
      createUiTheme("terminal"),
    ))
    expect(text).toContain("Ctrl+C again to exit")
    expect(text).not.toContain("cached")
    expect(visibleWidth(text)).toBeLessThanOrEqual(48)
  })
})
