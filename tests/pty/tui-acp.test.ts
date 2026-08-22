import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { listHistory, projectKey } from "../../src/backend/session-log.ts"
import { spawnTui } from "./pty-harness.ts"

const fixture = join(process.cwd(), "tests/fixtures/fake-acp-server.mjs")
const TEST_API_KEY = "test-placeholder"

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function exitTui(terminal: ReturnType<typeof spawnTui>): Promise<void> {
  terminal.write("\u0003")
  await terminal.waitForText("Ctrl+C again to exit", 2_000)
  terminal.write("\u0003")
  await expect(terminal.waitForExit()).resolves.toMatchObject({ exitCode: 0 })
}

function acpArgs(persistRoot: string): string[] {
  return [
    "src/main.ts",
    "--mode", "acp",
    "--model", "deepseek-v4-flash",
    "--persist-root", persistRoot,
    "--cwd", process.cwd(),
    "--tool-cards", "off",
    "--backend-command-json", JSON.stringify([process.execPath, fixture]),
  ]
}

async function withAcp(scenario: string, run: (terminal: ReturnType<typeof spawnTui>, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dsh-pty-acp-"))
  const terminal = spawnTui(acpArgs(root), {
    env: {
      FAKE_ACP_SCENARIO: scenario,
      FAKE_ACP_PERMISSION_CANCELLED_TEXT: "permission cancelled",
      FAKE_ACP_PERMISSION_DELAY_MS: "250",
      DSH_TUI_MOTION: "off",
      DEEPSEEK_API_KEY: TEST_API_KEY,
    },
    cols: 80,
    rows: 24,
  })
  try {
    await terminal.waitForText("fake-001")
    await run(terminal, root)
  } finally {
    terminal.kill()
    await rm(root, { recursive: true, force: true })
  }
}

describe("real ACP TUI", () => {
  it("keeps one editable startup prompt and shows activity before final text", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-pty-startup-"))
    const terminal = spawnTui(acpArgs(root), {
      env: { FAKE_ACP_SCENARIO: "slow-start-live", DSH_TUI_MOTION: "full", DSH_TUI_PERF: "1", DEEPSEEK_API_KEY: TEST_API_KEY },
      cols: 80,
      rows: 24,
    })
    try {
      await terminal.waitForText("DeepSeek Harness")
      await terminal.waitForText("starting")
      terminal.write("first\r")
      await terminal.waitForText("queued")
      terminal.write(" edited")
      const liveStart = terminal.rawLength()
      await terminal.waitForText("thinking", 8_000, liveStart)
      await terminal.waitForText("queued:first edited", 8_000, liveStart)
      await terminal.waitForText("paint ", 8_000, liveStart)

      const liveOutput = terminal.raw().slice(liveStart)
      expect(liveOutput.indexOf("thinking")).toBeLessThan(liveOutput.indexOf("queued:first edited"))
      expect(terminal.screenText()).not.toContain("duplicate prompt")
      await exitTui(terminal)
    } finally {
      terminal.kill()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it("keeps partial live text when cancellation settles without committed ACP text", async () => {
    await withAcp("live-cancel", async (terminal) => {
      terminal.write("cancel me\r")
      await terminal.waitForText("partial evidence")
      terminal.write("\u001b")
      await terminal.waitForText("interrupted")
      expect(terminal.screenText()).toContain("partial evidence")
      await exitTui(terminal)
    })
  }, 15_000)

  it("queues and edits one follow-up without overlapping ACP prompts", async () => {
    await withAcp("queued-follow-up", async (terminal) => {
      terminal.write("first\r")
      await pause(200)
      terminal.write("second\r")
      await terminal.waitForText("queued follow-up")
      terminal.write(" edited")

      await terminal.waitForText("first done")
      await terminal.waitForText("follow-up:second edited")
      expect(terminal.screenText()).not.toContain("private follow-up contents")
      await exitTui(terminal)
    })
  }, 15_000)

  it("keeps partial evidence and marks an unknown outcome after backend exit", async () => {
    await withAcp("live-forced-exit", async (terminal) => {
      terminal.write("side effect\r")
      await terminal.waitForText("unknown evidence")
      await terminal.waitForText("outcome is unknown")
      expect(terminal.screenText()).toContain("unknown evidence")
      await exitTui(terminal)
    })
  }, 15_000)

  it("falls back to committed ACP output when fd 3 closes", async () => {
    await withAcp("live-pipe-close", async (terminal) => {
      terminal.write("fallback\r")
      await terminal.waitForText("live event pipe closed")
      await terminal.waitForText("after close")
      await exitTui(terminal)
    })
  }, 15_000)

  it("allows the offered permission option through the overlay", async () => {
    await withAcp("permission", async (terminal) => {
      const approvalStart = terminal.rawLength()
      terminal.write("run the command\r")
      await terminal.waitForText("Allow this action", 8_000, approvalStart)
      terminal.write("\r")
      await terminal.waitForText("allowed")
      await exitTui(terminal)
    })
  }, 15_000)

  it("rejects the offered permission option through the overlay", async () => {
    await withAcp("permission", async (terminal) => {
      const approvalStart = terminal.rawLength()
      terminal.write("run the command\r")
      await terminal.waitForText("Allow this action", 8_000, approvalStart)
      terminal.write("\u001b[B")
      await pause(80)
      terminal.write("\r")
      await terminal.waitForText("permission cancelled")
      await exitTui(terminal)
    })
  }, 15_000)

  it("lets Escape close an approval overlay without sending session cancel", async () => {
    await withAcp("permission", async (terminal) => {
      const approvalStart = terminal.rawLength()
      terminal.write("run the command\r")
      await terminal.waitForText("Allow this action", 8_000, approvalStart)
      terminal.write("\u001b")
      await terminal.waitForText("permission cancelled")
      expect(terminal.screenText()).not.toContain("unexpected-session-cancel")
      await exitTui(terminal)
    })
  }, 15_000)

  it("cancels working prompts only after the overlay precedence is clear", async () => {
    await withAcp("delayed", async (terminal) => {
      terminal.write("hold this\r")
      await terminal.waitForText("thinking")
      terminal.write("\u001b")
      await terminal.waitForText("cancelled")
      await exitTui(terminal)
    })
  }, 15_000)

  it("replays read-only history and resets to a new ACP session", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-pty-history-"))
    const historyDir = join(root, projectKey(process.cwd()), "hist-1234")
    await mkdir(historyDir, { recursive: true })
    await writeFile(join(historyDir, "session.jsonl"), [
      JSON.stringify({ type: "session/title", data: { title: "Recorded session" } }),
      JSON.stringify({ type: "user/message", data: { message: { content: [{ type: "text", text: "读 README" }] } } }),
      JSON.stringify({ type: "tool/call", data: { callId: "history-call", name: "read_file", arguments: "{\"path\":\"README.md\"}" } }),
      JSON.stringify({ type: "tool/result", data: { message: { source: { callId: "history-call" }, content: [{ type: "tool-result", content: [{ type: "text", text: "历史结果" }] }] } } }),
      JSON.stringify({ type: "assistant/message", data: { message: { content: [{ type: "text", text: "历史完成" }] } } }),
    ].join("\n") + "\n")
    expect((await listHistory(root, process.cwd())).map((item) => item.id)).toEqual(["hist-1234"])
    const terminal = spawnTui(acpArgs(root), { env: { FAKE_ACP_SCENARIO: "normal", DEEPSEEK_API_KEY: TEST_API_KEY }, cols: 100, rows: 30 })
    try {
      await terminal.waitForText("fake-001")
      terminal.write("\u0012")
      await terminal.waitForText("Recorded session")
      terminal.write("\u001b[B")
      await pause(80)
      terminal.write("\r")
      await terminal.waitForText("history hist-12")
      await terminal.waitForText("历史结果")

      const newSessionStart = terminal.rawLength()
      terminal.write("\u0012")
      await terminal.waitForText("+ New session", 8_000, newSessionStart)
      terminal.write("\r")
      await terminal.waitForText("fake-002", 8_000, newSessionStart)
      await terminal.waitForText("DeepSeek Harness", 8_000, newSessionStart)
      await exitTui(terminal)
    } finally {
      terminal.kill()
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)
})
