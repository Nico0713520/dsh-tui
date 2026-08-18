import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { listHistory, loadHistory, projectKey } from "../../src/backend/session-log.ts"

describe("read-only history", () => {
  it("lists and loads user, assistant, and tool entries without changing session identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-history-"))
    try {
      const dir = join(root, projectKey("/workspace/demo"), "s1")
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "session.jsonl"), [
        JSON.stringify({ type: "session/title", data: { title: "Demo" } }),
        JSON.stringify({ type: "user/message", data: { message: { content: [{ type: "text", text: "你好" }] } } }),
        JSON.stringify({ type: "tool/call", data: { callId: "c1", name: "read_file", arguments: "{\"path\":\"README.md\"}" } }),
        JSON.stringify({ type: "assistant/message", data: { message: { content: [{ type: "text", text: "完成" }] } } }),
      ].join("\n") + "\n")
      const listed = await listHistory(root, "/workspace/demo")
      const loaded = await loadHistory(root, "/workspace/demo", "s1")
      expect(listed[0]?.title).toBe("Demo")
      expect(loaded).toEqual([
        { kind: "user", text: "你好" },
        { kind: "tool", text: "read_file README.md" },
        { kind: "assistant", text: "完成" },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("surfaces malformed history rather than returning an indistinguishable empty list", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-history-"))
    try {
      const dir = join(root, projectKey("/workspace/demo"), "bad")
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "session.jsonl"), "not-json\n")
      const entries = await loadHistory(root, "/workspace/demo", "bad")
      expect(entries).toEqual([{ kind: "diagnostic", text: "History contains 1 malformed record(s)." }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
