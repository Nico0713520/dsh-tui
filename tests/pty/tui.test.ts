import { spawn } from "node-pty"
import { describe, expect, it } from "vitest"
import { sanitizeTerminalText } from "../../src/text.ts"

async function waitFor(output: () => string, needle: string): Promise<void> {
  const started = Date.now()
  while (!output().includes(needle)) {
    if (Date.now() - started > 8_000) throw new Error(`PTY output did not contain ${needle}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe("real TUI", () => {
  it("submits Echo mode with CJK, resizes, and exits through double Ctrl+C", async () => {
    const terminal = spawn(process.execPath, ["src/main.ts", "--echo"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: { ...process.env, DSH_TUI_MODE: "echo" },
      encoding: "utf8",
    })
    let raw = ""
    terminal.onData((data) => { raw += data })
    try {
      await waitFor(() => sanitizeTerminalText(raw), "dsh-tui")
      terminal.resize(100, 30)
      terminal.write("你好\r")
      await waitFor(() => sanitizeTerminalText(raw), "[echo] 你好")
      terminal.write("\u0003")
      await new Promise((resolve) => setTimeout(resolve, 50))
      terminal.write("\u0003")
      const exit = await new Promise<{ exitCode: number }>((resolve) => terminal.onExit(resolve))
      expect(exit.exitCode).toBe(0)
      expect(sanitizeTerminalText(raw)).not.toMatch(/uncaught|unhandled|TypeError|ReferenceError/i)
    } finally {
      try { terminal.kill() } catch {}
    }
  }, 15_000)
})
