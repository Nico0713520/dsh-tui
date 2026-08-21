import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn as spawnPty } from "node-pty"
import { ensurePtyHelper } from "./ensure-pty-helper.mjs"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const temp = mkdtempSync(join(tmpdir(), "dsh-tui-install-"))
const npmCli = process.env.npm_execpath
ensurePtyHelper(root)

function command(args) {
  const options = { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  return npmCli
    ? execFileSync(process.execPath, [npmCli, ...args], options)
    : execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, options)
}

async function echoSmoke(bin) {
  const terminal = spawnPty(process.execPath, [bin, "--echo"], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: temp,
    env: { ...process.env, TERM: "xterm-256color" },
    encoding: "utf8",
  })
  let output = ""
  let settled = false
  let submitted = false
  let stopped = false
  let timer
  const finish = (error) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    try { terminal.kill() } catch {}
    if (error) throw error
  }
  await new Promise((resolvePromise, reject) => {
    terminal.onData((data) => {
      output += data
      if (output.includes("dsh-tui") && !submitted) {
        submitted = true
        terminal.write("install smoke\r")
      }
      if (output.includes("[echo] install smoke") && !stopped) {
        stopped = true
        terminal.write("\u0003")
        setTimeout(() => terminal.write("\u0003"), 80)
      }
    })
    terminal.onExit(({ exitCode }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (exitCode === 0 && output.includes("[echo] install smoke")) resolvePromise()
      else reject(new Error(`installed Echo smoke failed with exit ${exitCode}`))
    })
    timer = setTimeout(() => reject(new Error("installed Echo smoke timed out")), 12_000)
  }).catch((error) => {
    finish(error)
    throw error
  })
}

try {
  command(["run", "build"])
  const packed = command(["pack", "--ignore-scripts", "--pack-destination", temp]).trim().split(/\r?\n/).at(-1)
  if (!packed) throw new Error("npm pack did not return an archive name")
  const archive = join(temp, packed)
  command(["install", "--ignore-scripts", "--no-save", "--prefix", temp, archive])
  const bin = join(temp, "node_modules", "@nico0713520", "dsh-tui", "bin", "dsh-tui.js")
  const version = execFileSync(process.execPath, [bin, "--version"], { encoding: "utf8" }).trim()
  const help = execFileSync(process.execPath, [bin, "--help"], { encoding: "utf8" })
  if (version !== "dsh-tui 0.1.0") throw new Error(`unexpected installed version: ${version}`)
  if (!help.includes("Usage:") || !help.includes("--echo")) throw new Error("installed help output is incomplete")
  if (process.platform === "win32") {
    const shim = join(temp, "node_modules", ".bin", "dsh-tui.cmd")
    if (!existsSync(shim)) throw new Error("installed Windows command shim is missing")
  } else {
    await echoSmoke(bin)
  }
  console.log(`install check passed: ${version}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
