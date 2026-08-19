import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface, type Interface } from "node:readline"
import type { Readable } from "node:stream"
import { safeErrorText } from "../text.ts"
import { LiveRecordDecoder, type DshLiveRecord } from "./live-record.ts"

export type PermissionDecision =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" }

export interface AcpClientEvents {
  onAssistantText(text: string): void
  onLiveRecord?(record: DshLiveRecord): void
  onSessionChanged(sessionId: string): void
  onDiagnostic(message: string): void
  onPermission(request: {
    toolCallId: string
    optionIds: readonly string[]
  }): Promise<PermissionDecision>
  onBackendExit(info: {
    code: number | null
    signal: NodeJS.Signals | null
    outcomeUnknown: boolean
  }): void
}

export interface AcpClientOptions {
  command: readonly string[]
  cwd: string
  events: AcpClientEvents
  env?: NodeJS.ProcessEnv
  timeouts?: Record<string, number>
}

interface PendingRequest {
  method: string
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface RecordValue {
  [key: string]: unknown
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null
}

export class AcpClient {
  private readonly command: readonly string[]
  private readonly cwd: string
  private readonly events: AcpClientEvents
  private readonly environment: NodeJS.ProcessEnv
  private readonly timeouts: Record<string, number>
  private process: ChildProcessWithoutNullStreams | null = null
  private output: Interface | null = null
  private liveOutput: Readable | null = null
  private liveDecoder: LiveRecordDecoder | null = null
  private livePipeFailed = false
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private initialized = false
  private sessionId: string | null = null
  private promptInFlight = false
  private closed = false
  private closing = false
  private closePromise: Promise<void> | null = null
  private exitReported = false

  constructor(options: AcpClientOptions) {
    if (options.command.length === 0 || !options.command[0]?.trim()) {
      throw new Error("ACP command must be a non-empty argument array")
    }
    this.command = options.command
    this.cwd = options.cwd
    this.events = options.events
    this.environment = options.env ?? process.env
    this.timeouts = {
      initialize: 30_000,
      "session/new": 30_000,
      "session/prompt": 180_000,
      ...options.timeouts,
    }
  }

  get activeSessionId(): string | null {
    return this.sessionId
  }

  get isPromptInFlight(): boolean {
    return this.promptInFlight
  }

  async start(): Promise<void> {
    this.ensureProcess()
  }

  async newSession(): Promise<string> {
    if (this.closed || this.closing) throw new Error("ACP client is closed")
    if (this.promptInFlight) throw new Error("Cannot create a session while a prompt is in flight")
    return this.createSession()
  }

  private async createSession(): Promise<string> {
    this.ensureProcess()
    if (!this.initialized) {
      await this.call("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "dsh-tui", version: "0.1.0" },
      })
      this.initialized = true
    }
    const result = await this.call("session/new", { cwd: this.cwd, mcpServers: [] })
    if (!isRecord(result) || typeof result.sessionId !== "string" || !result.sessionId) {
      throw new Error("ACP session/new returned no sessionId")
    }
    this.sessionId = result.sessionId
    this.events.onSessionChanged(result.sessionId)
    return result.sessionId
  }

  async prompt(text: string): Promise<{ stopReason: string }> {
    if (this.closed || this.closing) throw new Error("ACP client is closed")
    if (this.promptInFlight) throw new Error("A prompt is already in flight")
    this.promptInFlight = true
    try {
      const sessionId = this.sessionId ?? await this.createSession()
      const result = await this.call("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
      })
      const stopReason = isRecord(result) && typeof result.stopReason === "string"
        ? result.stopReason
        : "unknown"
      return { stopReason }
    } finally {
      this.promptInFlight = false
    }
  }

  cancel(): void {
    if (!this.sessionId || !this.promptInFlight || !this.process || this.closed || this.closing) return
    try {
      this.writeFrame({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: this.sessionId, reason: "user interrupted" },
      })
    } catch (error) {
      this.events.onDiagnostic(`cancel failed: ${safeErrorText(error)}`)
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.closing = true
    this.closePromise = this.dispose()
    return this.closePromise
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.process) return this.process
    if (this.closed || this.closing) throw new Error("ACP client is closed")
    const executable = this.command[0]
    if (!executable) throw new Error("ACP command is empty")

    const child = spawn(executable, this.command.slice(1), {
      cwd: this.cwd,
      env: this.environment,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
    this.process = child
    this.exitReported = false
    this.livePipeFailed = false
    this.output = createInterface({ input: child.stdout })
    this.output.on("line", (line) => this.handleLine(line))
    const liveOutput = child.stdio[3]
    if (liveOutput && "readable" in liveOutput) {
      this.liveOutput = liveOutput as Readable
      this.liveDecoder = new LiveRecordDecoder({
        sessionId: () => this.sessionId,
        onRecord: (record) => this.events.onLiveRecord?.(record),
        onDiagnostic: (message) => this.events.onDiagnostic(message),
      })
      this.liveOutput.on("data", (chunk: Buffer | string) => this.liveDecoder?.push(chunk))
      this.liveOutput.once("end", () => {
        if (this.process === child && !this.closed && !this.closing) {
          this.reportLivePipeFailure("live event pipe closed; continuing with ACP")
        }
        this.finishLivePipe()
      })
      this.liveOutput.once("error", (error) => {
        this.reportLivePipeFailure(`live event pipe unavailable: ${safeErrorText(error)}`)
        this.finishLivePipe()
      })
    }
    child.stderr.on("data", (chunk: Buffer | string) => {
      const diagnostic = safeErrorText(String(chunk), 220)
      if (diagnostic) this.events.onDiagnostic(`backend: ${diagnostic}`)
    })
    child.once("error", (error) => {
      this.events.onDiagnostic(`backend start/error: ${safeErrorText(error)}`)
      this.finalizeProcess(child, new Error(`ACP backend failed to start: ${safeErrorText(error)}`), null, null)
    })
    child.once("exit", (code, signal) => {
      this.finalizeProcess(child, new Error(`ACP backend exited (${code ?? signal ?? "unknown"}); outcome unknown`), code, signal)
    })
    return child
  }

  private finalizeProcess(
    child: ChildProcessWithoutNullStreams,
    error: Error,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.process !== child) return
    this.process = null
    this.output?.close()
    this.output = null
    this.finishLivePipe()
    this.initialized = false
    this.sessionId = null
    this.promptInFlight = false
    const outcomeUnknown = this.pending.size > 0
    this.rejectPending(error)
    if (!this.closing && !this.closed && !this.exitReported) {
      this.exitReported = true
      this.events.onBackendExit({ code, signal, outcomeUnknown })
    }
  }

  private handleLine(line: string): void {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      this.events.onDiagnostic("backend emitted a malformed JSON frame")
      return
    }
    if (!isRecord(message)) return

    const id = message.id
    if (typeof id === "number" && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      clearTimeout(pending.timer)
      const error = message.error
      if (isRecord(error)) {
        pending.reject(new Error(`ACP ${pending.method}: ${safeErrorText(error.message ?? error)}`))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.method === "session/update") {
      this.handleUpdate(message.params)
      return
    }
    if (message.method === "session/request_permission") {
      this.handlePermission(message)
    }
  }

  private finishLivePipe(): void {
    const decoder = this.liveDecoder
    this.liveDecoder = null
    this.liveOutput = null
    decoder?.end()
  }

  private reportLivePipeFailure(message: string): void {
    if (this.livePipeFailed) return
    this.livePipeFailed = true
    this.events.onDiagnostic(message)
  }

  private handleUpdate(params: unknown): void {
    if (!isRecord(params) || !isRecord(params.update)) return
    const update = params.update
    if (update.sessionUpdate !== "agent_message_chunk") return
    const content = update.content
    if (isRecord(content) && content.type === "text" && typeof content.text === "string") {
      this.events.onAssistantText(content.text)
    }
  }

  private handlePermission(message: RecordValue): void {
    if (typeof message.id !== "number") {
      this.events.onDiagnostic("backend permission request had no numeric id")
      return
    }
    const params = isRecord(message.params) ? message.params : {}
    const toolCall = isRecord(params.toolCall) ? params.toolCall : {}
    const options = Array.isArray(params.options) ? params.options : []
    const optionIds = options
      .filter(isRecord)
      .map((option) => option.optionId)
      .filter((optionId): optionId is string => typeof optionId === "string" && optionId.length > 0)
    const toolCallId = typeof toolCall.toolCallId === "string" ? toolCall.toolCallId : ""
    const respond = (decision: PermissionDecision): void => {
      if (!this.process || this.closed) return
      const valid = decision.outcome === "selected" && optionIds.includes(decision.optionId)
        ? decision
        : { outcome: "cancelled" as const }
      try {
        this.writeFrame({
          jsonrpc: "2.0",
          id: message.id,
          result: { outcome: valid.outcome === "selected" ? valid : { outcome: "cancelled" } },
        })
      } catch (error) {
        this.events.onDiagnostic(`permission response failed: ${safeErrorText(error)}`)
      }
    }
    void Promise.resolve()
      .then(() => this.events.onPermission({ toolCallId, optionIds }))
      .catch(() => ({ outcome: "cancelled" as const }))
      .then(respond)
  }

  private call(method: string, params: unknown): Promise<unknown> {
    this.ensureProcess()
    const id = this.nextId++
    const timeoutMs = this.timeouts[method] ?? 30_000
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`ACP ${method} timed out after ${timeoutMs}ms; outcome unknown`))
      }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
      try {
        this.writeFrame({ jsonrpc: "2.0", id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error(`ACP ${method} write failed: ${safeErrorText(error)}`))
      }
    })
  }

  private writeFrame(frame: RecordValue): void {
    const child = this.process
    if (!child || child.stdin.destroyed || !child.stdin.writable) throw new Error("ACP stdin is unavailable")
    child.stdin.write(`${JSON.stringify(frame)}\n`)
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  private async dispose(): Promise<void> {
    const child = this.process
    this.rejectPending(new Error("ACP client closed before the request settled"))
    if (!child) return
    this.tryLifecycleAction("ACP stdin close failed", () => child.stdin.end())
    if (await this.waitForExit(child, 1_000)) return
    this.tryLifecycleAction("ACP graceful termination failed", () => { child.kill() })
    if (await this.waitForExit(child, 1_500)) return
    this.tryLifecycleAction("ACP force termination failed", () => { child.kill("SIGKILL") })
    if (!(await this.waitForExit(child, 1_000))) {
      throw new Error("ACP backend did not exit after forced shutdown")
    }
  }

  private tryLifecycleAction(label: string, action: () => void): void {
    try {
      action()
    } catch (error) {
      this.events.onDiagnostic(`${label}: ${safeErrorText(error)}`)
    }
  }

  private waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
    return new Promise((resolve) => {
      let settled = false
      const finish = (exited: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.removeListener("exit", onExit)
        resolve(exited)
      }
      const onExit = () => finish(true)
      const timer = setTimeout(() => finish(false), timeoutMs)
      child.once("exit", onExit)
    })
  }
}
