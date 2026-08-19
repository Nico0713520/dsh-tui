import { describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
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

  it("selects the bundled config for the requested platform", () => {
    const config = {
      mode: "acp" as const,
      model: "deepseek-v4-flash",
      cwd: "/tmp/workspace",
      persistRoot: "/tmp/sessions",
      toolCards: true,
    }
    expect(resolveDefaultBackendCommand(config, "win32").join(" ")).toContain("cordis.windows.yml")
    expect(resolveDefaultBackendCommand(config, "linux").join(" ")).toContain("cordis.posix.yml")
  })

  it("keeps Windows model tools PowerShell-only", async () => {
    const yaml = await readFile(new URL("../../config/cordis.windows.yml", import.meta.url), "utf8")
    expect(yaml).toMatch(/toolBash:\s*false/)
    expect(yaml).toContain("name: '@deepseek-ai/dsh-shell-env'")
    expect(yaml).toContain("name: '@deepseek-ai/dsh-tool-pwsh'")
    expect(yaml).not.toContain("name: '@deepseek-ai/dsh-tool-bash'")
  })
})
