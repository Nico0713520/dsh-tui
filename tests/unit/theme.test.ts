import { describe, expect, it } from "vitest"
import { stripTerminalSequences } from "@earendil-works/pi-tui"
import { createUiTheme } from "../../src/ui/theme.ts"

describe("semantic UI themes", () => {
  it("covers every semantic role in both themes", () => {
    const foregrounds = [
      "brand", "accent", "text", "muted", "subtle",
      "success", "warning", "error", "border", "borderFocus",
    ] as const
    const surfaces = ["canvas", "user", "toolPending", "toolSuccess", "toolError", "overlay"] as const

    for (const name of ["terminal", "deepseek"] as const) {
      const theme = createUiTheme(name, { color: true })
      expect(theme.name).toBe(name)
      for (const role of foregrounds) expect(stripTerminalSequences(theme.fg(role, role))).toBe(role)
      for (const role of surfaces) expect(stripTerminalSequences(theme.bg(role, role))).toBe(role)
      expect(stripTerminalSequences(theme.markdown.heading("heading"))).toBe("heading")
      expect(stripTerminalSequences(theme.select.selectedText("selected"))).toBe("selected")
    }
  })

  it("keeps Terminal transparent and paints the DeepSeek Light canvas", () => {
    expect(createUiTheme("terminal").canvasBackground).toBeNull()
    expect(createUiTheme("deepseek").canvasBackground).toBe("#F7F9FF")
    expect(createUiTheme("deepseek").fg("brand", "x")).toContain("38;2;77;107;254")
    expect(createUiTheme("deepseek").bg("canvas", "x")).toContain("48;2;247;249;255")
  })

  it("retains hierarchy without decorative color", () => {
    const theme = createUiTheme("deepseek", { color: false })
    expect(theme.fg("error", "failure")).toBe("failure")
    expect(theme.bg("user", "prompt")).toBe("prompt")
    expect(theme.strong("title")).toContain("title")
  })
})
