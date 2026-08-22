import { afterEach, describe, expect, it } from "vitest"
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
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
    const options = { env: {}, home, platform: process.platform }

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
      platform: process.platform,
    })).resolves.toEqual({
      configured: true,
      source: "environment",
      writable: false,
    })

    const filename = credentialFilePath({}, home)
    if (process.platform !== "win32") {
      expect((await stat(join(home, ".dsh"))).mode & 0o777).toBe(0o700)
      expect((await stat(filename)).mode & 0o777).toBe(0o600)
    }
    expect(await readFile(filename, "utf8")).toContain("managed-test-secret")
  })

  it("reads the official versioned document, preserves unrelated entries, and removes only DeepSeek", async () => {
    const home = await tempHome()
    const options = { env: {}, home, platform: process.platform }
    const filename = credentialFilePath({}, home)
    await mkdir(join(home, ".dsh"), { recursive: true, mode: 0o700 })
    await writeFile(filename, [
      "version: 1",
      "refs:",
      "  DEEPSEEK_API_KEY: managed-test-secret",
      "  OPENAI_API_KEY: keep-me",
      "",
    ].join("\n"), { mode: 0o600 })

    await expect(describeDeepSeekCredential(options)).resolves.toEqual({
      configured: true,
      source: "managed",
      writable: true,
    })
    await storeDeepSeekCredential("replacement-test-secret", options)
    expect(await readFile(filename, "utf8")).toContain("OPENAI_API_KEY: keep-me")
    expect(await readFile(filename, "utf8")).toContain("replacement-test-secret")

    await expect(removeDeepSeekCredential(options)).resolves.toBe(true)
    await expect(removeDeepSeekCredential(options)).resolves.toBe(false)
    expect(await readFile(filename, "utf8")).toContain("OPENAI_API_KEY: keep-me")
    await expect(describeDeepSeekCredential(options)).resolves.toMatchObject({ configured: false, source: "missing" })
  })

  it("lets the official provider migrate the recognized flat pre-release layout", async () => {
    const home = await tempHome()
    const options = { env: {}, home, platform: process.platform }
    const filename = credentialFilePath({}, home)
    await mkdir(join(home, ".dsh"), { recursive: true, mode: 0o700 })
    await writeFile(filename, "# retained\nDEEPSEEK_API_KEY: migration-test-secret\n", { mode: 0o600 })

    await expect(describeDeepSeekCredential(options)).resolves.toMatchObject({
      configured: true,
      source: "managed",
    })

    const migrated = await readFile(filename, "utf8")
    expect(migrated).toContain("version: 1")
    expect(migrated).toContain("refs:")
    expect(migrated).toContain("  DEEPSEEK_API_KEY: migration-test-secret")
    expect(migrated).toContain("  # retained")
  })

  it("rejects unsafe or malformed documents without repeating their contents", async () => {
    const home = await tempHome()
    const filename = credentialFilePath({}, home)
    const credentialDir = join(home, ".dsh")
    const options = { env: {}, home, platform: process.platform }
    await storeDeepSeekCredential("initial", options)
    await writeFile(filename, "DEEPSEEK_API_KEY: leaked-parser-secret\nDEEPSEEK_API_KEY: duplicate", { mode: 0o600 })

    const malformed = await describeDeepSeekCredential(options).catch((error: unknown) => error)
    expect(String(malformed)).toMatch(/invalid document/i)
    expect(String(malformed)).not.toContain("leaked-parser-secret")

    if (process.platform !== "win32") {
      await writeFile(filename, "DEEPSEEK_API_KEY: hidden\n", { mode: 0o644 })
      await chmod(filename, 0o644)
      const permissions = await describeDeepSeekCredential(options).catch((error: unknown) => error)
      expect(String(permissions)).toContain("chmod 600")
      expect(String(permissions)).not.toContain("hidden")
    }
    expect((await stat(credentialDir)).isDirectory()).toBe(true)
  })

  it("refuses a stored write that would be shadowed by an inherited value", async () => {
    const home = await tempHome()

    await expect(storeDeepSeekCredential("managed", {
      env: { DEEPSEEK_API_KEY: "override" },
      home,
      platform: process.platform,
    })).rejects.toThrow(/environment/i)
  })
})
