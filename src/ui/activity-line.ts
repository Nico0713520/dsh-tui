import { truncateToWidth } from "@earendil-works/pi-tui"
import type { AppActivity } from "../controller.ts"
import { singleLine } from "../text.ts"
import type { UiTheme } from "./theme.ts"

export function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.max(0, Math.round(durationMs))}ms`
  return `${(durationMs / 1_000).toFixed(1)}s`
}

export function thinkingTraceText(durationMs: number, columns: number, theme: UiTheme): string {
  return truncateToWidth(
    theme.fg("muted", `  Thought for ${formatDuration(durationMs)}`),
    Math.max(1, columns),
    "…",
  )
}

export function activityLineText(
  activity: AppActivity,
  options: { columns: number; frame: number; elapsedSeconds: number; theme: UiTheme },
): string {
  if (activity.kind === "idle") return ""
  const elapsed = options.elapsedSeconds > 0 ? ` · ${options.elapsedSeconds}s` : ""
  let label: string
  if (activity.kind === "boot") label = `Starting ${activity.stage}`
  else if (activity.kind === "thinking") label = "Thinking"
  else if (activity.kind === "responding") label = "Responding"
  else if (activity.kind === "tool") label = `Running ${singleLine(activity.name, 24)}`
  else if (activity.kind === "approval") label = `Approval ${singleLine(activity.name, 24)}`
  else return ""
  const tone = activity.kind === "approval" ? "warning" : activity.kind === "boot" ? "muted" : "accent"
  return truncateToWidth(
    `${options.theme.fg(tone, "·")} ${options.theme.fg("muted", `${label}${elapsed}`)}`,
    Math.max(1, options.columns),
    "…",
  )
}
