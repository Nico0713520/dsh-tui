import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import type { AppState } from "../controller.ts"
import type { RunMode } from "../config.ts"
import { singleLine } from "../text.ts"
import type { UiTheme } from "./theme.ts"

export interface FooterOptions {
  mode: RunMode
  model: string
  cwd?: string
  notice?: string
  elapsedSeconds?: number
}

function activityLabel(state: AppState): string {
  const activity = state.activity.kind === "boot" ? `starting ${state.activity.stage}`
    : state.activity.kind === "tool" ? `tool ${singleLine(state.activity.name, 12)}`
      : state.activity.kind === "approval" ? `approval ${singleLine(state.activity.name, 9)}`
        : state.activity.kind
  return state.queuedPrompt !== null ? "queued"
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

function workspaceTail(cwd: string): string {
  const normalized = cwd.replace(/[\\/]+$/, "")
  return singleLine(normalized.split(/[\\/]/).at(-1) || normalized, 24)
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
    const labelWidth = Math.max(4, Math.min(10, width - 16))
    const stableLabel = padToCellWidth(label, labelWidth)
    const fixed = visibleWidth(` ${stableLabel} ·  · `)
    const budget = Math.max(2, width - fixed)
    const noticeWidth = Math.max(1, Math.min(visibleWidth(notice), Math.ceil(budget * 0.68)))
    const backendWidth = Math.max(1, budget - noticeWidth)
    return truncateToWidth(
      ` ${colorPhase(stableLabel)} · ${styleBackend(singleLine(backendName, backendWidth))} · ${theme.fg("muted", singleLine(notice, noticeWidth))}`,
      width,
      "…",
    )
  }

  const labelWidth = Math.max(4, Math.min(16, width - 10))
  const stableLabel = padToCellWidth(label, labelWidth)
  const fixedPrefix = ` ${colorPhase(stableLabel)} · `
  const minimumBackendWidth = Math.max(1, width - visibleWidth(fixedPrefix))
  let text = `${fixedPrefix}${styleBackend(singleLine(backendName, minimumBackendWidth))}`

  const segments: string[] = []
  if (options.cwd) segments.push(theme.fg("muted", workspaceTail(options.cwd)))
  if (options.elapsedSeconds !== undefined) segments.push(theme.fg("muted", `${Math.max(0, options.elapsedSeconds)}s`))
  if (state.sessionId) segments.push(theme.fg("muted", singleLine(state.sessionId, 9)))
  if (state.usage.inputTokens || state.usage.outputTokens || state.usage.cacheReadTokens) {
    segments.push(theme.fg("muted", `${state.usage.inputTokens ?? 0}in/${state.usage.outputTokens ?? 0}out/${state.usage.cacheReadTokens ?? 0}cached`))
  }
  if (state.costUsd !== null) segments.push(theme.fg("muted", `$${state.costUsd.toFixed(6)}`))

  for (const segment of segments) {
    const candidate = `${text} · ${segment}`
    if (visibleWidth(candidate) <= width) text = candidate
  }
  return truncateToWidth(text, width, "…")
}
