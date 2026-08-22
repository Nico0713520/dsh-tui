import { readFile } from "node:fs/promises"

const SUPPORTED = new Set(["0.1.1-rc.2"])
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const entries = Object.entries(pkg.dependencies ?? {})
  .filter(([name]) => name.startsWith("@deepseek-ai/dsh-"))
const versions = new Set(entries.map(([, version]) => version))

if (entries.length === 0 || versions.size !== 1) {
  throw new Error(`DSH dependencies must share one exact version: ${JSON.stringify([...versions])}`)
}
const [version] = versions
if (!SUPPORTED.has(version) || /^[~^]/.test(version)) {
  throw new Error(`Unsupported DSH version ${version}`)
}
process.stdout.write(`DSH compatibility: ${version}\n`)
