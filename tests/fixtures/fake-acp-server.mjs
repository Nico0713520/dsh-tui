import { createInterface } from "node:readline"

const scenario = process.env.FAKE_ACP_SCENARIO ?? "normal"
const input = createInterface({ input: process.stdin })
let nextSession = 1
let promptId = null
let permissionId = 100

if (scenario === "stubborn") process.on("SIGTERM", () => {})

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
    result(frame.id, { sessionId: `fake-session-${nextSession++}` })
    return
  }

  if (frame.id === permissionId && frame.result) {
    if (frame.result.outcome?.outcome === "selected") assistant("allowed")
    else assistant("cancelled")
    if (promptId !== null) result(promptId, { stopReason: frame.result.outcome?.outcome === "selected" ? "end_turn" : "cancelled" })
    return
  }

  if (frame.method === "session/cancel") {
    if (scenario === "delayed" && promptId !== null) {
      assistant("cancelled")
      result(promptId, { stopReason: "cancelled" })
    }
    return
  }

  if (frame.method !== "session/prompt") return
  promptId = frame.id

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

  assistant("hello")
  result(frame.id, { stopReason: "end_turn" })
})

process.stdin.on("end", () => {
  if (scenario !== "stubborn") process.exit(0)
})
