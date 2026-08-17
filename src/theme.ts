/** Theme cues borrowed from CodeWhale's PALETTE discipline: subtle prefixes, no rainbow. */
export const MARK_ASSISTANT = "\x1b[36m❯\x1b[0m "   // cyan
export const MARK_USER = "\x1b[33m›\x1b[0m "          // yellow
export const MARK_TOOL = "\x1b[90m⚙\x1b[0m "          // bright-black gear
export const MARK_TOOL_ERR = "\x1b[31m⚙✗\x1b[0m "     // red
export const MARK_REASON = "\x1b[90m˙\x1b[0m "         // dim dot (thinking)
export const STATUS_PREFIX = "\x1b[90m"               // bright-black

// CodeWhale-style palette helpers (dim/cyan/blue family, no rainbow)
export const c = {
  dim: (s: string) => "\x1b[90m" + s + "\x1b[0m",
  cyan: (s: string) => "\x1b[36m" + s + "\x1b[0m",
  blue: (s: string) => "\x1b[34m" + s + "\x1b[0m",
  green: (s: string) => "\x1b[32m" + s + "\x1b[0m",
  red: (s: string) => "\x1b[31m" + s + "\x1b[0m",
  yellow: (s: string) => "\x1b[33m" + s + "\x1b[0m",
  bold: (s: string) => "\x1b[1m" + s + "\x1b[0m",
}

/** One-line tool summary, CodeWhale info-density: name + key arg, <=1 line. */
export function toolSummary(name: string, args: string, width = 80): string {
  let detail = ""
  try {
    const a = JSON.parse(args)
    detail = a.command ?? a.path ?? a.pattern ?? a.query ?? a.description ?? ""
  } catch {
    detail = args.slice(0, 40)
  }
  const line = `${name} ${detail}`.trim()
  return line.length > width - 4 ? line.slice(0, width - 7) + "…" : line
}
