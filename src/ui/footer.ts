import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import type { AppState } from "../controller.ts"
import type { ReasoningMode, RunMode } from "../config.ts"
import { singleLine } from "../text.ts"
import type { UiTheme } from "./theme.ts"

export interface FooterOptions {
  mode: RunMode
  model: string
  cwd?: string
  notice?: string
  elapsedSeconds?: number
  reasoningMode: ReasoningMode
}

function activityLabel(state: AppState): string {
  const activity = state.activity.kind === "boot" ? `starting ${state.activity.stage}`
    : state.activity.kind === "tool" ? `tool ${singleLine(state.activity.name, 12)}`
      : state.activity.kind === "approval" ? `approval ${singleLine(state.activity.name, 9)}`
        : state.activity.kind
  return state.queuedPrompt !== null ? "queued follow-up"
    : state.phase === "starting" ? (state.activity.kind === "boot" ? activity : "starting")
      : state.phase === "cancelling" ? "cancelling"
        : state.phase === "failed" ? "failed"
          : state.phase === "closing" ? "closing"
            : state.phase === "ready" ? "ready" : activity
}

function padToCellWidth(text: string, width: number): string {
  const clipped = singleLine(text, width)
  return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`
}

export function footerText(
  state: AppState,
  options: FooterOptions,
  columns: number,
  theme: UiTheme,
): string {
  const width = Math.max(1, columns)
  const label = activityLabel(state)
  const colorPhase = (value: string): string => state.phase === "failed" ? theme.fg("error", value)
    : state.phase === "ready" ? theme.fg("success", value)
      : state.phase === "closing" ? theme.fg("muted", value)
        : theme.fg("warning", value)
  const backendName = options.mode === "echo" ? "echo" : options.model
  const styleBackend = (value: string): string => options.mode === "echo"
    ? theme.fg("muted", value)
    : theme.fg("brand", value)
  const notice = options.notice || state.backendMessage || state.interruption || ""

  if (notice) {
    const labelWidth = Math.max(4, Math.min(10, width - 12))
    const stableLabel = padToCellWidth(label, labelWidth)
    const fixed = visibleWidth(` ${stableLabel} ·  · `)
    const budget = Math.max(2, width - fixed)
    const backendWidth = Math.max(1, Math.min(visibleWidth(backendName), Math.floor(budget * 0.34)))
    const noticeWidth = Math.max(1, budget - backendWidth)
    return truncateToWidth(
      ` ${colorPhase(stableLabel)} · ${styleBackend(singleLine(backendName, backendWidth))} · ${theme.fg("muted", singleLine(notice, noticeWidth))}`,
      width,
      "…",
    )
  }

  const showReasoning = width >= 28
  const reasoning = showReasoning ? ` · ${theme.fg("accent", options.reasoningMode)}` : ""
  const labelWidth = width >= 48 ? 16 : width >= 28 ? 10 : Math.max(4, Math.min(8, width - 8))
  const stableLabel = padToCellWidth(label, labelWidth)
  const fixedPrefix = ` ${colorPhase(stableLabel)} · `
  const backendWidth = Math.max(1, width - visibleWidth(fixedPrefix) - visibleWidth(reasoning))
  let text = `${fixedPrefix}${styleBackend(singleLine(backendName, backendWidth))}${reasoning}`

  const segments: string[] = []
  if (options.elapsedSeconds !== undefined && (state.phase === "working" || state.phase === "cancelling")) {
    segments.push(theme.fg("muted", `${Math.max(0, options.elapsedSeconds)}s`))
  }
  if (width >= 96 && (state.usage.inputTokens || state.usage.outputTokens || state.usage.cacheReadTokens)) {
    segments.push(theme.fg("muted", `${state.usage.inputTokens ?? 0}in/${state.usage.outputTokens ?? 0}out/${state.usage.cacheReadTokens ?? 0}cached`))
  }

  for (const segment of segments) {
    const candidate = `${text} · ${segment}`
    if (visibleWidth(candidate) > width) break
    text = candidate
  }
  return truncateToWidth(text, width, "…")
}
