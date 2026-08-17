/** Minimal ACP client for DeepSeek Harness (dsh-acp-demo) over JSON-RPC stdio. */
import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"

export interface AcpEvents {
  onChunk(chunk: string): void
  onTurnEnd(): void
  onSession(id: string): void
  onError(msg: string): void
  /** Permission request for a tool call; respond with one of optionIds. */
  onPermission?(toolCallId: string, optionIds: string[], respond: (optionId: string) => void): void
}

export interface AcpOptions {
  model?: string
  /** Command that boots the dsh ACP server, e.g. ["node", "refs-dsh/packages/examples/acp-demo/src/bin.ts", "--config", "cordis.yml"] */
  command?: string[]
  events: AcpEvents
}

interface Pending {
  resolve(v: any): void
  reject(e: any): void
}

export class AcpClient {
  private proc: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private events: AcpEvents
  private model: string
  private command: string[]

  constructor(opts: AcpOptions) {
    this.events = opts.events
    this.model = opts.model ?? "deepseek-v4-flash"
    this.command = opts.command ?? []
  }

  private ensure(): ChildProcess {
    if (this.proc) return this.proc
    const [cmd, ...args] = this.command
    const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] })
    this.proc = proc
    const rl = createInterface({ input: proc.stdout! })
    rl.on("line", (line) => this.onLine(line))
    proc.on("exit", (code) => {
      this.proc = null
      for (const p of this.pending.values()) p.reject(new Error(`dsh ACP server exited (${code})`))
      this.pending.clear()
    })
    return proc
  }

  private onLine(line: string) {
    let msg: any
    try { msg = JSON.parse(line) } catch { return }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
      else p.resolve(msg.result)
      return
    }
    // notification
    if (msg.method === "session/update") {
      const p = msg.params ?? {}
      if (p.update?.sessionUpdate === "agent_message_chunk") {
        const c = p.update.content
        if (c?.type === "text" && c.text) this.events.onChunk(c.text)
      }
    } else if (msg.method === "session/request_permission") {
      const id = msg.id
      const p = msg.params ?? {}
      const optionIds = (Array.isArray(p.options) ? p.options : []).map((o: any) => o.optionId).filter(Boolean)
      const respond = (optionId: string) => {
        this.respond(id, { outcome: { outcome: "selected", optionId } })
      }
      const toolCallId = p.toolCall?.toolCallId ?? ""
      if (this.events.onPermission) {
        this.events.onPermission(toolCallId, optionIds, respond)
      } else {
        respond(optionIds.find((o: string) => o.includes("allow")) ?? optionIds[0])
      }
    }
  }

  private respond(id: number, result: any) {
    this.proc?.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
  }

  private call(method: string, params: any): Promise<any> {
    const proc = this.ensure()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId
    const version = await this.call("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "dsh-tui", version: "0.0.1" },
    }).catch(() => ({}))
    const res = await this.call("session/new", {
      cwd: process.cwd(),
      mcpServers: [],
    })
    this.sessionId = res.sessionId
    this.events.onSession(res.sessionId)
    return res.sessionId
  }
  private sessionId: string | null = null

  async prompt(text: string): Promise<void> {
    const sid = await this.ensureSession()
    await this.call("session/prompt", {
      sessionId: sid,
      prompt: [{ type: "text", text }],
    })
    this.events.onTurnEnd()
  }

  close() {
    try { this.proc?.stdin?.end() } catch {}
    try { this.proc?.kill() } catch {}
  }
}

function pAllowOption(options: any): string {
  const list = Array.isArray(options) ? options : []
  for (const o of list) if (typeof o?.optionId === "string" && /allow/i.test(o.optionId)) return o.optionId
  return list[0]?.optionId ?? "allow"
}

function extractTitle(options: any): string {
  const list = Array.isArray(options) ? options : []
  for (const o of list) {
    if (o?.kind === "title" || o?.type === "title") return o.content?.text ?? o.name ?? "Permission"
  }
  return "Tool permission"
}

function extractDetail(options: any): string {
  const list = Array.isArray(options) ? options : []
  for (const o of list) {
    const t = o?.content?.text ?? o?.highlight ?? ""
    if (t && (o?.kind !== "title" && o?.type !== "title")) return String(t)
  }
  return ""
}
