import { describe, expect, it } from "vitest"
import { createAssistantStream } from "../../src/backend/assistant-stream.ts"

describe("AssistantStream", () => {
  it("replaces streamed deltas with the matching final block and then exact ACP text", () => {
    const stream = createAssistantStream()
    stream.begin("s-1")
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
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 4, kind: "text-delta", turn: 1, step: 1, index: 0, text: "duplicate" }).text).toBe("AB")

    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 5, kind: "turn-start", turn: 2 })).toMatchObject({ turn: 2, text: "", activity: "idle" })
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 6, kind: "text-delta", turn: 1, step: 2, index: 0, text: "stale" }).text).toBe("")
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

  it("preserves partial evidence on interruption and clears all state on reset", () => {
    const stream = createAssistantStream()
    stream.begin("s-1")
    stream.apply({ v: 1, sessionId: "s-1", seq: 1, kind: "turn-start", turn: 1 })
    stream.apply({ v: 1, sessionId: "s-1", seq: 2, kind: "text-delta", turn: 1, step: 1, index: 0, text: "partial" })

    expect(stream.interrupt("outcome-unknown")).toMatchObject({ text: "partial", activity: "idle", interruption: "outcome-unknown" })
    expect(stream.reset()).toEqual({ sessionId: null, turn: null, text: "", activity: "idle", committed: false, interruption: null })
    expect(stream.apply({ v: 1, sessionId: "s-1", seq: 3, kind: "text-delta", turn: 1, step: 1, index: 0, text: "late" }).text).toBe("")
  })
})
