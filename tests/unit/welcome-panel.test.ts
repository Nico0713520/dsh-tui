import { describe, expect, it } from "vitest"
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import { WelcomeTranscriptComponent } from "../../src/ui/welcome-panel.ts"
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
    [60, 11],
    [48, 11],
    [32, 1],
  ])("fits the %i-column tier within its row budget", (columns, maxRows) => {
    const lines = new WelcomeTranscriptComponent({
      ...base,
      columns,
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
      capabilities: textCapabilities,
      assetPath,
    }).render(120).join("\n"))

    expect(text).toContain("dsh-tui  v0.2.0")
    expect(text).toContain("Community client for DeepSeek Harness")
    expect(text).toContain("Welcome back!")
    expect(text).toContain("Tips for getting started")
    expect(text).toContain("Quick actions")
    expect(text).toContain("deepseek-v4-flash")
    expect(text).not.toContain("session-1234")
    expect(text).not.toContain("workspace-write")
    expect(text).not.toContain("approval ask")
  })

  it("keeps the complete card when the session starts working", () => {
    const component = new WelcomeTranscriptComponent({
      ...base,
      columns: 120,
      capabilities: textCapabilities,
      assetPath,
    })

    component.update({ ...base, columns: 120, phase: "working" })
    const text = stripTerminalSequences(component.render(120).join("\n"))

    expect(text).toContain("Welcome back!")
    expect(text).toContain("Tips for getting started")
    expect(text).toContain("Quick actions")
  })

  it("reuses the settled card across animation-only ticks", () => {
    const component = new WelcomeTranscriptComponent({
      ...base,
      columns: 120,
      capabilities: textCapabilities,
      assetPath,
    })
    const first = component.render(120)

    component.update({
      ...base,
      columns: 120,
      tick: { frame: 2, completion: false, settled: true },
    })
    expect(component.render(120)).toBe(first)

    component.update({ ...base, columns: 120, phase: "working" })
    expect(component.render(120)).not.toBe(first)
  })
})
