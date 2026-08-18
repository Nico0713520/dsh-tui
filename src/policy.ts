/**
 * Approval risk policy, ported from CodeWhale.
 * UI-free classification so the approval overlay renders decisions it doesn't own.
 */

// ------------------------------------------------------------------ risk (CodeWhale policy.rs)
export type ToolCategory = "safe" | "file-write" | "shell" | "network" | "unknown"
export type ApprovalStakes = "routine" | "elevated" | "critical"

const SHELL_META = /(?:&&|\|\||[;|<>`]|\$\(|\r|\n|&)/
const READ_ONLY_COMMANDS = [
  /^(?:node|npm|pnpm|python|python3|pip|pip3)\s+(?:--version|-v)\s*$/i,
  /^git\s+(?:status|diff|log|show|blame)(?:\s+[^;&|<>`]*)?\s*$/i,
]

export function classifyShellCommand(command: string): "benign" | "destructive" {
  const value = command.trim()
  if (!value || SHELL_META.test(value)) return "destructive"
  return READ_ONLY_COMMANDS.some((pattern) => pattern.test(value)) ? "benign" : "destructive"
}

const FILE_WRITE = new Set(["write", "edit", "write_file", "edit_file", "apply_patch"])
const NETWORK = new Set(["web_run", "web_search", "fetch_url", "registry_sync"])
const SHELL = new Set(["bash", "Bash", "exec_shell", "pwsh", "task_shell_start", "task_shell_wait"])
const SAFE = new Set(["read", "read_file", "list_dir", "todo_write", "todo_read", "search", "grep_files", "git_status", "git_diff", "git_log", "git_show", "git_blame"])

export function getToolCategory(name: string): ToolCategory {
  if (FILE_WRITE.has(name)) return "file-write"
  if (NETWORK.has(name)) return "network"
  if (SHELL.has(name)) return "shell"
  if (SAFE.has(name) || name.startsWith("read_") || name.startsWith("list_") || name.startsWith("get_")) return "safe"
  return "unknown"
}

/** Conservative bias: unprovable read-only → destructive, per CodeWhale. */
export function classifyRisk(name: string, args: unknown): "benign" | "destructive" {
  const cat = getToolCategory(name)
  if (cat === "safe") return "benign"
  if (cat === "network") {
    if (name === "web_search" || name === "registry_sync") return "benign"
    return "destructive"
  }
  if (cat === "shell") {
    try {
      const command = typeof args === "object" && args !== null
        ? (args as Record<string, unknown>).command
        : undefined
      if (typeof command === "string" && classifyShellCommand(command) === "benign") return "benign"
    } catch {}
    return "destructive"
  }
  return "destructive"
}

/** Presentation stakes: Routine (minimal chrome) / Elevated (calm) / Critical (strong warning). */
export function classifyStakes(name: string, args: unknown): ApprovalStakes {
  if (classifyRisk(name, args) === "benign") return "routine"
  const cat = getToolCategory(name)
  // publish-like or destructive patterns → critical; ordinary state-touching → elevated
  try {
    const cmd = String((args as any)?.command ?? "")
    if (/\b(rm\s+-rf|git\s+push\s+--force|drop\s+table|curl[^|]*\|\s*(ba)?sh|del\s+\/[sq])/i.test(cmd)) return "critical"
    if (/\b(git\s+push|npm\s+publish|docker\s+(rm|rmi)|kubectl\s+delete)/i.test(cmd)) return "critical"
  } catch {}
  if (cat === "unknown") return "critical"
  return "elevated"
}
