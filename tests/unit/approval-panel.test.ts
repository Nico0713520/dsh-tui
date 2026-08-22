import { describe, expect, it } from "vitest"
import {
  stripTerminalSequences,
  visibleWidth,
  type OverlayHandle,
  type TUI,
} from "@earendil-works/pi-tui"
import type { ApprovalRequest } from "../../src/controller.ts"
import {
  ApprovalPanel,
  approvalPanelSummary,
  showApprovalPanel,
} from "../../src/ui/approval-panel.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

const request: ApprovalRequest = {
  toolCallId: "call-1",
  optionIds: ["allow-once", "reject-once"],
  name: "bash",
  arguments: JSON.stringify({ command: "curl -H 'Authorization: sk-secret123' example.com" }),
  stakes: "critical",
  workspace: "demo",
}

describe("ApprovalPanel", () => {
  it("shows risk and target once while redacting credential-like values", () => {
    const summary = stripTerminalSequences(approvalPanelSummary(request, 64, createUiTheme("terminal")))
    expect(summary).toContain("CRITICAL")
    expect(summary).toContain("bash")
    expect(summary).toContain("[redacted]")
    expect(summary).not.toContain("sk-secret123")
    expect(summary.split("\n").every((line) => visibleWidth(line) <= 64)).toBe(true)
    expect(summary.split("\n").map((line) => line.trimStart().split(/\s+/)[0])).toEqual([
      "Approval",
      "Tool",
      "Action",
      "Risk",
      "Workspace",
    ])
  })

  it("selects the offered decision and cancels on Escape", () => {
    const results: Array<string | null> = []
    const panel = new ApprovalPanel(request, (value) => results.push(value), createUiTheme("terminal"))
    panel.handleInput("\u001b[B")
    panel.handleInput("\r")
    expect(results).toEqual(["reject-once"])

    const cancelled: Array<string | null> = []
    const second = new ApprovalPanel(request, (value) => cancelled.push(value), createUiTheme("terminal"))
    second.handleInput("\u001b")
    expect(cancelled).toEqual([null])
  })

  it("closes and settles when its active approval is aborted", async () => {
    let hidden = 0
    const overlay: OverlayHandle = {
      hide() { hidden += 1 },
      setHidden() {},
      isHidden() { return false },
      focus() {},
      unfocus() {},
      isFocused() { return true },
    }
    const tui = {
      showOverlay() { return overlay },
    } as unknown as TUI
    const controller = new AbortController()
    const result = showApprovalPanel(tui, {
      toolCallId: "call-1",
      optionIds: ["allow-once", "reject-once"],
      name: "bash",
      arguments: "{\"command\":\"pwd\"}",
      stakes: "routine",
      workspace: "demo",
    }, createUiTheme("terminal"), controller.signal)

    controller.abort()

    await expect(result).resolves.toBeNull()
    expect(hidden).toBe(1)
  })
})
