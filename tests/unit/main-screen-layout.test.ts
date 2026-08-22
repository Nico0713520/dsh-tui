import { describe, expect, it, vi } from "vitest"
import { ScrollView, Text, stripTerminalSequences } from "@earendil-works/pi-tui"
import { MainScreenLayout } from "../../src/ui/main-screen-layout.ts"

describe("MainScreenLayout", () => {
  it("keeps lower chrome visible and lets the transcript scroll away from the end", () => {
    const transcript = new Text(["one", "two", "three", "four", "five"].join("\n"), 0, 0)
    const scroller = new ScrollView(transcript, { follow: "end", scrollbar: "auto" })
    const layout = new MainScreenLayout(
      scroller,
      new Text("editor", 0, 0),
      new Text("status", 0, 0),
      () => 5,
      vi.fn(),
    )

    expect(layout.render(20).map(stripAnsi)).toEqual(["three", "four", "five", "editor", "status"])

    scroller.scrollBy(-3)
    expect(layout.render(20).map(stripAnsi)).toEqual(["one", "two", "three", "editor", "status"])
    expect(scroller.isFollowingEnd).toBe(false)

    scroller.scrollToEnd()
    expect(layout.render(20).map(stripAnsi)).toEqual(["three", "four", "five", "editor", "status"])
    expect(scroller.isFollowingEnd).toBe(true)
  })

  it("adapts the transcript viewport when the editor grows", () => {
    const scroller = new ScrollView(new Text("one\ntwo\nthree\nfour", 0, 0), { follow: "end" })
    const editor = new Text("editor", 0, 0)
    const layout = new MainScreenLayout(scroller, editor, new Text("status", 0, 0), () => 5, vi.fn())

    expect(layout.render(20).map(stripAnsi)).toEqual(["two", "three", "four", "editor", "status"])
    editor.setText("editor\nwrapped")
    expect(layout.render(20).map(stripAnsi)).toEqual(["three", "four", "editor", "wrapped", "status"])
  })
})

function stripAnsi(text: string): string {
  return stripTerminalSequences(text).trimEnd()
}
