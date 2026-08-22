import { afterEach, describe, expect, it } from "vitest"
import {
  Text,
  resetCapabilitiesCache,
  setCapabilities,
  stripTerminalSequences,
  visibleWidth,
  type Component,
  type TerminalCapabilities,
} from "@earendil-works/pi-tui"
import type { AppState, TranscriptItem } from "../../src/controller.ts"
import { activityLineText, thinkingTraceText } from "../../src/ui/activity-line.ts"
import { approvalPanelSummary } from "../../src/ui/approval-panel.ts"
import { footerText } from "../../src/ui/footer.ts"
import { ModalList } from "../../src/ui/modal-list.ts"
import { sessionPanelText } from "../../src/ui/session-panel.ts"
import { createUiTheme } from "../../src/ui/theme.ts"
import {
  renderAssistantMessage,
  renderDiagnostic,
  renderHistoryBoundary,
  renderInterruptedAssistant,
  renderUserMessage,
} from "../../src/ui/transcript-components.ts"
import { turnSummaryComponent } from "../../src/ui/turn-summary.ts"
import { toolCardComponent } from "../../src/ui/tool-card.ts"
import { WelcomeTranscriptComponent } from "../../src/ui/welcome-panel.ts"

const assetPath = new URL("../../assets/brand/deepseek-whale.png.base64", import.meta.url)
const widths = [120, 96, 80, 60, 48, 32] as const
const textCapabilities: TerminalCapabilities = { images: null, trueColor: true, hyperlinks: true }
const imageCapabilities: TerminalCapabilities = { images: "iterm2", trueColor: true, hyperlinks: true }

const state: AppState = {
  phase: "working",
  sessionId: "session-1234",
  usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50 },
  costUsd: 0.001234,
  activeOverlay: null,
  backendMessage: null,
  transcript: [],
  partialAssistantText: "",
  queuedPrompt: null,
  activity: { kind: "thinking" },
  interruption: null,
}

const pending = {
  kind: "tool-call",
  name: "read_file",
  arguments: "{\"path\":\"src/非常长的文件.ts\"}",
} satisfies TranscriptItem
const success = {
  kind: "tool-result",
  name: "read_file",
  arguments: pending.arguments,
  text: "完成\nsecond line",
  isError: false,
  durationMs: 875,
} satisfies TranscriptItem
const failure = { ...success, isError: true, text: "permission denied" } satisfies TranscriptItem

afterEach(() => resetCapabilitiesCache())

function expectBounded(lines: readonly string[], width: number): void {
  for (const line of lines) {
    if (line.includes("\x1b]1337;File=") || line.includes("\x1b_G")) {
      expect(line).not.toContain("image/png")
      continue
    }
    const plain = stripTerminalSequences(line)
    expect(visibleWidth(plain)).toBeLessThanOrEqual(width)
    expect(Array.from(plain).some((character) => {
      const code = character.codePointAt(0) ?? 0
      return (code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
    })).toBe(false)
  }
}

function welcome(width: number, capabilities: TerminalCapabilities, themeName: "terminal" | "deepseek"): Component {
  const theme = createUiTheme(themeName)
  setCapabilities(capabilities)
  return new WelcomeTranscriptComponent({
    capabilities,
    assetPath,
    columns: width,
    tick: { frame: 10, completion: false, settled: true },
    motion: "off",
    tty: true,
    model: "deepseek-v4-flash",
    cwd: "/workspace/项目",
    phase: "ready",
    sessionId: "session-1234",
    theme,
  })
}

describe("complete visual layout matrix", () => {
  it.each(["terminal", "deepseek"] as const)("keeps every %s-theme surface bounded", (themeName) => {
    const theme = createUiTheme(themeName)
    for (const width of widths) {
      const components: Component[] = [
        welcome(width, textCapabilities, themeName),
        renderUserMessage("你好，这是一个很长的用户问题。".repeat(3), theme),
        renderAssistantMessage("## Result\n\nAssistant prose without an avatar.", theme),
        renderInterruptedAssistant("Partial assistant prose.", "cancelled", theme),
        turnSummaryComponent({
          kind: "turn-summary",
          status: "done",
          durationMs: 84_000,
          toolCount: 7,
          failedToolCount: 1,
        }, theme),
        new Text(thinkingTraceText(1_250, width, theme), 0, 0),
        toolCardComponent(pending, { expanded: false, frame: 0, theme }),
        toolCardComponent(success, { expanded: true, frame: 0, theme }),
        toolCardComponent(failure, { expanded: false, frame: 0, theme }),
        renderDiagnostic("backend diagnostic", theme),
        renderHistoryBoundary("history abcdef12 (read-only)", theme),
        new ModalList("History", [{ value: "one", label: "Recorded session" }], 4, () => {}, theme),
      ]
      for (const component of components) expectBounded(component.render(width), width)

      const textRows = [
        activityLineText(state.activity, { columns: width, frame: 0, elapsedSeconds: 3, theme }),
        footerText(state, { mode: "acp", model: "deepseek-v4-flash", cwd: "/workspace/项目", elapsedSeconds: 3 }, width, theme),
        approvalPanelSummary({
          toolCallId: "call", optionIds: ["allow-once", "reject-once"], name: "bash",
          arguments: "{\"command\":\"npm test\"}", stakes: "elevated",
        }, width, theme),
        sessionPanelText({ state, model: "deepseek-v4-flash", cwd: "/workspace/项目", mode: "acp", motion: "full", theme, columns: width }),
      ]
      for (const text of textRows) expectBounded(text.split("\n"), width)
    }
  })

  it("keeps the inline-image welcome bounded on capable terminals", () => {
    for (const width of [120, 96, 80, 60] as const) {
      const component = welcome(width, imageCapabilities, "terminal")
      const lines = component.render(width)
      expect(lines.join("\n")).toContain("\x1b]1337;File=")
      expectBounded(lines, width)
    }
  })
})
