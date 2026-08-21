import type { MarkdownTheme, SelectListTheme } from "@earendil-works/pi-tui"
import type { AppPhase } from "../controller.ts"
import type { ThemePreference } from "../preferences.ts"
import { singleLine } from "../text.ts"

export type ForegroundRole =
  | "brand" | "accent" | "text" | "muted" | "subtle"
  | "success" | "warning" | "error" | "border" | "borderFocus"

export type SurfaceRole =
  | "canvas" | "user" | "toolPending" | "toolSuccess" | "toolError" | "overlay"

export interface UiTheme {
  name: ThemePreference
  canvasBackground: string | null
  fg(role: ForegroundRole, text: string): string
  bg(role: SurfaceRole, text: string): string
  strong(text: string): string
  italic(text: string): string
  underline(text: string): string
  strikethrough(text: string): string
  markdown: MarkdownTheme
  select: SelectListTheme
  editorBorder(phase: AppPhase, focused: boolean, text: string): string
}

const DEEPSEEK_FOREGROUNDS: Record<ForegroundRole, string> = {
  brand: "#4D6BFE",
  accent: "#5B8CFF",
  text: "#182033",
  muted: "#687089",
  subtle: "#8790A8",
  success: "#218A56",
  warning: "#A56A00",
  error: "#C93C4A",
  border: "#DCE5FF",
  borderFocus: "#4D6BFE",
}

const DEEPSEEK_SURFACES: Record<SurfaceRole, string> = {
  canvas: "#F7F9FF",
  user: "#EEF3FF",
  toolPending: "#F1F4FC",
  toolSuccess: "#EAF7F0",
  toolError: "#FDEEF0",
  overlay: "#FFFFFF",
}

const TERMINAL_FOREGROUNDS: Record<ForegroundRole, string | null> = {
  brand: "#4D6BFE",
  accent: "#6D83FF",
  text: null,
  muted: "90",
  subtle: "2",
  success: "32",
  warning: "33",
  error: "31",
  border: "90",
  borderFocus: "#6D83FF",
}

function parseHex(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function foreground(hexOrCode: string | null, text: string, color: boolean): string {
  if (!color || hexOrCode === null) return text
  if (!hexOrCode.startsWith("#")) return `\x1b[${hexOrCode}m${text}\x1b[39m`
  const [red, green, blue] = parseHex(hexOrCode)
  return `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`
}

function background(hex: string, text: string, color: boolean): string {
  if (!color) return text
  const [red, green, blue] = parseHex(hex)
  return `\x1b[48;2;${red};${green};${blue}m${text}\x1b[49m`
}

export function createUiTheme(
  name: ThemePreference,
  options: { color?: boolean } = {},
): UiTheme {
  const color = options.color ?? true
  const foregrounds = name === "deepseek" ? DEEPSEEK_FOREGROUNDS : TERMINAL_FOREGROUNDS
  const fg = (role: ForegroundRole, text: string): string => foreground(foregrounds[role], text, color)
  const bg = (role: SurfaceRole, text: string): string => name === "terminal"
    ? text
    : background(DEEPSEEK_SURFACES[role], text, color)
  const strong = (text: string): string => `\x1b[1m${text}\x1b[22m`
  const italic = (text: string): string => `\x1b[3m${text}\x1b[23m`
  const underline = (text: string): string => `\x1b[4m${text}\x1b[24m`
  const strikethrough = (text: string): string => `\x1b[9m${text}\x1b[29m`
  const markdown: MarkdownTheme = {
    heading: (text) => strong(fg("brand", text)),
    link: (text) => underline(fg("accent", text)),
    linkUrl: (text) => fg("muted", text),
    code: (text) => fg("warning", text),
    codeBlock: (text) => fg("success", text),
    codeBlockBorder: (text) => fg("border", text),
    quote: (text) => italic(fg("muted", text)),
    quoteBorder: (text) => fg("border", text),
    hr: (text) => fg("border", text),
    listBullet: (text) => fg("brand", text),
    bold: strong,
    italic,
    strikethrough,
    underline,
  }
  const select: SelectListTheme = {
    selectedPrefix: (text) => fg("brand", text),
    selectedText: (text) => strong(fg("text", text)),
    description: (text) => fg("muted", text),
    scrollInfo: (text) => fg("muted", text),
    noMatch: (text) => fg("muted", text),
  }
  return {
    name,
    canvasBackground: name === "deepseek" ? DEEPSEEK_SURFACES.canvas : null,
    fg,
    bg,
    strong,
    italic,
    underline,
    strikethrough,
    markdown,
    select,
    editorBorder: (phase, focused, text) => {
      if (phase === "failed") return fg("error", text)
      if (phase === "cancelling") return fg("warning", text)
      if (!focused) return fg("border", text)
      if (phase === "starting") return fg("warning", text)
      if (phase === "working") return fg("accent", text)
      return fg("borderFocus", text)
    },
  }
}

const terminalTheme = createUiTheme("terminal", { color: true })

// Transitional compatibility exports for modules converted in later visual slices.
export const c = {
  dim: (text: string) => terminalTheme.fg("muted", text),
  cyan: (text: string) => terminalTheme.fg("brand", text),
  blue: (text: string) => terminalTheme.fg("brand", text),
  green: (text: string) => terminalTheme.fg("success", text),
  red: (text: string) => terminalTheme.fg("error", text),
  yellow: (text: string) => terminalTheme.fg("warning", text),
  bold: (text: string) => terminalTheme.strong(text),
}

export const selectTheme = terminalTheme.select
export const markdownTheme = terminalTheme.markdown
export const MARK_ASSISTANT = terminalTheme.fg("brand", "❯") + " "
export const MARK_USER = terminalTheme.fg("brand", "›") + " "
export const MARK_TOOL = terminalTheme.fg("muted", "⚙") + " "
export const MARK_TOOL_ERR = terminalTheme.fg("error", "⚙✗") + " "
export const STATUS_PREFIX = terminalTheme.fg("muted", "")

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
