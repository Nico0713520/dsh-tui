import { truncateToWidth } from "@earendil-works/pi-tui"
import type { AppActivity } from "../controller.ts"
import { singleLine } from "../text.ts"
import type { UiTheme } from "./theme.ts"

export function formatDuration(durationMs: number): string {
  const safe = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  if (safe < 1_000) return `${Math.round(safe)}ms`
  if (safe < 59_950) return `${(safe / 1_000).toFixed(1)}s`
  const totalSeconds = Math.round(safe / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
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
  const elapsed = options.elapsedSeconds > 0 ? ` · ${formatDuration(options.elapsedSeconds * 1_000)}` : ""
  let label: string
  if (activity.kind === "boot") label = `Starting ${activity.stage}`
  else if (activity.kind === "thinking") label = "Thinking"
  else if (activity.kind === "responding") label = "Responding"
  else if (activity.kind === "tool") label = `Running ${singleLine(activity.name, 24)}`
  else if (activity.kind === "approval") label = `Approval ${singleLine(activity.name, 24)}`
  else return ""
  const tone = activity.kind === "approval" ? "warning" : activity.kind === "boot" ? "muted" : "accent"
  const marker = options.theme.fg(tone, "·")
  const styledMarker = options.frame % 4 === 0 ? options.theme.strong(marker) : marker
  return truncateToWidth(
    `${styledMarker} ${options.theme.fg("muted", `${label}${elapsed}`)}`,
    Math.max(1, options.columns),
    "…",
  )
}
