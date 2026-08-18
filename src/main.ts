import { runCli } from "./cli.ts"

try {
  process.exitCode = await runCli()
} catch (error) {
  process.stderr.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
