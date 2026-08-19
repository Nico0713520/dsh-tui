import { classifyStakes, type ApprovalStakes } from "./policy.ts"
import { estimateCostUsd, type Usage } from "./usage.ts"
import type { AppConfig } from "./config.ts"
import type { PermissionDecision } from "./backend/acp-client.ts"
import type { HistoryEntry, SessionInfo, SessionLogEvent, SessionLogWatchOptions } from "./backend/session-log.ts"

export type AppPhase = "starting" | "ready" | "working" | "cancelling" | "failed" | "closing"

export type TranscriptItem =
  | { kind: "user" | "assistant" | "diagnostic"; text: string }
  | { kind: "tool-call"; name: string; arguments: string }
  | { kind: "tool-result"; name: string; text: string; isError: boolean }
  | { kind: "history-boundary"; text: string }

export interface AppState {
  phase: AppPhase
  sessionId: string | null
  usage: Usage
  costUsd: number | null
  activeOverlay: "approval" | "history" | null
  backendMessage: string | null
  transcript: readonly TranscriptItem[]
  partialAssistantText: string
}

export interface ApprovalRequest {
  toolCallId: string
  optionIds: readonly string[]
  name: string
  arguments: string
  stakes: ApprovalStakes
}

export interface PermissionRequest {
  toolCallId: string
  optionIds: readonly string[]
}

export type HistoryChoice =
  | { kind: "new" }
  | { kind: "session"; id: string }
  | { kind: "cancel" }

export interface ControllerView {
  render(state: AppState): void
  requestApproval(request: ApprovalRequest): Promise<PermissionDecision>
  chooseHistory(items: readonly SessionInfo[]): Promise<HistoryChoice>
}

export interface BackendPort {
  start(): Promise<void>
  newSession(): Promise<string>
  prompt(text: string): Promise<{ stopReason: string }>
  cancel(): void
  close(): Promise<void>
  get activeSessionId(): string | null
}

export interface SessionLogPort {
  watch(options: SessionLogWatchOptions): void
  stop(): void
  lookupCall(callId: string): { name: string; arguments: string } | undefined
  listHistory(persistRoot: string, cwd: string): Promise<SessionInfo[]>
  loadHistory(persistRoot: string, cwd: string, sessionId: string): Promise<HistoryEntry[]>
}

export class AppController {
  private readonly config: AppConfig
  private readonly backend: BackendPort
  private readonly logs: SessionLogPort
  private readonly view: ControllerView
  private permissionTail: Promise<void> = Promise.resolve()
  private stateValue: AppState = {
    phase: "starting",
    sessionId: null,
    usage: {},
    costUsd: null,
    activeOverlay: null,
    backendMessage: null,
    transcript: [],
    partialAssistantText: "",
  }

  constructor(options: {
    config: AppConfig
    backend: BackendPort
    logs: SessionLogPort
    view: ControllerView
  }) {
    this.config = options.config
    this.backend = options.backend
    this.logs = options.logs
    this.view = options.view
  }

  get state(): AppState {
    return this.snapshot()
  }

  async start(): Promise<void> {
    this.setState({ phase: "starting", backendMessage: null })
    try {
      await this.backend.start()
      await this.backend.newSession()
      this.setState({ phase: "ready", sessionId: this.backend.activeSessionId, backendMessage: null })
    } catch (error) {
      this.fail(error)
    }
  }

  async submit(text: string): Promise<void> {
    const value = text.trim()
    if (!value) return
    if (this.stateValue.activeOverlay !== null) {
      this.addDiagnostic("Close the current overlay before submitting.")
      return
    }
    if (this.stateValue.phase !== "ready") {
      this.addDiagnostic(this.stateValue.phase === "working" || this.stateValue.phase === "cancelling"
        ? "Already working; wait for the current prompt to settle."
        : "The backend is not ready; start a new session before submitting.")
      return
    }
    this.setState({
      phase: "working",
      backendMessage: null,
      partialAssistantText: "",
      transcript: [...this.stateValue.transcript, { kind: "user", text: value }],
    })
    try {
      const result = await this.backend.prompt(value)
      if (this.isClosing()) return
      this.finishAssistant(result.stopReason)
      this.setState({ phase: "ready", backendMessage: result.stopReason === "cancelled" ? "interrupted" : null })
    } catch (error) {
      if (this.isClosing()) return
      this.finishAssistant("")
      this.fail(error)
    }
  }

  cancel(): void {
    if (this.stateValue.phase !== "working") return
    this.setState({ phase: "cancelling", backendMessage: "cancelling…" })
    this.backend.cancel()
  }

  async newSession(): Promise<void> {
    if (this.stateValue.activeOverlay !== null) {
      this.addDiagnostic("Close the current overlay before starting a new session.")
      return
    }
    if (this.stateValue.phase === "working" || this.stateValue.phase === "cancelling") {
      this.addDiagnostic("Finish or cancel the current prompt before starting a new session.")
      return
    }
    this.logs.stop()
    this.setState({
      phase: "starting",
      sessionId: null,
      usage: {},
      costUsd: null,
      activeOverlay: null,
      backendMessage: null,
      transcript: [],
      partialAssistantText: "",
    })
    try {
      await this.backend.newSession()
      this.setState({ phase: "ready", sessionId: this.backend.activeSessionId })
    } catch (error) {
      this.fail(error)
    }
  }

  async openHistory(): Promise<void> {
    if (this.stateValue.activeOverlay !== null) return
    if (this.stateValue.phase === "working" || this.stateValue.phase === "cancelling") {
      this.addDiagnostic("History is unavailable while a prompt is running.")
      return
    }
    this.setState({ activeOverlay: "history" })
    try {
      const sessions = await this.logs.listHistory(this.config.persistRoot, this.config.cwd)
      const choice = await this.view.chooseHistory(sessions)
      if (choice.kind === "new") {
        this.setState({ activeOverlay: null })
        await this.newSession()
        return
      }
      if (choice.kind !== "session") {
        this.setState({ activeOverlay: null })
        return
      }
      const entries = await this.logs.loadHistory(this.config.persistRoot, this.config.cwd, choice.id)
      const replay: TranscriptItem[] = [
        { kind: "history-boundary", text: `── history ${choice.id.slice(0, 8)} (read-only) ──` },
        ...entries.map(historyToTranscript),
        { kind: "history-boundary", text: "── end history · new prompts use the current ACP session ──" },
      ]
      this.setState({ activeOverlay: null, transcript: [...this.stateValue.transcript, ...replay] })
    } catch (error) {
      this.setState({ activeOverlay: null })
      this.addDiagnostic(`History unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  decidePermission(request: PermissionRequest): Promise<PermissionDecision> {
    const result = this.permissionTail.then(
      () => this.runPermissionRequest(request),
      () => this.runPermissionRequest(request),
    )
    this.permissionTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async runPermissionRequest(request: PermissionRequest): Promise<PermissionDecision> {
    if (this.stateValue.phase === "closing") return { outcome: "cancelled" }
    const call = this.logs.lookupCall(request.toolCallId)
    const approval: ApprovalRequest = {
      toolCallId: request.toolCallId,
      optionIds: request.optionIds,
      name: call?.name ?? "tool",
      arguments: call?.arguments ?? "{}",
      stakes: classifyStakes(call?.name ?? "tool", parseArguments(call?.arguments ?? "{}")),
    }
    this.setState({ activeOverlay: "approval" })
    try {
      const decision = await this.view.requestApproval(approval)
      return decision.outcome === "selected" && request.optionIds.includes(decision.optionId)
        ? decision
        : { outcome: "cancelled" }
    } catch {
      return { outcome: "cancelled" }
    } finally {
      this.setState({ activeOverlay: null })
    }
  }

  onAssistantText(text: string): void {
    if (this.stateValue.phase !== "working" && this.stateValue.phase !== "cancelling") return
    this.setState({ partialAssistantText: `${this.stateValue.partialAssistantText}${text}` })
  }

  onSessionChanged(sessionId: string): void {
    this.setState({ sessionId })
    if (!this.config.toolCards) return
    this.logs.watch({
      persistRoot: this.config.persistRoot,
      cwd: this.config.cwd,
      sessionId,
      onEvent: (event) => this.onSessionLogEvent(event),
      onDiagnostic: (message) => this.addDiagnostic(message),
    })
  }

  onDiagnostic(message: string): void {
    this.addDiagnostic(message)
  }

  onBackendExit(info: { outcomeUnknown: boolean }): void {
    if (this.stateValue.phase === "closing") return
    this.finishAssistant("")
    this.fail(new Error(info.outcomeUnknown ? "Backend exited; prompt outcome is unknown." : "Backend exited."))
  }

  async close(): Promise<void> {
    if (this.stateValue.phase === "closing") return
    this.setState({ phase: "closing", activeOverlay: null })
    this.logs.stop()
    await this.backend.close()
  }

  private onSessionLogEvent(event: SessionLogEvent): void {
    if (event.kind === "tool-call") {
      this.setState({ transcript: [...this.stateValue.transcript, { kind: "tool-call", name: event.name, arguments: event.arguments }] })
    } else if (event.kind === "tool-result") {
      this.setState({ transcript: [...this.stateValue.transcript, { kind: "tool-result", name: event.name, text: event.text, isError: event.isError }] })
    } else {
      const usage = {
        inputTokens: (this.stateValue.usage.inputTokens ?? 0) + (event.usage.inputTokens ?? 0),
        outputTokens: (this.stateValue.usage.outputTokens ?? 0) + (event.usage.outputTokens ?? 0),
        cacheReadTokens: (this.stateValue.usage.cacheReadTokens ?? 0) + (event.usage.cacheReadTokens ?? 0),
      }
      this.setState({ usage, costUsd: estimateCostUsd(this.config.model, usage) })
    }
  }

  private finishAssistant(_stopReason: string): void {
    const text = this.stateValue.partialAssistantText
    if (!text) return
    this.setState({
      transcript: [...this.stateValue.transcript, { kind: "assistant", text }],
      partialAssistantText: "",
    })
  }

  private addDiagnostic(text: string): void {
    this.setState({ transcript: [...this.stateValue.transcript, { kind: "diagnostic", text }] })
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.setState({ phase: "failed", backendMessage: message })
    this.addDiagnostic(message)
  }

  private isClosing(): boolean {
    return this.stateValue.phase === "closing"
  }

  private setState(patch: Partial<AppState>): void {
    this.stateValue = { ...this.stateValue, ...patch }
    this.view.render(this.snapshot())
  }

  private snapshot(): AppState {
    return { ...this.stateValue, transcript: [...this.stateValue.transcript], usage: { ...this.stateValue.usage } }
  }
}

function parseArguments(value: string): unknown {
  try { return JSON.parse(value) } catch { return {} }
}

function historyToTranscript(entry: HistoryEntry): TranscriptItem {
  if (entry.kind === "user" || entry.kind === "assistant" || entry.kind === "diagnostic") {
    return { kind: entry.kind, text: entry.text }
  }
  if (entry.kind === "tool-call") {
    return { kind: "tool-call", name: entry.name, arguments: entry.arguments }
  }
  if (entry.kind === "tool-result") {
    return { kind: "tool-result", name: entry.name, text: entry.text, isError: entry.isError }
  }
  return { kind: "diagnostic", text: entry.text }
}
