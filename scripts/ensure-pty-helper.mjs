import { chmodSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export function ensurePtyHelper(root = resolve(fileURLToPath(new URL("..", import.meta.url)))) {
  const helper = join(root, "node_modules", "node-pty", "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper")
  if (existsSync(helper)) chmodSync(helper, 0o755)
}

ensurePtyHelper()
