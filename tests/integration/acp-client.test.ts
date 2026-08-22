import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { AcpClient, type AcpClientEvents, type PermissionDecision } from "../../src/backend/acp-client.ts"
import type { DshLiveRecord } from "../../src/backend/live-record.ts"

const fixture = fileURLToPath(new URL("../fixtures/fake-acp-server.mjs", import.meta.url))

function createEvents(overrides: Partial<AcpClientEvents> = {}): AcpClientEvents & {
  chunks: string[]
  live: DshLiveRecord[]
  exits: Array<{ outcomeUnknown: boolean }>
  diagnostics: string[]
} {
  const events = {
    chunks: [] as string[],
    live: [] as DshLiveRecord[],
    exits: [] as Array<{ outcomeUnknown: boolean }>,
    diagnostics: [] as string[],
    onAssistantText(text: string) { events.chunks.push(text) },
    onLiveRecord(record: DshLiveRecord) { events.live.push(record) },
    onSessionChanged() {},
    onDiagnostic(message: string) { events.diagnostics.push(message) },
    async onPermission(): Promise<PermissionDecision> { return { outcome: "cancelled" } },
    onBackendExit(info: { outcomeUnknown: boolean }) { events.exits.push({ outcomeUnknown: info.outcomeUnknown }) },
    ...overrides,
  }
  return events
}

function client(scenario: string, events: AcpClientEvents, timeouts?: Record<string, number>) {
  return new AcpClient({
    command: [process.execPath, fixture],
    cwd: process.cwd(),
    events,
    env: { ...process.env, FAKE_ACP_SCENARIO: scenario },
    ...(timeouts === undefined ? {} : { timeouts }),
  })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 1_000) throw new Error("test condition did not become true")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("AcpClient", () => {
  it("initializes once, creates a real session, and streams assistant text", async () => {
    const events = createEvents()
    const acp = client("normal", events)
    await acp.start()
    const sessionId = await acp.newSession()
    const result = await acp.prompt("hello")

    expect(sessionId).toBe("fake-001")
    expect(result.stopReason).toBe("end_turn")
    expect(events.chunks).toEqual(["hello"])
    expect(acp.activeSessionId).toBe(sessionId)
    await acp.close()
  })

  it("carries live records separately from authoritative ACP text", async () => {
    const events = createEvents()
    const acp = client("live-stream", events)
    await acp.newSession()
    await expect(acp.prompt("hello")).resolves.toEqual({ stopReason: "end_turn" })
    await waitFor(() => events.live.length === 6)

    expect(events.live.map((record) => record.kind)).toEqual([
      "turn-start",
      "activity",
      "text-delta",
      "text-delta",
      "text-final",
      "turn-end",
    ])
    expect(events.chunks).toEqual(["hello!"])
    await acp.close()
  })

  it("waits for the live pipe barrier before resolving the current prompt", async () => {
    const events = createEvents()
    const acp = client("live-stream", events)
    await acp.newSession()
    await expect(acp.prompt("hello")).resolves.toEqual({ stopReason: "end_turn" })

    expect(events.live.map((record) => record.kind)).toEqual([
      "turn-start",
      "activity",
      "text-delta",
      "text-delta",
      "text-final",
      "turn-end",
    ])
    await acp.close()
  })

  it("disables ambiguous live records when prompt-boundary control is unavailable", async () => {
    const events = createEvents()
    const acp = client("no-live-control", events)
    await acp.newSession()

    await expect(acp.prompt("first")).resolves.toEqual({ stopReason: "end_turn" })
    await expect(acp.prompt("second")).resolves.toEqual({ stopReason: "end_turn" })

    expect(events.chunks).toEqual(["hello", "hello"])
    expect(events.diagnostics).toEqual(["live event synchronization unavailable; continuing with ACP"])
    await acp.close()
  })

  it("recreates instead of reusing a backend that exits after an authoritative prompt result", async () => {
    const events = createEvents()
    const acp = client("barrier-exit", events, { "session/prompt": 500 })
    await acp.newSession()
    await expect(acp.prompt("first")).resolves.toEqual({ stopReason: "end_turn" })
    await waitFor(() => events.exits.length === 1)
    expect(acp.activeSessionId).toBeNull()

    await expect(acp.prompt("second")).resolves.toEqual({ stopReason: "end_turn" })
    await waitFor(() => events.exits.length === 2)

    expect(events.exits).toEqual([{ outcomeUnknown: false }, { outcomeUnknown: false }])
    expect(acp.activeSessionId).toBeNull()
    await acp.close()
  })

  it("terminates and reaps a backend whose stdin fails while it remains alive", async () => {
    const exits: Array<{ signal: NodeJS.Signals | null; outcomeUnknown: boolean }> = []
    const events = createEvents({
      onBackendExit(info) { exits.push({ signal: info.signal, outcomeUnknown: info.outcomeUnknown }) },
    })
    const acp = client("stdin-close", events, { "session/prompt": 2_000 })
    await acp.newSession()
    await waitFor(() => events.live.length === 1)

    await expect(acp.prompt("cannot arrive")).rejects.toThrow(/stdin|exited|unknown/i)
    await waitFor(() => exits.length === 1)

    expect(exits).toHaveLength(1)
    expect(exits[0]?.outcomeUnknown).toBe(true)
    if (process.platform !== "win32") expect(exits[0]?.signal).toBe("SIGTERM")
    await expect(acp.close()).resolves.toBeUndefined()
  })

  it("terminates an unresponsive backend after an ACP request timeout", async () => {
    const events = createEvents()
    const acp = client("prompt-timeout", events, { "session/prompt": 50 })
    await acp.newSession()

    await expect(acp.prompt("never answered")).rejects.toThrow(/timed out|outcome unknown/i)
    await waitFor(() => events.exits.length === 1)

    expect(events.exits).toEqual([{ outcomeUnknown: true }])
    expect(acp.activeSessionId).toBeNull()
    await expect(acp.close()).resolves.toBeUndefined()
  })

  it("continues through malformed and oversized live records without leaking their content", async () => {
    const events = createEvents()
    const acp = client("live-degraded", events)
    await acp.newSession()
    await expect(acp.prompt("fallback")).resolves.toEqual({ stopReason: "end_turn" })
    await waitFor(() => events.diagnostics.length === 2)

    expect(events.live).toEqual([])
    expect(events.chunks).toEqual(["fallback"])
    expect(events.diagnostics).toHaveLength(2)
    expect(events.diagnostics.join(" ")).not.toContain("must-not-appear")
    await acp.close()
  })

  it("falls back to ACP when the live pipe closes early", async () => {
    const events = createEvents()
    const acp = client("live-pipe-close", events)
    await acp.newSession()
    await expect(acp.prompt("fallback")).resolves.toEqual({ stopReason: "end_turn" })

    expect(events.chunks).toEqual(["after close"])
    expect(events.diagnostics.join(" ")).toMatch(/live event pipe/i)
    await acp.close()
  })

  it("redacts credentials written by the backend to stderr", async () => {
    const events = createEvents()
    const acp = client("stderr-secret", events)
    await acp.newSession()
    await expect(acp.prompt("probe")).resolves.toEqual({ stopReason: "end_turn" })
    await waitFor(() => events.diagnostics.length > 0)

    expect(events.diagnostics.join(" ")).toContain("Authorization: Bearer [redacted]")
    expect(events.diagnostics.join(" ")).not.toContain("1234567890abcdef")
    await acp.close()
  })

  it("can detach the live reader before closing the ACP child", async () => {
    const events = createEvents()
    const acp = client("live-stream", events)
    await acp.newSession()

    acp.stopLiveEvents()
    await expect(acp.prompt("fallback")).resolves.toEqual({ stopReason: "end_turn" })

    expect(events.live).toEqual([])
    expect(events.chunks).toEqual(["hello!"])
    await acp.close()
  })

  it("rejects a second prompt before writing it", async () => {
    const acp = client("delayed", createEvents())
    const first = acp.prompt("first")
    await expect(acp.prompt("second")).rejects.toThrow("A prompt is already in flight")
    await waitFor(() => acp.activeSessionId !== null)
    acp.cancel()
    await expect(first).resolves.toMatchObject({ stopReason: "cancelled" })
    await acp.close()
  })

  it("sends cancellation as a notification and settles the original prompt", async () => {
    const events = createEvents()
    const acp = client("delayed", events)
    const prompt = acp.prompt("interrupt me")
    await waitFor(() => acp.activeSessionId !== null)
    expect(acp.isPromptInFlight).toBe(true)
    acp.cancel()
    await expect(prompt).resolves.toEqual({ stopReason: "cancelled" })
    expect(events.chunks).toEqual(["cancelled"])
    await acp.close()
  })

  it("fails closed when the permission callback selects an unknown option", async () => {
    const events = createEvents({
      async onPermission(): Promise<PermissionDecision> {
        return { outcome: "selected", optionId: "not-offered" }
      },
    })
    const acp = client("permission", events)
    await expect(acp.prompt("permission")).resolves.toMatchObject({ stopReason: "cancelled" })
    expect(events.chunks).toEqual(["cancelled"])
    await acp.close()
  })

  it("rejects pending work and reports unknown outcome when the backend exits", async () => {
    const events = createEvents()
    const acp = client("forced-exit", events, { "session/prompt": 500 })
    await expect(acp.prompt("may have side effects")).rejects.toThrow(/exited|unknown/i)
    expect(events.exits).toEqual([{ outcomeUnknown: true }])
    expect(acp.activeSessionId).toBeNull()
    await acp.close()
  })

  it("closes a delayed backend without leaving the caller waiting", async () => {
    const acp = client("delayed", createEvents())
    const prompt = acp.prompt("hold")
    const settled = prompt.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await waitFor(() => acp.activeSessionId !== null)
    await expect(acp.close()).resolves.toBeUndefined()
    await expect(settled).resolves.toMatchObject({ ok: false })
  })

  it("rejects immediately when the backend executable cannot spawn", async () => {
    const missing = join(tmpdir(), `missing-dsh-${process.pid}`)
    const acp = new AcpClient({
      command: [missing],
      cwd: process.cwd(),
      events: createEvents(),
      timeouts: { initialize: 10_000 },
    })
    const started = Date.now()
    await expect(acp.newSession()).rejects.toThrow(/start|spawn|ENOENT/i)
    expect(Date.now() - started).toBeLessThan(1_500)
    await expect(acp.close()).resolves.toBeUndefined()
  })

  it("escalates a stubborn backend and remains idempotent", async () => {
    const acp = client("stubborn", createEvents())
    await acp.newSession()
    await expect(Promise.all([acp.close(), acp.close()])).resolves.toEqual([undefined, undefined])
  })
})
