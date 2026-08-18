import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { AcpClient, type PermissionDecision } from "../../src/backend/acp-client.ts"
import { SessionLogReader } from "../../src/backend/session-log.ts"
import { AppController, type AppState, type ControllerView } from "../../src/controller.ts"
import { resolveDefaultBackendCommand } from "../../src/app.ts"
import type { AppConfig } from "../../src/config.ts"
import type { ApprovalRequest, HistoryChoice } from "../../src/controller.ts"
import type { SessionInfo } from "../../src/backend/session-log.ts"

const enabled = process.env.DSH_LIVE === "1"

async function waitFor(condition: () => boolean, message: string, timeoutMs: number): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe("live dsh ACP flow", () => {
  const liveTest = enabled ? it : it.skip

  liveTest("answers, uses tools, rejects permission, cancels, resets, and shuts down", async () => {
    if (!process.env.DEEPSEEK_API_KEY?.trim()) {
      throw new Error("DSH_LIVE=1 requires DEEPSEEK_API_KEY; no credential value is printed")
    }

    const workspace = mkdtempSync(join(tmpdir(), "dsh-tui-live-"))
    const config: AppConfig = {
      mode: "acp",
      model: process.env.DSH_MODEL?.trim() || "deepseek-v4-flash",
      cwd: workspace,
      persistRoot: join(workspace, "sessions"),
      toolCards: true,
    }
    const states: AppState[] = []
    const permissionRequests: ApprovalRequest[] = []
    const decisions: PermissionDecision[] = []
    let permissionMode: "allow" | "reject" = "allow"
    const view: ControllerView = {
      render: (state) => { states.push(state) },
      requestApproval: async (request) => {
        permissionRequests.push(request)
        if (permissionMode === "reject") {
          const decision = { outcome: "cancelled" as const }
          decisions.push(decision)
          return decision
        }
        const optionId = request.optionIds.find((id) => /allow/i.test(id))
        const decision: PermissionDecision = optionId
          ? { outcome: "selected", optionId }
          : { outcome: "cancelled" }
        decisions.push(decision)
        return decision
      },
      chooseHistory: async (_items: readonly SessionInfo[]): Promise<HistoryChoice> => ({ kind: "cancel" }),
    }
    const logs = new SessionLogReader({ pollIntervalMs: 50 })
    let controller: AppController
    const backend = new AcpClient({
      command: resolveDefaultBackendCommand(config),
      cwd: workspace,
      events: {
        onAssistantText: (text) => controller.onAssistantText(text),
        onSessionChanged: (sessionId) => controller.onSessionChanged(sessionId),
        onDiagnostic: (message) => controller.onDiagnostic(message),
        onPermission: (request): Promise<PermissionDecision> => controller.decidePermission(request),
        onBackendExit: (info) => controller.onBackendExit(info),
      },
      env: { ...process.env, DSH_MODEL: config.model, DSH_PERSIST_ROOT: config.persistRoot },
    })
    controller = new AppController({ config, backend, logs, view })

    try {
      await controller.start()
      expect(controller.state.phase).toBe("ready")
      const firstSession = controller.state.sessionId
      expect(firstSession).toBeTruthy()

      await controller.submit("Reply with exactly LIVE_OK and nothing else.")
      expect(controller.state.transcript.some((entry) => entry.kind === "assistant" && "text" in entry && entry.text.includes("LIVE_OK"))).toBe(true)

      permissionMode = "allow"
      const toolPrompt = controller.submit("You must make exactly one bash tool call before answering. Use these exact arguments: command \"printf TOOL_OK\", description \"Print approval test marker\", sandbox_permissions \"danger-full-access\", justification \"Verify the approval flow\". Do not omit sandbox_permissions or answer before the tool call. After the tool result, reply exactly TOOL_RESULT_OK.")
      await waitFor(() => permissionRequests.length >= 1, "live tool prompt did not request permission", 90_000)
      await waitFor(() => controller.state.transcript.some((entry) => entry.kind === "tool-call"), "live tool call was not observed", 30_000)
      expect(decisions.some((decision) => decision.outcome === "selected")).toBe(true)
      await waitFor(() => controller.state.transcript.some((entry) => entry.kind === "tool-result"), "live tool result was not observed", 30_000)
      await toolPrompt

      await controller.newSession()
      expect(controller.state.sessionId).not.toBe(firstSession)
      permissionMode = "reject"
      const rejectPrompt = controller.submit("You must make exactly one bash tool call before answering. Use these exact arguments: command \"printf REJECTED_TOOL\", description \"Print rejection test marker\", sandbox_permissions \"danger-full-access\", justification \"Verify the rejection flow\". Do not omit sandbox_permissions or answer before the tool call. After the tool result, explain what happened.")
      await waitFor(() => permissionRequests.length >= 2, "live reject prompt did not request permission", 90_000)
      expect(decisions.at(-1)?.outcome).toBe("cancelled")
      await rejectPrompt

      await controller.newSession()
      permissionMode = "allow"
      const cancelPrompt = controller.submit("You must make exactly one bash tool call before answering. Use these exact arguments: command \"sleep 30\", description \"Sleep for cancellation test\". Do not set run_in_background and do not answer before the tool call. After the tool result, reply SLOW_DONE.")
      await waitFor(() => controller.state.transcript.some((entry) => entry.kind === "tool-call" && entry.arguments.includes("sleep")), "live cancel prompt did not reach its tool call", 90_000)
      controller.cancel()
      await cancelPrompt
      expect(controller.state.phase).toBe("ready")

      const beforeReset = controller.state.sessionId
      await controller.newSession()
      expect(controller.state.sessionId).not.toBe(beforeReset)
      expect(controller.state.transcript).toEqual([])
      await waitFor(() => states.some((state) => state.sessionId === beforeReset), "live session was not rendered", 5_000)
      const history = await logs.listHistory(config.persistRoot, config.cwd)
      expect(history.length).toBeGreaterThan(0)
    } finally {
      await controller.close()
      expect(controller.state.phase).toBe("closing")
      rmSync(workspace, { recursive: true, force: true })
    }
  }, 240_000)
})
