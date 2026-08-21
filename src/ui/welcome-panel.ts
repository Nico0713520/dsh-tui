import {
  Text,
  truncateToWidth,
  type Component,
  type TerminalCapabilities,
} from "@earendil-works/pi-tui"
import type { AppPhase, AppState } from "../controller.ts"
import type { MotionPreference } from "../config.ts"
import { brandLogoMode, createBrandLogo } from "./brand-logo.ts"
import type { DeepPulseTick } from "./deep-pulse.ts"
import type { UiTheme } from "./theme.ts"
import { WelcomeCard } from "./welcome-card.ts"

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

function phaseText(phase: AppPhase, theme: UiTheme): string {
  if (phase === "ready") return theme.fg("success", "ready")
  if (phase === "failed") return theme.fg("error", "failed")
  if (phase === "closing") return theme.fg("muted", "closing")
  return theme.fg("warning", phase)
}

export function compactIdentityText(options: CompactIdentityOptions): string {
  const width = Math.max(1, options.columns)
  if (width < 22) return fit(`dsh-tui · ${options.phase}`, width)
  const full = `${options.theme.strong(options.theme.fg("brand", "DeepSeek Harness"))} ${options.theme.fg("muted", "·")} ${options.theme.fg("brand", options.model)} ${options.theme.fg("muted", "·")} ${phaseText(options.phase, options.theme)}`
  const medium = `${options.theme.strong(options.theme.fg("brand", "DeepSeek Harness"))} ${options.theme.fg("muted", "·")} ${options.theme.fg("brand", options.model)}`
  return fit(width >= 58 ? full : medium, width)
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
    return new WelcomeCard({
      columns,
      logo: columns >= 48 ? this.logo(columns) : null,
      model: this.options.model,
      cwd: this.options.cwd,
      phase: this.options.phase,
      theme: this.options.theme,
    }).render(columns)
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
