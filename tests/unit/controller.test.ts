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
  theme: "terminal",
  perf: false,
  reasoningMode: "quick",
}

function createHarness(configOverride: Partial<AppConfig> = {}, now: () => number = Date.now) {
  let promptResolve: ((value: { stopReason: string }) => void) | undefined
  let promptImpl: ((text: string) => Promise<{ stopReason: string }>) | undefined
  let listHistoryImpl: () => Promise<SessionInfo[]> = async () => []
  let loadHistoryImpl: () => Promise<HistoryEntry[]> = async () => []
  let chooseHistoryImpl: () => Promise<HistoryChoice> = async () => ({ kind: "cancel" })
  let approvalImpl: (request: ApprovalRequest) => Promise<PermissionDecision> = async () => ({ outcome: "cancelled" })
  let lookupCallImpl: (callId: string) => { name: string; arguments: string } | undefined = () => ({
    name: "bash",
    arguments: JSON.stringify({ command: "rm -rf ." }),
  })
  let sessionNumber = 0
  let activeSessionId: string | null = null
  let sessionGate: Promise<void> | null = null
  let releaseSession: (() => void) | undefined
  let rejectSession: ((error: Error) => void) | undefined
  let liveSyncGate: Promise<void> | null = null
  let releaseLiveSync: (() => void) | undefined
  let synchronizeLogsImpl: () => Promise<void> = async () => {}
  const renders: AppState[] = []
  const promptCalls: string[] = []
  const cleanupOrder: string[] = []
  const backend: BackendPort & { stopLiveEvents(): void; synchronizeLiveEvents(): Promise<void> } = {
    get activeSessionId() { return activeSessionId },
    async start() {},
    async newSession() {
      const id = `session-${++sessionNumber}`
      if (sessionGate) await sessionGate
      activeSessionId = id
      return id
    },
    async synchronizeLiveEvents() {
      if (liveSyncGate) await liveSyncGate
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
    lookupCall(callId) { return lookupCallImpl(callId) },
    async listHistory() { return listHistoryImpl() },
    async loadHistory() { return loadHistoryImpl() },
    async synchronize() { await synchronizeLogsImpl() },
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
    controller: new AppController({ config: { ...config, ...configOverride }, backend, logs, view, now }),
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
    setLookupCall(impl: (callId: string) => { name: string; arguments: string } | undefined) {
      lookupCallImpl = impl
    },
    setLogSynchronize(impl: () => Promise<void>) {
      synchronizeLogsImpl = impl
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
    deferLiveSync() {
      liveSyncGate = new Promise((resolve) => { releaseLiveSync = resolve })
      return () => {
        releaseLiveSync?.()
        liveSyncGate = null
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
  it("commits a truthful thinking duration when response begins", async () => {
    let now = 1_000
    const harness = createHarness({}, () => now)
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("hello")
    await new Promise((resolve) => setTimeout(resolve, 0))

    now = 2_250
    harness.controller.onAssistantText("Hi")
    harness.finishPrompt()
    await prompt

    expect(harness.controller.state.transcript).toContainEqual({ kind: "thinking-trace", durationMs: 1_250 })
  })

  it("preserves tool target and measures its visible lifecycle", async () => {
    let now = 10_000
    const harness = createHarness({}, () => now)
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("inspect")
    await new Promise((resolve) => setTimeout(resolve, 0))

    harness.controller.onLiveRecord({
      v: 1, sessionId: "session-1", seq: 1, kind: "tool-start", turn: 1, step: 1,
      callId: "call-1", name: "read_file", arguments: "{\"path\":\"src/app.ts\"}",
    })
    now = 10_875
    harness.controller.onLiveRecord({
      v: 1, sessionId: "session-1", seq: 2, kind: "tool-end", turn: 1, step: 1,
      callId: "call-1", isError: false, text: "contents",
    })

    expect(harness.controller.state.transcript).toContainEqual({
      kind: "tool-result",
      name: "read_file",
      arguments: "{\"path\":\"src/app.ts\"}",
      text: "contents",
      isError: false,
      durationMs: 875,
    })
    harness.finishPrompt()
    await prompt
  })

  it("uses live tool metadata for approval when JSONL observation is disabled", async () => {
    const harness = createHarness({ toolCards: false })
    const approvals: ApprovalRequest[] = []
    harness.setLookupCall(() => undefined)
    harness.setApproval(async (request) => {
      approvals.push(request)
      return { outcome: "cancelled" }
    })
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("inspect")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onLiveRecord({
      v: 1, sessionId: "session-1", seq: 1, kind: "tool-start", turn: 1, step: 1,
      callId: "call-1", name: "read_file", arguments: "{\"path\":\"README.md\"}",
    })

    await harness.controller.decidePermission({ toolCallId: "call-1", optionIds: ["allow-once", "reject-once"] })

    expect(approvals).toEqual([expect.objectContaining({
      toolCallId: "call-1",
      name: "read_file",
      arguments: "{\"path\":\"README.md\"}",
      stakes: "routine",
    })])
    harness.finishPrompt()
    await prompt
  })

  it("shows a pending tool card when permission arrives before the observed tool event", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("run it")
    await new Promise((resolve) => setTimeout(resolve, 0))

    await harness.controller.decidePermission({ toolCallId: "approval-first", optionIds: ["allow-once"] })

    expect(harness.controller.state.transcript).toContainEqual({
      kind: "tool-call",
      name: "bash",
      arguments: JSON.stringify({ command: "rm -rf ." }),
    })
    harness.finishPrompt()
    await prompt
  })

  it("replaces the pending tool after a visible thinking trace is inserted", async () => {
    let now = 1_000
    const harness = createHarness({}, () => now)
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("inspect")
    await new Promise((resolve) => setTimeout(resolve, 0))

    now = 1_500
    harness.controller.onLiveRecord({
      v: 1, sessionId: "session-1", seq: 1, kind: "tool-start", turn: 1, step: 1,
      callId: "call-1", name: "read_file", arguments: "{\"path\":\"src/app.ts\"}",
    })
    now = 1_800
    harness.controller.onLiveRecord({
      v: 1, sessionId: "session-1", seq: 2, kind: "tool-end", turn: 1, step: 1,
      callId: "call-1", isError: false, text: "contents",
    })

    expect(harness.controller.state.transcript).toEqual([
      { kind: "user", text: "inspect" },
      { kind: "thinking-trace", durationMs: 500 },
      {
        kind: "tool-result",
        name: "read_file",
        arguments: "{\"path\":\"src/app.ts\"}",
        text: "contents",
        isError: false,
        durationMs: 300,
      },
    ])
    harness.finishPrompt()
    await prompt
  })

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
    expect(toolItems).toEqual([{
      kind: "tool-result",
      name: "read_file",
      arguments: "{\"path\":\"README.md\"}",
      text: "contents",
      isError: false,
      durationMs: expect.any(Number),
    }])
    expect(harness.controller.state.transcript.filter((item) => item.kind === "tool-result")).toHaveLength(1)
    expect(harness.controller.state.usage).toEqual({ inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 })
    harness.finishPrompt()
    await prompt
  })

  it("appends a truthful turn summary from unique tool results", async () => {
    let now = 1_000
    const harness = createHarness({}, () => now)
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("check")
    await new Promise((resolve) => setTimeout(resolve, 0))

    now = 1_200
    harness.controller.onLiveRecord({
      v: 1, sessionId: "session-1", seq: 1, kind: "tool-start", turn: 1, step: 1,
      callId: "read", name: "read_file", arguments: "{}",
    })
    now = 1_500
    harness.controller.onLiveRecord({
      v: 1, sessionId: "session-1", seq: 2, kind: "tool-end", turn: 1, step: 1,
      callId: "read", isError: false, text: "ok",
    })
    harness.controller.onLiveRecord({
      v: 1, sessionId: "session-1", seq: 3, kind: "tool-start", turn: 1, step: 2,
      callId: "test", name: "npm_test", arguments: "{}",
    })
    now = 2_000
    harness.controller.onLiveRecord({
      v: 1, sessionId: "session-1", seq: 4, kind: "tool-end", turn: 1, step: 2,
      callId: "test", isError: true, text: "failed",
    })
    now = 2_500
    harness.finishPrompt()
    await prompt

    expect(harness.controller.state.transcript).toContainEqual({
      kind: "turn-summary",
      status: "done",
      durationMs: 1_500,
      toolCount: 2,
      failedToolCount: 1,
    })
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
    harness.finishPrompt()
    await prompt
    expect(harness.controller.state.phase).toBe("ready")

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

    expect(harness.controller.state.transcript).toContainEqual({
      kind: "tool-result",
      name: "read_file",
      arguments: "{}",
      text: "done",
      isError: false,
      durationMs: expect.any(Number),
    })
    expect(harness.controller.state.usage).toEqual({ inputTokens: 7, outputTokens: 2, cacheReadTokens: 0 })
  })

  it("synchronizes a JSONL tool result before finalizing the turn summary", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    harness.setLogSynchronize(async () => {
      harness.logs.emit({ kind: "tool-call", callId: "late-1", name: "read_file", arguments: "{}" })
      harness.logs.emit({ kind: "tool-result", callId: "late-1", name: "read_file", text: "done", isError: false })
    })
    await harness.controller.start()
    harness.controller.onSessionChanged("session-1")
    const prompt = harness.controller.submit("inspect")
    await new Promise((resolve) => setTimeout(resolve, 0))

    harness.finishPrompt()
    await prompt

    expect(harness.controller.state.transcript.at(-1)).toEqual({
      kind: "turn-summary",
      status: "done",
      durationMs: expect.any(Number),
      toolCount: 1,
      failedToolCount: 0,
    })
  })

  it("does not start a queued follow-up until observability and the first summary settle", async () => {
    let now = 1_000
    const harness = createHarness({}, () => now)
    harness.deferPrompt()
    let releaseLogs!: () => void
    const logsSettled = new Promise<void>((resolve) => { releaseLogs = resolve })
    harness.setLogSynchronize(() => logsSettled)
    await harness.controller.start()
    const first = harness.controller.submit("one")
    await new Promise((resolve) => setTimeout(resolve, 0))
    await harness.controller.submit("two")

    harness.finishPrompt()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.promptCalls).toEqual(["one"])

    now = 1_500
    releaseLogs()
    await first
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.promptCalls).toEqual(["one", "two"])
    const transcript = harness.controller.state.transcript
    const summaryIndex = transcript.findIndex((item) => item.kind === "turn-summary")
    const secondUserIndex = transcript.findIndex((item, index) => index > 0 && item.kind === "user" && item.text === "two")
    expect(summaryIndex).toBeGreaterThanOrEqual(0)
    expect(secondUserIndex).toBeGreaterThan(summaryIndex)
  })

  it("accepts first-arriving usage after ACP settles without prior live records", async () => {
    const harness = createHarness({ toolCards: false })
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("inspect")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onAssistantText("authoritative")
    harness.finishPrompt()
    await prompt

    harness.controller.onLiveRecord({
      v: 1,
      sessionId: "session-1",
      seq: 1,
      kind: "usage",
      turn: 1,
      step: 1,
      usage: { inputTokens: 3, outputTokens: 1 },
    })

    expect(harness.controller.state.usage).toEqual({ inputTokens: 3, outputTokens: 1, cacheReadTokens: 0 })
    expect(harness.controller.state.partialAssistantText).toBe("")
  })

  it("queues one editable follow-up and sends it after the active prompt", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const first = harness.controller.submit("one")
    await new Promise((resolve) => setTimeout(resolve, 0))
    await harness.controller.submit("two")
    harness.controller.updateDraft("two edited")

    expect(harness.promptCalls).toEqual(["one"])
    expect(harness.controller.state.queuedPrompt).toBe("two edited")
    harness.finishPrompt()
    await first
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.promptCalls).toEqual(["one", "two edited"])
    expect(harness.controller.state.transcript).toEqual([
      { kind: "user", text: "one" },
      { kind: "user", text: "two edited" },
    ])
    harness.finishPrompt()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.controller.state.phase).toBe("ready")
  })

  it("lets an empty draft remove the queued follow-up", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const first = harness.controller.submit("one")
    await new Promise((resolve) => setTimeout(resolve, 0))
    await harness.controller.submit("two")

    harness.controller.updateDraft("")
    expect(harness.controller.state.queuedPrompt).toBeNull()
    harness.finishPrompt()
    await first
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.promptCalls).toEqual(["one"])
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
    expect(harness.controller.state.transcript).toContainEqual({
      kind: "interrupted-assistant",
      text: "possibly applied",
      reason: "outcome-unknown",
    })
    expect(harness.controller.state.transcript).not.toContainEqual({ kind: "assistant", text: "possibly applied" })
    expect(harness.promptCalls).toEqual(["side effect"])
  })

  it("never presents an interrupted live prefix as a completed assistant answer", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const prompt = harness.controller.submit("long task")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onLiveRecord({
      v: 1,
      sessionId: "session-1",
      seq: 1,
      kind: "text-delta",
      turn: 1,
      step: 1,
      index: 0,
      text: "partial result",
    })
    harness.finishPrompt("cancelled")
    await prompt

    expect(harness.controller.state.transcript).toContainEqual({
      kind: "interrupted-assistant",
      text: "partial result",
      reason: "cancelled",
    })
    expect(harness.controller.state.transcript).not.toContainEqual({
      kind: "assistant",
      text: "partial result",
    })
  })

  it("opens live streaming for the next prompt only after an interrupted turn", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const first = harness.controller.submit("first")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 1, kind: "turn-start", turn: 1 })
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 2, kind: "text-delta", turn: 1, step: 1, index: 0, text: "partial" })
    harness.finishPrompt("cancelled")
    await first

    const second = harness.controller.submit("second")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 3, kind: "text-delta", turn: 1, step: 1, index: 0, text: "stale" })
    expect(harness.controller.state.partialAssistantText).toBe("")
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 4, kind: "turn-start", turn: 2 })
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 5, kind: "text-delta", turn: 2, step: 1, index: 0, text: "fresh" })
    expect(harness.controller.state.partialAssistantText).toBe("fresh")

    harness.finishPrompt()
    await second
  })

  it("drains delayed interrupted records before binding the next backend turn", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const first = harness.controller.submit("first")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.finishPrompt("cancelled")
    await first

    const releaseLiveSync = harness.deferLiveSync()
    const second = harness.controller.submit("second")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 1, kind: "turn-start", turn: 1 })
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 2, kind: "text-delta", turn: 1, step: 1, index: 0, text: "stale" })
    expect(harness.controller.state.partialAssistantText).toBe("")

    releaseLiveSync()
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 3, kind: "turn-start", turn: 1 })
    harness.controller.onLiveRecord({ v: 1, sessionId: "session-1", seq: 4, kind: "text-delta", turn: 1, step: 1, index: 0, text: "fresh" })
    expect(harness.controller.state.partialAssistantText).toBe("fresh")

    harness.finishPrompt()
    await second
  })

  it("does not duplicate the previous answer when cancellation wins during live synchronization", async () => {
    const harness = createHarness()
    harness.deferPrompt()
    await harness.controller.start()
    const first = harness.controller.submit("first")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.onAssistantText("previous answer")
    harness.finishPrompt()
    await first

    const releaseLiveSync = harness.deferLiveSync()
    const second = harness.controller.submit("cancel before send")
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.cancel()
    releaseLiveSync()
    await second

    expect(harness.promptCalls).toEqual(["first"])
    expect(harness.controller.state.transcript).toEqual([
      { kind: "user", text: "first" },
      { kind: "assistant", text: "previous answer" },
      { kind: "user", text: "cancel before send" },
      {
        kind: "turn-summary",
        status: "cancelled",
        durationMs: expect.any(Number),
        toolCount: 0,
        failedToolCount: 0,
      },
    ])
    expect(harness.controller.state.interruption).toBe("cancelled")
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
