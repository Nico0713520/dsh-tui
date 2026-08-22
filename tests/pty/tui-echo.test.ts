import { describe, expect, it } from "vitest"
import { visibleWidth } from "@earendil-works/pi-tui"
import { spawnTui } from "./pty-harness.ts"

describe("real Echo TUI", () => {
  it("shows the complete welcome immediately and keeps it above the first exchange", async () => {
    const terminal = spawnTui(["src/main.ts", "--echo", "--motion", "off"], { cols: 120, rows: 30 })
    try {
      await terminal.waitForText("Welcome back!")
      await terminal.waitForText("Quick actions")
      await terminal.waitForText("deepseek-v4-flash")
      expect(terminal.screenText()).toContain("▗█████████▙▖")
      expect(terminal.screenText()).toContain("Tips for getting started")
      expect(terminal.screenText()).toContain("Quick actions")
      expect(terminal.screenText()).toContain("deepseek-v4-flash")
      expect(terminal.screenText()).not.toContain("workspace-write")
      expect(terminal.screenText()).not.toContain("approval ask")

      const promptStart = terminal.rawLength()
      terminal.write("hello\r")
      await terminal.waitForText("[echo] hello")
      await terminal.waitForText("端。", 2_000, promptStart)
      await terminal.waitForText("ready", 2_000, promptStart)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(terminal.screenText()).toContain("Welcome back!")
      expect(terminal.screenText()).toContain("▗█████████▙▖")
      expect(terminal.screenText()).toContain("[echo] hello")

      const statusStart = terminal.rawLength()
      terminal.write("/status\r")
      await terminal.waitForText("Session", 2_000, statusStart)
      await terminal.waitForText("workspace-write", 2_000, statusStart)
      expect(terminal.raw().slice(statusStart)).not.toContain("[echo] /status")
      terminal.write("\u001b")
      await new Promise((resolve) => setTimeout(resolve, 100))

      const toolsStart = terminal.rawLength()
      terminal.write("\u000f")
      await terminal.waitForText("tool details expanded", 2_000, toolsStart)
      expect(terminal.screenText()).not.toContain("^O")

      terminal.write("\u0003")
      await new Promise((resolve) => setTimeout(resolve, 50))
      terminal.write("\u0003")
      await expect(terminal.waitForExit()).resolves.toMatchObject({ exitCode: 0 })
    } finally {
      terminal.kill()
    }
  }, 10_000)

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
      expect(terminal.screenText()).toContain("dsh-tui · ready")
      terminal.resize(48, 16)
      await new Promise((resolve) => setTimeout(resolve, 100))

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

  it("keeps Home and End available for prompt editing on the main screen", async () => {
    const terminal = spawnTui(["src/main.ts", "--echo", "--motion", "off"], { cols: 80, rows: 24 })
    try {
      await terminal.waitForText("dsh-tui")
      const start = terminal.rawLength()
      terminal.write("ac")
      terminal.write("\u001b[H")
      terminal.write("b")
      terminal.write("\u001b[F")
      terminal.write("d\r")

      await terminal.waitForText("[echo] bacd", 3_000, start)
      terminal.write("\u0003")
      await new Promise((resolve) => setTimeout(resolve, 50))
      terminal.write("\u0003")
      await expect(terminal.waitForExit()).resolves.toMatchObject({ exitCode: 0 })
    } finally {
      terminal.kill()
    }
  }, 10_000)

  it("keeps the empty welcome composed while resizing from wide to text-only", async () => {
    const terminal = spawnTui(["src/main.ts", "--echo", "--motion", "off"], { cols: 120, rows: 30 })
    try {
      await terminal.waitForText("Welcome back!")
      for (const [columns, rows] of [[80, 24], [60, 20], [48, 18], [32, 14]] as const) {
        terminal.resize(columns, rows)
        await new Promise((resolve) => setTimeout(resolve, 100))
        const overflow = terminal.screenText().split("\n").filter((line) => visibleWidth(line) > columns)
        expect(overflow).toEqual([])
      }
      expect(terminal.screenText()).toContain("dsh-tui")
      expect(terminal.screenText()).not.toContain("╭")
      terminal.write("\u0003")
      await new Promise((resolve) => setTimeout(resolve, 50))
      terminal.write("\u0003")
      await expect(terminal.waitForExit()).resolves.toMatchObject({ exitCode: 0 })
    } finally {
      terminal.kill()
    }
  }, 10_000)

  it("renders the faithful inline whale on image-capable terminals", async () => {
    const terminal = spawnTui(["src/main.ts", "--echo", "--motion", "off"], {
      cols: 120,
      rows: 30,
      env: { TERM_PROGRAM: "iTerm.app", ITERM_SESSION_ID: "test-session", TMUX: undefined },
    })
    try {
      await terminal.waitForText("DeepSeek Harness")
      await terminal.waitForRaw("\x1b]1337;File=")
      expect(terminal.raw()).not.toContain("image/png")
      terminal.write("\u0003")
      await new Promise((resolve) => setTimeout(resolve, 50))
      terminal.write("\u0003")
      await expect(terminal.waitForExit()).resolves.toMatchObject({ exitCode: 0 })
    } finally {
      terminal.kill()
    }
  }, 10_000)

  it("paints DeepSeek Light, resets it on exit, and preserves NO_COLOR layout", async () => {
    const light = spawnTui(["src/main.ts", "--echo", "--theme", "deepseek", "--motion", "off"], {
      cols: 80,
      rows: 24,
      env: { NO_COLOR: undefined },
    })
    try {
      await light.waitForText("DeepSeek Harness")
      expect(light.raw()).toContain("\x1b[48;2;247;249;255m")
      light.write("\u0003")
      await new Promise((resolve) => setTimeout(resolve, 50))
      light.write("\u0003")
      await expect(light.waitForExit()).resolves.toMatchObject({ exitCode: 0 })
      expect(light.raw().includes("\x1b[0m") || light.raw().includes("\x1b[m")).toBe(true)
    } finally {
      light.kill()
    }

    const noColor = spawnTui(["src/main.ts", "--echo", "--theme", "deepseek", "--motion", "off"], {
      cols: 80,
      rows: 24,
      env: { NO_COLOR: "1" },
    })
    try {
      await noColor.waitForText("DeepSeek Harness")
      expect(noColor.screenText()).toContain("▟██████▙")
      expect(noColor.screenText()).not.toMatch(/[\u2800-\u28ff]/u)
      expect(noColor.raw()).not.toContain("\x1b[38;2;")
      expect(noColor.raw()).not.toContain("\x1b[48;2;")
      noColor.write("\u0003")
      await new Promise((resolve) => setTimeout(resolve, 50))
      noColor.write("\u0003")
      await expect(noColor.waitForExit()).resolves.toMatchObject({ exitCode: 0 })
    } finally {
      noColor.kill()
    }
  }, 15_000)

  it("lets the complete welcome naturally scroll away in a long conversation", async () => {
    const terminal = spawnTui(["src/main.ts", "--echo", "--motion", "off"], { cols: 80, rows: 12 })
    try {
      await terminal.waitForText("DeepSeek Harness")
      for (const prompt of ["one", "two", "three", "four"]) {
        const start = terminal.rawLength()
        terminal.write(`${prompt}\r`)
        await terminal.waitForText("端。", 3_000, start)
        await terminal.waitForText("ready", 3_000, start)
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(terminal.screenText()).not.toContain("DeepSeek Harness")
      terminal.write("\u0003")
      await new Promise((resolve) => setTimeout(resolve, 50))
      terminal.write("\u0003")
      await expect(terminal.waitForExit()).resolves.toMatchObject({ exitCode: 0 })
    } finally {
      terminal.kill()
    }
  }, 15_000)
})
