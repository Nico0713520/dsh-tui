import { describe, expect, it } from "vitest"
import { LiveRecordDecoder, type DshLiveRecord } from "../../src/backend/live-record.ts"

describe("LiveRecordDecoder", () => {
  it("decodes process control readiness and barriers outside session filtering", () => {
    const controls: string[] = []
    const decoder = new LiveRecordDecoder({
      sessionId: () => null,
      onRecord: () => {},
      onControlReady: () => controls.push("ready"),
      onBarrier: (id) => controls.push(`barrier:${id}`),
      onDiagnostic: () => {},
    })

    decoder.push(`${JSON.stringify({ v: 1, kind: "control-ready" })}\n`)
    decoder.push(`${JSON.stringify({ v: 1, kind: "barrier", id: 7 })}\n`)

    expect(controls).toEqual(["ready", "barrier:7"])
  })

  it("decodes split UTF-8 records without waiting for another line", () => {
    const records: DshLiveRecord[] = []
    const decoder = new LiveRecordDecoder({
      sessionId: () => "s-1",
      onRecord: (record) => records.push(record),
      onDiagnostic: () => {},
    })
    const record: DshLiveRecord = {
      v: 1,
      sessionId: "s-1",
      seq: 3,
      kind: "text-delta",
      turn: 1,
      step: 1,
      index: 0,
      text: "你好",
    }
    const line = Buffer.from(`${JSON.stringify(record)}\n`)

    decoder.push(line.subarray(0, line.length - 2))
    expect(records).toEqual([])
    decoder.push(line.subarray(line.length - 2))

    expect(records).toEqual([record])
  })

  it("validates every record kind and removes terminal control sequences", () => {
    const records: DshLiveRecord[] = []
    const decoder = new LiveRecordDecoder({
      sessionId: () => "s-1",
      onRecord: (record) => records.push(record),
      onDiagnostic: () => {},
    })
    const lines: unknown[] = [
      { v: 1, sessionId: "s-1", seq: 1, kind: "turn-start", turn: 2 },
      { v: 1, sessionId: "s-1", seq: 2, kind: "activity", turn: 2, step: 1, activity: "thinking" },
      { v: 1, sessionId: "s-1", seq: 3, kind: "text-final", turn: 2, step: 1, index: 0, text: "safe\u001b[31m red\u001b[0m" },
      { v: 1, sessionId: "s-1", seq: 4, kind: "tool-start", turn: 2, step: 1, callId: "call-1", name: "bash\u0007", arguments: "{\"x\":1}" },
      { v: 1, sessionId: "s-1", seq: 5, kind: "tool-end", turn: 2, step: 1, callId: "call-1", isError: false, text: "done\u0000" },
      { v: 1, sessionId: "s-1", seq: 6, kind: "usage", turn: 2, step: 1, usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 } },
      { v: 1, sessionId: "s-1", seq: 7, kind: "turn-end", turn: 2, reason: "end_turn\u0007" },
    ]

    decoder.push(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`)

    expect(records.map((record) => record.kind)).toEqual([
      "turn-start",
      "activity",
      "text-final",
      "tool-start",
      "tool-end",
      "usage",
      "turn-end",
    ])
    expect(records[2]).toMatchObject({ text: "safe red" })
    expect(records[3]).toMatchObject({ name: "bash" })
    expect(records[4]).toMatchObject({ text: "done" })
    expect(records[6]).toMatchObject({ reason: "end_turn" })
  })

  it("drops stale, malformed, unsupported, invalid, and oversized records with bounded diagnostics", () => {
    const records: DshLiveRecord[] = []
    const diagnostics: string[] = []
    const decoder = new LiveRecordDecoder({
      sessionId: () => "active",
      onRecord: (record) => records.push(record),
      onDiagnostic: (message) => diagnostics.push(message),
    })
    const secret = "must-not-appear"

    decoder.push(`${JSON.stringify({ v: 1, sessionId: "stale", seq: 1, kind: "turn-start", turn: 1 })}\n`)
    decoder.push(`{${secret}\n{still-bad\n`)
    decoder.push(`${JSON.stringify({ v: 2, sessionId: "active", seq: 2, kind: "turn-start", turn: 1, secret })}\n`)
    decoder.push(`${JSON.stringify({ v: 1, sessionId: "active", seq: -1, kind: "turn-start", turn: 1 })}\n`)
    decoder.push(`${"x".repeat(1_048_577)}\n`)
    decoder.push(`${JSON.stringify({ v: 1, sessionId: "active", seq: 3, kind: "tool-start", turn: 1, step: 1, callId: "c", name: "bash", arguments: "x".repeat(65_537) })}\n`)
    decoder.push(`${JSON.stringify({ v: 1, sessionId: "active", seq: 4, kind: "turn-end", turn: 1, reason: "done" })}\n`)

    expect(records).toEqual([{ v: 1, sessionId: "active", seq: 4, kind: "turn-end", turn: 1, reason: "done" }])
    expect(diagnostics).toHaveLength(4)
    expect(diagnostics.join(" ")).not.toContain(secret)
    expect(Math.max(...diagnostics.map((message) => message.length))).toBeLessThan(160)
  })

  it("bounds an unfinished record and resumes after its newline", () => {
    const records: DshLiveRecord[] = []
    const diagnostics: string[] = []
    const decoder = new LiveRecordDecoder({
      sessionId: () => "s-1",
      onRecord: (record) => records.push(record),
      onDiagnostic: (message) => diagnostics.push(message),
    })

    decoder.push("x".repeat(1_048_577))
    decoder.push(`discarded\n${JSON.stringify({ v: 1, sessionId: "s-1", seq: 8, kind: "turn-start", turn: 3 })}\n`)

    expect(diagnostics).toHaveLength(1)
    expect(records).toEqual([{ v: 1, sessionId: "s-1", seq: 8, kind: "turn-start", turn: 3 }])
  })

  it("discards an unfinished shutdown record without decoding or diagnosing it", () => {
    const records: DshLiveRecord[] = []
    const diagnostics: string[] = []
    const decoder = new LiveRecordDecoder({
      sessionId: () => "s-1",
      onRecord: (record) => records.push(record),
      onDiagnostic: (message) => diagnostics.push(message),
    })

    decoder.push('{"v":1,"sessionId":"s-1"')
    decoder.discard()

    expect(records).toEqual([])
    expect(diagnostics).toEqual([])
  })
})
