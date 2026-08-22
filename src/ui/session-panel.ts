import { truncateToWidth } from "@earendil-works/pi-tui"
import type { AppState } from "../controller.ts"
import type { MotionPreference, RunMode } from "../config.ts"
import { sanitizeTerminalText, singleLine } from "../text.ts"
import type { UiTheme } from "./theme.ts"

export interface SessionPanelOptions {
  state: AppState
  model: string
  cwd: string
  mode: RunMode
  motion: MotionPreference
  theme: UiTheme
  columns: number
}

function activityText(state: AppState): string {
  if (state.activity.kind === "boot") return `${state.phase} · ${state.activity.stage}`
  if (state.activity.kind === "tool" || state.activity.kind === "approval") {
    return `${state.phase} · ${state.activity.kind} ${singleLine(state.activity.name, 24)}`
  }
  return `${state.phase} · ${state.activity.kind}`
}

export function sessionPanelText(options: SessionPanelOptions): string {
  const width = Math.max(1, options.columns)
  const labelWidth = width >= 48 ? 11 : 8
  const row = (label: string, value: string): string => truncateToWidth(
    `${options.theme.fg("muted", label.padEnd(labelWidth))}${options.theme.fg("text", sanitizeTerminalText(value))}`,
    width,
    "…",
  )
  const state = options.state
  const usage = `${state.usage.inputTokens ?? 0} in · ${state.usage.outputTokens ?? 0} out · ${state.usage.cacheReadTokens ?? 0} cached`
  const rows = [
    row("model", options.mode === "echo" ? "echo" : options.model),
    row("workspace", options.cwd),
    row("session", state.sessionId ?? "creating…"),
    row("activity", activityText(state)),
    row("safety", "workspace-write · approval ask"),
    row("theme", options.theme.name),
    row("motion", options.motion),
    row("usage", usage),
    row("cost", state.costUsd === null ? "unavailable" : `$${state.costUsd.toFixed(6)}`),
  ]
  const notice = state.backendMessage || state.interruption
  if (notice) rows.push(row("notice", notice))
  if (state.phase === "failed") {
    rows.push(row("recovery", state.interruption === "outcome-unknown"
      ? "Start a new session before retrying; the previous result is unknown."
      : "Start a new session before retrying."))
  }
  return rows.join("\n")
}
