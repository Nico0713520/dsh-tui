import { runCli } from "./cli.ts"
import { safeErrorText } from "./text.ts"

try {
  process.exitCode = await runCli()
} catch (error) {
  process.stderr.write(`dsh-tui: ${safeErrorText(error)}\n`)
  process.exitCode = 1
}
