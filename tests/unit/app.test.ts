import { describe, expect, it, vi } from "vitest"
import { readFile } from "node:fs/promises"
import { createAcpClientEvents, resolveBackendEnvironment, resolveDefaultBackendCommand } from "../../src/app.ts"

const baseConfig = {
  mode: "acp" as const,
  model: "deepseek-v4-flash",
  cwd: "/tmp/workspace",
  persistRoot: "/tmp/sessions",
  toolCards: true,
  motion: "full" as const,
  theme: "terminal" as const,
  perf: false,
  reasoningMode: "quick" as const,
}

describe("default ACP composition", () => {
  it("passes only options supported by dsh-acp-demo and uses env for the model", () => {
    const command = resolveDefaultBackendCommand(baseConfig)

    expect(command[0]).toBe(process.execPath)
    expect(command).toContain("--config")
    expect(command).not.toContain("--model")
  })

  it("selects the bundled config for the requested platform", () => {
    const config = baseConfig
    expect(resolveDefaultBackendCommand(config, "win32").join(" ")).toContain("cordis.windows.yml")
    expect(resolveDefaultBackendCommand(config, "linux").join(" ")).toContain("cordis.posix.yml")
  })

  it("maps the user-facing mode to the exact DSH reasoning effort", () => {
    expect(resolveBackendEnvironment(baseConfig, { KEEP: "yes" })).toMatchObject({
      KEEP: "yes",
      DSH_MODEL: "deepseek-v4-flash",
      DSH_PERSIST_ROOT: "/tmp/sessions",
      DSH_REASONING_EFFORT: "low",
    })
    expect(resolveBackendEnvironment({ ...baseConfig, reasoningMode: "deep" }, {}))
      .toMatchObject({ DSH_REASONING_EFFORT: "max" })
  })

  it("binds every ACP event channel, including live records, to the controller", async () => {
    const controller = {
      onAssistantText: vi.fn(),
      onLiveRecord: vi.fn(),
      onSessionChanged: vi.fn(),
      onDiagnostic: vi.fn(),
      decidePermission: vi.fn(async () => ({ outcome: "cancelled" as const })),
      onBackendExit: vi.fn(),
    }
    const events = createAcpClientEvents(() => controller)
    const liveRecord = { v: 1 as const, sessionId: "session-1", seq: 1, kind: "turn-start" as const, turn: 1 }

    events.onAssistantText("chunk")
    events.onLiveRecord?.(liveRecord)
    events.onSessionChanged("session-1")
    events.onDiagnostic("diagnostic")
    await events.onPermission({ toolCallId: "call-1", optionIds: ["deny"] })
    events.onBackendExit({ code: 0, signal: null, outcomeUnknown: false })

    expect(controller.onAssistantText).toHaveBeenCalledWith("chunk")
    expect(controller.onLiveRecord).toHaveBeenCalledWith(liveRecord)
    expect(controller.onSessionChanged).toHaveBeenCalledWith("session-1")
    expect(controller.onDiagnostic).toHaveBeenCalledWith("diagnostic")
    expect(controller.decidePermission).toHaveBeenCalledWith({ toolCallId: "call-1", optionIds: ["deny"] })
    expect(controller.onBackendExit).toHaveBeenCalledWith({ code: 0, signal: null, outcomeUnknown: false })
  })

  it("keeps Windows model tools PowerShell-only", async () => {
    const yaml = await readFile(new URL("../../config/cordis.windows.yml", import.meta.url), "utf8")
    expect(yaml).toMatch(/toolBash:\s*false/)
    expect(yaml).toContain("name: '@deepseek-ai/dsh-shell-env'")
    expect(yaml).toContain("name: '@deepseek-ai/dsh-tool-pwsh'")
    expect(yaml).not.toContain("name: '@deepseek-ai/dsh-tool-bash'")
  })
})
