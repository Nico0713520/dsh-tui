import { Container, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import type { UiTheme } from "./theme.ts"

function canvasStart(theme: UiTheme): string {
  return theme.bg("canvas", "").replace("\x1b[49m", "")
}

export function paintFullWidth(line: string, width: number, theme: UiTheme): string {
  if (theme.canvasBackground === null) return line
  const safeWidth = Math.max(1, width)
  const clipped = truncateToWidth(line, safeWidth, "")
  const padded = `${clipped}${" ".repeat(Math.max(0, safeWidth - visibleWidth(clipped)))}`
  const start = canvasStart(theme)
  const restored = padded.replaceAll("\x1b[0m", `\x1b[0m${start}`).replaceAll("\x1b[49m", `\x1b[49m${start}`)
  return `${start}${restored}\x1b[0m`
}

export class ThemeCanvas extends Container {
  private readonly rows: () => number
  private readonly theme: UiTheme

  constructor(
    rows: () => number,
    theme: UiTheme,
  ) {
    super()
    this.rows = rows
    this.theme = theme
  }

  render(width: number): string[] {
    const rendered = super.render(width)
    if (this.theme.canvasBackground === null) return rendered
    const minimumRows = Math.max(0, this.rows())
    while (rendered.length < minimumRows) rendered.push("")
    return rendered.map((line) => paintFullWidth(line, width, this.theme))
  }
}
