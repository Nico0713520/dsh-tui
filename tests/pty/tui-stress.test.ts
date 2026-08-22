import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { sanitizeTerminalText } from "../../src/text.ts"
import { spawnTui } from "./pty-harness.ts"

const fixture = join(process.cwd(), "tests/fixtures/fake-acp-server.mjs")

function acpArgs(persistRoot: string): string[] {
  return [
    "src/main.ts",
    "--mode", "acp",
    "--model", "deepseek-v4-flash",
    "--persist-root", persistRoot,
    "--cwd", process.cwd(),
    "--tool-cards", "off",
    "--motion", "off",
    "--backend-command-json", JSON.stringify([process.execPath, fixture]),
  ]
}

async function exitTui(terminal: ReturnType<typeof spawnTui>): Promise<void> {
  terminal.write("\u0003")
  await terminal.waitForText("Ctrl+C again to exit", 3_000)
  terminal.write("\u0003")
  await expect(terminal.waitForExit()).resolves.toMatchObject({ exitCode: 0 })
}

describe("real TUI stress", () => {
  it("remains interactive through 10k chunks, 100 tools, and resize storms", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-pty-stress-"))
    const terminal = spawnTui(acpArgs(root), {
      env: {
        FAKE_ACP_SCENARIO: "stress",
        FAKE_ACP_TEXT_CHUNKS: "10000",
        FAKE_ACP_TOOL_CALLS: "100",
        FAKE_ACP_CHUNK_DELAY_MS: "0",
        DEEPSEEK_API_KEY: "test-placeholder",
      },
      cols: 120,
      rows: 30,
    })
    try {
      await terminal.waitForText("ready")
      const stressStart = terminal.rawLength()
      terminal.write("stress\r")
      for (const [columns, rows] of [[48, 16], [120, 30], [32, 14], [80, 24]] as const) {
        terminal.resize(columns, rows)
      }

      await terminal.waitForText("STRESS_DONE", 30_000, stressStart)
      await terminal.waitForText("Done · 100 tools", 30_000, stressStart)
      expect(terminal.screenText().match(/STRESS_DONE/g)).toHaveLength(1)

      const sanitized = sanitizeTerminalText(terminal.raw().slice(stressStart))
      expect(sanitized).not.toContain("\"jsonrpc\"")
      expect(sanitized).not.toContain("\"sessionUpdate\"")
      expect(sanitized).not.toContain("{\"v\":1")
      // Ten thousand protocol chunks must not become ten thousand full-screen paints.
      expect(sanitized.length).toBeLessThan(500_000)

      const followUpStart = terminal.rawLength()
      terminal.write("still interactive\r")
      await terminal.waitForText("after stress:still interactive", 3_000, followUpStart)
      await exitTui(terminal)
    } finally {
      terminal.kill()
      await rm(root, { recursive: true, force: true })
    }
  }, 40_000)

  it("keeps one queued follow-up responsive during deliberately slow chunks", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-pty-slow-"))
    const terminal = spawnTui(acpArgs(root), {
      env: {
        FAKE_ACP_SCENARIO: "stress",
        FAKE_ACP_TEXT_CHUNKS: "120",
        FAKE_ACP_TOOL_CALLS: "5",
        FAKE_ACP_CHUNK_DELAY_MS: "2",
        DEEPSEEK_API_KEY: "test-placeholder",
      },
      cols: 80,
      rows: 24,
    })
    try {
      await terminal.waitForText("ready")
      terminal.write("slow stream\r")
      await terminal.waitForText("responding", 3_000)
      terminal.write("queued after slow\r")
      await terminal.waitForText("queued follow-up", 3_000)
      await terminal.waitForText("after stress:queued after slow", 5_000)
      await exitTui(terminal)
    } finally {
      terminal.kill()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)
})
