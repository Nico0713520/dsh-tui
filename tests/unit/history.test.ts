import { mkdtemp, rm, writeFile, mkdir, utimes } from "node:fs/promises"
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
        JSON.stringify({ type: "tool/result", data: { message: { source: { callId: "c1" }, content: [{ type: "tool-result", isError: true, content: [{ type: "text", text: "失败" }] }] } } }),
        JSON.stringify({ type: "assistant/message", data: { message: { content: [{ type: "text", text: "完成" }] } } }),
      ].join("\n") + "\n")
      const listed = await listHistory(root, "/workspace/demo")
      const loaded = await loadHistory(root, "/workspace/demo", "s1")
      expect(listed[0]?.title).toBe("Demo")
      expect(loaded).toEqual([
        { kind: "user", text: "你好" },
        { kind: "tool-call", name: "read_file", arguments: "{\"path\":\"README.md\"}" },
        { kind: "tool-result", name: "read_file", text: "失败", isError: true },
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

  it("selects the newest sessions before applying the history limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-history-"))
    try {
      const project = join(root, projectKey("/workspace/demo"))
      for (let index = 0; index <= 100; index += 1) {
        const id = `session-${String(index).padStart(3, "0")}`
        const dir = join(project, id)
        const file = join(dir, "session.jsonl")
        await mkdir(dir, { recursive: true })
        await writeFile(file, `${JSON.stringify({ type: "session/title", data: { title: id } })}\n`)
        const timestamp = new Date(1_700_000_000_000 + index * 1_000)
        await utimes(file, timestamp, timestamp)
      }

      const listed = await listHistory(root, "/workspace/demo")

      expect(listed).toHaveLength(100)
      expect(listed[0]?.id).toBe("session-100")
      expect(listed.some((session) => session.id === "session-000")).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
