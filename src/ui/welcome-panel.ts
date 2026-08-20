import { truncateToWidth } from "@earendil-works/pi-tui"
import type { AppPhase, AppState } from "../controller.ts"
import type { MotionPreference } from "../config.ts"
import { sanitizeTerminalText, singleLine } from "../text.ts"
import { deepPulseFrame, type DeepPulseTick } from "./deep-pulse.ts"
import { c } from "./theme.ts"

export interface WelcomePanelOptions {
  columns: number
  tick: DeepPulseTick
  motion: MotionPreference
  tty: boolean
  model: string
  cwd: string
  phase: AppPhase
  sessionId: string | null
}

const DSH_ART = [
  "████▄  █████  █   █",
  "█   █  █      █   █",
  "█   █  ████   █████",
  "█   █      █  █   █",
  "████▀  █████  █   █",
] as const

function fit(text: string, columns: number): string {
  if (columns <= 0) return ""
  return truncateToWidth(text, columns, "…")
}

function phaseText(phase: AppPhase): string {
  const text = phase === "starting" ? "starting"
    : phase === "working" ? "working"
      : phase === "cancelling" ? "cancelling"
        : phase
  return phase === "ready" ? c.green(text)
    : phase === "failed" ? c.red(text)
      : phase === "closing" ? c.dim(text)
        : c.yellow(text)
}

function safe(value: string, width: number): string {
  return singleLine(sanitizeTerminalText(value), Math.max(1, width))
}

function brand(options: WelcomePanelOptions): string {
  return deepPulseFrame({
    columns: Math.max(34, options.columns),
    frame: options.tick.frame,
    motion: options.motion,
    tty: options.tty,
    completion: options.tick.completion,
  }) || "dsh-tui"
}

function fullPanel(options: WelcomePanelOptions): string {
  const identity = [
    `${brand(options)}  ${c.dim("v0.1")}`,
    c.bold("DeepSeek Harness in your terminal"),
    c.dim("A focused terminal client for agentic coding"),
    "",
    c.dim("fast input · live tools · persistent sessions"),
  ]
  const art = DSH_ART.map((line, index) => fit(`  ${c.cyan(line)}    ${identity[index] ?? ""}`, options.columns))
  const model = safe(options.model, Math.max(8, options.columns - 28))
  const workspace = safe(options.cwd, Math.max(8, options.columns - 16))
  const session = safe(options.sessionId ?? "creating…", 24)
  return [
    ...art,
    fit(c.dim("─".repeat(options.columns)), options.columns),
    fit(`  ${c.dim("model")}      ${c.blue(model)}   ${c.dim("·")}   ${c.dim("state")} ${phaseText(options.phase)}`, options.columns),
    fit(`  ${c.dim("workspace")}  ${workspace}`, options.columns),
    fit(`  ${c.dim("session")}    ${session}   ${c.dim("· workspace-write · approval ask")}`, options.columns),
    fit(`  ${c.cyan("Enter")} send   ${c.dim("·")}   ${c.cyan("Esc")} interrupt   ${c.dim("·")}   ${c.cyan("Ctrl+R")} history   ${c.dim("·")}   ${c.cyan("Ctrl+C ×2")} exit`, options.columns),
  ].join("\n")
}

function mediumPanel(options: WelcomePanelOptions): string {
  const width = options.columns
  const title = `${brand(options)}  ${c.bold("DeepSeek Harness in your terminal")}`
  const model = safe(options.model, Math.max(8, width - 24))
  const workspace = safe(options.cwd, Math.max(8, width - 15))
  const session = safe(options.sessionId ?? "creating…", Math.max(8, width - 39))
  return [
    fit(`╭─ ${title}`, width),
    fit(`│  ${c.blue(model)}  ${c.dim("·")}  ${phaseText(options.phase)}`, width),
    fit(`│  ${c.dim("workspace")}  ${workspace}`, width),
    fit(`│  ${c.dim("session")} ${session}  ${c.dim("· workspace-write · ask")}`, width),
    fit(`╰─ ${c.cyan("Enter")} send  ${c.dim("·")}  ${c.cyan("Esc")} interrupt  ${c.dim("·")}  ${c.cyan("Ctrl+R")} history`, width),
  ].join("\n")
}

function narrowPanel(options: WelcomePanelOptions): string {
  return [
    fit(`${brand(options)}  ${c.bold("DeepSeek Harness")}`, options.columns),
    fit(`${c.blue(safe(options.model, Math.max(8, options.columns - 14)))}  ${c.dim("·")}  ${phaseText(options.phase)}`, options.columns),
    fit(`${c.cyan("Enter")} send  ${c.dim("·")}  ${c.cyan("Esc")} stop  ${c.dim("·")}  ${c.cyan("Ctrl+R")} history`, options.columns),
  ].join("\n")
}

export function welcomePanelText(options: WelcomePanelOptions): string {
  if (options.columns >= 96) return fullPanel(options)
  if (options.columns >= 60) return mediumPanel(options)
  if (options.columns >= 34) return narrowPanel(options)
  return fit(`dsh-tui  ${c.dim("·")}  ${phaseText(options.phase)}`, options.columns)
}

export function shouldExpandWelcome(state: Pick<AppState, "transcript">): boolean {
  return !state.transcript.some((item) => item.kind === "user")
}
