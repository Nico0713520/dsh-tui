import { describe, expect, it } from "vitest"
import { sanitizeTerminalText, singleLine } from "../../src/text.ts"

describe("terminal text", () => {
  it("removes CSI, OSC hyperlinks, carriage returns, and NUL", () => {
    const value = "ok\u001b[2Jbad\u001b]8;;https://evil.test\u0007link\u001b]8;;\u0007\r\u0000done"
    expect(sanitizeTerminalText(value)).toBe("okbadlinkdone")
  })

  it("preserves line feeds and tabs for markdown text", () => {
    expect(sanitizeTerminalText("a\n\tb")).toBe("a\n\tb")
  })

  it("normalizes newlines and truncates by terminal width", () => {
    expect(singleLine("中文\n路径", 20)).toBe("中文 路径")
    expect(singleLine("中文路径", 5)).toBe("中文…")
  })
})
