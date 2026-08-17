/** Minimal ACP client for DeepSeek Harness (dsh-acp-demo) over JSON-RPC stdio. */
import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"

export interface AcpEvents {
  onChunk(chunk: string): void
  onTurnEnd(): void
  onSession(id: string): void
  onError(msg: string): void
  /** Backend died and was restarted; session state lost. */
  onRestart?(attempt: number): void
  /** Permission request for a tool call; respond with one of optionIds. */
  onPermission?(toolCallId: string, optionIds: string[], respond: (optionId: string) => void): void
}

export interface AcpOptions {
  model?: string
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
  private restarts = 0
  private dead = false
  private lastPrompt: string | null = null

  constructor(opts: AcpOptions) {
    this.events = opts.events
    this.model = opts.model ?? "deepseek-v4-flash"
    this.command = opts.command ?? []
  }

  private ensure(): ChildProcess {
    if (this.proc) return this.proc
    if (this.dead || !this.command.length) throw new Error("ACP server not configured")
    const [cmd, ...args] = this.command
    const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] })
    this.proc = proc
    const rl = createInterface({ input: proc.stdout! })
    rl.on("line", (line) => this.onLine(line))
    proc.on("exit", (code) => {
      this.proc = null
      for (const p of this.pending.values()) p.reject(new Error(`dsh ACP server exited (${code})`))
      this.pending.clear()
      this.sessionId = null
      // Auto-restart once per turn; surface to UI.
      if (!this.dead && this.lastPrompt && this.restarts < 3) {
        this.restarts++
        this.events.onRestart?.(this.restarts)
        // retry the interrupted prompt on the fresh server
        const retry = this.lastPrompt
        this.lastPrompt = null
        setTimeout(() => { void this.prompt(retry!) }, 1000)
      } else {
        this.events.onError(`backend exited (code ${code})`)
      }
    })
    proc.on("error", (err) => {
      this.events.onError(`failed to start backend: ${err.message}`)
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

  private call(method: string, params: any, timeoutMs = 180_000): Promise<any> {
    const proc = this.ensure()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`ACP ${method} timed out after ${timeoutMs / 1000}s`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId
    await this.call("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "dsh-tui", version: "0.0.2" },
    }, 30_000)
    const res = await this.call("session/new", {
      cwd: process.cwd(),
      mcpServers: [],
    }, 30_000)
    this.sessionId = res.sessionId
    this.events.onSession(res.sessionId)
    return res.sessionId
  }
  private sessionId: string | null = null

  async prompt(text: string): Promise<void> {
    this.lastPrompt = text
    const sid = await this.ensureSession()
    await this.call("session/prompt", {
      sessionId: sid,
      prompt: [{ type: "text", text }],
    })
    this.lastPrompt = null
    this.restarts = 0
    this.events.onTurnEnd()
  }

  /** Cancel in-flight work (Esc interrupt). */
  async cancel(): Promise<void> {
    if (!this.sessionId) return
    try {
      await this.call("session/cancel", { sessionId: this.sessionId, reason: "user interrupted" }, 10_000)
    } catch {
      // no in-flight prompt is a no-op on the server side; ignore errors
    }
    this.lastPrompt = null
  }

  /** Graceful shutdown: end stdin, escalate kill, caller restores TUI. */
  close() {
    this.dead = true
    const proc = this.proc
    if (!proc) return
    try { proc.stdin?.end() } catch {}
    const kill = setTimeout(() => { try { proc.kill("SIGKILL") } catch {} }, 3000)
    try { proc.kill() } catch {}
    proc.on("exit", () => clearTimeout(kill))
  }
}
