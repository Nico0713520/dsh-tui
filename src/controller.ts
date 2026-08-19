import { classifyStakes, type ApprovalStakes } from "./policy.ts"
import { addUsage, estimateCostUsd, type Usage } from "./usage.ts"
import type { AppConfig } from "./config.ts"
import type { PermissionDecision } from "./backend/acp-client.ts"
import type { HistoryEntry, SessionInfo, SessionLogEvent, SessionLogWatchOptions } from "./backend/session-log.ts"
import { createAssistantStream } from "./backend/assistant-stream.ts"
import type { DshLiveRecord } from "./backend/live-record.ts"
import { TurnPerf } from "./perf.ts"

export type AppPhase = "starting" | "ready" | "working" | "cancelling" | "failed" | "closing"

export type AppActivity =
  | { kind: "boot"; stage: "backend" | "session" }
  | { kind: "idle" | "thinking" | "responding" }
  | { kind: "tool" | "approval"; name: string }

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
  queuedPrompt: string | null
  activity: AppActivity
  interruption: "cancelled" | "outcome-unknown" | null
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
  prepareShutdown?(): void
  dismissOverlays?(): void
}

export interface BackendPort {
  start(): Promise<void>
  newSession(): Promise<string>
  prompt(text: string): Promise<{ stopReason: string }>
  cancel(): void
  stopLiveEvents?(): void
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
  private readonly assistantStream = createAssistantStream()
  private permissionTail: Promise<void> = Promise.resolve()
  private committedAssistantText = ""
  private readonly seenToolStarts = new Set<string>()
  private readonly seenToolEnds = new Set<string>()
  private readonly liveTools = new Map<string, { name: string; transcriptIndex: number }>()
  private readonly seenUsageSteps = new Set<string>()
  private readonly turnPerf = new TurnPerf()
  private perfReported = false
  private stateValue: AppState = {
    phase: "starting",
    sessionId: null,
    usage: {},
    costUsd: null,
    activeOverlay: null,
    backendMessage: null,
    transcript: [],
    partialAssistantText: "",
    queuedPrompt: null,
    activity: { kind: "boot", stage: "backend" },
    interruption: null,
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
    this.setState({ phase: "starting", backendMessage: null, activity: { kind: "boot", stage: "backend" } })
    try {
      await this.backend.start()
      this.setState({ activity: { kind: "boot", stage: "session" } })
      await this.backend.newSession()
      const sessionId = this.backend.activeSessionId
      if (sessionId) this.assistantStream.begin(sessionId)
      this.resetLiveMetadata()
      this.setState({ phase: "ready", sessionId, backendMessage: null, activity: { kind: "idle" } })
      await this.drainQueuedPrompt()
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
    if (this.stateValue.phase === "starting") {
      this.setState({ queuedPrompt: value })
      return
    }
    if (this.stateValue.phase !== "ready") {
      this.addDiagnostic(this.stateValue.phase === "working" || this.stateValue.phase === "cancelling"
        ? "Already working; wait for the current prompt to settle."
        : "The backend is not ready; start a new session before submitting.")
      return
    }
    await this.runPrompt(value)
  }

  updateDraft(text: string): void {
    if ((this.stateValue.phase !== "starting" && this.stateValue.phase !== "failed") || this.stateValue.queuedPrompt === null) return
    this.setState({ queuedPrompt: text })
  }

  private async runPrompt(value: string): Promise<void> {
    this.committedAssistantText = ""
    this.assistantStream.preparePrompt()
    this.turnPerf.start()
    this.perfReported = false
    this.setState({
      phase: "working",
      backendMessage: null,
      partialAssistantText: "",
      queuedPrompt: null,
      activity: { kind: "thinking" },
      interruption: null,
      transcript: [...this.stateValue.transcript, { kind: "user", text: value }],
    })
    try {
      const result = await this.backend.prompt(value)
      if (this.isClosing() || this.stateValue.phase === "failed") return
      this.turnPerf.mark("settled")
      if (result.stopReason === "cancelled") {
        const snapshot = this.assistantStream.interrupt("cancelled")
        this.setState({ partialAssistantText: snapshot.text, interruption: "cancelled" })
      }
      this.finishAssistant(result.stopReason)
      this.reportPerf()
      this.setState({
        phase: "ready",
        activity: { kind: "idle" },
        backendMessage: result.stopReason === "cancelled" ? "interrupted" : null,
      })
    } catch (error) {
      if (this.isClosing() || this.stateValue.phase === "failed") return
      this.turnPerf.mark("settled")
      this.finishAssistant("")
      this.reportPerf()
      this.fail(error)
    }
  }

  cancel(): void {
    if (this.stateValue.phase !== "working") return
    this.setState({ phase: "cancelling", backendMessage: "cancelling…", activity: { kind: "idle" } })
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
      queuedPrompt: null,
      activity: { kind: "boot", stage: "session" },
      interruption: null,
    })
    try {
      await this.backend.newSession()
      const sessionId = this.backend.activeSessionId
      if (sessionId) this.assistantStream.begin(sessionId)
      this.committedAssistantText = ""
      this.resetLiveMetadata()
      this.setState({ phase: "ready", sessionId, activity: { kind: "idle" } })
      await this.drainQueuedPrompt()
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
    this.setState({ activeOverlay: "approval", activity: { kind: "approval", name: approval.name } })
    try {
      const decision = await this.view.requestApproval(approval)
      return decision.outcome === "selected" && request.optionIds.includes(decision.optionId)
        ? decision
        : { outcome: "cancelled" }
    } catch {
      return { outcome: "cancelled" }
    } finally {
      this.setState({
        activeOverlay: null,
        activity: this.stateValue.phase === "working" ? { kind: "thinking" } : { kind: "idle" },
      })
    }
  }

  onAssistantText(text: string): void {
    if (this.stateValue.phase !== "working" && this.stateValue.phase !== "cancelling") return
    this.turnPerf.mark("acp-committed")
    this.committedAssistantText += text
    const snapshot = this.assistantStream.reconcileCommitted(this.committedAssistantText)
    this.setState({ partialAssistantText: snapshot.text, activity: { kind: "responding" } })
  }

  onLiveRecord(record: DshLiveRecord): void {
    const turnActive = this.stateValue.phase === "working" || this.stateValue.phase === "cancelling"
    const lateMetadata = this.stateValue.phase === "ready"
      && (record.kind === "tool-start" || record.kind === "tool-end" || record.kind === "usage")
    if (!turnActive && !lateMetadata) return
    const snapshot = this.assistantStream.apply(record)
    if (!snapshot.acceptedRecord) return
    if (lateMetadata && !snapshot.committed) return
    this.turnPerf.mark("first-live-event")
    if (snapshot.text) this.turnPerf.mark("first-live-text")
    const partialAssistantText = turnActive ? snapshot.text : this.stateValue.partialAssistantText
    if (record.kind === "tool-start") {
      if (turnActive) this.turnPerf.mark("first-visible-activity")
      const activity: AppActivity = turnActive ? { kind: "tool", name: record.name } : this.stateValue.activity
      if (!this.seenToolStarts.has(record.callId) && !this.seenToolEnds.has(record.callId)) {
        this.seenToolStarts.add(record.callId)
        const transcriptIndex = this.stateValue.transcript.length
        this.liveTools.set(record.callId, { name: record.name, transcriptIndex })
        this.setState({
          partialAssistantText,
          activity,
          transcript: [...this.stateValue.transcript, { kind: "tool-call", name: record.name, arguments: record.arguments }],
        })
      } else {
        this.setState({ partialAssistantText, activity })
      }
      return
    }
    if (record.kind === "tool-end") {
      if (turnActive) this.turnPerf.mark("first-visible-activity")
      const activity: AppActivity = turnActive ? { kind: "thinking" } : this.stateValue.activity
      const tool = this.liveTools.get(record.callId)
      if (!this.seenToolEnds.has(record.callId)) {
        this.seenToolEnds.add(record.callId)
        this.seenToolStarts.add(record.callId)
        const item: TranscriptItem = {
          kind: "tool-result",
          name: tool?.name ?? "tool",
          text: record.text,
          isError: record.isError,
        }
        const transcript = [...this.stateValue.transcript]
        if (tool && transcript[tool.transcriptIndex]?.kind === "tool-call") transcript[tool.transcriptIndex] = item
        else transcript.push(item)
        this.setState({
          partialAssistantText,
          activity,
          transcript,
        })
      } else {
        this.setState({ partialAssistantText, activity })
      }
      return
    }
    if (record.kind === "usage") {
      this.applyUsage(record.usage, `${record.turn}:${record.step}`)
      return
    }
    const activity: AppActivity = snapshot.activity === "thinking"
      ? { kind: "thinking" }
      : snapshot.activity === "responding"
        ? { kind: "responding" }
        : this.stateValue.activity
    if (snapshot.activity !== "idle") this.turnPerf.mark("first-visible-activity")
    this.setState({ partialAssistantText: snapshot.text, activity })
  }

  onLiveTextPaint(): void {
    this.turnPerf.mark("first-live-text-paint")
  }

  onSessionChanged(sessionId: string): void {
    this.assistantStream.begin(sessionId)
    this.committedAssistantText = ""
    this.resetLiveMetadata()
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
    if (info.outcomeUnknown) {
      const snapshot = this.assistantStream.interrupt("outcome-unknown")
      this.setState({ partialAssistantText: snapshot.text, interruption: "outcome-unknown", activity: { kind: "idle" } })
    }
    this.finishAssistant("")
    this.turnPerf.mark("settled")
    this.reportPerf()
    this.fail(new Error(info.outcomeUnknown ? "Backend exited; prompt outcome is unknown." : "Backend exited."))
  }

  async close(): Promise<void> {
    if (this.stateValue.phase === "closing") return
    this.setState({ phase: "closing", activeOverlay: null, activity: { kind: "idle" } })
    this.view.prepareShutdown?.()
    this.backend.stopLiveEvents?.()
    this.logs.stop()
    this.view.dismissOverlays?.()
    await this.backend.close()
  }

  private onSessionLogEvent(event: SessionLogEvent): void {
    if (event.kind === "tool-call") {
      if (this.seenToolStarts.has(event.callId) || this.seenToolEnds.has(event.callId)) return
      this.seenToolStarts.add(event.callId)
      this.liveTools.set(event.callId, {
        name: event.name,
        transcriptIndex: this.stateValue.transcript.length,
      })
      this.setState({ transcript: [...this.stateValue.transcript, { kind: "tool-call", name: event.name, arguments: event.arguments }] })
    } else if (event.kind === "tool-result") {
      if (this.seenToolEnds.has(event.callId)) return
      this.seenToolEnds.add(event.callId)
      this.seenToolStarts.add(event.callId)
      const item: TranscriptItem = { kind: "tool-result", name: event.name, text: event.text, isError: event.isError }
      const tool = this.liveTools.get(event.callId)
      const transcript = [...this.stateValue.transcript]
      if (tool && transcript[tool.transcriptIndex]?.kind === "tool-call") transcript[tool.transcriptIndex] = item
      else transcript.push(item)
      this.setState({ transcript })
    } else {
      const key = event.turn === undefined || event.step === undefined ? undefined : `${event.turn}:${event.step}`
      this.applyUsage(event.usage, key)
    }
  }

  private applyUsage(sample: Usage, key?: string): void {
    if (key && this.seenUsageSteps.has(key)) return
    if (key) this.seenUsageSteps.add(key)
    const usage = addUsage(this.stateValue.usage, sample)
    this.setState({ usage, costUsd: estimateCostUsd(this.config.model, usage) })
  }

  private resetLiveMetadata(): void {
    this.seenToolStarts.clear()
    this.seenToolEnds.clear()
    this.liveTools.clear()
    this.seenUsageSteps.clear()
  }

  private reportPerf(): void {
    if (!this.config.perf || this.perfReported) return
    const report = this.turnPerf.report()
    if (!report) return
    this.perfReported = true
    this.addDiagnostic(`[perf] ${report}`)
  }

  private finishAssistant(_stopReason: string): void {
    const text = this.stateValue.partialAssistantText
    if (!text) return
    this.setState({
      transcript: [...this.stateValue.transcript, { kind: "assistant", text }],
      partialAssistantText: "",
    })
  }

  private async drainQueuedPrompt(): Promise<void> {
    const queued = this.stateValue.queuedPrompt?.trim()
    if (!queued || this.stateValue.phase !== "ready") return
    this.setState({ queuedPrompt: null })
    await this.runPrompt(queued)
  }

  private addDiagnostic(text: string): void {
    this.setState({ transcript: [...this.stateValue.transcript, { kind: "diagnostic", text }] })
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.setState({ phase: "failed", backendMessage: message, activity: { kind: "idle" } })
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
