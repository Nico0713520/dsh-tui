import { describe, expect, it } from "vitest"
import { ModalList } from "../../src/ui/modal-list.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

describe("ModalList", () => {
  it("resolves cancellation on Escape exactly once", () => {
    const results: Array<string | null> = []
    const modal = new ModalList("History", [
      { value: "one", label: "One" },
    ], 4, (value) => results.push(value))

    modal.handleInput("\u001b")
    modal.handleInput("\u001b")

    expect(results).toEqual([null])
  })

  it("forwards arrow and Enter input to the installed SelectList", () => {
    const results: Array<string | null> = []
    const modal = new ModalList("History", [
      { value: "one", label: "One" },
      { value: "two", label: "Two" },
    ], 4, (value) => results.push(value))

    modal.handleInput("\u001b[B")
    modal.handleInput("\r")

    expect(results).toEqual(["two"])
    expect(modal.render(40).length).toBeGreaterThan(0)
  })

  it("uses the selected semantic theme for modal chrome", () => {
    const modal = new ModalList("History", [
      { value: "one", label: "One" },
    ], 4, () => {}, createUiTheme("deepseek"))

    expect(modal.render(40).join("\n")).toContain("38;2;77;107;254")
  })
})
