/**
 * Session log watcher: tails the dsh session JSONL in real time and emits
 * typed events for tool calls / results / reasoning. Powers tool cards.
 */
import { watchFile, unwatchFile } from "node:fs"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export interface LogEvents {
  onToolCall(name: string, args: string): void
  onToolResult(name: string, text: string, isError: boolean): void
  /** Per-turn token usage from assistant/message events. */
  onUsage?(u: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }): void
}

export class SessionLogWatcher {
  private file: string | null = null
  private pos = 0
  private stopped = false
  /** callId -> {name, args} for permission-card lookup. */
  private calls = new Map<string, { name: string; args: string }>()

  lookupCall(callId: string): { name: string; args: string } | undefined {
    return this.calls.get(callId)
  }

  /** Resolve the session log path from persistenceRoot + cwd + sessionId. */
  /** Port of dsh projectKey() from session-persistence-jsonl/src/format.ts. */
  static projectKey(cwd: string): string {
    let readable = ""
    let separatorRun = false
    for (let i = 0; i < cwd.length; i++) {
      const code = cwd.charCodeAt(i)
      const ch = String.fromCharCode(code)
      if (ch === "/" || ch === "\\" || ch === ":") {
        if (!separatorRun) readable += "-"
        separatorRun = true
      } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
        readable += ch
        separatorRun = false
      } else {
        readable += "~" + code.toString(16).toUpperCase().padStart(4, "0")
        separatorRun = false
      }
    }
    const slug = readable.replace(/^-+/, "") || "root"
    return `--${slug.slice(0, 251)}--`
  }

  static resolvePath(persistenceRoot: string, cwd: string, sessionId: string): string {
    return join(persistenceRoot, SessionLogWatcher.projectKey(cwd), sessionId, "session.jsonl")
  }

  watch(persistenceRoot: string, cwd: string, sessionId: string, events: LogEvents) {
    this.file = SessionLogWatcher.resolvePath(persistenceRoot, cwd, sessionId)
    this.pos = 0
    this.stopped = false
    const tick = () => {
      if (this.stopped) return
      this.pump(events)
      setTimeout(tick, 250)
    }
    tick()
  }

  private pump(events: LogEvents) {
    if (!this.file) return
    let content: string
    try {
      content = readFileSync(this.file, "utf8")
    } catch {
      return // not created yet
    }
    const fresh = content.slice(this.pos)
    this.pos = content.length
    for (const line of fresh.split("\n")) {
      if (!line.trim()) continue
      let j: any
      try { j = JSON.parse(line) } catch { continue }
      const d = j.data ?? {}
      if (j.type === "tool/call") {
        this.calls.set(d.callId, { name: d.name, args: d.arguments ?? "" })
        events.onToolCall(d.name, d.arguments ?? "")
      } else if (j.type === "tool/result") {
        const content = d.message?.content?.[0]?.content?.[0]?.text ?? ""
        const err = d.message?.content?.[0]?.content?.[0]?.isError === true
        events.onToolResult(d.message?.source?.callId ? this.lastName : "", String(content).slice(0, 400), err)
      } else if (j.type === "assistant/message") {
        const u = j.data?.usage
        if (u && events.onUsage) events.onUsage(u)
      }
    }
  }

  private lastName = ""

  stop() {
    this.stopped = true
  }
}
