import { describe, expect, it } from "vitest"
import { createAssistantStream } from "../../src/backend/assistant-stream.ts"

describe("AssistantStream", () => {
  it("replaces streamed deltas with the matching final block and then exact ACP text", () => {
    const stream = createAssistantStream()
    stream.begin("s-1")
    stream.preparePrompt()
    stream.apply({ v: 1, sessionId: "s-1", seq: 1, kind: "turn-start", turn: 1 })
    stream.apply({ v: 1, sessionId: "s-1", seq: 2, kind: "text-delta", turn: 1, step: 1, index: 0, text: "hel" })

    expect(stream.apply({
      v: 1,
      sessionId: "s-1",
      seq: 3,
      kind: "text-final",
      turn: 1,
      step: 1,
      index: 0,
      text: "hello",
    }).text).toBe("hello")
    expect(stream.reconcileCommitted("hello!")).toMatchObject({ text: "hello!", committed: true })
  })

  it("orders blocks while ignoring duplicate sequences and stale turns", () => {
    const stream = createAssistantStream()
    stream.begin("s-1")
    stream.apply({ v: 1, sessionId: "s-1", seq: 1, kind: "turn-start", turn: 1 })
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 2, kind: "activity", turn: 1, step: 1, activity: "thinking" }).activity).toBe("thinking")
    stream.apply({ v: 1, sessionId: "s-1", seq: 3, kind: "text-delta", turn: 1, step: 1, index: 1, text: "B" })
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 4, kind: "text-delta", turn: 1, step: 1, index: 0, text: "A" }).text).toBe("AB")
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 4, kind: "text-delta", turn: 1, step: 1, index: 0, text: "duplicate" })).toMatchObject({ text: "AB", acceptedRecord: false })

    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 5, kind: "turn-start", turn: 2 })).toMatchObject({ turn: 2, text: "", activity: "idle", acceptedRecord: true })
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 6, kind: "text-delta", turn: 1, step: 2, index: 0, text: "stale" })).toMatchObject({ text: "", acceptedRecord: false })
  })

  it("keeps committed output authoritative until a newer turn", () => {
    const stream = createAssistantStream()
    stream.begin("s-1")
    stream.apply({ v: 1, sessionId: "s-1", seq: 1, kind: "turn-start", turn: 1 })
    stream.apply({ v: 1, sessionId: "s-1", seq: 2, kind: "text-delta", turn: 1, step: 1, index: 0, text: "live" })
    const committed = stream.reconcileCommitted("authoritative")

    expect(Object.isFrozen(committed)).toBe(true)
    expect(stream.reconcileCommitted("authoritative")).toEqual(committed)
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 3, kind: "text-final", turn: 1, step: 1, index: 0, text: "late" })).toEqual(committed)
    expect(stream.apply({ v: 1, sessionId: "other", seq: 99, kind: "turn-start", turn: 9 })).toEqual(committed)
  })

  it("accepts fresh tool metadata after commit without accepting late text", () => {
    const stream = createAssistantStream()
    stream.begin("s-1")
    stream.apply({ v: 1, sessionId: "s-1", seq: 1, kind: "turn-start", turn: 1 })
    stream.reconcileCommitted("authoritative")

    expect(stream.apply({
      v: 1,
      sessionId: "s-1",
      seq: 2,
      kind: "tool-end",
      turn: 1,
      step: 1,
      callId: "call-1",
      isError: false,
      text: "done",
    })).toMatchObject({ text: "authoritative", committed: true, acceptedRecord: true })
    expect(stream.apply({
      v: 1,
      sessionId: "s-1",
      seq: 3,
      kind: "text-final",
      turn: 1,
      step: 1,
      index: 0,
      text: "late",
    })).toMatchObject({ text: "authoritative", committed: true, acceptedRecord: false })
  })

  it("preserves partial evidence on interruption and clears all state on reset", () => {
    const stream = createAssistantStream()
    stream.begin("s-1")
    stream.preparePrompt()
    stream.apply({ v: 1, sessionId: "s-1", seq: 1, kind: "turn-start", turn: 1 })
    stream.apply({ v: 1, sessionId: "s-1", seq: 2, kind: "text-delta", turn: 1, step: 1, index: 0, text: "partial" })

    expect(stream.interrupt("outcome-unknown")).toMatchObject({ text: "partial", activity: "idle", interruption: "outcome-unknown" })
    expect(stream.apply({
      v: 1,
      sessionId: "s-1",
      seq: 3,
      kind: "usage",
      turn: 1,
      step: 1,
      usage: { inputTokens: 1 },
    }).acceptedRecord).toBe(false)
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 4, kind: "turn-start", turn: 2 }).acceptedRecord).toBe(false)

    stream.preparePrompt()
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 5, kind: "turn-start", turn: 2 }).acceptedRecord).toBe(true)
    expect(stream.reset()).toEqual({ sessionId: null, turn: null, text: "", activity: "idle", committed: false, interruption: null, acceptedRecord: false })
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 6, kind: "text-delta", turn: 1, step: 1, index: 0, text: "late" }).text).toBe("")
  })

  it("rejects an unseen interrupted turn after the next prompt is prepared", () => {
    const stream = createAssistantStream()
    stream.begin("s-1")
    stream.preparePrompt()
    stream.interrupt("cancelled")
    stream.preparePrompt()

    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 1, kind: "text-delta", turn: 1, step: 1, index: 0, text: "old" }).acceptedRecord).toBe(false)
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 2, kind: "turn-start", turn: 2 }).acceptedRecord).toBe(true)
  })

  it("binds the next prompt to the same backend turn after a turnless cancellation", () => {
    const stream = createAssistantStream()
    stream.begin("s-1")
    stream.preparePrompt()
    stream.interrupt("cancelled")
    stream.preparePrompt()

    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 1, kind: "turn-start", turn: 1 })).toMatchObject({
      turn: 1,
      acceptedRecord: true,
    })
    expect(stream.apply({
      v: 1,
      sessionId: "s-1",
      seq: 2,
      kind: "text-delta",
      turn: 1,
      step: 1,
      index: 0,
      text: "current",
    })).toMatchObject({ text: "current", acceptedRecord: true })
  })

  it("keeps one hot block exact across ten thousand deltas", () => {
    const stream = createAssistantStream()
    stream.begin("s-1")
    stream.preparePrompt()
    stream.apply({ v: 1, sessionId: "s-1", seq: 1, kind: "turn-start", turn: 1 })

    let snapshot = stream.apply({
      v: 1,
      sessionId: "s-1",
      seq: 2,
      kind: "text-delta",
      turn: 1,
      step: 2,
      index: 1,
      text: "tail",
    })
    for (let index = 0; index < 10_000; index += 1) {
      snapshot = stream.apply({
        v: 1,
        sessionId: "s-1",
        seq: index + 3,
        kind: "text-delta",
        turn: 1,
        step: 1,
        index: 0,
        text: "x",
      })
    }

    expect(snapshot.text).toBe(`${"x".repeat(10_000)}tail`)
  })
})
