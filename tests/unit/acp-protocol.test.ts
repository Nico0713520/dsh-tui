import { describe, expect, it } from "vitest"
import { parseAcpResult } from "../../src/backend/acp-protocol.ts"

describe("ACP protocol contract", () => {
  it("validates session results without exposing arbitrary unknown values", () => {
    expect(parseAcpResult("session/new", { sessionId: "s1" })).toEqual({ sessionId: "s1" })
    expect(() => parseAcpResult("session/new", {})).toThrow(/sessionId/)
    expect(parseAcpResult("session/prompt", { stopReason: "end_turn" })).toEqual({ stopReason: "end_turn" })
    expect(() => parseAcpResult("session/prompt", { stopReason: 1 })).toThrow(/stopReason/)
  })

  it("keeps initialize forward compatible", () => {
    const result = { protocolVersion: 1, serverInfo: { name: "fixture" } }
    expect(parseAcpResult("initialize", result)).toBe(result)
  })
})
