import {
  type Component,
  type TerminalCapabilities,
} from "@earendil-works/pi-tui"
import type { AppPhase } from "../controller.ts"
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

export class WelcomeTranscriptComponent implements Component {
  private options: WelcomePanelOptions
  private readonly capabilities: TerminalCapabilities
  private readonly assetPath: string | URL
  private readonly logoCache = new Map<string, Component | null>()
  private cachedWidth: number | null = null
  private cachedLines: string[] | null = null

  constructor(options: WelcomePanelOptions & {
    capabilities: TerminalCapabilities
    assetPath: string | URL
  }) {
    const { capabilities, assetPath, ...presentation } = options
    this.options = presentation
    this.capabilities = capabilities
    this.assetPath = assetPath
  }

  update(options: WelcomePanelOptions): void {
    const presentationChanged = options.model !== this.options.model
      || options.cwd !== this.options.cwd
      || options.phase !== this.options.phase
      || options.theme !== this.options.theme
    this.options = options
    if (presentationChanged) this.clearRenderCache()
  }

  render(width: number): string[] {
    const columns = Math.max(1, width)
    if (this.cachedLines !== null && this.cachedWidth === columns) return this.cachedLines
    this.cachedWidth = columns
    this.cachedLines = new WelcomeCard({
      columns,
      logo: columns >= 48 ? this.logo(columns) : null,
      model: this.options.model,
      cwd: this.options.cwd,
      phase: this.options.phase,
      theme: this.options.theme,
    }).render(columns)
    return this.cachedLines
  }

  invalidate(): void {
    this.clearRenderCache()
    for (const logo of this.logoCache.values()) logo?.invalidate()
  }

  private clearRenderCache(): void {
    this.cachedWidth = null
    this.cachedLines = null
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
