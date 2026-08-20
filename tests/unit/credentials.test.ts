import { afterEach, describe, expect, it } from "vitest"
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  credentialFilePath,
  describeDeepSeekCredential,
  removeDeepSeekCredential,
  storeDeepSeekCredential,
} from "../../src/credentials.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dsh-tui-credentials-"))
  roots.push(root)
  return root
}

describe("DeepSeek credential storage", () => {
  it("persists once and lets an inherited credential override the managed value", async () => {
    const home = await tempHome()
    const options = { env: {}, home, platform: "linux" as const }

    await expect(describeDeepSeekCredential(options)).resolves.toEqual({
      configured: false,
      source: "missing",
      writable: true,
    })

    await storeDeepSeekCredential("managed-test-secret", options)

    await expect(describeDeepSeekCredential(options)).resolves.toEqual({
      configured: true,
      source: "managed",
      writable: true,
    })
    await expect(describeDeepSeekCredential({
      env: { DEEPSEEK_API_KEY: "one-run-override" },
      home,
      platform: "linux",
    })).resolves.toEqual({
      configured: true,
      source: "environment",
      writable: false,
    })

    const filename = credentialFilePath({}, home)
    expect((await stat(join(home, ".dsh"))).mode & 0o777).toBe(0o700)
    expect((await stat(filename)).mode & 0o777).toBe(0o600)
    expect(await readFile(filename, "utf8")).toContain("managed-test-secret")
  })

  it("preserves unrelated entries and removes only the DeepSeek credential", async () => {
    const home = await tempHome()
    const options = { env: {}, home, platform: "linux" as const }
    const filename = credentialFilePath({}, home)

    await storeDeepSeekCredential("managed-test-secret", options)
    await writeFile(filename, "DEEPSEEK_API_KEY: managed-test-secret\nOPENAI_API_KEY: keep-me\n", { mode: 0o600 })

    await expect(removeDeepSeekCredential(options)).resolves.toBe(true)
    await expect(removeDeepSeekCredential(options)).resolves.toBe(false)
    expect(await readFile(filename, "utf8")).toContain("OPENAI_API_KEY: keep-me")
    await expect(describeDeepSeekCredential(options)).resolves.toMatchObject({ configured: false, source: "missing" })
  })

  it("rejects unsafe or malformed documents without repeating their contents", async () => {
    const home = await tempHome()
    const filename = credentialFilePath({}, home)
    const credentialDir = join(home, ".dsh")
    await storeDeepSeekCredential("initial", { env: {}, home, platform: "linux" })
    await writeFile(filename, "DEEPSEEK_API_KEY: leaked-parser-secret\nDEEPSEEK_API_KEY: duplicate", { mode: 0o600 })

    const malformed = await describeDeepSeekCredential({ env: {}, home, platform: "linux" }).catch((error: unknown) => error)
    expect(String(malformed)).toMatch(/invalid credential document/i)
    expect(String(malformed)).not.toContain("leaked-parser-secret")

    await writeFile(filename, "DEEPSEEK_API_KEY: hidden\n", { mode: 0o644 })
    await chmod(filename, 0o644)
    const permissions = await describeDeepSeekCredential({ env: {}, home, platform: "linux" }).catch((error: unknown) => error)
    expect(String(permissions)).toContain("chmod 600")
    expect(String(permissions)).not.toContain("hidden")
    expect((await stat(credentialDir)).isDirectory()).toBe(true)
  })

  it("refuses a stored write that would be shadowed by an inherited value", async () => {
    const home = await tempHome()

    await expect(storeDeepSeekCredential("managed", {
      env: { DEEPSEEK_API_KEY: "override" },
      home,
      platform: "linux",
    })).rejects.toThrow(/environment/i)
  })
})
