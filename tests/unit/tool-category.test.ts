import { describe, expect, it } from "vitest"
import { toolCategory } from "../../src/ui/tool-category.ts"

describe("toolCategory", () => {
  it.each([
    ["read_file", "read"],
    ["grep", "search"],
    ["write_file", "edit"],
    ["apply_patch", "edit"],
    ["npm_test", "test"],
    ["bash", "run"],
    ["custom_tool", "other"],
  ] as const)("maps %s to %s", (name, expected) => {
    expect(toolCategory(name)).toBe(expected)
  })
})
