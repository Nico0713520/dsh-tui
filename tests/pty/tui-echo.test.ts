import { describe, expect, it } from "vitest"
import { visibleWidth } from "@earendil-works/pi-tui"
import { spawnTui } from "./pty-harness.ts"

describe("real Echo TUI", () => {
  it("submits CJK, handles narrow resize, clears Ctrl+C notice, and exits", async () => {
    const terminal = spawnTui(["src/main.ts", "--echo"], { cols: 80, rows: 24, env: { DSH_TUI_MODE: "echo" } })
    try {
      await terminal.waitForText("dsh-tui")
      terminal.resize(48, 16)
      terminal.write("你好\r")
      await terminal.waitForText("[echo] 你好")
      await terminal.waitForText("端。")
      await new Promise((resolve) => setTimeout(resolve, 100))
      const overflowing = terminal.screenText().split("\n")
        .map((line, index) => ({ index, width: visibleWidth(line), line }))
        .filter((entry) => entry.width > 48)
      expect(overflowing).toEqual([])

      terminal.resize(32, 14)
      await new Promise((resolve) => setTimeout(resolve, 100))
      const veryNarrowOverflow = terminal.screenText().split("\n")
        .map((line) => visibleWidth(line))
        .filter((width) => width > 32)
      expect(veryNarrowOverflow).toEqual([])
      expect(terminal.screenText()).toContain("dsh-tui")
      terminal.resize(48, 16)

      const noticeStart = terminal.rawLength()
      terminal.write("\u0003")
      await terminal.waitForText("Ctrl+C again to exit", 2_000, noticeStart)
      const clearStart = terminal.rawLength()
      await new Promise((resolve) => setTimeout(resolve, 1_650))
      await terminal.waitForText("echo-1", 2_000, clearStart)
      expect(terminal.raw().slice(clearStart)).not.toContain("Ctrl+C again to exit")

      terminal.write("\u0003")
      await new Promise((resolve) => setTimeout(resolve, 50))
      terminal.write("\u0003")
      await expect(terminal.waitForExit()).resolves.toMatchObject({ exitCode: 0 })
      expect(terminal.raw()).not.toMatch(/uncaught|unhandled|TypeError|ReferenceError/i)
    } finally {
      terminal.kill()
    }
  }, 15_000)
})
