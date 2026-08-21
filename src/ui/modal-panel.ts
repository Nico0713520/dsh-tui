import {
  Container,
  Text,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type OverlayHandle,
  type TUI,
} from "@earendil-works/pi-tui"
import { createUiTheme, type UiTheme } from "./theme.ts"

export class ModalPanel implements Component {
  private readonly body: Container
  private readonly theme: UiTheme
  private readonly onClose: () => void
  private overlay: OverlayHandle | null = null
  private closed = false

  constructor(
    title: string,
    content: string,
    onClose: () => void,
    theme: UiTheme = createUiTheme("terminal"),
  ) {
    this.theme = theme
    this.onClose = onClose
    this.body = new Container()
    this.body.addChild(new Text(theme.strong(theme.fg("brand", title)), 1, 0))
    this.body.addChild(new Text(content, 1, 0))
    this.body.addChild(new Text(theme.fg("muted", "Esc close"), 1, 0))
  }

  setOverlay(handle: OverlayHandle): void {
    this.overlay = handle
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    return this.body.render(safeWidth).map((line) => {
      const clipped = truncateToWidth(line, safeWidth, "")
      if (this.theme.name === "terminal") return clipped
      const padded = `${clipped}${" ".repeat(Math.max(0, safeWidth - visibleWidth(clipped)))}`
      return this.theme.bg("overlay", padded)
    })
  }

  invalidate(): void {
    this.body.invalidate()
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) this.close()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.overlay?.hide()
    this.onClose()
  }
}

export function showModalPanel(
  tui: TUI,
  title: string,
  content: string,
  theme: UiTheme,
  onClose: () => void = () => {},
): ModalPanel {
  const panel = new ModalPanel(title, content, onClose, theme)
  const overlay = tui.showOverlay(panel, {
    width: "70%",
    minWidth: 28,
    maxHeight: "80%",
    margin: 1,
  })
  panel.setOverlay(overlay)
  overlay.focus()
  return panel
}
