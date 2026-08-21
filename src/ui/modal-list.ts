import {
  Container,
  SelectList,
  Text,
  type Component,
  type OverlayHandle,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui"
import { matchesKey } from "@earendil-works/pi-tui"
import { createUiTheme, type UiTheme } from "./theme.ts"

export class ModalList implements Component {
  private readonly body: Container
  private readonly list: SelectList
  private readonly onResult: (value: string | null) => void
  private settled = false
  private overlay: OverlayHandle | null = null

  constructor(
    header: string,
    items: readonly SelectItem[],
    maxVisible: number,
    onResult: (value: string | null) => void,
    theme: UiTheme = createUiTheme("terminal"),
  ) {
    this.onResult = onResult
    this.body = new Container()
    this.body.addChild(new Text(theme.strong(theme.fg("brand", header)), 1, 0))
    this.body.addChild(new Text(theme.fg("muted", "↑↓ select · Enter choose · Esc cancel"), 1, 0))
    this.list = new SelectList([...items], maxVisible, theme.select)
    this.list.onSelect = (item) => this.finish(item.value)
    this.list.onCancel = () => this.finish(null)
    this.body.addChild(this.list)
  }

  setOverlay(handle: OverlayHandle): void {
    this.overlay = handle
  }

  render(width: number): string[] {
    return this.body.render(width)
  }

  invalidate(): void {
    this.body.invalidate()
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.finish(null)
      return
    }
    this.list.handleInput(data)
  }

  private finish(value: string | null): void {
    if (this.settled) return
    this.settled = true
    this.overlay?.hide()
    this.onResult(value)
  }
}

export function showModalList(
  tui: TUI,
  header: string,
  items: readonly SelectItem[],
  maxVisible: number,
  theme: UiTheme = createUiTheme("terminal"),
): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new ModalList(header, items, maxVisible, resolve, theme)
    const overlay = tui.showOverlay(modal, { width: "70%", maxHeight: maxVisible + 3 })
    modal.setOverlay(overlay)
    overlay.focus()
  })
}
