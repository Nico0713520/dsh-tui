import { basename } from "node:path"
import {
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui"
import type { AppPhase } from "../controller.ts"
import { sanitizeTerminalText, singleLine } from "../text.ts"
import type { UiTheme } from "./theme.ts"

export interface WelcomeCardOptions {
  columns: number
  logo: Component | null
  model: string
  cwd: string
  phase: AppPhase
  theme: UiTheme
}

type Alignment = "left" | "center"

function fit(text: string, width: number, alignment: Alignment = "left"): string {
  const safeWidth = Math.max(0, width)
  if (safeWidth === 0) return ""
  const clipped = truncateToWidth(text, safeWidth, "…")
  const remaining = Math.max(0, safeWidth - visibleWidth(clipped))
  const leading = alignment === "center" ? Math.floor(remaining / 2) : 0
  return `${" ".repeat(leading)}${clipped}${" ".repeat(remaining - leading)}`
}

function inlineImage(line: string): boolean {
  return line.includes("\x1b]1337;File=") || line.includes("\x1b_G")
}

function phaseText(phase: AppPhase, theme: UiTheme): string {
  if (phase === "ready") return theme.fg("success", "ready")
  if (phase === "failed") return theme.fg("error", "failed")
  if (phase === "closing") return theme.fg("muted", "closing")
  return theme.fg("warning", phase)
}

function topBorder(width: number, theme: UiTheme, compact = false): string {
  const title = compact
    ? theme.strong(theme.fg("brand", "DeepSeek Harness"))
    : `${theme.strong(theme.fg("brand", "DeepSeek Harness"))}  ${theme.fg("muted", "v0.1.0")}`
  const prefix = `${theme.fg("border", "╭─")} ${title} `
  const fill = "─".repeat(Math.max(0, width - visibleWidth(prefix) - 1))
  return `${prefix}${theme.fg("border", `${fill}╮`)}`
}

function bottomBorder(width: number, theme: UiTheme, splitAt?: number): string {
  if (splitAt === undefined) return theme.fg("border", `╰${"─".repeat(Math.max(0, width - 2))}╯`)
  const rightWidth = Math.max(0, width - splitAt - 3)
  return theme.fg("border", `╰${"─".repeat(splitAt)}┴${"─".repeat(rightWidth)}╯`)
}

function framedLine(content: string, width: number, theme: UiTheme, alignment: Alignment = "left"): string {
  return `${theme.fg("border", "│")}${fit(content, width - 2, alignment)}${theme.fg("border", "│")}`
}

function safeModel(model: string): string {
  return singleLine(sanitizeTerminalText(model), 32)
}

function safeWorkspace(cwd: string): string {
  return singleLine(sanitizeTerminalText(basename(cwd) || cwd), 30)
}

function logoRows(options: WelcomeCardOptions, width: number): readonly string[] {
  return options.logo?.render(Math.max(1, width)) ?? []
}

function rightContent(
  row: number,
  dividerRow: number,
  rightWidth: number,
  theme: UiTheme,
): string {
  if (row === 0) return theme.strong(theme.fg("brand", "Tips for getting started"))
  if (row === 1) return theme.fg("text", "Enter a task or ask about this workspace.")
  if (row === 2) return theme.fg("muted", "Use /status for model, session, and safety details.")
  if (row === dividerRow + 1) return theme.strong(theme.fg("brand", "Quick actions"))
  if (row === dividerRow + 2) return `${theme.fg("accent", "Enter")} send  ${theme.fg("muted", "·")}  ${theme.fg("accent", "Esc")} stop`
  if (row === dividerRow + 3 && rightWidth >= 30) {
    return `${theme.fg("accent", "Ctrl+R")} history  ${theme.fg("muted", "·")}  ${theme.fg("accent", "Ctrl+O")} tool details`
  }
  return ""
}

function renderSplitCard(options: WelcomeCardOptions, width: number): string[] {
  const innerWidth = width - 2
  const leftWidth = Math.max(26, Math.min(40, Math.floor(innerWidth * 0.34)))
  const rightWidth = Math.max(1, innerWidth - leftWidth - 1)
  const renderedLogo = logoRows(options, leftWidth - 2)
  const leftRows = [
    options.theme.strong(options.theme.fg("text", "Welcome back!")),
    ...renderedLogo,
    `${options.theme.fg("brand", safeModel(options.model))} ${options.theme.fg("muted", "·")} ${phaseText(options.phase, options.theme)}`,
    options.theme.fg("muted", safeWorkspace(options.cwd)),
  ]
  const height = Math.max(8, leftRows.length)
  const dividerRow = Math.min(4, height - 4)
  const lines = [topBorder(width, options.theme)]

  for (let row = 0; row < height; row += 1) {
    const left = leftRows[row] ?? ""
    if (row === dividerRow) {
      lines.push(`${options.theme.fg("border", "│")}${fit(left, leftWidth, "center")}${options.theme.fg("border", `├${"─".repeat(rightWidth)}┤`)}`)
      continue
    }
    const right = fit(rightContent(row, dividerRow, rightWidth, options.theme), rightWidth)
    if (inlineImage(left)) {
      // Inline-image protocol rows must remain control-sequence-only. Prefixing
      // border text would expose the encoded payload in conservative terminals.
      lines.push(left)
      continue
    }
    lines.push(`${options.theme.fg("border", "│")}${fit(left, leftWidth, "center")}${options.theme.fg("border", "│")}${right}${options.theme.fg("border", "│")}`)
  }

  lines.push(bottomBorder(width, options.theme, leftWidth))
  return lines
}

function renderStackedCard(options: WelcomeCardOptions, width: number): string[] {
  const innerWidth = width - 2
  const renderedLogo = logoRows(options, innerWidth)
  const lines = [
    topBorder(width, options.theme),
    framedLine(options.theme.strong(options.theme.fg("text", "Welcome back!")), width, options.theme, "center"),
    ...renderedLogo.map((line) => inlineImage(line)
      ? line
      : framedLine(line, width, options.theme, "center")),
    framedLine(`${options.theme.fg("brand", safeModel(options.model))} ${options.theme.fg("muted", "·")} ${phaseText(options.phase, options.theme)}`, width, options.theme, "center"),
    framedLine(options.theme.fg("muted", "Enter a task or ask about this workspace."), width, options.theme, "center"),
    bottomBorder(width, options.theme),
  ]
  return lines
}

function renderCompactCard(options: WelcomeCardOptions, width: number): string[] {
  return [
    topBorder(width, options.theme, true),
    framedLine(`${options.theme.fg("brand", safeModel(options.model))} ${options.theme.fg("muted", "·")} ${phaseText(options.phase, options.theme)}`, width, options.theme, "center"),
    framedLine(options.theme.fg("muted", "Enter a task"), width, options.theme, "center"),
    bottomBorder(width, options.theme),
  ]
}

export class WelcomeCard implements Component {
  constructor(private readonly options: WelcomeCardOptions) {}

  render(width: number): string[] {
    const columns = Math.max(1, Math.min(width, this.options.columns))
    if (columns < 34) return [`dsh-tui ${this.options.theme.fg("muted", "·")} ${phaseText(this.options.phase, this.options.theme)}`]
    if (columns < 48) return renderCompactCard(this.options, columns)
    if (columns < 72) return renderStackedCard(this.options, columns)
    return renderSplitCard(this.options, columns)
  }

  invalidate(): void {
    this.options.logo?.invalidate?.()
  }
}
