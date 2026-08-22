import { truncateToWidth, type Component } from "@earendil-works/pi-tui"
import type { TurnSummaryItem } from "../controller.ts"
import { formatDuration } from "./activity-line.ts"
import type { UiTheme } from "./theme.ts"

export function turnSummaryText(item: TurnSummaryItem, columns: number, theme: UiTheme): string {
  const status = item.status === "done"
    ? { marker: "✓", label: "Done", tone: "success" as const }
    : item.status === "cancelled"
      ? { marker: "!", label: "Interrupted", tone: "warning" as const }
      : item.status === "outcome-unknown"
        ? { marker: "?", label: "Outcome unknown", tone: "warning" as const }
        : { marker: "✕", label: "Failed", tone: "error" as const }
  const toolLabel = `${item.toolCount} ${item.toolCount === 1 ? "tool" : "tools"}`
  const failed = item.failedToolCount > 0 ? ` · ${item.failedToolCount} failed` : ""
  return truncateToWidth(
    `${theme.fg(status.tone, status.marker)} ${theme.fg("muted", `${status.label} · ${toolLabel}${failed} · ${formatDuration(item.durationMs)}`)}`,
    Math.max(1, columns),
    "…",
  )
}

class TurnSummaryComponent implements Component {
  private readonly item: TurnSummaryItem
  private readonly theme: UiTheme

  constructor(item: TurnSummaryItem, theme: UiTheme) {
    this.item = item
    this.theme = theme
  }

  render(width: number): string[] {
    return [turnSummaryText(this.item, width, this.theme)]
  }

  invalidate(): void {}
}

export function turnSummaryComponent(item: TurnSummaryItem, theme: UiTheme): Component {
  return new TurnSummaryComponent(item, theme)
}
