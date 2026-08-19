import { createInterface } from "node:readline"
import { closeSync, createWriteStream } from "node:fs"
import { Socket } from "node:net"

const scenario = process.env.FAKE_ACP_SCENARIO ?? "normal"
const input = createInterface({ input: process.stdin })
const controlInput = new Socket({ fd: 4, readable: true, writable: false })
controlInput.unref()
const control = createInterface({ input: controlInput, crlfDelay: Infinity })
let nextSession = 1
let activeSessionId = null
let promptId = null
let promptCount = 0
let permissionId = 100
const live = createWriteStream(null, { fd: 3, autoClose: false })
live.on("error", () => {})
if (scenario !== "no-live-control") live.write(`${JSON.stringify({ v: 1, kind: "control-ready" })}\n`)

control.on("line", (line) => {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  if (request?.v === 1 && request.kind === "barrier" && Number.isSafeInteger(request.id) && request.id >= 0) {
    if (scenario === "barrier-exit") process.exit(18)
    live.write(`${JSON.stringify({ v: 1, kind: "barrier", id: request.id })}\n`)
  }
})
controlInput.on("error", () => control.close())

if (scenario === "live-degraded") {
  live.write(`${JSON.stringify({ v: 1, sessionId: "fake-001", seq: 0, kind: "turn-start", turn: 0 })}\n`)
}

if (scenario === "stubborn") process.on("SIGTERM", () => {})
if (scenario === "stdin-close") {
  setInterval(() => {}, 1_000)
  setTimeout(() => process.exit(0), 1_000)
}

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)
}

function result(id, value) {
  send({ id, result: value })
}

function assistant(text) {
  send({
    method: "session/update",
    params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } },
  })
}

function liveRecords(records) {
  for (const record of records) live.write(`${JSON.stringify(record)}\n`)
}

input.on("line", (line) => {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return
  }

  if (frame.method === "initialize") {
    result(frame.id, { protocolVersion: 1, agentInfo: { name: "fake" } })
    return
  }

  if (frame.method === "session/new") {
    activeSessionId = `fake-${String(nextSession++).padStart(3, "0")}`
    if (scenario === "slow-start-live") setTimeout(() => result(frame.id, { sessionId: activeSessionId }), 350)
    else result(frame.id, { sessionId: activeSessionId })
    if (scenario === "stdin-close") setTimeout(() => {
      process.stdin.destroy()
      try { closeSync(0) } catch {}
    }, 10)
    return
  }

  if (frame.id === permissionId && frame.result) {
    if (frame.result.outcome?.outcome === "selected" && frame.result.outcome?.optionId === "allow-once") assistant("allowed")
    else assistant("cancelled")
    if (promptId !== null) result(promptId, { stopReason: frame.result.outcome?.outcome === "selected" ? "end_turn" : "cancelled" })
    return
  }

  if (frame.method === "session/cancel") {
    if (scenario === "permission") {
      assistant("unexpected-session-cancel")
      return
    }
    if (scenario === "delayed" && promptId !== null) {
      assistant("cancelled")
      result(promptId, { stopReason: "cancelled" })
    }
    if (scenario === "live-cancel" && promptId !== null) {
      result(promptId, { stopReason: "cancelled" })
    }
    return
  }

  if (frame.method !== "session/prompt") return
  promptId = frame.id
  promptCount += 1

  if (scenario === "forced-exit") {
    process.exit(17)
  }
  if (scenario === "malformed") {
    process.stdout.write("not-json\\n")
  }
  if (scenario === "permission") {
    permissionId += 1
    send({
      id: permissionId,
      method: "session/request_permission",
      params: {
        toolCall: { toolCallId: "call-1", title: "run command" },
        options: [{ optionId: "allow-once", name: "Allow" }, { optionId: "reject-once", name: "Reject" }],
      },
    })
    return
  }
  if (scenario === "delayed") return

  if (scenario === "live-stream") {
    liveRecords([
      { v: 1, sessionId: activeSessionId, seq: 1, kind: "turn-start", turn: 1 },
      { v: 1, sessionId: activeSessionId, seq: 2, kind: "activity", turn: 1, step: 1, activity: "thinking" },
      { v: 1, sessionId: activeSessionId, seq: 3, kind: "text-delta", turn: 1, step: 1, index: 0, text: "hel" },
      { v: 1, sessionId: activeSessionId, seq: 4, kind: "text-delta", turn: 1, step: 1, index: 0, text: "lo" },
      { v: 1, sessionId: activeSessionId, seq: 5, kind: "text-final", turn: 1, step: 1, index: 0, text: "hello" },
      { v: 1, sessionId: activeSessionId, seq: 6, kind: "turn-end", turn: 1, reason: "end_turn" },
    ])
    assistant("hello!")
    result(frame.id, { stopReason: "end_turn" })
    return
  }
  if (scenario === "live-degraded") {
    live.write("{must-not-appear\n")
    live.write(`${"x".repeat(1_048_577)}\n`)
    assistant("fallback")
    result(frame.id, { stopReason: "end_turn" })
    return
  }
  if (scenario === "live-pipe-close") {
    live.end(() => {
      try { closeSync(3) } catch {}
      assistant("after close")
      result(frame.id, { stopReason: "end_turn" })
    })
    return
  }
  if (scenario === "slow-start-live") {
    const promptText = frame.params?.prompt?.[0]?.text ?? ""
    const answer = promptCount === 1 ? `queued:${promptText}` : "duplicate prompt"
    liveRecords([
      { v: 1, sessionId: activeSessionId, seq: 1, kind: "turn-start", turn: 1 },
      { v: 1, sessionId: activeSessionId, seq: 2, kind: "activity", turn: 1, step: 1, activity: "thinking" },
    ])
    setTimeout(() => liveRecords([
      { v: 1, sessionId: activeSessionId, seq: 3, kind: "text-delta", turn: 1, step: 1, index: 0, text: answer.slice(0, 6) },
    ]), 80)
    setTimeout(() => {
      liveRecords([
        { v: 1, sessionId: activeSessionId, seq: 4, kind: "text-final", turn: 1, step: 1, index: 0, text: answer },
        { v: 1, sessionId: activeSessionId, seq: 5, kind: "turn-end", turn: 1, reason: "completed" },
      ])
      assistant(answer)
      result(frame.id, { stopReason: "end_turn" })
    }, 160)
    return
  }
  if (scenario === "live-cancel") {
    liveRecords([
      { v: 1, sessionId: activeSessionId, seq: 1, kind: "turn-start", turn: 1 },
      { v: 1, sessionId: activeSessionId, seq: 2, kind: "text-delta", turn: 1, step: 1, index: 0, text: "partial evidence" },
    ])
    return
  }
  if (scenario === "live-forced-exit") {
    liveRecords([
      { v: 1, sessionId: activeSessionId, seq: 1, kind: "turn-start", turn: 1 },
      { v: 1, sessionId: activeSessionId, seq: 2, kind: "text-delta", turn: 1, step: 1, index: 0, text: "unknown evidence" },
    ])
    setTimeout(() => process.exit(17), 120)
    return
  }

  assistant("hello")
  result(frame.id, { stopReason: "end_turn" })
})

process.stdin.on("end", () => {
  if (scenario !== "stubborn") process.exit(0)
})
