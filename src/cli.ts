import { runApp, resolveDefaultBackendCommand } from "./app.ts"
import { loadConfig } from "./config.ts"
import { homedir } from "node:os"
import {
  credentialFilePath,
  describeDeepSeekCredential,
  removeDeepSeekCredential,
  storeDeepSeekCredential,
} from "./credentials.ts"
import { readSecretFromTty } from "./secret-input.ts"
import { loadUiPreferences, saveThemePreference, type ThemePreference } from "./preferences.ts"

export const VERSION = "0.1.0"

export const HELP = `dsh-tui ${VERSION}

Usage:
  dsh-tui [options]
  dsh-tui auth <login|status|logout>
  dsh-tui theme <status|terminal|deepseek>

Options:
  --echo                         Run the offline Echo smoke/demo instead of ACP
  --mode <echo|acp>              Select the backend mode
  --model <name>                 Model name for ACP and pricing display
  --cwd <path>                   Working directory for the backend
  --persist-root <path>          Session persistence root
  --tool-cards <on|off>          Enable or disable live session-log cards
  --backend-command-json <json>  Explicit ACP command array, no shell splitting
  --motion <full|reduced|off>    Control the non-blocking entrance motion
  --theme <terminal|deepseek>    Override the saved appearance preference
  --perf                         Show sanitized turn latency diagnostics
  --help                         Show this help
  --version                      Show the version

Keys:
  Enter send · Esc interrupt · Ctrl+R history · Ctrl+C twice exit
`

interface OutputPort {
  write(text: string): unknown
}

async function runThemeCommand(
  command: string | undefined,
  env: NodeJS.ProcessEnv,
  dependencies: Required<CliDependencies>,
): Promise<number> {
  const options = { env, home: dependencies.home, platform: dependencies.platform }
  if (command === "status") {
    dependencies.stdout.write(`${loadUiPreferences(options).theme}\n`)
    return 0
  }
  if (command === "terminal" || command === "deepseek") {
    await saveThemePreference(command as ThemePreference, options)
    dependencies.stdout.write(`${command}\n`)
    return 0
  }
  throw new Error("Usage: dsh-tui theme <status|terminal|deepseek>")
}

export interface CliDependencies {
  home?: string
  platform?: NodeJS.Platform
  stdout?: OutputPort
  stderr?: OutputPort
  readSecret?: (prompt: string) => Promise<string>
  runApp?: typeof runApp
}

async function runAuthCommand(
  command: string | undefined,
  env: NodeJS.ProcessEnv,
  dependencies: Required<CliDependencies>,
): Promise<number> {
  const options = { env, home: dependencies.home, platform: dependencies.platform }

  if (command === "status") {
    const status = await describeDeepSeekCredential(options)
    dependencies.stdout.write(status.configured
      ? `DeepSeek API key: configured (${status.source})\n`
      : "DeepSeek API key: not configured\n")
    return 0
  }

  if (command === "login") {
    const status = await describeDeepSeekCredential(options)
    if (!status.writable) {
      dependencies.stdout.write("DeepSeek API key: configured (environment)\n")
      return 0
    }
    const secret = await dependencies.readSecret("DeepSeek API key (hidden): ")
    await storeDeepSeekCredential(secret, options)
    dependencies.stdout.write(`DeepSeek API key saved to ${credentialFilePath(env, dependencies.home)}\n`)
    return 0
  }

  if (command === "logout") {
    const removed = await removeDeepSeekCredential(options)
    dependencies.stdout.write(removed
      ? "DeepSeek API key removed\n"
      : "DeepSeek API key: not configured\n")
    return 0
  }

  throw new Error("Usage: dsh-tui auth <login|status|logout>")
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  rawDependencies: CliDependencies = {},
): Promise<number> {
  const stdout = rawDependencies.stdout ?? process.stdout
  const stderr = rawDependencies.stderr ?? process.stderr
  const dependencies: Required<CliDependencies> = {
    home: rawDependencies.home ?? homedir(),
    platform: rawDependencies.platform ?? process.platform,
    stdout,
    stderr,
    readSecret: rawDependencies.readSecret ?? ((prompt) => readSecretFromTty(prompt, stderr)),
    runApp: rawDependencies.runApp ?? runApp,
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    stdout.write(HELP)
    return 0
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    stdout.write(`dsh-tui ${VERSION}\n`)
    return 0
  }
  if (argv[0] === "auth") return runAuthCommand(argv[1], env, dependencies)
  if (argv[0] === "theme") return runThemeCommand(argv[1], env, dependencies)

  const preferences = loadUiPreferences({ env, home: dependencies.home, platform: dependencies.platform })
  const config = loadConfig(argv, env, dependencies.platform, preferences)
  if (config.mode === "acp") {
    const options = { env, home: dependencies.home, platform: dependencies.platform }
    const status = await describeDeepSeekCredential(options)
    if (!status.configured) {
      const secret = await dependencies.readSecret("DeepSeek API key (hidden, saved once): ")
      await storeDeepSeekCredential(secret, options)
      stdout.write("DeepSeek API key saved. Starting dsh-tui.\n")
    }
  }
  return dependencies.runApp(config)
}

export { resolveDefaultBackendCommand }
