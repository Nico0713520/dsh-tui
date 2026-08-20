import { describe, expect, it } from "vitest"
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import type { AppState } from "../../src/controller.ts"
import { shouldExpandWelcome, welcomePanelText } from "../../src/ui/welcome-panel.ts"

const state: AppState = {
  phase: "ready",
  sessionId: "session-1234567890",
  usage: {},
  costUsd: null,
  activeOverlay: null,
  backendMessage: null,
  transcript: [],
  partialAssistantText: "",
  queuedPrompt: null,
  activity: { kind: "idle" },
  interruption: null,
}

const base = {
  tick: { frame: 2, completion: false, settled: false },
  motion: "full" as const,
  tty: true,
  model: "deepseek-v4-flash",
  cwd: "/Users/example/很长的中文工作区/开源项目/dsh-tui",
  phase: "ready" as const,
  sessionId: "session-1234567890",
}

describe("welcome panel", () => {
  it("renders a bounded responsive tier at every supported width", () => {
    for (const columns of [24, 32, 34, 48, 60, 80, 96, 120]) {
      const text = welcomePanelText({ ...base, columns })
      expect(text.split("\n").every((line) => visibleWidth(line) <= columns)).toBe(true)
    }
  })

  it("keeps the complete identity and useful session context in the full tier", () => {
    const text = stripTerminalSequences(welcomePanelText({ ...base, columns: 120 }))
    expect(text).toContain("DeepSeek Harness in your terminal")
    expect(text).toContain("deepseek-v4-flash")
    expect(text).toContain("workspace")
    expect(text).toContain("session")
    expect(text).toContain("workspace-write")
    expect(text).toContain("Enter send")
    expect(text.split("\n").length).toBeGreaterThanOrEqual(8)
  })

  it("sweeps a visible highlight across the full DSH wordmark without moving it", () => {
    const first = welcomePanelText({ ...base, columns: 120, tick: { frame: 0, completion: false, settled: false } })
    const third = welcomePanelText({ ...base, columns: 120, tick: { frame: 2, completion: false, settled: false } })

    expect(first.split("\n")[2]).not.toBe(third.split("\n")[2])
    expect(stripTerminalSequences(first)).toBe(stripTerminalSequences(third))
  })

  it("removes decoration before identity as the terminal narrows", () => {
    const medium = stripTerminalSequences(welcomePanelText({ ...base, columns: 80 }))
    const narrow = stripTerminalSequences(welcomePanelText({ ...base, columns: 48 }))
    const tiny = stripTerminalSequences(welcomePanelText({ ...base, columns: 24 }))

    expect(medium).toContain("DeepSeek Harness in your terminal")
    expect(medium).not.toContain("████▄")
    expect(narrow).toContain("dsh-tui")
    expect(narrow).toContain("deepseek")
    expect(tiny).not.toContain("█")
  })

  it("expands only while a session has no committed user prompt", () => {
    expect(shouldExpandWelcome(state)).toBe(true)
    expect(shouldExpandWelcome({
      ...state,
      transcript: [{ kind: "assistant", text: "prelude" }],
    })).toBe(true)
    expect(shouldExpandWelcome({
      ...state,
      transcript: [{ kind: "user", text: "hello" }],
    })).toBe(false)
  })
})
