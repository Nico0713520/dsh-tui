import { execFileSync } from "node:child_process"

const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" })
const report = JSON.parse(raw)
const files = report[0]?.files ?? []
const allowed = (name) => name === "package.json"
  || name === "README.md"
  || name === "README.zh-CN.md"
  || name === "LICENSE"
  || name.startsWith("bin/")
  || name.startsWith("dist/")
  || name.startsWith("config/")
const unexpected = files.map((file) => file.path).filter((name) => !allowed(name))
const executable = files.find((file) => file.path === "bin/dsh-tui.js")
const forbidden = files.map((file) => file.path).filter((name) => /(?:CODEX-HANDOFF|tests\/|src\/|hello\.txt|probe|\.env|\.sessions)/i.test(name))

if (unexpected.length > 0) throw new Error(`unexpected package files: ${unexpected.join(", ")}`)
if (forbidden.length > 0) throw new Error(`forbidden package files: ${forbidden.join(", ")}`)
if (!executable) throw new Error("bin/dsh-tui.js is missing from the package")
if ((Number(executable.mode) & 0o111) === 0) throw new Error("bin/dsh-tui.js is not executable")

console.log(`pack allowlist passed: ${files.length} files`)
