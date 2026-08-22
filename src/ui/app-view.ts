import {
  Container,
  Editor,
  Markdown,
  ProcessTerminal,
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
import { createUiTheme, type UiTheme } from "./theme.ts"
import { ThemeCanvas } from "./theme-canvas.ts"
import { showModalList } from "./modal-list.ts"
import { createStreamingMarkdownView } from "./streaming-markdown.ts"
import { ElapsedClock, VisualClock, type DeepPulseTick } from "./deep-pulse.ts"
import { LatestRenderGate, type DrainSource } from "./render-backpressure.ts"
import { WelcomeTranscriptComponent } from "./welcome-panel.ts"
import {
  renderAssistantMessage,
  renderDiagnostic,
  renderHistoryBoundary,
  renderInterruptedAssistant,
  renderUserMessage,
} from "./transcript-components.ts"
import { activityLineText, thinkingTraceText } from "./activity-line.ts"
import { ToolCardComponent, toolCardComponent } from "./tool-card.ts"
import { footerText, type FooterOptions } from "./footer.ts"
import { showApprovalPanel } from "./approval-panel.ts"
import { showModalPanel } from "./modal-panel.ts"
import { sessionPanelText } from "./session-panel.ts"

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
  options: FooterOptions,
  columns: number,
  theme: UiTheme = createUiTheme("terminal"),
): string {
  return footerText(state, options, columns, theme)
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
  private readonly activeActivity = new Text("", 1, 0)
  private readonly partialAssistant: ReturnType<typeof createStreamingMarkdownView>
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
  private readonly pulseClock: VisualClock
  private readonly elapsedClock: ElapsedClock
  private readonly renderGate: LatestRenderGate<AppState>
  private pulseTick: DeepPulseTick = { frame: 0, completion: false, settled: false }
  private elapsedSeconds = 0
  private toolDetailsExpanded = false
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
    this.pulseClock = new VisualClock(this.motion, (tick) => {
      this.pulseTick = tick
      this.updateWelcome()
      this.updateActivity()
      for (const component of this.committedTranscript.children) {
        if (component instanceof ToolCardComponent) component.setFrame(tick.frame)
      }
      this.tui.requestRender()
    })
    this.elapsedClock = new ElapsedClock((seconds) => {
      this.elapsedSeconds = seconds
      this.updateActivity()
      this.updateStatus()
      this.tui.requestRender()
    })
    this.renderGate = new LatestRenderGate(options.output ?? process.stdout, (state) => this.renderState(state))
    this.tui.setClearOnShrink(true)
    const editorTheme: EditorTheme = {
      borderColor: (text) => {
        if (this.currentState?.activeOverlay === "approval") return this.theme.fg("warning", text)
        return this.theme.editorBorder(
          this.currentState?.phase ?? "starting",
          this.currentState?.activeOverlay === null,
          text,
        )
      },
      selectList: this.theme.select,
    }
    this.editor = new Editor(this.tui, editorTheme)
    this.transcript.addChild(this.welcome)
    this.transcript.addChild(this.committedTranscript)
    this.transcript.addChild(this.activeActivity)
    this.transcript.addChild(this.partialAssistant.element)
    this.canvas.addChild(this.transcript)
    this.canvas.addChild(this.editor)
    this.canvas.addChild(this.status)
    this.tui.addChild(this.canvas)
  }

  bind(actions: ViewActions): void {
    this.actions = actions
    this.editor.onSubmit = (text) => {
      if (text.trim() === "/status") {
        this.openSessionPanel()
        return
      }
      actions.onSubmit(text)
    }
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
    const toolCompleted = this.currentState?.transcript.some((item, index) => (
      item.kind === "tool-call" && state.transcript[index]?.kind === "tool-result"
    )) ?? false
    const priority = state.phase === "ready" || state.phase === "failed" || state.phase === "closing" || toolCompleted
    this.renderGate.submit(state, priority)
  }

  private renderState(state: AppState): void {
    const previous = this.currentState
    this.currentState = state
    this.pulseClock.setActive(
      state.phase === "working"
      && (state.activity.kind === "thinking" || state.activity.kind === "responding" || state.activity.kind === "tool"),
    )
    this.pulseClock.setOccluded(state.activeOverlay !== null)
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
          && this.committedTranscript.children[index] instanceof ToolCardComponent))
    if (!canReuseRendered) {
      this.committedTranscript.clear()
      for (const item of state.transcript) this.addTranscriptItem(item)
    } else {
      for (let index = 0; index < this.renderedTranscript.length; index += 1) {
        const previousItem = this.renderedTranscript[index]
        const nextItem = state.transcript[index]
        const component = this.committedTranscript.children[index]
        if (previousItem !== nextItem && previousItem?.kind === "tool-call" && nextItem?.kind === "tool-result" && component instanceof ToolCardComponent) {
          component.setItem(nextItem)
        }
      }
      for (const item of state.transcript.slice(this.renderedTranscript.length)) this.addTranscriptItem(item)
    }
    this.renderedTranscript = [...state.transcript]
    this.partialAssistant.setText(sanitizeTerminalText(state.partialAssistantText))
    this.updateWelcome()
    this.updateActivity()
    this.updateStatus()
    const committedLiveText = Boolean(previous?.partialAssistantText) && !state.partialAssistantText
    if (!previous?.partialAssistantText && state.partialAssistantText) this.transcript.markPending()
    else if (committedLiveText) {
      const latest = state.transcript.at(-1)
      if (latest?.kind !== "assistant") this.transcript.clearPending()
    }
    this.tui.requestRender(committedLiveText)
  }

  async requestApproval(request: ApprovalRequest, signal?: AbortSignal): Promise<PermissionDecision> {
    if (request.optionIds.length === 0) return { outcome: "cancelled" }
    this.pulseClock.setOccluded(true)
    try {
      const selected = await showApprovalPanel(this.tui, request, this.theme, signal)
      return selected === null ? { outcome: "cancelled" } : { outcome: "selected", optionId: selected }
    } finally {
      this.pulseClock.setOccluded(false)
    }
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
    this.pulseClock.setOccluded(true)
    const selected = await showModalList(this.tui, "History", choices, Math.min(16, choices.length), this.theme)
      .finally(() => this.pulseClock.setOccluded(false))
    if (selected === null) return { kind: "cancel" }
    return selected === "__new__" ? { kind: "new" } : { kind: "session", id: selected }
  }

  private addTranscriptItem(item: TranscriptItem): void {
    if (item.kind === "user") {
      this.committedTranscript.addChild(renderUserMessage(item.text, this.theme))
    } else if (item.kind === "assistant") {
      this.committedTranscript.addChild(renderAssistantMessage(item.text, this.theme))
    } else if (item.kind === "interrupted-assistant") {
      this.committedTranscript.addChild(renderInterruptedAssistant(item.text, item.reason, this.theme))
    } else if (item.kind === "thinking-trace") {
      this.committedTranscript.addChild(new Text(thinkingTraceText(item.durationMs, this.terminal.columns, this.theme), 0, 0))
    } else if (item.kind === "tool-call" || item.kind === "tool-result") {
      this.committedTranscript.addChild(toolCardComponent(item, {
        expanded: this.toolDetailsExpanded,
        frame: this.pulseTick.frame,
        theme: this.theme,
      }))
    } else if (item.kind === "history-boundary") {
      this.committedTranscript.addChild(renderHistoryBoundary(item.text, this.theme))
    } else {
      this.committedTranscript.addChild(renderDiagnostic(item.text, this.theme))
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
    if (matchesKey(data, "ctrl+o")) {
      this.toolDetailsExpanded = !this.toolDetailsExpanded
      for (const component of this.committedTranscript.children) {
        if (component instanceof ToolCardComponent) component.setExpanded(this.toolDetailsExpanded)
      }
      this.notice = this.toolDetailsExpanded ? "tool details expanded" : "tool details compact"
      this.updateStatus()
      this.tui.requestRender(true)
      if (this.noticeTimer !== null) clearTimeout(this.noticeTimer)
      this.noticeTimer = setTimeout(() => {
        this.notice = ""
        this.noticeTimer = null
        this.updateStatus()
        this.tui.requestRender()
      }, 1_200)
      this.noticeTimer.unref?.()
      return { consume: true }
    }
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
      cwd: this.cwd,
      notice: this.notice,
      elapsedSeconds: this.elapsedSeconds,
    }, this.terminal.columns, this.theme))
  }

  private updateActivity(): void {
    if (!this.currentState) return
    this.activeActivity.setText(activityLineText(this.currentState.activity, {
      columns: this.terminal.columns,
      frame: this.pulseTick.frame,
      elapsedSeconds: this.elapsedSeconds,
      theme: this.theme,
    }))
  }

  private openSessionPanel(): void {
    if (!this.currentState || this.tui.hasOverlay()) return
    const columns = Math.max(24, Math.floor(this.terminal.columns * 0.7) - 2)
    this.pulseClock.setOccluded(true)
    showModalPanel(
      this.tui,
      "Session",
      sessionPanelText({
        state: this.currentState,
        model: this.model,
        cwd: this.cwd,
        mode: this.mode,
        motion: this.motion,
        theme: this.theme,
        columns,
      }),
      this.theme,
      () => {
        this.pulseClock.setOccluded(false)
        this.tui.requestRender(true)
      },
    )
    this.tui.requestRender(true)
  }
}
