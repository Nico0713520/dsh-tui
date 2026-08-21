import { describe, expect, it } from "vitest"
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import type { AppState } from "../../src/controller.ts"
import {
  compactIdentityText,
  shouldExpandWelcome,
  WelcomeTranscriptComponent,
} from "../../src/ui/welcome-panel.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

const assetPath = new URL("../../assets/brand/deepseek-whale.png.base64", import.meta.url)
const textCapabilities = { images: null, trueColor: true, hyperlinks: true } as const

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
    [120, 11],
    [96, 11],
    [80, 10],
    [60, 10],
    [48, 10],
    [32, 1],
  ])("fits the %i-column tier within its row budget", (columns, maxRows) => {
    const lines = new WelcomeTranscriptComponent({
      ...base,
      columns,
      expanded: true,
      capabilities: textCapabilities,
      assetPath,
    }).render(columns)

    expect(lines.length).toBeLessThanOrEqual(maxRows)
    expect(lines.every((line) => visibleWidth(line) <= columns)).toBe(true)
  })

  it("uses the framed hierarchy without startup diagnostics", () => {
    const text = stripTerminalSequences(new WelcomeTranscriptComponent({
      ...base,
      columns: 120,
      expanded: true,
      capabilities: textCapabilities,
      assetPath,
    }).render(120).join("\n"))

    expect(text).toContain("DeepSeek Harness")
    expect(text).toContain("Welcome back!")
    expect(text).toContain("Tips for getting started")
    expect(text).toContain("Quick actions")
    expect(text).toContain("deepseek-v4-flash")
    expect(text).not.toContain("session-1234")
    expect(text).not.toContain("workspace-write")
    expect(text).not.toContain("approval ask")
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
