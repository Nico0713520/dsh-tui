import { describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import { resolveBackendEnvironment, resolveDefaultBackendCommand } from "../../src/app.ts"

const baseConfig = {
  mode: "acp" as const,
  model: "deepseek-v4-flash",
  cwd: "/tmp/workspace",
  persistRoot: "/tmp/sessions",
  toolCards: true,
  motion: "full" as const,
  theme: "terminal" as const,
  perf: false,
  reasoningMode: "quick" as const,
}

describe("default ACP composition", () => {
  it("passes only options supported by dsh-acp-demo and uses env for the model", () => {
    const command = resolveDefaultBackendCommand(baseConfig)

    expect(command[0]).toBe(process.execPath)
    expect(command).toContain("--config")
    expect(command).not.toContain("--model")
  })

  it("selects the bundled config for the requested platform", () => {
    const config = baseConfig
    expect(resolveDefaultBackendCommand(config, "win32").join(" ")).toContain("cordis.windows.yml")
    expect(resolveDefaultBackendCommand(config, "linux").join(" ")).toContain("cordis.posix.yml")
  })

  it("maps the user-facing mode to the exact DSH reasoning effort", () => {
    expect(resolveBackendEnvironment(baseConfig, { KEEP: "yes" })).toMatchObject({
      KEEP: "yes",
      DSH_MODEL: "deepseek-v4-flash",
      DSH_PERSIST_ROOT: "/tmp/sessions",
      DSH_REASONING_EFFORT: "low",
    })
    expect(resolveBackendEnvironment({ ...baseConfig, reasoningMode: "deep" }, {}))
      .toMatchObject({ DSH_REASONING_EFFORT: "max" })
  })

  it("keeps Windows model tools PowerShell-only", async () => {
    const yaml = await readFile(new URL("../../config/cordis.windows.yml", import.meta.url), "utf8")
    expect(yaml).toMatch(/toolBash:\s*false/)
    expect(yaml).toContain("name: '@deepseek-ai/dsh-shell-env'")
    expect(yaml).toContain("name: '@deepseek-ai/dsh-tool-pwsh'")
    expect(yaml).not.toContain("name: '@deepseek-ai/dsh-tool-bash'")
  })
})
