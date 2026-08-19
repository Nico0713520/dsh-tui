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
import type { RunMode } from "../config.ts"
import { sanitizeTerminalText, singleLine } from "../text.ts"
import { c, markdownTheme, MARK_TOOL, MARK_TOOL_ERR, MARK_USER, selectTheme, STATUS_PREFIX, toolSummary } from "./theme.ts"
import { showModalList } from "./modal-list.ts"
import { createStreamingMarkdownView } from "./streaming-markdown.ts"

export interface ViewActions {
  onSubmit(text: string): void
  onDraft(text: string): void
  onCancel(): void
  onHistory(): void
  onClose(): void
}

export function headerText(columns: number): string {
  if (columns < 52) return "dsh-tui · Enter send · Ctrl+R · Ctrl+C ×2"
  if (columns < 76) return "dsh-tui · Enter send · Esc stop · Ctrl+R History · Ctrl+C ×2"
  return "dsh-tui — Enter send · Esc interrupt · Ctrl+R History · Ctrl+C ×2 exit"
}

export function statusText(
  state: AppState,
  options: { mode: RunMode; model: string; notice?: string },
  columns: number,
): string {
  const phase = state.phase === "starting" ? c.yellow("starting…")
    : state.phase === "working" ? c.yellow("working…")
      : state.phase === "cancelling" ? c.yellow("cancelling…")
        : state.phase === "failed" ? c.red("failed")
          : state.phase === "closing" ? c.dim("closing") : c.green("ready")
  const tokens = state.usage.inputTokens || state.usage.outputTokens || state.usage.cacheReadTokens
    ? c.dim(`${state.usage.inputTokens ?? 0}in/${state.usage.outputTokens ?? 0}out/${state.usage.cacheReadTokens ?? 0}cached`)
    : ""
  const cost = state.costUsd === null ? c.dim("—") : c.dim(`$${state.costUsd.toFixed(6)}`)
  const session = state.sessionId ? c.dim(` · ${singleLine(state.sessionId, 8)}`) : ""
  const extra = options.notice || state.backendMessage || ""
  const backend = options.mode === "echo" ? c.dim("echo") : c.blue(singleLine(options.model, 28))
  const raw = extra
    ? `${STATUS_PREFIX} dsh-tui · ${phase} · ${c.dim(singleLine(extra, Math.max(1, columns - 16)))}\x1b[0m`
    : `${STATUS_PREFIX} dsh-tui · ${backend} · ${phase}${session} ${tokens} ${cost}\x1b[0m`
  return truncateToWidth(raw, Math.max(8, columns), "…")
}

export function toolResultText(item: Extract<TranscriptItem, { kind: "tool-result" }>, columns: number): string {
  const prefix = item.isError ? MARK_TOOL_ERR : MARK_TOOL
  const textWidth = Math.max(1, columns - visibleWidth(prefix))
  const text = singleLine(item.text, textWidth)
  return `${prefix}${item.isError ? c.red(text) : c.dim(text)}`
}

export class AppView implements ControllerView {
  readonly terminal = new ProcessTerminal()
  readonly tui: TUI = new TuiMainScreen(this.terminal)
  private readonly transcript = new Container()
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

  constructor(options: { mode: RunMode; model: string }) {
    this.mode = options.mode
    this.model = options.model
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
    this.tui.start()
  }

  stop(): void {
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer)
    this.noticeTimer = null
    this.removeInputListener?.()
    this.removeInputListener = null
    this.tui.stop()
  }

  render(state: AppState): void {
    this.currentState = state
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
    this.header.setText(c.bold(headerText(this.terminal.columns)))
    this.status.setText(statusText(state, { mode: this.mode, model: this.model, notice: this.notice }, this.terminal.columns))
    this.tui.requestRender()
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
}
