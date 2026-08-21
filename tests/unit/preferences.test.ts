import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  loadUiPreferences,
  preferenceFilePath,
  saveThemePreference,
} from "../../src/preferences.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("UI preferences", () => {
  it("uses platform-native settings paths", () => {
    expect(preferenceFilePath({}, "/home/test", "linux"))
      .toBe("/home/test/.config/dsh-tui/settings.json")
    expect(preferenceFilePath({}, "/Users/test", "darwin"))
      .toBe("/Users/test/Library/Application Support/dsh-tui/settings.json")
    expect(preferenceFilePath({ APPDATA: "C:\\Users\\test\\AppData\\Roaming" }, "C:\\Users\\test", "win32"))
      .toBe("C:\\Users\\test\\AppData\\Roaming/dsh-tui/settings.json")
  })

  it("persists a validated theme atomically with private POSIX permissions", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-tui-preferences-"))
    roots.push(home)
    const options = { env: {}, home, platform: "linux" as const }

    expect(loadUiPreferences(options)).toEqual({ theme: "terminal" })
    await saveThemePreference("deepseek", options)

    expect(loadUiPreferences(options)).toEqual({ theme: "deepseek" })
    const path = preferenceFilePath({}, home, "linux")
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ theme: "deepseek" })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it("rejects malformed settings without echoing their contents", async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-tui-preferences-invalid-"))
    roots.push(home)
    const options = { env: {}, home, platform: "linux" as const }
    await saveThemePreference("terminal", options)
    const path = preferenceFilePath({}, home, "linux")
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path, '{"theme":"secret-value"}', { mode: 0o600 }))

    expect(() => loadUiPreferences(options)).toThrow(path)
    expect(() => loadUiPreferences(options)).not.toThrow(/secret-value/)
  })
})
