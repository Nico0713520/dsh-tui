import { createWriteStream } from "node:fs"
import { Socket } from "node:net"
import { createInterface } from "node:readline"

export const name = "dsh-tui-live-events"

const MAX_TOOL_BYTES = 65_536
const MAX_RECORD_BYTES = 1_048_576

export function apply(ctx) {
  const output = createWriteStream(null, { fd: 3, autoClose: false })
  const controlInput = new Socket({ fd: 4, readable: true, writable: false })
  controlInput.unref()
  const control = createInterface({ input: controlInput, crlfDelay: Infinity })
  const textFinals = new WeakMap()
  let writable = true
  let blocked = false

  output.on("error", () => {
    writable = false
    blocked = false
  })
  output.on("drain", () => {
    if (writable) blocked = false
  })

  const send = (record, essential = false) => {
    if (!writable || (blocked && !essential)) return
    const line = `${JSON.stringify({ v: 1, ...record })}\n`
    if (Buffer.byteLength(line) > MAX_RECORD_BYTES) return
    try {
      blocked = !output.write(line) || blocked
    } catch {
      writable = false
      blocked = false
    }
  }

  controlInput.on("error", () => control.close())
  control.on("line", (line) => {
    let request
    try {
      request = JSON.parse(line)
    } catch {
      return
    }
    if (request?.v === 1 && request.kind === "barrier" && Number.isSafeInteger(request.id) && request.id >= 0) {
      send({ kind: "barrier", id: request.id }, true)
    }
  })
  send({ kind: "control-ready" }, true)

  const markFinal = (session, turn, step) => {
    let steps = textFinals.get(session)
    if (!steps) textFinals.set(session, steps = new Set())
    steps.add(`${turn}:${step}`)
  }

  const hasFinal = (session, turn, step) => textFinals.get(session)?.has(`${turn}:${step}`) === true

  ctx.on("session/event", (session, event) => {
    const sessionId = String(session.id)
    const base = { sessionId, seq: event.seq }

    if (event.type === "turn/start") {
      send({ ...base, kind: "turn-start", turn: event.data.turn })
      return
    }
    if (event.type === "turn/end") {
      send({ ...base, kind: "turn-end", turn: event.data.turn, reason: reasonText(event.data.reason) })
      return
    }
    if (event.type === "assistant/chunk") {
      const { turn, step, chunk } = event.data
      if (chunk.type === "reasoning-delta" || (chunk.type === "block-start" && chunk.blockType === "reasoning")) {
        send({ ...base, kind: "activity", turn, step, activity: "thinking" })
        return
      }
      if (chunk.type === "block-start" && chunk.blockType === "text") {
        send({ ...base, kind: "activity", turn, step, activity: "responding" })
        return
      }
      if (chunk.type === "text-delta") {
        send({ ...base, kind: "text-delta", turn, step, index: chunk.index, text: chunk.text })
        return
      }
      if (chunk.type === "block-end" && chunk.block?.type === "text") {
        const record = { ...base, kind: "text-final", turn, step, index: chunk.index, text: chunk.block.text }
        if (Buffer.byteLength(`${JSON.stringify({ v: 1, ...record })}\n`) <= MAX_RECORD_BYTES) {
          markFinal(session, turn, step)
          send(record)
        }
        return
      }
      if (chunk.type === "usage") {
        send({ ...base, kind: "usage", turn, step, usage: normalizeUsage(chunk.usage) })
      }
      return
    }
    if (event.type === "assistant/message") {
      const { turn, step, message, usage } = event.data
      if (!hasFinal(session, turn, step)) {
        const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("")
        if (text) send({ ...base, kind: "text-final", turn, step, index: 0, text })
      }
      if (usage) send({ ...base, kind: "usage", turn, step, usage: normalizeUsage(usage) })
      return
    }
    if (event.type === "tool/call") {
      send({
        ...base,
        kind: "tool-start",
        turn: event.data.turn,
        step: event.data.step,
        callId: String(event.data.callId),
        name: event.data.name,
        arguments: boundedText(event.data.arguments),
      })
      return
    }
    if (event.type === "tool/result") {
      const block = event.data.message.content[0]
      send({
        ...base,
        kind: "tool-end",
        turn: event.data.turn,
        step: event.data.step,
        callId: String(block.toolCallId),
        isError: block.isError === true || event.data.error !== undefined,
        text: boundedText(contentText(block.content)),
      })
    }
  })

  ctx.on("session/disposed", (session) => {
    textFinals.delete(session)
  })

  ctx.effect(() => () => {
    writable = false
    control.close()
    controlInput.destroy()
    output.destroy()
  }, "dsh-tui live event pipe")
}

function normalizeUsage(usage) {
  return {
    inputTokens: finiteCount(usage.inputTokens),
    outputTokens: finiteCount(usage.outputTokens),
    cacheReadTokens: finiteCount(usage.cacheReadTokens),
  }
}

function finiteCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function reasonText(reason) {
  return typeof reason?.kind === "string" ? reason.kind : "unknown"
}

function contentText(content) {
  return content.flatMap((block) => {
    if (block.type === "text") return [block.text]
    if (block.type === "tool-result") return [contentText(block.content)]
    return []
  }).filter(Boolean).join("\n")
}

function boundedText(value) {
  const text = String(value)
  if (Buffer.byteLength(text) <= MAX_TOOL_BYTES) return text
  let end = Math.min(text.length, MAX_TOOL_BYTES)
  while (end > 0 && Buffer.byteLength(text.slice(0, end)) > MAX_TOOL_BYTES - 3) end -= 1
  return `${text.slice(0, end)}...`
}
