import { describe, expect, it } from "vitest"
import { Text, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import { ThemeCanvas, paintFullWidth } from "../../src/ui/theme-canvas.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

describe("ThemeCanvas", () => {
  it("fills a DeepSeek Light viewport without changing visible content width", () => {
    const canvas = new ThemeCanvas(() => 4, createUiTheme("deepseek"))
    canvas.addChild(new Text("content"))

    const lines = canvas.render(20)

    expect(lines).toHaveLength(4)
    expect(lines.every((line) => visibleWidth(line) === 20)).toBe(true)
    expect(stripTerminalSequences(lines.join("\n"))).toContain("content")
    expect(lines.every((line) => line.includes("48;2;247;249;255"))).toBe(true)
  })

  it("reapplies the canvas after nested full resets", () => {
    const line = paintFullWidth("left\x1b[0mright", 16, createUiTheme("deepseek"))
    expect(visibleWidth(line)).toBe(16)
    expect(line.match(/48;2;247;249;255/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it("leaves Terminal-theme lines and geometry untouched", () => {
    const canvas = new ThemeCanvas(() => 8, createUiTheme("terminal"))
    const child = new Text("content")
    canvas.addChild(child)
    expect(canvas.render(20)).toEqual(child.render(20))
  })
})
