import { runApp, resolveDefaultBackendCommand } from "./app.ts"
import { loadConfig } from "./config.ts"

export const VERSION = "0.1.0"

export const HELP = `dsh-tui ${VERSION}

Usage:
  dsh-tui [options]

Options:
  --echo                         Run without a live ACP backend
  --mode <echo|acp>              Select the backend mode
  --model <name>                 Model name for ACP and pricing display
  --cwd <path>                   Working directory for the backend
  --persist-root <path>          Session persistence root
  --tool-cards <on|off>          Enable or disable live session-log cards
  --backend-command-json <json>  Explicit ACP command array, no shell splitting
  --help                         Show this help
  --version                      Show the version

Keys:
  Enter send · Esc interrupt · Ctrl+R history · Ctrl+C twice exit
`

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP)
    return 0
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`dsh-tui ${VERSION}\n`)
    return 0
  }
  return runApp(loadConfig(argv, env))
}

export { resolveDefaultBackendCommand }
