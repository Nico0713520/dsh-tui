import {
  Container,
  Editor,
  Markdown,
  ProcessTerminal,
  ScrollView,
  Text,
  TuiMainScreen,
  getCapabilities,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type EditorTheme,
  type TerminalCapabilities,
  type TUI,
} from "@earendil-works/pi-tui"
import type { ApprovalRequest, AppState, ControllerView, HistoryChoice, TranscriptItem } from "../controller.ts"
import type { PermissionDecision } from "../backend/acp-client.ts"
import type { SessionInfo } from "../backend/session-log.ts"
import type { MotionPreference, RunMode } from "../config.ts"
import type { ThemePreference } from "../preferences.ts"
import { sanitizeTerminalText, singleLine } from "../text.ts"
import { createUiTheme, toolSummary, type UiTheme } from "./theme.ts"
import { ThemeCanvas } from "./theme-canvas.ts"
import { showModalList } from "./modal-list.ts"
import { createStreamingMarkdownView } from "./streaming-markdown.ts"
import { DeepPulseClock, ElapsedClock, type DeepPulseTick } from "./deep-pulse.ts"
import { LatestRenderGate, type DrainSource } from "./render-backpressure.ts"
import { shouldExpandWelcome, WelcomeTranscriptComponent } from "./welcome-panel.ts"

export interface ViewActions {
  onSubmit(text: string): void
  onDraft(text: string): void
  onLiveTextPaint(): void
  onCancel(): void
  onHistory(): void
  onClose(): void
}

export function headerText(columns: number, brand = "dsh-tui"): string {
  if (columns < 34) return columns >= 7 ? "dsh-tui" : ""
  const raw = columns < 52
    ? `${brand} · Enter send · Ctrl+C ×2`
    : columns < 76
      ? `${brand} · Enter send · Esc stop · Ctrl+R History · Ctrl+C ×2`
      : `${brand} — Enter send · Esc interrupt · Ctrl+R History · Ctrl+C ×2 exit`
  return truncateToWidth(raw, columns, "…")
}

export function statusText(
  state: AppState,
  options: { mode: RunMode; model: string; notice?: string; elapsedSeconds?: number },
  columns: number,
  theme: UiTheme = createUiTheme("terminal"),
): string {
  const activity = state.activity.kind === "boot" ? `starting ${state.activity.stage}`
    : state.activity.kind === "tool" ? `tool ${singleLine(state.activity.name, 12)}`
      : state.activity.kind === "approval" ? `approval ${singleLine(state.activity.name, 9)}`
        : state.activity.kind
  const label = state.queuedPrompt !== null ? "queued"
    : state.phase === "starting" ? (state.activity.kind === "boot" ? `starting ${state.activity.stage}` : "starting")
      : state.phase === "cancelling" ? "cancelling"
      : state.phase === "failed" ? "failed"
        : state.phase === "closing" ? "closing"
          : state.phase === "ready" ? "ready" : activity
  const stableLabel = padToCellWidth(label, 16)
  const colorPhase = (value: string): string => state.phase === "failed" ? theme.fg("error", value)
    : state.phase === "ready" ? theme.fg("success", value)
      : state.phase === "closing" ? theme.fg("muted", value) : theme.fg("warning", value)
  const phase = colorPhase(stableLabel)
  const tokens = state.usage.inputTokens || state.usage.outputTokens || state.usage.cacheReadTokens
    ? theme.fg("muted", `${state.usage.inputTokens ?? 0}in/${state.usage.outputTokens ?? 0}out/${state.usage.cacheReadTokens ?? 0}cached`)
    : ""
  const cost = state.costUsd === null ? theme.fg("muted", "—") : theme.fg("muted", `$${state.costUsd.toFixed(6)}`)
  const session = state.sessionId ? theme.fg("muted", ` · ${singleLine(state.sessionId, 8)}`) : ""
  const extra = options.notice || state.backendMessage || state.interruption || ""
  const width = Math.max(8, columns)
  const backendName = options.mode === "echo" ? "echo" : options.model
  const styleBackend = (value: string): string => options.mode === "echo" ? theme.fg("muted", value) : theme.fg("brand", value)
  const backend = styleBackend(singleLine(backendName, 28))
  const compactLabelWidth = Math.max(4, Math.min(16, width - 10))
  const compactLabel = padToCellWidth(label, compactLabelWidth)
  const compactBackendWidth = Math.max(1, width - visibleWidth(` ${compactLabel} · `))
  const compactBackend = styleBackend(singleLine(backendName, compactBackendWidth))
  const extraLabelWidth = Math.max(4, Math.min(10, width - 16))
  const extraLabel = padToCellWidth(label, extraLabelWidth)
  const extraBudget = Math.max(2, width - visibleWidth(` ${extraLabel} ·  · `))
  const extraWidth = Math.max(1, Math.min(visibleWidth(extra), Math.floor(extraBudget / 2)))
  const extraBackendWidth = Math.max(1, extraBudget - extraWidth)
  const compactExtra = ` ${colorPhase(extraLabel)} · ${styleBackend(singleLine(backendName, extraBackendWidth))} · ${theme.fg("muted", singleLine(extra, extraWidth))}`
  const elapsed = options.elapsedSeconds === undefined || (state.phase !== "working" && state.phase !== "cancelling")
    ? ""
    : theme.fg("muted", ` · ${options.elapsedSeconds}s`)
  const full = extra
    ? ` dsh-tui · ${backend} · ${colorPhase(label)} · ${theme.fg("muted", singleLine(extra, Math.max(1, columns - 18)))}`
    : ` dsh-tui · ${backend} · ${phase}${elapsed}${session} ${tokens} ${cost}`
  const compact = extra
    ? compactExtra
    : ` ${colorPhase(compactLabel)} · ${compactBackend}`
  const phaseAndExtra = ` ${colorPhase(label)}${extra ? ` · ${theme.fg("muted", singleLine(extra, Math.max(1, columns)))}` : ""}`
  const best = [full, compact, phaseAndExtra].find((candidate) => visibleWidth(candidate) <= width) ?? phaseAndExtra
  return truncateToWidth(best, width, "…")
}

function padToCellWidth(text: string, width: number): string {
  const clipped = singleLine(text, width)
  return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`
}

export function toolResultText(
  item: Extract<TranscriptItem, { kind: "tool-result" }>,
  columns: number,
  theme: UiTheme = createUiTheme("terminal"),
): string {
  const prefix = item.isError ? `${theme.fg("error", "⚙✗")} ` : `${theme.fg("muted", "⚙")} `
  const textWidth = Math.max(1, columns - visibleWidth(prefix))
  const text = singleLine(item.text, textWidth)
  return `${prefix}${item.isError ? theme.fg("error", text) : theme.fg("muted", text)}`
}

class PaintAwareContainer extends Container {
  private pending = false
  private readonly onPaint: () => void

  constructor(onPaint: () => void) {
    super()
    this.onPaint = onPaint
  }

  markPending(): void {
    this.pending = true
  }

  clearPending(): void {
    this.pending = false
  }

  render(width: number): string[] {
    const lines = super.render(width)
    if (this.pending) {
      this.pending = false
      this.onPaint()
    }
    return lines
  }
}

export class AppView implements ControllerView {
  readonly terminal = new ProcessTerminal()
  readonly tui: TUI = new TuiMainScreen(this.terminal)
  private readonly transcript = new PaintAwareContainer(() => this.actions?.onLiveTextPaint())
  private readonly committedTranscript = new Container()
  private readonly partialAssistant: ReturnType<typeof createStreamingMarkdownView>
  private readonly scroller = new ScrollView(this.transcript, { follow: "end" })
  private readonly canvas: ThemeCanvas
  private readonly welcome: WelcomeTranscriptComponent
  private readonly status = new Text("")
  private readonly editor: Editor
  private actions: ViewActions | null = null
  private removeInputListener: (() => void) | null = null
  private notice = ""
  private lastCtrlC = 0
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  private currentState: AppState | null = null
  private renderedTranscript: readonly TranscriptItem[] = []
  private lastQueuedPrompt: string | null = null
  private readonly mode: RunMode
  private readonly model: string
  private readonly cwd: string
  private readonly motion: MotionPreference
  private readonly tty: boolean
  private readonly theme: UiTheme
  private readonly pulseClock: DeepPulseClock
  private readonly elapsedClock: ElapsedClock
  private readonly renderGate: LatestRenderGate<AppState>
  private pulseTick: DeepPulseTick = { frame: 0, completion: false, settled: false }
  private elapsedSeconds = 0
  private preparedToStop = false

  constructor(options: {
    mode: RunMode
    model: string
    cwd: string
    motion: MotionPreference
    theme?: ThemePreference
    color?: boolean
    tty?: boolean
    output?: DrainSource
    brandAssetPath: string | URL
    capabilities?: TerminalCapabilities
  }) {
    this.mode = options.mode
    this.model = options.model
    this.cwd = options.cwd
    this.motion = options.motion
    this.tty = options.tty ?? process.stdout.isTTY === true
    this.theme = createUiTheme(options.theme ?? "terminal", {
      color: options.color ?? !("NO_COLOR" in process.env),
    })
    this.partialAssistant = createStreamingMarkdownView({
      markdown: (text) => new Markdown(text, 1, 0, this.theme.markdown),
    })
    this.canvas = new ThemeCanvas(() => this.terminal.rows, this.theme)
    this.welcome = new WelcomeTranscriptComponent({
      expanded: true,
      capabilities: options.capabilities ?? getCapabilities(),
      assetPath: options.brandAssetPath,
      columns: this.terminal.columns,
      tick: this.pulseTick,
      motion: this.motion,
      tty: this.tty,
      model: this.model,
      cwd: this.cwd,
      phase: "starting",
      sessionId: null,
      theme: this.theme,
    })
    this.pulseClock = new DeepPulseClock(this.motion, (tick) => {
      this.pulseTick = tick
      this.updateWelcome()
      this.tui.requestRender()
    })
    this.elapsedClock = new ElapsedClock((seconds) => {
      this.elapsedSeconds = seconds
      this.updateStatus()
      this.tui.requestRender()
    })
    this.renderGate = new LatestRenderGate(options.output ?? process.stdout, (state) => this.renderState(state))
    this.tui.setClearOnShrink(true)
    const editorTheme: EditorTheme = {
      borderColor: (text) => this.theme.editorBorder(this.currentState?.phase ?? "starting", true, text),
      selectList: this.theme.select,
    }
    this.editor = new Editor(this.tui, editorTheme)
    this.transcript.addChild(this.welcome)
    this.transcript.addChild(this.committedTranscript)
    this.transcript.addChild(this.partialAssistant.element)
    this.canvas.addChild(this.scroller)
    this.canvas.addChild(this.editor)
    this.canvas.addChild(this.status)
    this.tui.addChild(this.canvas)
  }

  bind(actions: ViewActions): void {
    this.actions = actions
    this.editor.onSubmit = (text) => actions.onSubmit(text)
    this.editor.onChange = (text) => actions.onDraft(text)
    this.removeInputListener = this.tui.addInputListener((data) => this.handleGlobalInput(data))
  }

  start(): void {
    this.tui.setFocus(this.editor)
    this.pulseClock.start()
    this.tui.start()
  }

  stop(): void {
    this.prepareShutdown()
    this.dismissOverlays()
    if (this.theme.canvasBackground !== null) this.terminal.write("\x1b[0m")
    this.tui.stop()
  }

  prepareShutdown(): void {
    if (this.preparedToStop) return
    this.preparedToStop = true
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer)
    this.noticeTimer = null
    this.pulseClock.dispose()
    this.elapsedClock.dispose()
    this.renderGate.dispose()
    this.removeInputListener?.()
    this.removeInputListener = null
  }

  dismissOverlays(): void {
    while (this.tui.hasOverlay()) this.tui.hideOverlay()
  }

  render(state: AppState): void {
    const priority = state.phase === "ready" || state.phase === "failed" || state.phase === "closing"
    this.renderGate.submit(state, priority)
  }

  private renderState(state: AppState): void {
    const previous = this.currentState
    this.currentState = state
    const wasActive = previous?.phase === "working" || previous?.phase === "cancelling"
    const isActive = state.phase === "working" || state.phase === "cancelling"
    if (!wasActive && isActive) this.elapsedClock.start()
    else if (wasActive && !isActive) {
      this.elapsedClock.stop()
      this.elapsedSeconds = 0
    }
    if (previous && previous.phase !== "starting" && state.phase === "starting") this.pulseClock.start()
    if (previous?.phase === "starting" && state.phase === "ready") this.pulseClock.complete()
    if (state.queuedPrompt !== null) {
      if (this.editor.getText() !== state.queuedPrompt) this.editor.setText(state.queuedPrompt)
      this.lastQueuedPrompt = state.queuedPrompt
    } else if (this.lastQueuedPrompt !== null) {
      if (this.editor.getText() === this.lastQueuedPrompt) this.editor.setText("")
      this.lastQueuedPrompt = null
    }
    this.editor.disableSubmit = state.queuedPrompt !== null
      || state.phase === "working"
      || state.phase === "cancelling"
      || state.activeOverlay !== null
    const canReuseRendered = state.transcript.length >= this.renderedTranscript.length
      && this.renderedTranscript.every((item, index) => item === state.transcript[index]
        || (item.kind === "tool-call" && state.transcript[index]?.kind === "tool-result"
          && this.committedTranscript.children[index] instanceof Text))
    if (!canReuseRendered) {
      this.committedTranscript.clear()
      for (const item of state.transcript) this.addTranscriptItem(item)
    } else {
      for (let index = 0; index < this.renderedTranscript.length; index += 1) {
        const previousItem = this.renderedTranscript[index]
        const nextItem = state.transcript[index]
        const component = this.committedTranscript.children[index]
        if (previousItem !== nextItem && previousItem?.kind === "tool-call" && nextItem?.kind === "tool-result" && component instanceof Text) {
          component.setText(toolResultText(nextItem, this.terminal.columns, this.theme))
        }
      }
      for (const item of state.transcript.slice(this.renderedTranscript.length)) this.addTranscriptItem(item)
    }
    this.renderedTranscript = [...state.transcript]
    this.partialAssistant.setText(sanitizeTerminalText(state.partialAssistantText))
    this.updateWelcome()
    this.updateStatus()
    const committedLiveText = Boolean(previous?.partialAssistantText) && !state.partialAssistantText
    if (!previous?.partialAssistantText && state.partialAssistantText) this.transcript.markPending()
    else if (committedLiveText) {
      const latest = state.transcript.at(-1)
      if (latest?.kind !== "assistant") this.transcript.clearPending()
    }
    this.tui.requestRender(committedLiveText)
  }

  async requestApproval(request: ApprovalRequest): Promise<PermissionDecision> {
    const items = request.optionIds.map((optionId) => ({
      value: optionId,
      label: optionId.includes("allow")
        ? this.theme.fg("success", `Allow · ${singleLine(request.name, 32)}`)
        : this.theme.fg("error", `Reject · ${singleLine(request.name, 32)}`),
      description: singleLine(toolSummary(request.name, request.arguments, 52), 52),
    }))
    if (items.length === 0) return { outcome: "cancelled" }
    const selected = await showModalList(this.tui, `${request.stakes.toUpperCase()} approval`, items, Math.min(8, items.length), this.theme)
    return selected === null ? { outcome: "cancelled" } : { outcome: "selected", optionId: selected }
  }

  async chooseHistory(items: readonly SessionInfo[]): Promise<HistoryChoice> {
    const choices = [
      { value: "__new__", label: this.theme.fg("success", "+ New session"), description: "Create a real ACP session and clear the current transcript" },
      ...items.slice(0, 20).map((item) => ({
        value: item.id,
        label: singleLine(`${item.title || item.firstUserMessage || item.id.slice(0, 8)}`, 48),
        description: singleLine(`${new Intl.DateTimeFormat(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(item.mtimeMs)} · read-only`, 60),
      })),
    ]
    const selected = await showModalList(this.tui, "History", choices, Math.min(16, choices.length), this.theme)
    if (selected === null) return { kind: "cancel" }
    return selected === "__new__" ? { kind: "new" } : { kind: "session", id: selected }
  }

  private addTranscriptItem(item: TranscriptItem): void {
    if (item.kind === "user") {
      this.committedTranscript.addChild(new Text(`${this.theme.fg("brand", "›")} ${singleLine(item.text, Math.max(10, this.terminal.columns - 4))}`))
    } else if (item.kind === "assistant") {
      this.committedTranscript.addChild(new Markdown(sanitizeTerminalText(item.text), 1, 0, this.theme.markdown))
    } else if (item.kind === "tool-call") {
      this.committedTranscript.addChild(new Text(`${this.theme.fg("muted", "⚙")} ${this.theme.fg("muted", toolSummary(item.name, item.arguments, this.terminal.columns))}`))
    } else if (item.kind === "tool-result") {
      this.committedTranscript.addChild(new Text(toolResultText(item, this.terminal.columns, this.theme)))
    } else if (item.kind === "history-boundary") {
      this.committedTranscript.addChild(new Text(this.theme.fg("muted", singleLine(item.text, Math.max(10, this.terminal.columns - 2)))))
    } else {
      this.committedTranscript.addChild(new Text(this.theme.fg("error", `⚠ ${singleLine(item.text, Math.max(10, this.terminal.columns - 4))}`)))
    }
  }

  private handleGlobalInput(data: string): { consume?: boolean } | undefined {
    const actions = this.actions
    if (!actions) return undefined
    this.pulseClock.collapse()
    if (matchesKey(data, "ctrl+c")) {
      const now = Date.now()
      if (now - this.lastCtrlC < 1_500) actions.onClose()
      else {
        this.lastCtrlC = now
        this.notice = "Ctrl+C again to exit"
        if (this.currentState) this.render(this.currentState)
        if (this.noticeTimer !== null) clearTimeout(this.noticeTimer)
        this.noticeTimer = setTimeout(() => {
          this.notice = ""
          this.noticeTimer = null
          if (this.currentState) this.render(this.currentState)
        }, 1_500)
      }
      return { consume: true }
    }
    if (this.tui.hasOverlay()) return undefined
    if (matchesKey(data, "ctrl+r")) {
      actions.onHistory()
      return { consume: true }
    }
    if (matchesKey(data, "escape")) {
      actions.onCancel()
      return { consume: true }
    }
    return undefined
  }

  private updateWelcome(): void {
    const state = this.currentState
    this.welcome.update({
      expanded: state ? shouldExpandWelcome(state) : true,
      columns: this.terminal.columns,
      tick: this.pulseTick,
      motion: this.motion,
      tty: this.tty,
      model: this.model,
      cwd: this.cwd,
      phase: state?.phase ?? "starting",
      sessionId: state?.sessionId ?? null,
      theme: this.theme,
    })
    this.welcome.invalidate()
  }

  private updateStatus(): void {
    if (!this.currentState) return
    this.status.setText(statusText(this.currentState, {
      mode: this.mode,
      model: this.model,
      notice: this.notice,
      elapsedSeconds: this.elapsedSeconds,
    }, this.terminal.columns, this.theme))
  }
}
