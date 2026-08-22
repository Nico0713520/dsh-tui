import { mkdtemp, readFile, rm } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = await mkdtemp(join(tmpdir(), "dsh-composition-"))
const configFile = process.platform === "win32" ? "cordis.windows.yml" : "cordis.posix.yml"
const backendBin = fileURLToPath(import.meta.resolve("@deepseek-ai/dsh-acp-demo/bin"))
const configPath = fileURLToPath(new URL(`../config/${configFile}`, import.meta.url))
const livePluginPath = fileURLToPath(new URL("../config/dsh-tui-live-events.mjs", import.meta.url))
const livePluginText = await readFile(livePluginPath, "utf8")
const requiredCodeLightIds = ["tool-fs", "tool-fs-search", "tool-todo"]
for (const name of ["cordis.posix.yml", "cordis.windows.yml"]) {
  const text = await readFile(fileURLToPath(new URL(`../config/${name}`, import.meta.url)), "utf8")
  if (!text.includes("name: './dsh-tui-live-events.mjs'")) throw new Error(`${name} does not load the live event plugin`)
  for (const id of requiredCodeLightIds) {
    const matches = text.match(new RegExp(`^- id: ${id}$`, "gm")) ?? []
    if (matches.length !== 1) throw new Error(`${name} must load ${id} exactly once`)
  }
  if (!/workspaceContext:\s*\n\s+maxBytes:\s*65536/.test(text)) {
    throw new Error(`${name} must enable bounded workspace context`)
  }
}
if (!livePluginText.includes('export const name = "dsh-tui-live-events"')) throw new Error("live event plugin export is missing")
const child = spawn(process.execPath, [backendBin, "--config", configPath], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DSH_MODEL: "deepseek-v4-flash",
    DSH_PERSIST_ROOT: root,
    DSH_REASONING_EFFORT: "low",
    DEEPSEEK_API_KEY: "composition-smoke-placeholder",
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
})

const output = createInterface({ input: child.stdout })
let stderrTail = ""
child.stderr.setEncoding("utf8")
child.stderr.on("data", (chunk) => {
  stderrTail = `${stderrTail}${chunk}`.slice(-8_192)
})
let nextId = 1
let settled = false
const pending = new Map()
const exitFailure = (message) => new Error(
  stderrTail.trim() ? `${message}\nbackend stderr:\n${stderrTail.trim()}` : message,
)
const fail = (error) => {
  for (const request of pending.values()) request.reject(error)
  pending.clear()
}

output.on("line", (line) => {
  try {
    const frame = JSON.parse(line)
    if (typeof frame.id !== "number") return
    const request = pending.get(frame.id)
    if (!request) return
    pending.delete(frame.id)
    if (frame.error) request.reject(new Error("composition RPC error"))
    else request.resolve(frame.result)
  } catch {
    fail(new Error("composition emitted malformed JSON"))
  }
})
child.once("error", () => fail(new Error("composition backend failed to spawn")))
child.once("exit", (code, signal) => {
  if (!settled) fail(exitFailure(`composition backend exited (${code ?? signal ?? "unknown"})`))
})

function call(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
  })
}

function waitForExit(timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  return new Promise((resolve) => {
    const onExit = (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    }
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit)
      resolve(null)
    }, timeoutMs)
    child.once("exit", onExit)
  })
}

const timeout = setTimeout(() => fail(new Error("composition smoke timed out")), 10_000)
try {
  const initialized = await call("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "dsh-tui-composition-check", version: "0.1.0" },
  })
  if (!initialized || typeof initialized !== "object") throw new Error("composition initialize response was invalid")
  const session = await call("session/new", { cwd: process.cwd(), mcpServers: [] })
  if (!session || typeof session.sessionId !== "string" || !session.sessionId) throw new Error("composition session response was invalid")
  settled = true
  child.stdin.end()
  let exit = await waitForExit(1_000)
  if (!exit) {
    child.kill()
    exit = await waitForExit(1_500)
  }
  if (!exit) {
    child.kill("SIGKILL")
    exit = await waitForExit(1_000)
  }
  if (!exit) throw exitFailure("composition backend did not exit after forced shutdown")
  console.log(`composition check passed: ${process.platform}`)
} finally {
  clearTimeout(timeout)
  output.close()
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  await rm(root, { recursive: true, force: true })
}
