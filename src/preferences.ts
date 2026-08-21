import { readFileSync } from "node:fs"
import { chmod, mkdir, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, posix, win32 } from "node:path"

export type ThemePreference = "terminal" | "deepseek"

export interface UiPreferences {
  theme: ThemePreference
}

export interface PreferenceOptions {
  env?: NodeJS.ProcessEnv
  home?: string
  platform?: NodeJS.Platform
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "terminal" || value === "deepseek"
}

export function preferenceFilePath(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const paths = platform === "win32" ? win32 : posix
  if (platform === "win32") {
    return paths.join(env.APPDATA ?? paths.join(home, "AppData", "Roaming"), "dsh-tui", "settings.json")
  }
  if (platform === "darwin") {
    return paths.join(home, "Library", "Application Support", "dsh-tui", "settings.json")
  }
  return paths.join(env.XDG_CONFIG_HOME ?? paths.join(home, ".config"), "dsh-tui", "settings.json")
}

export function loadUiPreferences(options: PreferenceOptions = {}): UiPreferences {
  const path = preferenceFilePath(options.env, options.home, options.platform)
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { theme: "terminal" }
    throw new Error(`Unable to read UI settings at ${path}`, { cause: error })
  }

  // Tolerate a UTF-8 BOM left by external editors or PowerShell redirects so a
  // hand-edited settings file never blocks startup.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)

  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null || !isThemePreference((value as { theme?: unknown }).theme)) {
      throw new Error("invalid settings shape")
    }
    return { theme: (value as { theme: ThemePreference }).theme }
  } catch (error) {
    throw new Error(`Invalid UI settings at ${path}`, { cause: error })
  }
}

export async function saveThemePreference(
  theme: ThemePreference,
  options: PreferenceOptions = {},
): Promise<void> {
  if (!isThemePreference(theme)) throw new Error("theme must be terminal or deepseek")
  const path = preferenceFilePath(options.env, options.home, options.platform)
  const directory = dirname(path)
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporary, `${JSON.stringify({ theme }, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, path)
    if ((options.platform ?? process.platform) !== "win32") await chmod(path, 0o600)
  } catch (error) {
    throw new Error(`Unable to save UI settings at ${path}`, { cause: error })
  }
}
