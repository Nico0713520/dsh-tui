import { describe, expect, it } from "vitest"
import { classifyRisk, classifyShellCommand, classifyStakes } from "../../src/policy.ts"

describe("tool policy", () => {
  it("classifies only complete, exact read-only commands as benign", () => {
    expect(classifyShellCommand("git status")).toBe("benign")
    expect(classifyShellCommand("node --version")).toBe("benign")
    expect(classifyShellCommand("git status --short")).toBe("benign")
  })

  it("does not inherit a benign prefix through shell operators", () => {
    for (const command of [
      "git status && rm -rf .",
      "node --version; npm publish",
      "git diff | sh",
      "git status > report.txt",
      "pwsh -Command Remove-Item -Recurse .",
    ]) {
      expect(classifyShellCommand(command), command).toBe("destructive")
      expect(classifyStakes("bash", { command }), command).not.toBe("routine")
    }
  })

  it("keeps unknown tools fail-closed and safe tools routine", () => {
    expect(classifyRisk("mystery_tool", {})).toBe("destructive")
    expect(classifyRisk("read_file", { path: "README.md" })).toBe("benign")
    expect(classifyStakes("mystery_tool", {})).toBe("critical")
  })
})
