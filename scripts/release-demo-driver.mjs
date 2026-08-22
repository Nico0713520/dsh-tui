import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node-pty"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const releaseRoot = join(tmpdir(), "dsh-tui-release-media")
const workspace = join(releaseRoot, "demo-project")
const sessions = join(releaseRoot, "sessions")
const theme = process.argv[2] === "deepseek" ? "deepseek" : "terminal"

await rm(releaseRoot, { recursive: true, force: true })
await mkdir(workspace, { recursive: true })
await writeFile(join(workspace, "README.md"), "# demo-project\n\nA sanitized release-media workspace.\n", "utf8")

process.stdout.write("\x1b]0;DeepSeek Harness — demo-project\x07\x1b[2J\x1b[H")

const backendCommand = JSON.stringify([process.execPath, join(root, "tests", "fixtures", "fake-acp-server.mjs")])
const child = spawn(process.execPath, [
  "src/main.ts",
  "--mode", "acp",
  "--model", "deepseek-v4-flash",
  "--cwd", workspace,
  "--persist-root", sessions,
  "--tool-cards", "on",
  "--motion", "full",
  "--theme", theme,
  "--backend-command-json", backendCommand,
], {
  name: "xterm-256color",
  cols: 120,
  rows: 30,
  cwd: root,
  env: {
    ...process.env,
    DSH_TUI_MODE: "acp",
    DEEPSEEK_API_KEY: "release-demo-placeholder",
    FAKE_ACP_SCENARIO: "release-demo",
  },
  encoding: "utf8",
})

let output = ""
let submitted = false
let closing = false

child.onData((data) => {
  output += data
  process.stdout.write(data)
  if (!submitted && output.includes("ready")) {
    submitted = true
    setTimeout(() => child.write("In demo-project, inspect README.md and summarize release readiness.\r"), 2_500)
  }
  if (!closing && output.includes("Done") && output.includes("1 tool")) {
    closing = true
    setTimeout(() => {
      child.write("\u0003")
      setTimeout(() => child.write("\u0003"), 80)
    }, 8_000)
  }
})

child.onExit(({ exitCode }) => {
  process.exitCode = exitCode
})

setTimeout(() => {
  if (closing) return
  child.write("\u0003")
  setTimeout(() => child.write("\u0003"), 80)
}, 20_000).unref()
