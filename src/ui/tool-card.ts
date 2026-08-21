import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui"
import type { TranscriptItem } from "../controller.ts"
import { sanitizeTerminalText } from "../text.ts"
import { formatDuration } from "./activity-line.ts"
import { toolSummary, type SurfaceRole, type UiTheme } from "./theme.ts"

export type ToolItem = Extract<TranscriptItem, { kind: "tool-call" | "tool-result" }>

export interface ToolCardOptions {
  columns: number
  expanded: boolean
  frame: number
  theme: UiTheme
}

function paintRow(row: string, columns: number, surface: SurfaceRole, theme: UiTheme): string {
  const clipped = truncateToWidth(row, columns, "…")
  if (theme.name === "terminal") return clipped
  const padded = `${clipped}${" ".repeat(Math.max(0, columns - visibleWidth(clipped)))}`
  return theme.bg(surface, padded)
}

export function toolCardText(item: ToolItem, options: ToolCardOptions): string {
  const columns = Math.max(1, options.columns)
  const args = item.arguments ?? "{}"
  const summary = toolSummary(item.name, args, Math.max(8, columns - 2))
  if (item.kind === "tool-call") {
    const marker = options.theme.fg("accent", "◌")
    return paintRow(
      `${options.frame % 4 === 0 ? options.theme.strong(marker) : marker} ${options.theme.fg("muted", summary)}`,
      columns,
      "toolPending",
      options.theme,
    )
  }
  const marker = item.isError ? "✕" : "✓"
  const tone = item.isError ? "error" : "success"
  const duration = item.durationMs === undefined ? "" : ` · ${formatDuration(item.durationMs)}`
  const surface: SurfaceRole = item.isError ? "toolError" : "toolSuccess"
  const header = paintRow(
    `${options.theme.fg(tone, marker)} ${options.theme.fg("text", summary)}${options.theme.fg("muted", duration)}`,
    columns,
    surface,
    options.theme,
  )
  const output = sanitizeTerminalText(item.text).trim()
  if (!output) return header
  const wrapped = wrapTextWithAnsi(output.replace(/\t/g, "   "), Math.max(1, columns - 2))
  const limit = options.expanded ? 7 : 1
  const visible = wrapped.slice(0, limit)
  if (options.expanded && wrapped.length > limit) {
    visible.push(`… ${wrapped.length - limit} more lines`)
  }
  const rows = visible.map((line) => paintRow(
    `${options.theme.fg("muted", "  ")}${options.theme.fg(item.isError ? "error" : "muted", line)}`,
    columns,
    surface,
    options.theme,
  ))
  return [header, ...rows].join("\n")
}

export class ToolCardComponent implements Component {
  private item: ToolItem
  private expanded: boolean
  private frame: number
  private readonly theme: UiTheme

  constructor(item: ToolItem, options: Omit<ToolCardOptions, "columns">) {
    this.item = item
    this.expanded = options.expanded
    this.frame = options.frame
    this.theme = options.theme
  }

  setItem(item: ToolItem): void {
    this.item = item
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded
  }

  setFrame(frame: number): void {
    this.frame = frame
  }

  render(width: number): string[] {
    return toolCardText(this.item, {
      columns: Math.max(1, width),
      expanded: this.expanded,
      frame: this.frame,
      theme: this.theme,
    }).split("\n")
  }

  invalidate(): void {}
}

export function toolCardComponent(
  item: ToolItem,
  options: Omit<ToolCardOptions, "columns">,
): ToolCardComponent {
  return new ToolCardComponent(item, options)
}
