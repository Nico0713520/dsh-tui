import { describe, expect, it } from "vitest"
import { TranscriptBuilder, historyToTranscript } from "../../src/transcript-builder.ts"
import type { DshLiveRecord } from "../../src/backend/live-record.ts"
import type { HistoryEntry, SessionLogEvent } from "../../src/backend/session-log.ts"

let clock = 1_000
const now = () => (clock += 10)

function liveToolStart(callId: string, name = "bash"): Extract<DshLiveRecord, { kind: "tool-start" }> {
  return { v: 1, sessionId: "s", seq: 1, kind: "tool-start", turn: 0, step: 0, callId, name, arguments: "{}" }
}

function liveToolEnd(callId: string): Extract<DshLiveRecord, { kind: "tool-end" }> {
  return { v: 1, sessionId: "s", seq: 2, kind: "tool-end", turn: 0, step: 0, callId, isError: false, text: "done" }
}

function logToolCall(callId: string, name = "bash"): Extract<SessionLogEvent, { kind: "tool-call" }> {
  return { kind: "tool-call", callId, name, arguments: "{}" }
}

function logToolResult(callId: string, name = "bash"): Extract<SessionLogEvent, { kind: "tool-result" }> {
  return { kind: "tool-result", callId, name, text: "done", isError: false }
}

describe("TranscriptBuilder", () => {
  it("accepts a live tool start once and ignores duplicates", () => {
    const builder = new TranscriptBuilder(now)
    const first = builder.applyLiveToolStart(liveToolStart("a"), [])
    expect(first.accepted).toBe(true)
    expect(first.transcript).toHaveLength(1)

    const duplicate = builder.applyLiveToolStart(liveToolStart("a"), first.transcript)
    expect(duplicate.accepted).toBe(false)
    expect(duplicate.transcript).toHaveLength(1)
  })

  it("replaces the placeholder in place when a live tool ends", () => {
    const builder = new TranscriptBuilder(now)
    const started = builder.applyLiveToolStart(liveToolStart("a"), [])
    const ended = builder.applyLiveToolEnd(liveToolEnd("a"), started.transcript)
    expect(ended.accepted).toBe(true)
    expect(ended.transcript).toHaveLength(1)
    expect(ended.transcript[0]).toMatchObject({ kind: "tool-result", text: "done", durationMs: 10 })
  })

  it("suppresses the JSONL fallback copy of an already-seen live tool", () => {
    const builder = new TranscriptBuilder(now)
    const started = builder.applyLiveToolStart(liveToolStart("a"), [])
    expect(builder.applyLogToolCall(logToolCall("a"), started.transcript)).toBeNull()
    const ended = builder.applyLiveToolEnd(liveToolEnd("a"), started.transcript)
    expect(builder.applyLogToolResult(logToolResult("a"), ended.transcript)).toBeNull()
  })

  it("measures a visible thinking stretch above the threshold", () => {
    const builder = new TranscriptBuilder(now)
    builder.markThinkingStart()
    clock += 500
    expect(builder.closeThinking()).toEqual({ durationMs: 510 })
    expect(builder.closeThinking()).toBeNull()
  })

  it("drops a thinking stretch below the threshold", () => {
    const builder = new TranscriptBuilder(now)
    builder.markThinkingStart()
    clock += 50
    expect(builder.closeThinking()).toBeNull()
  })

  it("resets per-session state but keeps tool-call lookups fresh", () => {
    const builder = new TranscriptBuilder(now)
    builder.applyLiveToolStart(liveToolStart("a"), [])
    builder.resetSessionState()
    const again = builder.applyLiveToolStart(liveToolStart("a"), [])
    expect(again.accepted).toBe(true)
  })
})

describe("historyToTranscript", () => {
  it("maps every history entry kind", () => {
    const entries: HistoryEntry[] = [
      { kind: "user", text: "hi" },
      { kind: "assistant", text: "hello" },
      { kind: "tool-call", name: "bash", arguments: "{}" },
      { kind: "tool-result", name: "bash", text: "out", isError: false },
      { kind: "diagnostic", text: "warn" },
    ]
    expect(entries.map(historyToTranscript)).toEqual([
      { kind: "user", text: "hi" },
      { kind: "assistant", text: "hello" },
      { kind: "tool-call", name: "bash", arguments: "{}" },
      { kind: "tool-result", name: "bash", text: "out", isError: false },
      { kind: "diagnostic", text: "warn" },
    ])
  })
})
