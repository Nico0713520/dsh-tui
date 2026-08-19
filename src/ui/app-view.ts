import {
  Container,
  Editor,
  Markdown,
  ProcessTerminal,
  ScrollView,
  Text,
  TuiMainScreen,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui"
import type { ApprovalRequest, AppState, ControllerView, HistoryChoice, TranscriptItem } from "../controller.ts"
import type { PermissionDecision } from "../backend/acp-client.ts"
import type { SessionInfo } from "../backend/session-log.ts"
import type { MotionPreference, RunMode } from "../config.ts"
import { sanitizeTerminalText, singleLine } from "../text.ts"
import { c, markdownTheme, MARK_TOOL, MARK_TOOL_ERR, MARK_USER, selectTheme, STATUS_PREFIX, toolSummary } from "./theme.ts"
import { showModalList } from "./modal-list.ts"
import { createStreamingMarkdownView } from "./streaming-markdown.ts"
import { DeepPulseClock, ElapsedClock, deepPulseFrame, type DeepPulseTick } from "./deep-pulse.ts"
import { LatestRenderGate, type DrainSource } from "./render-backpressure.ts"

export interface ViewActions {
  onSubmit(text: string): void
  onDraft(text: string): void
  onLiveTextPaint(): void
  onCancel(): void
  onHistory(): void
  onClose(): void
}

export function headerText(columns: number, brand = "dsh-tui"): string {
  if (columns < 34) return ""
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
  const stableLabel = label.padEnd(16)
  const colorPhase = (value: string): string => state.phase === "failed" ? c.red(value)
    : state.phase === "ready" ? c.green(value)
      : state.phase === "closing" ? c.dim(value) : c.yellow(value)
  const phase = colorPhase(stableLabel)
  const tokens = state.usage.inputTokens || state.usage.outputTokens || state.usage.cacheReadTokens
    ? c.dim(`${state.usage.inputTokens ?? 0}in/${state.usage.outputTokens ?? 0}out/${state.usage.cacheReadTokens ?? 0}cached`)
    : ""
  const cost = state.costUsd === null ? c.dim("—") : c.dim(`$${state.costUsd.toFixed(6)}`)
  const session = state.sessionId ? c.dim(` · ${singleLine(state.sessionId, 8)}`) : ""
  const extra = options.notice || state.backendMessage || state.interruption || ""
  const width = Math.max(8, columns)
  const backend = options.mode === "echo" ? c.dim("echo") : c.blue(singleLine(options.model, 28))
  const compactBackendWidth = Math.max(1, width - visibleWidth(` ${label} · `))
  const compactBackend = options.mode === "echo"
    ? c.dim(singleLine("echo", compactBackendWidth))
    : c.blue(singleLine(options.model, compactBackendWidth))
  const elapsed = options.elapsedSeconds === undefined || (state.phase !== "working" && state.phase !== "cancelling")
    ? ""
    : c.dim(` · ${options.elapsedSeconds}s`)
  const full = extra
    ? `${STATUS_PREFIX} dsh-tui · ${backend} · ${colorPhase(label)} · ${c.dim(singleLine(extra, Math.max(1, columns - 18)))}\x1b[0m`
    : `${STATUS_PREFIX} dsh-tui · ${backend} · ${phase}${elapsed}${session} ${tokens} ${cost}\x1b[0m`
  const compact = extra
    ? `${STATUS_PREFIX} ${colorPhase(label)} · ${compactBackend} · ${c.dim(singleLine(extra, Math.max(1, columns)))}\x1b[0m`
    : `${STATUS_PREFIX} ${colorPhase(label)} · ${compactBackend}\x1b[0m`
  const phaseAndExtra = `${STATUS_PREFIX} ${colorPhase(label)}${extra ? ` · ${c.dim(singleLine(extra, Math.max(1, columns)))}` : ""}\x1b[0m`
  const best = [full, compact, phaseAndExtra].find((candidate) => visibleWidth(candidate) <= width) ?? phaseAndExtra
  return truncateToWidth(best, width, "…")
}

export function toolResultText(item: Extract<TranscriptItem, { kind: "tool-result" }>, columns: number): string {
  const prefix = item.isError ? MARK_TOOL_ERR : MARK_TOOL
  const textWidth = Math.max(1, columns - visibleWidth(prefix))
  const text = singleLine(item.text, textWidth)
  return `${prefix}${item.isError ? c.red(text) : c.dim(text)}`
}

export class PaintAwareContainer extends Container {
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
  private readonly partialAssistant = createStreamingMarkdownView({
    markdown: (text) => new Markdown(text, 1, 0, markdownTheme),
  })
  private readonly scroller = new ScrollView(this.transcript, { follow: "end" })
  private readonly header = new Text("")
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
  private readonly motion: MotionPreference
  private readonly tty: boolean
  private readonly pulseClock: DeepPulseClock
  private readonly elapsedClock: ElapsedClock
  private readonly renderGate: LatestRenderGate<AppState>
  private pulseTick: DeepPulseTick = { frame: 0, completion: false, settled: false }
  private elapsedSeconds = 0
  private preparedToStop = false

  constructor(options: {
    mode: RunMode
    model: string
    motion: MotionPreference
    tty?: boolean
    output?: DrainSource
  }) {
    this.mode = options.mode
    this.model = options.model
    this.motion = options.motion
    this.tty = options.tty ?? process.stdout.isTTY === true
    this.pulseClock = new DeepPulseClock(this.motion, (tick) => {
      this.pulseTick = tick
      this.updateHeader()
      this.tui.requestRender()
    })
    this.elapsedClock = new ElapsedClock((seconds) => {
      this.elapsedSeconds = seconds
      this.updateStatus()
      this.tui.requestRender()
    })
    this.renderGate = new LatestRenderGate(options.output ?? process.stdout, (state) => this.renderState(state))
    const editorTheme: EditorTheme = {
      borderColor: (text) => c.dim(text),
      selectList: selectTheme,
    }
    this.editor = new Editor(this.tui, editorTheme)
    this.transcript.addChild(this.committedTranscript)
    this.transcript.addChild(this.partialAssistant.element)
    this.tui.addChild(this.header)
    this.tui.addChild(this.scroller)
    this.tui.addChild(this.editor)
    this.tui.addChild(this.status)
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
    const extendsRendered = state.transcript.length >= this.renderedTranscript.length
      && this.renderedTranscript.every((item, index) => item === state.transcript[index])
    if (!extendsRendered) {
      this.committedTranscript.clear()
      for (const item of state.transcript) this.addTranscriptItem(item)
    } else {
      for (const item of state.transcript.slice(this.renderedTranscript.length)) this.addTranscriptItem(item)
    }
    this.renderedTranscript = [...state.transcript]
    this.partialAssistant.setText(sanitizeTerminalText(state.partialAssistantText))
    this.updateHeader()
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
        ? c.green(`Allow · ${singleLine(request.name, 32)}`)
        : c.red(`Reject · ${singleLine(request.name, 32)}`),
      description: singleLine(toolSummary(request.name, request.arguments, 52), 52),
    }))
    if (items.length === 0) return { outcome: "cancelled" }
    const selected = await showModalList(this.tui, `${request.stakes.toUpperCase()} approval`, items, Math.min(8, items.length))
    return selected === null ? { outcome: "cancelled" } : { outcome: "selected", optionId: selected }
  }

  async chooseHistory(items: readonly SessionInfo[]): Promise<HistoryChoice> {
    const choices = [
      { value: "__new__", label: c.green("+ New session"), description: "Create a real ACP session and clear the current transcript" },
      ...items.slice(0, 20).map((item) => ({
        value: item.id,
        label: singleLine(`${item.title || item.firstUserMessage || item.id.slice(0, 8)}`, 48),
        description: singleLine(`${new Intl.DateTimeFormat(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(item.mtimeMs)} · read-only`, 60),
      })),
    ]
    const selected = await showModalList(this.tui, "History", choices, Math.min(16, choices.length))
    if (selected === null) return { kind: "cancel" }
    return selected === "__new__" ? { kind: "new" } : { kind: "session", id: selected }
  }

  private addTranscriptItem(item: TranscriptItem): void {
    if (item.kind === "user") {
      this.committedTranscript.addChild(new Text(`${MARK_USER}${singleLine(item.text, Math.max(10, this.terminal.columns - 4))}`))
    } else if (item.kind === "assistant") {
      this.committedTranscript.addChild(new Markdown(sanitizeTerminalText(item.text), 1, 0, markdownTheme))
    } else if (item.kind === "tool-call") {
      this.committedTranscript.addChild(new Text(`${MARK_TOOL}${c.dim(toolSummary(item.name, item.arguments, this.terminal.columns))}`))
    } else if (item.kind === "tool-result") {
      this.committedTranscript.addChild(new Text(toolResultText(item, this.terminal.columns)))
    } else if (item.kind === "history-boundary") {
      this.committedTranscript.addChild(new Text(c.dim(singleLine(item.text, Math.max(10, this.terminal.columns - 2)))))
    } else {
      this.committedTranscript.addChild(new Text(c.red(`⚠ ${singleLine(item.text, Math.max(10, this.terminal.columns - 4))}`)))
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

  private updateHeader(): void {
    const brand = deepPulseFrame({
      columns: this.terminal.columns,
      frame: this.pulseTick.frame,
      motion: this.motion,
      tty: this.tty,
      completion: this.pulseTick.completion,
    })
    this.header.setText(headerText(this.terminal.columns, brand))
  }

  private updateStatus(): void {
    if (!this.currentState) return
    this.status.setText(statusText(this.currentState, {
      mode: this.mode,
      model: this.model,
      notice: this.notice,
      elapsedSeconds: this.elapsedSeconds,
    }, this.terminal.columns))
  }
}
