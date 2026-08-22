import { describe, expect, it } from "vitest"
import { redactSensitiveText, safeErrorText, sanitizeTerminalText, singleLine } from "../../src/text.ts"

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

  it("sanitizes exception text for terminal output", () => {
    expect(safeErrorText(new Error("bad\u001b]8;;https://evil.example\u0007link"), 80)).toBe("badlink")
  })

  it("redacts API credentials while preserving ordinary prose", () => {
    const dummy = "sk-test-only-1234567890abcdef"
    expect(redactSensitiveText(`Authorization: Bearer ${dummy}`))
      .toBe("Authorization: Bearer [redacted]")
    expect(redactSensitiveText(`DEEPSEEK_API_KEY=${dummy}`))
      .toBe("DEEPSEEK_API_KEY=[redacted]")
    expect(redactSensitiveText(`tool returned ${dummy}`))
      .toBe("tool returned [redacted]")
    expect(redactSensitiveText("sk-short ordinary prose")).toBe("sk-short ordinary prose")
  })

  it("redacts a styled credential after removing terminal sequences", () => {
    const styled = "token sk-test-only-\u001b[31m1234567890abcdef\u001b[0m"
    expect(sanitizeTerminalText(styled)).toBe("token [redacted]")
  })
})
