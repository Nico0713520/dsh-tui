import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runCli, type CliDependencies } from "../../src/cli.ts"
import { describeDeepSeekCredential } from "../../src/credentials.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function harness(secret = "unit-test-secret") {
  const home = await mkdtemp(join(tmpdir(), "dsh-tui-cli-"))
  roots.push(home)
  let output = ""
  let errors = ""
  let secretReads = 0
  const configs: unknown[] = []
  const dependencies: CliDependencies = {
    home,
    platform: process.platform,
    stdout: { write(text) { output += text } },
    stderr: { write(text) { errors += text } },
    readSecret: async () => {
      secretReads += 1
      return secret
    },
    runApp: async (config) => {
      configs.push(config)
      return 7
    },
  }
  return {
    home,
    dependencies,
    output: () => output,
    errors: () => errors,
    secretReads: () => secretReads,
    configs,
  }
}

describe("dsh-tui CLI authentication", () => {
  it("logs in once, reports redacted status, and logs out", async () => {
    const test = await harness()

    await expect(runCli(["auth", "login"], {}, test.dependencies)).resolves.toBe(0)
    expect(test.secretReads()).toBe(1)
    expect(test.output()).toMatch(/saved/i)
    expect(test.output()).not.toContain("unit-test-secret")
    await expect(describeDeepSeekCredential({ env: {}, home: test.home, platform: process.platform }))
      .resolves.toMatchObject({ configured: true, source: "managed" })

    await expect(runCli(["auth", "status"], {}, test.dependencies)).resolves.toBe(0)
    expect(test.output()).toContain("configured (managed)")
    expect(test.output()).not.toContain("unit-test-secret")

    await expect(runCli(["auth", "logout"], {}, test.dependencies)).resolves.toBe(0)
    await expect(describeDeepSeekCredential({ env: {}, home: test.home, platform: process.platform }))
      .resolves.toMatchObject({ configured: false, source: "missing" })
  })

  it("performs one hidden login before the first ACP launch and skips it later", async () => {
    const test = await harness()

    await expect(runCli([], {}, test.dependencies)).resolves.toBe(7)
    await expect(runCli([], {}, test.dependencies)).resolves.toBe(7)

    expect(test.secretReads()).toBe(1)
    expect(test.configs).toHaveLength(2)
    expect(test.output()).not.toContain("unit-test-secret")
    expect(test.errors()).toBe("")
  })

  it("treats an environment credential as configured and read-only", async () => {
    const test = await harness()
    const env = { DEEPSEEK_API_KEY: "environment-test-secret" }

    await expect(runCli(["auth", "status"], env, test.dependencies)).resolves.toBe(0)
    await expect(runCli([], env, test.dependencies)).resolves.toBe(7)

    expect(test.secretReads()).toBe(0)
    expect(test.output()).toContain("configured (environment)")
    expect(test.output()).not.toContain("environment-test-secret")
  })

  it("never asks for credentials for help, version, or Echo mode", async () => {
    const test = await harness()

    await expect(runCli(["--help"], {}, test.dependencies)).resolves.toBe(0)
    await expect(runCli(["--version"], {}, test.dependencies)).resolves.toBe(0)
    await expect(runCli(["--echo"], {}, test.dependencies)).resolves.toBe(7)

    expect(test.secretReads()).toBe(0)
    expect(test.configs).toHaveLength(1)
  })

  it("manages the saved theme without reading credentials or launching the TUI", async () => {
    const test = await harness()

    await expect(runCli(["theme", "status"], {}, test.dependencies)).resolves.toBe(0)
    await expect(runCli(["theme", "deepseek"], {}, test.dependencies)).resolves.toBe(0)
    await expect(runCli(["theme", "status"], {}, test.dependencies)).resolves.toBe(0)
    await expect(runCli(["theme", "terminal"], {}, test.dependencies)).resolves.toBe(0)

    expect(test.output()).toBe("terminal\ndeepseek\ndeepseek\nterminal\n")
    expect(test.secretReads()).toBe(0)
    expect(test.configs).toHaveLength(0)
  })
})
