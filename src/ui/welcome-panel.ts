import {
  HStack,
  Text,
  truncateToWidth,
  type Component,
  type TerminalCapabilities,
} from "@earendil-works/pi-tui"
import type { AppPhase, AppState } from "../controller.ts"
import type { MotionPreference } from "../config.ts"
import { sanitizeTerminalText, singleLine } from "../text.ts"
import { brandLogoMode, createBrandLogo } from "./brand-logo.ts"
import type { DeepPulseTick } from "./deep-pulse.ts"
import type { UiTheme } from "./theme.ts"

export interface WelcomePanelOptions {
  columns: number
  tick: DeepPulseTick
  motion: MotionPreference
  tty: boolean
  model: string
  cwd: string
  phase: AppPhase
  sessionId: string | null
  theme: UiTheme
}

export interface CompactIdentityOptions {
  columns: number
  model: string
  phase: AppPhase
  theme: UiTheme
}

function fit(text: string, columns: number): string {
  if (columns <= 0) return ""
  return truncateToWidth(text, columns, "…")
}

function safe(value: string, width: number): string {
  return singleLine(sanitizeTerminalText(value), Math.max(1, width))
}

function phaseText(phase: AppPhase, theme: UiTheme): string {
  if (phase === "ready") return theme.fg("success", "ready")
  if (phase === "failed") return theme.fg("error", "failed")
  if (phase === "closing") return theme.fg("muted", "closing")
  return theme.fg("warning", phase)
}

export function welcomePanelText(options: WelcomePanelOptions): string {
  const width = Math.max(1, options.columns)
  const title = `${options.theme.strong(options.theme.fg("brand", "DeepSeek Harness"))}  ${options.theme.fg("muted", "v0.1 · community TUI")}`
  const identity = `${options.theme.fg("brand", safe(options.model, Math.max(8, width - 24)))}  ${options.theme.fg("muted", "·")}  ${phaseText(options.phase, options.theme)}`
  if (width >= 96) {
    return [
      fit(title, width),
      fit(identity, width),
      fit(`${options.theme.fg("muted", "workspace")}  ${safe(options.cwd, width - 12)}`, width),
      fit(`${options.theme.fg("muted", "session")}    ${safe(options.sessionId ?? "creating…", 24)}  ${options.theme.fg("muted", "· workspace-write · approval ask")}`, width),
      fit(`${options.theme.fg("accent", "Enter")} send  ${options.theme.fg("muted", "·")}  ${options.theme.fg("accent", "Esc")} stop  ${options.theme.fg("muted", "·")}  ${options.theme.fg("accent", "Ctrl+R")} history  ${options.theme.fg("muted", "·")}  ${options.theme.fg("accent", "Ctrl+O")} tools  ${options.theme.fg("muted", "· /status")}`, width),
    ].join("\n")
  }
  if (width >= 60) {
    return [
      fit(title, width),
      fit(identity, width),
      fit(`${options.theme.fg("muted", "workspace")}  ${safe(options.cwd, width - 12)}`, width),
      fit(`${options.theme.fg("accent", "Enter")} send  ${options.theme.fg("muted", "·")}  ${options.theme.fg("accent", "Esc")} stop  ${options.theme.fg("muted", "·")}  ${options.theme.fg("accent", "Ctrl+R")} history`, width),
    ].join("\n")
  }
  if (width >= 34) {
    return [
      fit(options.theme.strong(options.theme.fg("brand", "DeepSeek Harness")), width),
      fit(identity, width),
      fit(`${options.theme.fg("accent", "Enter")} send  ${options.theme.fg("muted", "·")}  ${options.theme.fg("accent", "Esc")} stop`, width),
    ].join("\n")
  }
  return fit(`dsh-tui ${options.theme.fg("muted", "·")} ${phaseText(options.phase, options.theme)}`, width)
}

export function compactIdentityText(options: CompactIdentityOptions): string {
  const width = Math.max(1, options.columns)
  if (width < 22) return fit(`dsh-tui · ${options.phase}`, width)
  const full = `${options.theme.strong(options.theme.fg("brand", "DeepSeek Harness"))} ${options.theme.fg("muted", "·")} ${options.theme.fg("brand", options.model)} ${options.theme.fg("muted", "·")} ${phaseText(options.phase, options.theme)}`
  const medium = `${options.theme.strong(options.theme.fg("brand", "DeepSeek Harness"))} ${options.theme.fg("muted", "·")} ${options.theme.fg("brand", options.model)}`
  return fit(width >= 58 ? full : medium, width)
}

function welcomeRule(options: WelcomePanelOptions): string {
  const width = Math.max(1, options.columns)
  const rule = "─".repeat(width)
  if (!options.tty || options.motion !== "full" || options.tick.settled) {
    return options.theme.fg("border", rule)
  }
  const highlightWidth = Math.min(8, width)
  const travel = Math.max(1, width - highlightWidth)
  const start = Math.min(travel, Math.floor((options.tick.frame / 9) * travel))
  return `${options.theme.fg("border", rule.slice(0, start))}${options.theme.fg("borderFocus", rule.slice(start, start + highlightWidth))}${options.theme.fg("border", rule.slice(start + highlightWidth))}`
}

export class WelcomeTranscriptComponent implements Component {
  private options: WelcomePanelOptions & { expanded: boolean }
  private readonly capabilities: TerminalCapabilities
  private readonly assetPath: string | URL
  private readonly logoCache = new Map<string, Component | null>()

  constructor(options: WelcomePanelOptions & {
    expanded: boolean
    capabilities: TerminalCapabilities
    assetPath: string | URL
  }) {
    const { capabilities, assetPath, ...presentation } = options
    this.options = presentation
    this.capabilities = capabilities
    this.assetPath = assetPath
  }

  update(options: WelcomePanelOptions & { expanded: boolean }): void {
    this.options = options
  }

  render(width: number): string[] {
    const columns = Math.max(1, width)
    if (!this.options.expanded) {
      return new Text(compactIdentityText({
        columns,
        model: this.options.model,
        phase: this.options.phase,
        theme: this.options.theme,
      })).render(columns)
    }
    const presentation = { ...this.options, columns }
    const details = new Text(welcomePanelText(presentation))
    if (columns < 34) return details.render(columns)
    const logo = this.logo(columns)
    const hero = logo === null
      ? details
      : new HStack([
          { component: logo, basis: columns >= 96 ? 11 : 8, shrink: 0 },
          { component: details, grow: 1, minSize: 20 },
        ], { gap: columns >= 60 ? 3 : 2, align: "center" })
    return [...hero.render(columns), welcomeRule(presentation)]
  }

  invalidate(): void {
    for (const logo of this.logoCache.values()) logo?.invalidate()
  }

  private logo(columns: number): Component | null {
    const tier = columns >= 96 ? "full" : "compact"
    const key = `${brandLogoMode(this.capabilities, columns)}:${tier}`
    if (!this.logoCache.has(key)) {
      this.logoCache.set(key, createBrandLogo({
        capabilities: this.capabilities,
        assetPath: this.assetPath,
        columns,
        theme: this.options.theme,
      }))
    }
    return this.logoCache.get(key) ?? null
  }
}

export function shouldExpandWelcome(state: Pick<AppState, "transcript">): boolean {
  return !state.transcript.some((item) => item.kind === "user")
}
