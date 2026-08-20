import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

export type RunMode = "acp" | "echo"
export type MotionPreference = "full" | "reduced" | "off"

export interface AppConfig {
  mode: RunMode
  model: string
  cwd: string
  persistRoot: string
  toolCards: boolean
  motion: MotionPreference
  perf: boolean
  backendCommand?: readonly string[]
}

interface ParsedValues {
  echo?: boolean
  mode?: string
  model?: string
  cwd?: string
  "persist-root"?: string
  "tool-cards"?: string
  "backend-command-json"?: string
  motion?: string
  perf?: boolean
}

const OPTIONS = {
  echo: { type: "boolean" },
  mode: { type: "string" },
  model: { type: "string" },
  cwd: { type: "string" },
  "persist-root": { type: "string" },
  "tool-cards": { type: "string" },
  "backend-command-json": { type: "string" },
  motion: { type: "string" },
  perf: { type: "boolean" },
  help: { type: "boolean" },
  version: { type: "boolean" },
} as const

function nonEmpty(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined
  if (!value.trim()) throw new Error(`${label} must not be empty`)
  return value
}

function parseCommand(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error("DSH_ACP_CMD_JSON must be a JSON array")
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("DSH_ACP_CMD_JSON must be a non-empty JSON array of non-empty strings")
  }
  return parsed
}

function defaultPersistRoot(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const home = homedir()
  if (platform === "win32") {
    return join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "dsh-tui", "sessions")
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "dsh-tui", "sessions")
  }
  return join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "dsh-tui", "sessions")
}

export function loadConfig(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): AppConfig {
  const parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }).values as ParsedValues
  const modeValue = parsed.echo === true ? "echo" : parsed.mode ?? env.DSH_TUI_MODE ?? "acp"
  if (modeValue !== "echo" && modeValue !== "acp") {
    throw new Error(`mode must be "echo" or "acp", received ${JSON.stringify(modeValue)}`)
  }

  const model = nonEmpty(parsed.model ?? env.DSH_MODEL ?? "deepseek-v4-flash", "model")!
  const cwd = resolve(nonEmpty(parsed.cwd ?? env.DSH_CWD ?? process.cwd(), "cwd")!)
  const persistRoot = resolve(nonEmpty(parsed["persist-root"] ?? env.DSH_PERSIST_ROOT ?? defaultPersistRoot(env, platform), "persist root")!)
  const toolCardsValue = parsed["tool-cards"] ?? env.DSH_TOOL_CARDS ?? "on"
  if (!["on", "off", "true", "false"].includes(toolCardsValue)) {
    throw new Error(`tool-cards must be on, off, true, or false; received ${JSON.stringify(toolCardsValue)}`)
  }
  const toolCards = toolCardsValue === "on" || toolCardsValue === "true"
  const commandValue = parsed["backend-command-json"] ?? env.DSH_ACP_CMD_JSON
  const backendCommand = parseCommand(commandValue)
  const requestedMotion = parsed.motion ?? env.DSH_TUI_MOTION ?? "full"
  if (requestedMotion !== "full" && requestedMotion !== "reduced" && requestedMotion !== "off") {
    throw new Error(`motion must be full, reduced, or off; received ${JSON.stringify(requestedMotion)}`)
  }
  const motion: MotionPreference = requestedMotion
  const perfValue = parsed.perf === true ? "1" : env.DSH_TUI_PERF ?? "0"
  if (perfValue !== "0" && perfValue !== "1") {
    throw new Error(`perf must be 0 or 1; received ${JSON.stringify(perfValue)}`)
  }

  return {
    mode: modeValue,
    model,
    cwd,
    persistRoot,
    toolCards,
    motion,
    perf: perfValue === "1",
    ...(backendCommand === undefined ? {} : { backendCommand }),
  }
}
