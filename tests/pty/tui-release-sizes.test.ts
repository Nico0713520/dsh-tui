import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { visibleWidth } from "@earendil-works/pi-tui"
import { describe, expect, it } from "vitest"
import { spawnTui } from "./pty-harness.ts"

const fixture = join(process.cwd(), "tests/fixtures/fake-acp-server.mjs")
const sizes = [
  { columns: 120, rows: 30 },
  { columns: 80, rows: 24 },
  { columns: 50, rows: 16 },
] as const

async function exitTui(terminal: ReturnType<typeof spawnTui>): Promise<void> {
  terminal.write("\u0003")
  await terminal.waitForText("Ctrl+C again to exit", 2_000)
  terminal.write("\u0003")
  await expect(terminal.waitForExit()).resolves.toMatchObject({ exitCode: 0 })
}

function expectBoundedScreen(terminal: ReturnType<typeof spawnTui>, columns: number): void {
  const overflow = terminal.screenText().split("\n").filter((line) => visibleWidth(line) > columns)
  expect(overflow).toEqual([])
}

describe("release terminal sizes", () => {
  it.each(sizes)("keeps Echo usable at $columns×$rows", async ({ columns, rows }) => {
    const terminal = spawnTui(["src/main.ts", "--echo", "--motion", "off"], { cols: columns, rows })
    try {
      await terminal.waitForText("ready")
      const start = terminal.rawLength()
      terminal.write("release smoke\r")
      await terminal.waitForText("[echo] release smoke", 3_000, start)
      await terminal.waitForText("端。", 3_000, start)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(terminal.screenText()).toContain("ready")
      expectBoundedScreen(terminal, columns)
      await exitTui(terminal)
    } finally {
      terminal.kill()
    }
  })

  it.each(sizes)("keeps ACP usable at $columns×$rows", async ({ columns, rows }) => {
    const persistRoot = await mkdtemp(join(tmpdir(), "dsh-release-size-"))
    const terminal = spawnTui([
      "src/main.ts",
      "--mode", "acp",
      "--model", "deepseek-v4-flash",
      "--persist-root", persistRoot,
      "--cwd", process.cwd(),
      "--motion", "off",
      "--backend-command-json", JSON.stringify([process.execPath, fixture]),
    ], {
      cols: columns,
      rows,
      env: { DEEPSEEK_API_KEY: "test-placeholder", FAKE_ACP_SCENARIO: "normal" },
    })
    try {
      await terminal.waitForText("ready")
      const start = terminal.rawLength()
      terminal.write("release smoke\r")
      await terminal.waitForText("hello", 3_000, start)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(terminal.screenText()).toContain("ready")
      expectBoundedScreen(terminal, columns)
      await exitTui(terminal)
    } finally {
      terminal.kill()
      await rm(persistRoot, { recursive: true, force: true })
    }
  })
})
