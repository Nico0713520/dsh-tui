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
}

function createHarness() {
  let promptResolve: ((value: { stopReason: string }) => void) | undefined
  let promptImpl: ((text: string) => Promise<{ stopReason: string }>) | undefined
  let listHistoryImpl: () => Promise<SessionInfo[]> = async () => []
  let loadHistoryImpl: () => Promise<HistoryEntry[]> = async () => []
  let chooseHistoryImpl: () => Promise<HistoryChoice> = async () => ({ kind: "cancel" })
  let approvalImpl: (request: ApprovalRequest) => Promise<PermissionDecision> = async () => ({ outcome: "cancelled" })
  let sessionNumber = 0
  let activeSessionId: string | null = null
  const renders: AppState[] = []
  const promptCalls: string[] = []
  const backend: BackendPort = {
    get activeSessionId() { return activeSessionId },
    async start() {},
    async newSession() {
      const id = `session-${++sessionNumber}`
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
    async close() {},
  }
  interface FakeLogs extends SessionLogPort {
    watched?: SessionLogWatchOptions
    emit(event: SessionLogEvent): void
  }
  const logs: FakeLogs = {
    watch(options) { logs.watched = options },
    stop() {},
    lookupCall() { return { name: "bash", arguments: JSON.stringify({ command: "rm -rf ." }) } },
    async listHistory() { return listHistoryImpl() },
    async loadHistory() { return loadHistoryImpl() },
    emit(event) { logs.watched?.onEvent(event) },
  }
  const view: ControllerView = {
    render(state) { renders.push(state) },
    async requestApproval(request): Promise<PermissionDecision> { return approvalImpl(request) },
    async chooseHistory() { return chooseHistoryImpl() },
  }
  return {
    backend,
    logs,
    view,
    renders,
    controller: new AppController({ config, backend, logs, view }),
    promptCalls,
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
    finishPrompt(stopReason = "end_turn") {
      promptResolve?.({ stopReason })
    },
  }
}

describe("AppController", () => {
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
