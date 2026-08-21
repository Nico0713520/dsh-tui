import { describe, expect, it } from "vitest"
import { stripTerminalSequences, visibleWidth, type Component } from "@earendil-works/pi-tui"
import { ThemeCanvas } from "../../src/ui/theme-canvas.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

class WideComponent implements Component {
  constructor(private readonly lines: string[]) {}
  render(): string[] { return this.lines }
  invalidate(): void {}
}

describe("ThemeCanvas width guard", () => {
  it("clips over-wide child lines under the terminal theme too", () => {
    const theme = createUiTheme("terminal", { color: false })
    const canvas = new ThemeCanvas(() => 10, theme)
    canvas.addChild(new WideComponent([
      "x".repeat(200),
      "short",
      `plain ${"y".repeat(120)} tail`,
    ]))
    const rendered = canvas.render(40)
    expect(rendered).toHaveLength(3)
    for (const line of rendered) {
      expect(visibleWidth(stripTerminalSequences(line))).toBeLessThanOrEqual(40)
    }
  })

  it("degrades to one column instead of crashing at width 0", () => {
    const theme = createUiTheme("terminal", { color: false })
    const canvas = new ThemeCanvas(() => 10, theme)
    canvas.addChild(new WideComponent(["abcdefgh", "ij"]))
    const rendered = canvas.render(0)
    expect(rendered.length).toBeGreaterThan(0)
    for (const line of rendered) {
      expect(visibleWidth(stripTerminalSequences(line))).toBeLessThanOrEqual(1)
    }
  })
})
