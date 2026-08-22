import { describe, expect, it } from "vitest"
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import type { AppState } from "../../src/controller.ts"
import { sessionPanelText } from "../../src/ui/session-panel.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

const state: AppState = {
  phase: "working",
  sessionId: "session-1234",
  usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 },
  costUsd: 0.000123,
  activeOverlay: null,
  backendMessage: null,
  transcript: [],
  partialAssistantText: "",
  queuedPrompt: null,
  activity: { kind: "tool", name: "read_file" },
  interruption: null,
}

describe("Session Panel", () => {
  it("shows only observable runtime facts", () => {
    const text = stripTerminalSequences(sessionPanelText({
      state,
      model: "deepseek-v4-flash",
      cwd: "/workspace/demo",
      mode: "acp",
      motion: "full",
      theme: createUiTheme("terminal"),
      columns: 64,
    }))

    expect(text).toContain("deepseek-v4-flash")
    expect(text).toContain("/workspace/demo")
    expect(text).toContain("session-1234")
    expect(text).toContain("workspace-write")
    expect(text).not.toMatch(/MCP|Skills|Git|authenticated/i)
  })

  it("stays bounded on narrow terminals", () => {
    const text = sessionPanelText({
      state,
      model: "deepseek-v4-flash",
      cwd: "/workspace/非常长的项目目录",
      mode: "acp",
      motion: "reduced",
      theme: createUiTheme("deepseek"),
      columns: 32,
    })
    expect(text.split("\n").every((line) => visibleWidth(line) <= 32)).toBe(true)
  })

  it("shows a concrete recovery action after an unknown backend outcome", () => {
    const text = stripTerminalSequences(sessionPanelText({
      state: {
        ...state,
        phase: "failed",
        backendMessage: "Backend stopped; outcome unknown.",
        interruption: "outcome-unknown",
      },
      model: "deepseek-v4-flash",
      cwd: "/workspace/demo",
      mode: "acp",
      motion: "off",
      theme: createUiTheme("terminal"),
      columns: 80,
    }))

    expect(text).toContain("Start a new session before retrying")
  })
})
