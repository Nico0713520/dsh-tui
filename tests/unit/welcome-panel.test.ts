import { describe, expect, it } from "vitest"
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import type { AppState } from "../../src/controller.ts"
import {
  compactIdentityText,
  shouldExpandWelcome,
  welcomePanelText,
} from "../../src/ui/welcome-panel.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

const base = {
  tick: { frame: 10, completion: false, settled: true },
  motion: "off" as const,
  tty: true,
  model: "deepseek-v4-flash",
  cwd: "/Users/example/workspace",
  phase: "ready" as const,
  sessionId: "session-1234",
  theme: createUiTheme("terminal"),
}

describe("welcome presentation", () => {
  it.each([
    [120, 5],
    [96, 5],
    [80, 4],
    [60, 4],
    [48, 3],
    [32, 1],
  ])("fits the %i-column tier within its row budget", (columns, maxRows) => {
    const lines = welcomePanelText({ ...base, columns }).split("\n")

    expect(lines.length).toBeLessThanOrEqual(maxRows)
    expect(lines.every((line) => visibleWidth(line) <= columns)).toBe(true)
  })

  it("keeps useful product identity without the old ASCII wordmark", () => {
    const text = stripTerminalSequences(welcomePanelText({ ...base, columns: 120 }))

    expect(text).toContain("DeepSeek Harness")
    expect(text).toContain("deepseek-v4-flash")
    expect(text).toContain("workspace")
    expect(text).toContain("session-1234")
    expect(text).not.toContain("████")
    expect(text).not.toContain("DeepSeek Harness in your terminal")
  })

  it("folds into a single compact identity row after the first user message", () => {
    const text = compactIdentityText({
      columns: 48,
      model: base.model,
      phase: base.phase,
      theme: base.theme,
    })

    expect(stripTerminalSequences(text)).toContain("DeepSeek Harness")
    expect(stripTerminalSequences(text)).toContain("deepseek")
    expect(visibleWidth(text)).toBeLessThanOrEqual(48)
    expect(text).not.toContain("\n")
  })

  it("expands only before a user prompt exists", () => {
    const state = { transcript: [] } satisfies Pick<AppState, "transcript">
    expect(shouldExpandWelcome(state)).toBe(true)
    expect(shouldExpandWelcome({ transcript: [{ kind: "user", text: "hello" }] })).toBe(false)
  })
})
