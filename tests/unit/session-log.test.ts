import { mkdtemp, readFile, rm, writeFile, mkdir, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  SessionLogReader,
  projectKey,
  resolveSessionLogPath,
  type SessionLogEvent,
} from "../../src/backend/session-log.ts"

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("log event did not arrive")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("SessionLogReader", () => {
  it("keeps project keys stable across platform-shaped paths", () => {
    expect(projectKey("/Users/demo/项目")).toBe("--Users-demo-~9879~76EE--")
    expect(projectKey("C:\\Program Files\\demo")).toBe("--C-Program~0020Files-demo--")
    expect(resolveSessionLogPath("/tmp/root", "/workspace/demo", "s1"))
      .toBe(join("/tmp/root", "--workspace-demo--", "s1", "session.jsonl"))
  })

  it("reads split JSON and split UTF-8 without dropping records", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-log-"))
    try {
      const file = resolveSessionLogPath(root, "/workspace/demo", "s1")
      await mkdir(join(root, projectKey("/workspace/demo"), "s1"), { recursive: true })
      const reader = new SessionLogReader({ pollIntervalMs: 5, readChunkSize: 3 })
      const events: SessionLogEvent[] = []
      reader.watch({ persistRoot: root, cwd: "/workspace/demo", sessionId: "s1", onEvent: (event) => events.push(event) })
      const record = JSON.stringify({ type: "tool/call", data: { callId: "c1", name: "read_file", arguments: "{\"path\":\"中文.md\"}" } }) + "\n"
      await writeFile(file, record.slice(0, 8))
      await new Promise((resolve) => setTimeout(resolve, 20))
      await writeFile(file, record.slice(8), { flag: "a" })
      await waitFor(() => events.length === 1)
      expect(events[0]).toEqual({ kind: "tool-call", callId: "c1", name: "read_file", arguments: "{\"path\":\"中文.md\"}" })
      reader.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("synchronizes newly appended records without waiting for the next poll", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-log-"))
    try {
      const dir = join(root, projectKey("/workspace/demo"), "sync")
      await mkdir(dir, { recursive: true })
      const file = join(dir, "session.jsonl")
      const reader = new SessionLogReader({ pollIntervalMs: 60_000 })
      const events: SessionLogEvent[] = []
      reader.watch({ persistRoot: root, cwd: "/workspace/demo", sessionId: "sync", onEvent: (event) => events.push(event) })
      await new Promise((resolve) => setTimeout(resolve, 20))
      await writeFile(file, JSON.stringify({
        type: "tool/call",
        data: { callId: "sync-1", name: "read_file", arguments: "{}" },
      }) + "\n")

      await reader.synchronize()

      expect(events).toEqual([{ kind: "tool-call", callId: "sync-1", name: "read_file", arguments: "{}" }])
      reader.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("correlates tool results and reads isError from the tool-result block", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-log-"))
    try {
      const dir = join(root, projectKey("/workspace/demo"), "s1")
      await mkdir(dir, { recursive: true })
      const reader = new SessionLogReader({ pollIntervalMs: 5 })
      const events: SessionLogEvent[] = []
      reader.watch({ persistRoot: root, cwd: "/workspace/demo", sessionId: "s1", onEvent: (event) => events.push(event) })
      await writeFile(join(dir, "session.jsonl"), [
        JSON.stringify({ type: "tool/call", data: { callId: "c1", name: "read_file", arguments: "{}" } }),
        JSON.stringify({ type: "tool/result", data: { message: { source: { callId: "c1" }, content: [{ type: "tool-result", isError: true, content: [{ type: "text", text: "失败" }] }] } } }),
        JSON.stringify({ type: "assistant/message", data: { usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1 } } }),
      ].join("\n") + "\n")
      await waitFor(() => events.length === 3)
      expect(events[1]).toEqual({ kind: "tool-result", callId: "c1", name: "read_file", text: "失败", isError: true })
      expect(events[2]).toEqual({ kind: "usage", usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1 } })
      reader.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("replaces a watcher and handles truncation without duplicate polling", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-log-"))
    try {
      const dir = join(root, projectKey("/workspace/demo"), "s1")
      await mkdir(dir, { recursive: true })
      const file = join(dir, "session.jsonl")
      const reader = new SessionLogReader({ pollIntervalMs: 5 })
      const events: SessionLogEvent[] = []
      reader.watch({ persistRoot: root, cwd: "/workspace/demo", sessionId: "s1", onEvent: (event) => events.push(event) })
      await writeFile(file, JSON.stringify({ type: "tool/call", data: { callId: "a", name: "read", arguments: "{}" } }) + "\n")
      await waitFor(() => events.length === 1)
      reader.watch({ persistRoot: root, cwd: "/workspace/demo", sessionId: "s1", onEvent: (event) => events.push(event) })
      await writeFile(file, JSON.stringify({ type: "tool/call", data: { callId: "b", name: "read", arguments: "{}" } }) + "\n")
      await waitFor(() => events.some((event) => event.kind === "tool-call" && event.callId === "b"))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(events.map((event) => event.kind === "tool-call" ? event.callId : "")).toEqual(["a", "b"])
      reader.stop()
      await readFile(file, "utf8")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("reopens a same-size overwritten log instead of losing the new event", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-log-"))
    try {
      const dir = join(root, projectKey("/workspace/demo"), "same-size")
      await mkdir(dir, { recursive: true })
      const file = join(dir, "session.jsonl")
      const reader = new SessionLogReader({ pollIntervalMs: 5 })
      const events: SessionLogEvent[] = []
      reader.watch({ persistRoot: root, cwd: "/workspace/demo", sessionId: "same-size", onEvent: (event) => events.push(event) })
      const first = JSON.stringify({ type: "tool/call", data: { callId: "a", name: "read", arguments: "{}" } }) + "\n"
      const second = JSON.stringify({ type: "tool/call", data: { callId: "b", name: "read", arguments: "{}" } }) + "\n"
      expect(second.length).toBe(first.length)
      await writeFile(file, first)
      await waitFor(() => events.length === 1)
      await new Promise((resolve) => setTimeout(resolve, 20))
      await writeFile(file, second)
      await waitFor(() => events.length === 2)
      expect(events.map((event) => event.kind === "tool-call" ? event.callId : "")).toEqual(["a", "b"])
      reader.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("reopens a log atomically replaced at the watched path", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-log-"))
    try {
      const dir = join(root, projectKey("/workspace/demo"), "atomic")
      await mkdir(dir, { recursive: true })
      const file = join(dir, "session.jsonl")
      const replacement = join(dir, "session.next.jsonl")
      const reader = new SessionLogReader({ pollIntervalMs: 5 })
      const events: SessionLogEvent[] = []
      reader.watch({ persistRoot: root, cwd: "/workspace/demo", sessionId: "atomic", onEvent: (event) => events.push(event) })
      const first = JSON.stringify({ type: "tool/call", data: { callId: "a", name: "read", arguments: "{}" } }) + "\n"
      const second = JSON.stringify({ type: "tool/call", data: { callId: "b", name: "read", arguments: "{}" } }) + "\n"
      await writeFile(file, first)
      await waitFor(() => events.length === 1)

      await writeFile(replacement, second)
      await rename(replacement, file)

      await waitFor(() => events.length === 2, 750)
      expect(events.map((event) => event.kind === "tool-call" ? event.callId : "")).toEqual(["a", "b"])
      reader.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
