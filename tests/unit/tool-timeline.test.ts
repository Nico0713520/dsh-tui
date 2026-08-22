import { describe, expect, it } from "vitest"
import { ToolTimeline } from "../../src/backend/tool-timeline.ts"

describe("ToolTimeline", () => {
  it("deduplicates two sources and replaces the exact pending item", () => {
    let now = 1_000
    const timeline = new ToolTimeline(() => now)
    const started = timeline.apply({
      kind: "start",
      callId: "c1",
      name: "read_file",
      arguments: "{}",
    })
    expect(started).toMatchObject({ kind: "append", item: { kind: "tool-call", name: "read_file" } })
    expect(timeline.apply({
      kind: "start",
      callId: "c1",
      name: "read_file",
      arguments: "{}",
    })).toEqual({ kind: "none" })

    now = 1_875
    const ended = timeline.apply({
      kind: "end",
      callId: "c1",
      name: "read_file",
      text: "ok",
      isError: false,
    })
    expect(ended).toMatchObject({
      kind: "replace",
      target: started.kind === "append" ? started.item : undefined,
      item: { kind: "tool-result", name: "read_file", durationMs: 875 },
    })
  })

  it("handles unknown ends, duplicate ends, empty ids, and reset without invented metadata", () => {
    const timeline = new ToolTimeline(() => 1_000)
    expect(timeline.apply({
      kind: "end",
      callId: "missing",
      name: "bash",
      text: "done",
      isError: false,
    })).toEqual({
      kind: "append",
      item: { kind: "tool-result", name: "bash", text: "done", isError: false },
    })
    expect(timeline.apply({
      kind: "end",
      callId: "missing",
      name: "bash",
      text: "duplicate",
      isError: false,
    })).toEqual({ kind: "none" })
    expect(timeline.apply({
      kind: "start",
      callId: "",
      name: "bash",
      arguments: "{}",
    })).toEqual({ kind: "none" })

    timeline.reset()
    expect(timeline.apply({
      kind: "start",
      callId: "missing",
      name: "bash",
      arguments: "{}",
    }).kind).toBe("append")
  })

  it("keeps live arguments available for approval lookup", () => {
    const timeline = new ToolTimeline()
    timeline.apply({
      kind: "start",
      callId: "approval-call",
      name: "write_file",
      arguments: "{\"path\":\"src/app.ts\"}",
    })

    expect(timeline.lookup("approval-call")).toMatchObject({
      name: "write_file",
      arguments: "{\"path\":\"src/app.ts\"}",
    })
  })
})
