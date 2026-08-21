import { describe, expect, it } from "vitest"
import { stripTerminalSequences, Text, visibleWidth } from "@earendil-works/pi-tui"
import { whalePixelArt } from "../../src/ui/brand-logo.ts"
import { WelcomeCard } from "../../src/ui/welcome-card.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

const theme = createUiTheme("terminal")

function card(columns: number): readonly string[] {
  const tier = columns >= 96 ? "full" : "compact"
  return new WelcomeCard({
    columns,
    logo: columns >= 48 ? new Text(theme.fg("brand", whalePixelArt(tier).join("\n")), 0, 0) : null,
    model: "deepseek-v4-flash",
    cwd: "/Users/example/dsh-tui",
    phase: "ready",
    theme,
  }).render(columns)
}

describe("Claude-style welcome card", () => {
  it("renders a calm framed split hierarchy on wide terminals", () => {
    const lines = card(120)
    const plain = stripTerminalSequences(lines.join("\n"))

    expect(lines.length).toBeLessThanOrEqual(11)
    expect(plain).toContain("╭─ DeepSeek Harness  v0.1.0")
    expect(plain).toContain("Welcome back!")
    expect(plain).toContain("Tips for getting started")
    expect(plain).toContain("Quick actions")
    expect(plain).toContain("deepseek-v4-flash · ready")
    expect(plain).toContain("dsh-tui")
    expect(plain).not.toContain("session-1234")
    expect(plain).not.toContain("workspace-write")
    expect(plain).not.toContain("approval ask")
    expect(lines.every((line) => visibleWidth(line) <= 120)).toBe(true)
  })

  it.each([
    [120, 11],
    [96, 11],
    [80, 10],
    [72, 10],
    [60, 10],
    [48, 10],
    [40, 4],
    [34, 4],
    [32, 1],
  ])("keeps the %i-column tier complete and within %i rows", (columns, maxRows) => {
    const lines = card(columns)
    expect(lines.length).toBeLessThanOrEqual(maxRows)
    expect(lines.every((line) => visibleWidth(line) <= columns)).toBe(true)
    if (columns >= 34) {
      const plain = stripTerminalSequences(lines.join("\n"))
      expect(plain.startsWith("╭")).toBe(true)
      expect(plain.endsWith("╯")).toBe(true)
    }
  })

  it("uses a stacked card without a vertical split when width is scarce", () => {
    const plain = stripTerminalSequences(card(60).join("\n"))
    expect(plain).toContain("Welcome back!")
    expect(plain).toContain("Enter a task")
    expect(plain).not.toContain("Tips for getting started")
    expect(plain).not.toContain("├")
    expect(plain).not.toContain("┤")
  })

  it("uses a compact framed identity before falling back to one line", () => {
    const compact = stripTerminalSequences(card(40).join("\n"))
    expect(compact).toContain("DeepSeek Harness")
    expect(compact).toContain("Enter a task")
    expect(compact).not.toContain("▀")
    expect(stripTerminalSequences(card(32).join("\n"))).toBe("dsh-tui · ready")
  })
})
