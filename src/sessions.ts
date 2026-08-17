/**
 * Session manager: list past sessions from dsh's persistence root, load
 * history from session JSONL for replay (ACP is fresh-only; replay is our
 * compromise per handoff doc).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { SessionLogWatcher } from "./logwatch.ts"

export interface SessionInfo {
  id: string
  projectKey: string
  mtime: number
  title: string
  firstUserMsg: string
}

export function listSessions(persistRoot: string, cwd: string): SessionInfo[] {
  const key = SessionLogWatcher.projectKey(cwd)
  const dir = join(persistRoot, key)
  if (!existsSync(dir)) return []
  const out: SessionInfo[] = []
  for (const sid of readdirSync(dir, { withFileTypes: true })) {
    if (!sid.isDirectory()) continue
    const log = join(dir, sid.name, "session.jsonl")
    if (!existsSync(log)) continue
    const { mtime } = statSafe(log)
    const { title, firstUserMsg } = summarize(log)
    out.push({ id: sid.name, projectKey: key, mtime, title, firstUserMsg })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

function statSafe(p: string): { mtime: number } {
  try { return { mtime: __stat_mtime(p) } } catch { return { mtime: 0 } }
}
import { statSync } from "node:fs"
function __stat_mtime(p: string): number {
  return statSync(p).mtimeMs
}

function summarize(log: string): { title: string; firstUserMsg: string } {
  let title = ""
  let firstUserMsg = ""
  try {
    const content = readFileSync(log, "utf8")
    for (const line of content.split("\n")) {
      if (!line.trim()) continue
      try {
        const j = JSON.parse(line)
        if (j.type === "session/title" && !title) title = String(j.data?.title ?? "")
        if (j.type === "user/message" && !firstUserMsg) {
          const blocks = j.data?.message?.content
          if (Array.isArray(blocks)) {
            firstUserMsg = blocks.filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ").slice(0, 60)
          }
        }
        if (title && firstUserMsg) break
      } catch {}
    }
  } catch {}
  return { title, firstUserMsg }
}

export interface ReplayEntry {
  kind: "user" | "assistant" | "tool"
  text: string
  isError?: boolean
}

/** Parse a finished session log into replayable transcript entries. */
export function loadReplay(persistRoot: string, cwd: string, sessionId: string): ReplayEntry[] {
  const log = SessionLogWatcher.resolvePath(persistRoot, cwd, sessionId)
  if (!existsSync(log)) return []
  const out: ReplayEntry[] = []
  let content = ""
  try { content = readFileSync(log, "utf8") } catch { return [] }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue
    try {
      const j = JSON.parse(line)
      const d = j.data ?? {}
      if (j.type === "user/message") {
        const blocks = d.message?.content
        // skip tool-result user messages (source.kind === "tool")
        const isToolResult = d.message?.content?.[0]?.type === "tool-result"
        if (!isToolResult && Array.isArray(blocks)) {
          const t = blocks.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n")
          if (t.trim()) out.push({ kind: "user", text: t })
        }
      } else if (j.type === "assistant/message") {
        const t = (d.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n")
        if (t.trim()) out.push({ kind: "assistant", text: t })
      } else if (j.type === "tool/call") {
        let detail = ""
        try {
          const a = JSON.parse(d.arguments ?? "{}")
          detail = a.command ?? a.path ?? a.pattern ?? ""
        } catch {}
        out.push({ kind: "tool", text: `${d.name} ${detail}`.trim() })
      }
    } catch {}
  }
  return out
}
