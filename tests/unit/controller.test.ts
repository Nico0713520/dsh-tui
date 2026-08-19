import { describe, expect, it } from "vitest"
import { AppController, type AppState, type ApprovalRequest, type BackendPort, type ControllerView, type HistoryChoice, type SessionLogPort } from "../../src/controller.ts"
import type { AppConfig } from "../../src/config.ts"
import type { PermissionDecision } from "../../src/backend/acp-client.ts"
import type { HistoryEntry, SessionInfo, SessionLogEvent, SessionLogWatchOptions } from "../../src/backend/session-log.ts"

const config: AppConfig = {
  mode: "echo",
  model: "deepseek-v4-flash",
  cwd: "/workspace/demo",
  persistRoot: "/tmp/sessions",
  toolCards: true,
  motion: "full",
  perf: false,
}

function createHarness(configOverride: Partial<AppConfig> = {}) {
  let promptResolve: ((value: { stopReason: string }) => void) | undefined
  let promptImpl: ((text: string) => Promise<{ stopReason: string }>) | undefined
  let listHistoryImpl: () => Promise<SessionInfo[]> = async () => []
  let loadHistoryImpl: () => Promise<HistoryEntry[]> = async () => []
  let chooseHistoryImpl: () => Promise<HistoryChoice> = async () => ({ kind: "cancel" })
  let approvalImpl: (request: ApprovalRequest) => Promise<PermissionDecision> = async () => ({ outcome: "cancelled" })
  let sessionNumber = 0
  let activeSessionId: string | null = null
  let sessionGate: Promise<void> | null = null
  let releaseSession: (() => void) | undefined
  let rejectSession: ((error: Error) => void) | undefined
  const renders: AppState[] = []
  const promptCalls: string[] = []
  const cleanupOrder: string[] = []
  const backend: BackendPort & { stopLiveEvents(): void } = {
    get activeSessionId() { return activeSessionId },
    async start() {},
    async newSession() {
      const id = `session-${++sessionNumber}`
      if (sessionGate) await sessionGate
      activeSessionId = id
      return id
    },
    async prompt(text) {
      promptCalls.push(text)
      if (promptImpl) return promptImpl(text)
      return { stopReason: `done:${text}` }
    },
    cancel() {
      promptResolve?.({ stopReason: "cancelled" })
    },
    stopLiveEvents() { cleanupOrder.push("backend-live") },
    async close() { cleanupOrder.push("backend") },
  }
  interface FakeLogs extends SessionLogPort {
    watched?: SessionLogWatchOptions
    emit(event: SessionLogEvent): void
  }
  const logs: FakeLogs = {
    watch(options) { logs.watched = options },
    stop() { cleanupOrder.push("logs") },
    lookupCall() { return { name: "bash", arguments: JSON.stringify({ command: "rm -rf ." }) } },
    async listHistory() { return listHistoryImpl() },
    async loadHistory() { return loadHistoryImpl() },
    emit(event) { logs.watched?.onEvent(event) },
  }
  const view: ControllerView & { prepareShutdown(): void; dismissOverlays(): void } = {
    render(state) { renders.push(state) },
    async requestApproval(request): Promise<PermissionDecision> { return approvalImpl(request) },
    async chooseHistory() { return chooseHistoryImpl() },
    prepareShutdown() { cleanupOrder.push("view-timers") },
    dismissOverlays() { cleanupOrder.push("view-overlays") },
  }
  return {
    backend,
    logs,
    view,
    renders,
    controller: new AppController({ config: { ...config, ...configOverride }, backend, logs, view }),
    promptCalls,
    cleanupOrder,
    setHistory(options: {
      choice?: HistoryChoice
      sessions?: SessionInfo[]
      entries?: HistoryEntry[]
    }) {
      chooseHistoryImpl = async () => options.choice ?? { kind: "cancel" }
      listHistoryImpl = async () => options.sessions ?? []
      loadHistoryImpl = async () => options.entries ?? []
    },
    setListHistory(impl: () => Promise<SessionInfo[]>) {
      listHistoryImpl = impl
    },
    setLoadHistory(impl: () => Promise<HistoryEntry[]>) {
      loadHistoryImpl = impl
    },
    setApproval(impl: (request: ApprovalRequest) => Promise<PermissionDecision>) {
      approvalImpl = impl
    },
    deferPrompt() {
      promptImpl = async () => new Promise((resolve) => {
        promptResolve = resolve
      })
    },
    deferSession() {
      sessionGate = new Promise((resolve, reject) => {
        releaseSession = resolve
        rejectSession = reject
      })
      return () => {
        releaseSession?.()
        sessionGate = null
      }
    },
    failSession(error = new Error("startup failed")) {
      rejectSession?.(error)
      sessionGate = null
    },
    finishPrompt(stopReason = "end_turn") {
      promptResolve?.({ stopReason })
    },
  }
}

describe("AppController", () => {
  it("emits a sanitized performance report only when enabled", async () => {
    const harness = createHarness({ perf: true })
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("secret prompt")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 1, kind: "turn-start", turn: 1 })
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 2, kind: "text-delta", turn: 1, step: 1, index: 0, text: "answer" })
    harness.controller.onLiveTextPaint()
    harness.controller.onAssistantText("answer")
    harness.finishPrompt()
    await prompt

    const report = harness.controller.state.transcript.find((item) => item.kind === "diagnostic" && item.text.startsWith("[perf]"))
    expect(report).toBeDefined()
    expect(report && "text" in report ? report.text : "").toMatch(/backend \d+ms.*paint \d+ms.*settle \d+ms/)
    expect(report && "text" in report ? report.text : "").not.toContain("secret prompt")
  })

  it("queues one editable startup prompt and sends its latest value exactly once", async () => {
    const harness = createHarness()
    const releaseSession = harness.deferSession()
    const starting = harness.controller.start()
    await new Promise((resolve) => setTimeout(resolve, 0))

    await harness.controller.submit("first")
    harness.controller.updateDraft("first edited")
    expect(harness.controller.state.queuedPrompt).toBe("first edited")

    releaseSession()
    await starting

    expect(harness.promptCalls).toEqual(["first edited"])
    expect(harness.controller.state.queuedPrompt).toBeNull()
    expect(harness.controller.state.transcript).toEqual([
      { kind: "user", text: "first edited" },
    ])
  })

  it("keeps a failed startup queue synchronized with later editor changes", async () => {
    const harness = createHarness()
    harness.deferSession()
    const starting = harness.controller.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await harness.controller.submit("first")

    harness.failSession()
    await starting
    expect(harness.controller.state.phase).toBe("failed")

    harness.controller.updateDraft("latest edit")
    expect(harness.controller.state.queuedPrompt).toBe("latest edit")
  })

  it("starts ready, submits one prompt, and renders streamed assistant text", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("hello")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onAssistantText("answer")
    harness.finishPrompt()
    await prompt

    expect(harness.controller.state.phase).toBe("ready")
    expect(harness.controller.state.sessionId).toBe("session-1")
    expect(harness.controller.state.transcript).toEqual([
      { kind: "user", text: "hello" },
      { kind: "assistant", text: "answer" },
    ])
  })

  it("shows real activity and reconciles live text to one authoritative ACP answer", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("hello")
    await new Promise((resolve) => setTimeout(resolve, 0))

    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 1, kind: "turn-start", turn: 1 })
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 2, kind: "activity", turn: 1, step: 1, activity: "thinking" })
    expect(harness.controller.state.activity).toEqual({ kind: "thinking" })
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 3, kind: "text-delta", turn: 1, step: 1, index: 0, text: "hel" })
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 4, kind: "text-final", turn: 1, step: 1, index: 0, text: "hello" })
    expect(harness.controller.state.partialAssistantText).toBe("hello")

    harness.controller.onAssistantText("hello!")
    harness.controller.onAssistantText(" Second block.")
    harness.finishPrompt()
    await prompt

    expect(harness.controller.state.transcript).toEqual([
      { kind: "user", text: "hello" },
      { kind: "assistant", text: "hello! Second block." },
    ])
    expect(harness.controller.state.partialAssistantText).toBe("")
    expect(harness.controller.state.activity).toEqual({ kind: "idle" })
  })

  it("deduplicates live tool cards and per-step usage against JSONL fallback", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("inspect")
    await new Promise((resolve) => setTimeout(resolve, 0))

    harness.controller.onLiveRecord({
      v: 1,
      sessionId: "session-1",
      seq: 1,
      kind: "tool-start",
      turn: 1,
      step: 1,
      callId: "call-1",
      name: "read_file",
      arguments: "{\"path\":\"README.md\"}",
    })
    expect(harness.controller.state.activity).toEqual({ kind: "tool", name: "read_file" })
    harness.controller.onLiveRecord({
      v: 1,
      sessionId: "session-1",
      seq: 1,
      kind: "tool-start",
      turn: 1,
      step: 2,
      callId: "duplicate-sequence",
      name: "must_not_render",
      arguments: "{}",
    })
    expect(harness.controller.state.transcript.filter((item) => item.kind === "tool-call")).toHaveLength(1)
    harness.controller.onLiveRecord({
      v: 1,
      sessionId: "session-1",
      seq: 2,
      kind: "tool-end",
      turn: 1,
      step: 1,
      callId: "call-1",
      isError: false,
      text: "contents",
    })
    harness.controller.onLiveRecord({
      v: 1,
      sessionId: "session-1",
      seq: 3,
      kind: "usage",
      turn: 1,
      step: 1,
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 },
    })
    harness.logs.emit({ kind: "tool-call", callId: "call-1", name: "read_file", arguments: "{\"path\":\"README.md\"}" })
    harness.logs.emit({ kind: "tool-result", callId: "call-1", name: "read_file", text: "contents", isError: false })
    harness.logs.emit({ kind: "usage", turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 } })

    const toolItems = harness.controller.state.transcript.filter((item) => item.kind === "tool-call" || item.kind === "tool-result")
    expect(toolItems).toEqual([{ kind: "tool-result", name: "read_file", text: "contents", isError: false }])
    expect(harness.controller.state.transcript.filter((item) => item.kind === "tool-result")).toHaveLength(1)
    expect(harness.controller.state.usage).toEqual({ inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 })
    harness.finishPrompt()
    await prompt
  })

  it("finishes fresh tool and usage records that arrive after ACP text", async () => {
    const harness = createHarness({ toolCards: false })
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("inspect")
    await new Promise((resolve) => setTimeout(resolve, 0))

    harness.controller.onLiveRecord({
      v: 1,
      sessionId: "session-1",
      seq: 1,
      kind: "tool-start",
      turn: 1,
      step: 1,
      callId: "call-1",
      name: "read_file",
      arguments: "{}",
    })
    harness.controller.onAssistantText("authoritative")
    harness.controller.onLiveRecord({
      v: 1,
      sessionId: "session-1",
      seq: 2,
      kind: "tool-end",
      turn: 1,
      step: 1,
      callId: "call-1",
      isError: false,
      text: "done",
    })
    harness.controller.onLiveRecord({
      v: 1,
      sessionId: "session-1",
      seq: 3,
      kind: "usage",
      turn: 1,
      step: 1,
      usage: { inputTokens: 7, outputTokens: 2 },
    })

    expect(harness.controller.state.transcript).toContainEqual({ kind: "tool-result", name: "read_file", text: "done", isError: false })
    expect(harness.controller.state.usage).toEqual({ inputTokens: 7, outputTokens: 2, cacheReadTokens: 0 })
    harness.finishPrompt()
    await prompt
  })

  it("blocks duplicate submit without adding a second user turn", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const first = harness.controller.submit("one")
    await new Promise((resolve) => setTimeout(resolve, 0))
    await harness.controller.submit("two")

    expect(harness.controller.state.transcript).toEqual([
      { kind: "user", text: "one" },
      { kind: "diagnostic", text: "Already working; wait for the current prompt to settle." },
    ])
    harness.finishPrompt()
    await first
  })

  it("resets transcript, usage, cost, watcher, and overlay state for a new session", async () => {
    const harness = createHarness()
    await harness.controller.start()
    harness.logs.emit({ kind: "usage", usage: { inputTokens: 1_000_000 } })
    harness.controller.onAssistantText("partial")
    await harness.controller.newSession()

    expect(harness.controller.state.phase).toBe("ready")
    expect(harness.controller.state.sessionId).toBe("session-2")
    expect(harness.controller.state.transcript).toEqual([])
    expect(harness.controller.state.partialAssistantText).toBe("")
    expect(harness.controller.state.usage).toEqual({})
    expect(harness.controller.state.costUsd).toBeNull()
  })

  it("moves to failed on backend exit and never replays the prompt", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("side effect")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onBackendExit({ outcomeUnknown: true })
    expect(harness.controller.state.phase).toBe("failed")
    expect(harness.controller.state.backendMessage).toMatch(/unknown/i)
    harness.finishPrompt()
    await prompt
    expect(harness.controller.state.transcript.filter((entry) => entry.kind === "user")).toHaveLength(1)
  })

  it("keeps partial live evidence marked unknown after a backend exit", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("side effect")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 1, kind: "turn-start", turn: 1 })
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 2, kind: "text-delta", turn: 1, step: 1, index: 0, text: "possibly applied" })

    harness.controller.onDiagnostic("live event pipe closed; continuing with ACP")
    harness.controller.onBackendExit({ outcomeUnknown: true })
    harness.finishPrompt()
    await prompt

    expect(harness.controller.state.phase).toBe("failed")
    expect(harness.controller.state.interruption).toBe("outcome-unknown")
    expect(harness.controller.state.transcript).toContainEqual({ kind: "assistant", text: "possibly applied" })
    expect(harness.promptCalls).toEqual(["side effect"])
  })

  it("fails closed for permission decisions and closes without returning to ready", async () => {
    const harness = createHarness()
    await harness.controller.start()
    await expect(harness.controller.decidePermission({ toolCallId: "call", optionIds: ["reject-once"] })).resolves.toEqual({ outcome: "cancelled" })
    harness.deferPrompt()
    const prompt = harness.controller.submit("hold")
    await new Promise((resolve) => setTimeout(resolve, 0))
    await harness.controller.close()
    harness.finishPrompt()
    await prompt
    expect(harness.controller.state.phase).toBe("closing")
  })

  it("disposes clocks, live input, logs, overlays, and the backend in order", async () => {
    const harness = createHarness()
    await harness.controller.start()

    await harness.controller.close()

    expect(harness.cleanupOrder).toEqual([
      "view-timers",
      "backend-live",
      "logs",
      "view-overlays",
      "backend",
    ])
  })

  it("blocks submit and duplicate History while history storage is loading", async () => {
    const harness = createHarness()
    let release!: (sessions: SessionInfo[]) => void
    let listCalls = 0
    harness.setListHistory(() => {
      listCalls += 1
      return new Promise((resolve) => { release = resolve })
    })
    await harness.controller.start()
    const opening = harness.controller.openHistory()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.controller.state.activeOverlay).toBe("history")
    await harness.controller.submit("must not send")
    await harness.controller.openHistory()
    expect(listCalls).toBe(1)
    expect(harness.promptCalls).toEqual([])

    release([])
    await opening
    expect(harness.controller.state.activeOverlay).toBeNull()
  })

  it("serializes concurrent permission dialogs", async () => {
    const harness = createHarness()
    let releaseFirst!: (decision: PermissionDecision) => void
    let calls = 0
    harness.setApproval(async () => {
      calls += 1
      if (calls === 1) return new Promise((resolve) => { releaseFirst = resolve })
      return { outcome: "cancelled" }
    })
    await harness.controller.start()

    const first = harness.controller.decidePermission({ toolCallId: "call-1", optionIds: ["allow-once", "reject-once"] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(1)
    expect(harness.controller.state.activeOverlay).toBe("approval")

    const second = harness.controller.decidePermission({ toolCallId: "call-2", optionIds: ["allow-once", "reject-once"] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(1)

    releaseFirst({ outcome: "selected", optionId: "allow-once" })
    await expect(first).resolves.toEqual({ outcome: "selected", optionId: "allow-once" })
    await expect(second).resolves.toEqual({ outcome: "cancelled" })
    expect(calls).toBe(2)
    expect(harness.controller.state.activeOverlay).toBeNull()
  })
})
