import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui"
import type { TranscriptItem } from "../controller.ts"
import { sanitizeTerminalText } from "../text.ts"
import { formatDuration } from "./activity-line.ts"
import { toolCategory, toolCategoryLabel } from "./tool-category.ts"
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
  const label = toolCategoryLabel(toolCategory(item.name))
  if (item.kind === "tool-call") {
    const marker = options.theme.fg("accent", "◌")
    return paintRow(
      `${options.frame % 4 === 0 ? options.theme.strong(marker) : marker} ${options.theme.fg("muted", `${label} · ${summary}`)}`,
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
    `${options.theme.fg(tone, marker)} ${options.theme.fg("muted", `${label} · `)}${options.theme.fg("text", summary)}${options.theme.fg("muted", duration)}`,
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
  private cachedWidth: number | null = null
  private cachedLines: string[] | null = null

  constructor(item: ToolItem, options: Omit<ToolCardOptions, "columns">) {
    this.item = item
    this.expanded = options.expanded
    this.frame = options.frame
    this.theme = options.theme
  }

  setItem(item: ToolItem): void {
    if (this.item === item) return
    this.item = item
    this.invalidate()
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return
    this.expanded = expanded
    this.invalidate()
  }

  setFrame(frame: number): void {
    if (!this.isPending() || this.frame === frame) return
    this.frame = frame
    this.invalidate()
  }

  isPending(): boolean {
    return this.item.kind === "tool-call"
  }

  render(width: number): string[] {
    const columns = Math.max(1, width)
    if (this.cachedLines !== null && this.cachedWidth === columns) return this.cachedLines
    this.cachedWidth = columns
    this.cachedLines = toolCardText(this.item, {
      columns,
      expanded: this.expanded,
      frame: this.frame,
      theme: this.theme,
    }).split("\n")
    return this.cachedLines
  }

  invalidate(): void {
    this.cachedWidth = null
    this.cachedLines = null
  }
}

export function toolCardComponent(
  item: ToolItem,
  options: Omit<ToolCardOptions, "columns">,
): ToolCardComponent {
  return new ToolCardComponent(item, options)
}
