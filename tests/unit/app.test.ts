import { describe, expect, it } from "vitest"
import { resolveDefaultBackendCommand } from "../../src/app.ts"

describe("default ACP composition", () => {
  it("passes only options supported by dsh-acp-demo and uses env for the model", () => {
    const command = resolveDefaultBackendCommand({
      mode: "acp",
      model: "deepseek-v4-flash",
      cwd: "/tmp/workspace",
      persistRoot: "/tmp/sessions",
      toolCards: true,
    })

    expect(command[0]).toBe(process.execPath)
    expect(command).toContain("--config")
    expect(command).not.toContain("--model")
  })
})
