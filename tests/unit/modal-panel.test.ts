import { describe, expect, it, vi } from "vitest"
import type { OverlayHandle } from "@earendil-works/pi-tui"
import { ModalPanel } from "../../src/ui/modal-panel.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

function overlay(): OverlayHandle {
  return {
    hide: vi.fn(),
    setHidden: vi.fn(),
    isHidden: () => false,
    focus: vi.fn(),
    unfocus: vi.fn(),
    isFocused: () => true,
  }
}

describe("ModalPanel", () => {
  it("renders bounded chrome and closes exactly once on Escape", () => {
    const closed = vi.fn()
    const handle = overlay()
    const panel = new ModalPanel("Session", "body\nsecond", closed, createUiTheme("terminal"))
    panel.setOverlay(handle)

    panel.handleInput("\u001b")
    panel.handleInput("\u001b")

    expect(handle.hide).toHaveBeenCalledTimes(1)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(panel.render(32).every((line) => line.length > 0)).toBe(true)
  })
})
