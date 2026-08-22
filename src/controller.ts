import { classifyStakes, type ApprovalStakes } from "./policy.ts"
import { addUsage, estimateCostUsd, type Usage } from "./usage.ts"
import type { AppConfig } from "./config.ts"
import type { PermissionDecision } from "./backend/acp-client.ts"
import type { HistoryEntry, SessionInfo, SessionLogEvent, SessionLogWatchOptions } from "./backend/session-log.ts"
import { createAssistantStream } from "./backend/assistant-stream.ts"
import type { DshLiveRecord } from "./backend/live-record.ts"
import { TurnPerf } from "./perf.ts"
import { TranscriptBuilder, historyToTranscript } from "./transcript-builder.ts"
import { ApprovalQueue } from "./approval-queue.ts"
import { ToolTimeline, type ToolTimelineEvent } from "./backend/tool-timeline.ts"

export type AppPhase = "starting" | "ready" | "working" | "cancelling" | "failed" | "closing"

export type AppActivity =
  | { kind: "boot"; stage: "backend" | "session" }
  | { kind: "idle" | "thinking" | "responding" }
  | { kind: "tool" | "approval"; name: string }

export type InterruptedReason = "cancelled" | "outcome-unknown"

export interface TurnSummaryItem {
  kind: "turn-summary"
  status: "done" | InterruptedReason | "failed"
  durationMs: number
  toolCount: number
  failedToolCount: number
}

export type TranscriptItem =
  | { kind: "user" | "assistant" | "diagnostic"; text: string }
  | { kind: "interrupted-assistant"; text: string; reason: InterruptedReason }
  | { kind: "thinking-trace"; durationMs: number }
  | { kind: "tool-call"; name: string; arguments: string }
  | { kind: "tool-result"; name: string; arguments?: string; text: string; isError: boolean; durationMs?: number }
  | { kind: "history-boundary"; text: string }
  | TurnSummaryItem

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
  requestApproval(request: ApprovalRequest, signal?: AbortSignal): Promise<PermissionDecision>
  chooseHistory(items: readonly SessionInfo[]): Promise<HistoryChoice>
  prepareShutdown?(): void
  dismissOverlays?(): void
}

export interface BackendPort {
  start(): Promise<void>
  newSession(): Promise<string>
  synchronizeLiveEvents?(): Promise<void>
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
  private readonly transcriptBuilder: TranscriptBuilder
  private readonly toolTimeline: ToolTimeline
  private readonly approvalQueue = new ApprovalQueue({
    onTimeout: (waitedMs) => this.addDiagnostic(`approval dialog timed out after ${Math.round(waitedMs / 1000)}s and was denied`),
  })
  private committedAssistantText = ""
  private readonly seenUsageSteps = new Set<string>()
  private readonly turnPerf = new TurnPerf()
  private readonly now: () => number
  private perfReported = false
  private turnStartedAtMs: number | null = null
  private turnToolCount = 0
  private turnFailedToolCount = 0
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
    now?: () => number
  }) {
    this.config = options.config
    this.backend = options.backend
    this.logs = options.logs
    this.view = options.view
    this.now = options.now ?? Date.now
    this.transcriptBuilder = new TranscriptBuilder(this.now)
    this.toolTimeline = new ToolTimeline(this.now)
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
    if (this.stateValue.phase === "working" || this.stateValue.phase === "cancelling") {
      this.setState({ queuedPrompt: value })
      return
    }
    if (this.stateValue.phase !== "ready") {
      this.addDiagnostic("The backend is not ready; start a new session before submitting.")
      return
    }
    await this.runPrompt(value)
  }

  updateDraft(text: string): void {
    if (this.stateValue.queuedPrompt === null) return
    this.setState({ queuedPrompt: text.trim() ? text : null })
  }

  private async runPrompt(value: string): Promise<void> {
    this.committedAssistantText = ""
    this.turnPerf.start()
    this.perfReported = false
    this.turnStartedAtMs = this.now()
    this.turnToolCount = 0
    this.turnFailedToolCount = 0
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
      await this.backend.synchronizeLiveEvents?.()
      if (this.isClosing() || this.hasFailed()) return
      if (this.stateValue.phase === "cancelling") {
        this.setState({ partialAssistantText: "", interruption: "cancelled" })
        this.reportPerf()
        this.setState({ phase: "ready", activity: { kind: "idle" }, backendMessage: "interrupted" })
        this.finishTurn("cancelled")
        void this.drainQueuedPrompt()
        return
      }
      this.assistantStream.preparePrompt()
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
      this.finishTurn(result.stopReason === "cancelled" ? "cancelled" : "done")
      void this.drainQueuedPrompt()
    } catch (error) {
      if (this.isClosing() || this.stateValue.phase === "failed") return
      this.turnPerf.mark("settled")
      this.finishAssistant("outcome-unknown")
      this.setState({ activity: { kind: "idle" } })
      this.finishTurn("failed")
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
    return this.approvalQueue.enqueue((signal) => this.runPermissionRequest(request, signal))
  }

  private async runPermissionRequest(request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision> {
    if (this.stateValue.phase === "closing") return { outcome: "cancelled" }
    const call = this.toolTimeline.lookup(request.toolCallId)
      ?? this.logs.lookupCall(request.toolCallId)
    const approval: ApprovalRequest = {
      toolCallId: request.toolCallId,
      optionIds: request.optionIds,
      name: call?.name ?? "tool",
      arguments: call?.arguments ?? "{}",
      stakes: classifyStakes(call?.name ?? "tool", parseArguments(call?.arguments ?? "{}")),
    }
    this.setState({ activeOverlay: "approval", activity: { kind: "approval", name: approval.name } })
    try {
      const decision = await this.view.requestApproval(approval, signal)
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
      const transcript = this.applyToolEvent({
        kind: "start",
        source: "live",
        callId: record.callId,
        name: record.name,
        arguments: record.arguments,
      })
      if (transcript) {
        this.setState({ partialAssistantText, activity, transcript })
      } else {
        this.setState({ partialAssistantText, activity })
      }
      return
    }
    if (record.kind === "tool-end") {
      if (turnActive) this.turnPerf.mark("first-visible-activity")
      const activity: AppActivity = turnActive ? { kind: "thinking" } : this.stateValue.activity
      const transcript = this.applyToolEvent({
        kind: "end",
        source: "live",
        callId: record.callId,
        name: this.toolTimeline.lookup(record.callId)?.name ?? "tool",
        text: record.text,
        isError: record.isError,
      })
      if (transcript) {
        this.setState({ partialAssistantText, activity, transcript })
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
    } else {
      this.setState({ activity: { kind: "idle" } })
    }
    this.finishAssistant("outcome-unknown")
    this.finishTurn(info.outcomeUnknown ? "outcome-unknown" : "failed")
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
      const transcript = this.applyToolEvent({
        kind: "start",
        source: "jsonl",
        callId: event.callId,
        name: event.name,
        arguments: event.arguments,
      })
      if (transcript) this.setState({ transcript })
    } else if (event.kind === "tool-result") {
      const transcript = this.applyToolEvent({
        kind: "end",
        source: "jsonl",
        callId: event.callId,
        name: event.name,
        text: event.text,
        isError: event.isError,
      })
      if (transcript) this.setState({ transcript })
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

  private applyToolEvent(event: ToolTimelineEvent): readonly TranscriptItem[] | null {
    const mutation = this.toolTimeline.apply(event)
    if (mutation.kind === "none") return null
    if (event.kind === "end" && this.turnStartedAtMs !== null) {
      this.turnToolCount += 1
      if (event.isError) this.turnFailedToolCount += 1
    }
    if (mutation.kind === "append") return [...this.stateValue.transcript, mutation.item]
    const transcript = [...this.stateValue.transcript]
    const index = transcript.findIndex((item) => item === mutation.target)
    if (index >= 0 && transcript[index]?.kind === "tool-call") transcript[index] = mutation.item
    else transcript.push(mutation.item)
    return transcript
  }

  private finishTurn(status: TurnSummaryItem["status"]): void {
    const startedAtMs = this.turnStartedAtMs
    if (startedAtMs === null) return
    const durationMs = Math.max(0, this.now() - startedAtMs)
    this.turnStartedAtMs = null
    // Avoid adding visual noise for effectively instant, tool-free turns.
    if (status === "done" && this.turnToolCount === 0 && durationMs < 250) return
    const summary: TurnSummaryItem = {
      kind: "turn-summary",
      status,
      durationMs,
      toolCount: this.turnToolCount,
      failedToolCount: this.turnFailedToolCount,
    }
    this.setState({ transcript: [...this.stateValue.transcript, summary] })
  }

  private resetLiveMetadata(): void {
    this.toolTimeline.reset()
    this.seenUsageSteps.clear()
  }

  private reportPerf(): void {
    if (!this.config.perf || this.perfReported) return
    const report = this.turnPerf.report()
    if (!report) return
    this.perfReported = true
    this.addDiagnostic(`[perf] ${report}`)
  }

  private finishAssistant(stopReason: string): void {
    const text = this.stateValue.partialAssistantText
    if (!text) return
    const reason: InterruptedReason | null = stopReason === "cancelled"
      ? "cancelled"
      : stopReason === "outcome-unknown" || this.stateValue.interruption === "outcome-unknown"
        ? "outcome-unknown"
        : null
    const item: TranscriptItem = reason
      ? { kind: "interrupted-assistant", text, reason }
      : { kind: "assistant", text }
    this.setState({
      transcript: [...this.stateValue.transcript, item],
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

  private hasFailed(): boolean {
    return this.stateValue.phase === "failed"
  }

  private setState(patch: Partial<AppState>): void {
    let nextPatch = patch
    if (patch.activity) {
      const wasThinking = this.stateValue.activity.kind === "thinking"
      const isThinking = patch.activity.kind === "thinking"
      if (wasThinking && !isThinking) {
        const trace = this.transcriptBuilder.closeThinking()
        if (trace) {
          const transcript = [...(patch.transcript ?? this.stateValue.transcript)]
          const insertionIndex = Math.min(this.stateValue.transcript.length, transcript.length)
          transcript.splice(insertionIndex, 0, { kind: "thinking-trace", durationMs: trace.durationMs })
          nextPatch = { ...patch, transcript }
        }
      } else if (!wasThinking && isThinking) {
        this.transcriptBuilder.markThinkingStart()
      }
    }
    this.stateValue = { ...this.stateValue, ...nextPatch }
    this.view.render(this.snapshot())
  }

  private snapshot(): AppState {
    return { ...this.stateValue, transcript: [...this.stateValue.transcript], usage: { ...this.stateValue.usage } }
  }
}

function parseArguments(value: string): unknown {
  try { return JSON.parse(value) } catch {
    // Malformed arguments still carry risk signal: expose the raw text as the
    // command so destructive-pattern classification keeps working.
    return { command: value }
  }
}
