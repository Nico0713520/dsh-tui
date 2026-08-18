import type { MarkdownTheme, SelectListTheme } from "@earendil-works/pi-tui"
import { singleLine } from "../text.ts"

export const MARK_ASSISTANT = "\x1b[36m❯\x1b[0m "
export const MARK_USER = "\x1b[33m›\x1b[0m "
export const MARK_TOOL = "\x1b[90m⚙\x1b[0m "
export const MARK_TOOL_ERR = "\x1b[31m⚙✗\x1b[0m "
export const STATUS_PREFIX = "\x1b[90m"

export const c = {
  dim: (text: string) => `\x1b[90m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
}

export const selectTheme: SelectListTheme = {
  selectedPrefix: (text) => c.cyan(text),
  selectedText: (text) => c.bold(text),
  description: (text) => c.dim(text),
  scrollInfo: (text) => c.dim(text),
  noMatch: (text) => c.dim(text),
}

export const markdownTheme: MarkdownTheme = {
  heading: (text) => c.bold(c.cyan(text)),
  link: (text) => c.blue(text),
  linkUrl: (text) => c.dim(text),
  code: (text) => c.yellow(text),
  codeBlock: (text) => c.green(text),
  codeBlockBorder: (text) => c.dim(text),
  quote: (text) => `\x1b[3m${text}\x1b[0m`,
  quoteBorder: (text) => c.dim(text),
  hr: (text) => c.dim(text),
  listBullet: (text) => c.cyan(text),
  bold: (text) => c.bold(text),
  italic: (text) => `\x1b[3m${text}\x1b[0m`,
  strikethrough: (text) => `\x1b[9m${text}\x1b[0m`,
  underline: (text) => `\x1b[4m${text}\x1b[0m`,
}

export function toolSummary(name: string, args: string, width = 80): string {
  let detail = ""
  try {
    const parsed: unknown = JSON.parse(args)
    if (typeof parsed === "object" && parsed !== null) {
      const value = parsed as Record<string, unknown>
      detail = String(value.command ?? value.path ?? value.pattern ?? value.query ?? value.description ?? "")
    }
  } catch {
    detail = args
  }
  return singleLine(`${name} ${detail}`.trim(), Math.max(1, width - 4))
}
