import {
  truncateToWidth,
  visibleWidth,
  type Component,
  type ScrollView,
} from "@earendil-works/pi-tui"

function paintScrollbarThumb(line: string, width: number, style: (text: string) => string): string {
  if (width <= 0 || line.includes("\x1b_G") || line.includes("\x1b]1337;File=")) return line
  const prefix = truncateToWidth(line, Math.max(0, width - 1), "")
  const padding = " ".repeat(Math.max(0, width - 1 - visibleWidth(prefix)))
  return `${prefix}${padding}${style(" ")}`
}

/**
 * Gives TuiMainScreen a bounded transcript viewport while leaving the prompt
 * editor and status line visible. ScrollView normally receives this geometry
 * from the alternate-screen layout engine; the regular main-screen renderer
 * intentionally does not run that engine.
 */
export class MainScreenLayout implements Component {
  private readonly scroller: ScrollView
  private readonly editor: Component
  private readonly status: Component
  private readonly rows: () => number
  private readonly requestRender: () => void

  constructor(
    scroller: ScrollView,
    editor: Component,
    status: Component,
    rows: () => number,
    requestRender: () => void,
  ) {
    this.scroller = scroller
    this.editor = editor
    this.status = status
    this.rows = rows
    this.requestRender = requestRender
  }

  invalidate(): void {
    this.scroller.invalidate()
    this.editor.invalidate()
    this.status.invalidate()
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const editorLines = this.editor.render(safeWidth)
    const statusLines = this.status.render(safeWidth)
    const viewportHeight = Math.max(0, this.rows() - editorLines.length - statusLines.length)
    const contentLines = this.scroller.render(safeWidth)

    this.scroller.updateLayout(contentLines.length, viewportHeight, this.requestRender)
    const visible = contentLines.slice(
      this.scroller.scrollTop,
      this.scroller.scrollTop + viewportHeight,
    )
    while (visible.length < viewportHeight) visible.push("")

    if (this.scroller.isScrollbarVisible && viewportHeight > 0) {
      const maxScrollTop = Math.max(0, contentLines.length - viewportHeight)
      const thumbHeight = Math.max(1, Math.min(
        viewportHeight,
        Math.round((viewportHeight * viewportHeight) / Math.max(1, contentLines.length)),
      ))
      const maxThumbTop = viewportHeight - thumbHeight
      const thumbTop = maxScrollTop === 0
        ? 0
        : Math.round((this.scroller.scrollTop / maxScrollTop) * maxThumbTop)
      for (let row = thumbTop; row < thumbTop + thumbHeight; row += 1) {
        visible[row] = paintScrollbarThumb(visible[row] ?? "", safeWidth, this.scroller.scrollbarStyle)
      }
    }

    return [...visible, ...editorLines, ...statusLines]
  }
}
