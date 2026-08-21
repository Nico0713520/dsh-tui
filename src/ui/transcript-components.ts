import {
  Markdown,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui"
import { sanitizeTerminalText, singleLine } from "../text.ts"
import type { UiTheme } from "./theme.ts"

class UserMessage implements Component {
  private readonly text: string
  private readonly theme: UiTheme

  constructor(text: string, theme: UiTheme) {
    this.text = sanitizeTerminalText(text)
    this.theme = theme
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (safeWidth < 3) return [truncateToWidth(this.text, safeWidth, "")]
    const bodyWidth = safeWidth - 2
    return wrapTextWithAnsi(this.text.replace(/\t/g, "   "), bodyWidth).map((line) => {
      const row = `${this.theme.fg("brand", "▌")} ${line}`
      if (this.theme.name === "terminal") return row
      const padded = `${row}${" ".repeat(Math.max(0, safeWidth - visibleWidth(row)))}`
      return this.theme.bg("user", padded)
    })
  }

  invalidate(): void {}
}

class HistoryBoundary implements Component {
  private readonly label: string
  private readonly theme: UiTheme

  constructor(text: string, theme: UiTheme) {
    this.label = singleLine(text.replace(/^[─\s]+|[─\s]+$/g, ""), 120)
    this.theme = theme
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const label = ` ${this.label} `
    if (visibleWidth(label) >= safeWidth) {
      return [this.theme.fg("muted", truncateToWidth(label.trim(), safeWidth, "…"))]
    }
    const remaining = safeWidth - visibleWidth(label)
    const left = Math.floor(remaining / 2)
    const right = remaining - left
    return [this.theme.fg("border", `${"─".repeat(left)}${label}${"─".repeat(right)}`)]
  }

  invalidate(): void {}
}

export function renderUserMessage(text: string, theme: UiTheme): Component {
  return new UserMessage(text, theme)
}

export function renderAssistantMessage(text: string, theme: UiTheme): Component {
  return new Markdown(sanitizeTerminalText(text), 1, 0, theme.markdown)
}

export function renderDiagnostic(text: string, theme: UiTheme): Component {
  return new Text(`${theme.fg("warning", "!")} ${theme.fg("muted", sanitizeTerminalText(text))}`, 1, 0)
}

export function renderHistoryBoundary(text: string, theme: UiTheme): Component {
  return new HistoryBoundary(text, theme)
}
