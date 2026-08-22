import { describe, expect, it } from "vitest"
import { TranscriptBuilder, historyToTranscript } from "../../src/transcript-builder.ts"
import type { HistoryEntry } from "../../src/backend/session-log.ts"

let clock = 1_000
const now = () => (clock += 10)

describe("TranscriptBuilder", () => {
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
