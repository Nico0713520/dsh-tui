import {
  Container,
  Editor,
  Markdown,
  ProcessTerminal,
  ScrollView,
  Text,
  TuiMainScreen,
  matchesKey,
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

export interface ViewActions {
  onSubmit(text: string): void
  onCancel(): void
  onHistory(): void
  onClose(): void
}

export class AppView implements ControllerView {
  readonly terminal = new ProcessTerminal()
  readonly tui: TUI = new TuiMainScreen(this.terminal)
  private readonly transcript = new Container()
  private readonly scroller = new ScrollView(this.transcript, { follow: "end" })
  private readonly status = new Text("")
  private readonly editor: Editor
  private actions: ViewActions | null = null
  private removeInputListener: (() => void) | null = null
  private notice = ""
  private lastCtrlC = 0
  private currentState: AppState | null = null
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
    this.tui.addChild(new Text(`${c.bold("dsh-tui")} ${c.dim("— Enter send · Esc interrupt · Ctrl+R History · Ctrl+C ×2 exit")}`))
    this.tui.addChild(this.scroller)
    this.tui.addChild(this.editor)
    this.tui.addChild(this.status)
  }

  bind(actions: ViewActions): void {
    this.actions = actions
    this.editor.onSubmit = (text) => actions.onSubmit(text)
    this.removeInputListener = this.tui.addInputListener((data) => this.handleGlobalInput(data))
  }

  start(): void {
    this.tui.setFocus(this.editor)
    this.tui.start()
  }

  stop(): void {
    this.removeInputListener?.()
    this.removeInputListener = null
    this.tui.stop()
  }

  render(state: AppState): void {
    this.currentState = state
    this.transcript.clear()
    for (const item of state.transcript) this.addTranscriptItem(item)
    if (state.partialAssistantText) {
      this.transcript.addChild(new Markdown(sanitizeTerminalText(state.partialAssistantText), 1, 0, markdownTheme))
    }
    this.status.setText(this.renderStatus(state))
    this.tui.requestRender()
  }

  async requestApproval(request: ApprovalRequest): Promise<PermissionDecision> {
    const items = request.optionIds.map((optionId) => ({
      value: optionId,
      label: optionId.includes("allow")
        ? c.green(`Allow · ${request.name}`)
        : c.red(`Reject · ${request.name}`),
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
      this.transcript.addChild(new Text(`${MARK_USER}${singleLine(item.text, Math.max(10, this.terminal.columns - 4))}`))
    } else if (item.kind === "assistant") {
      this.transcript.addChild(new Markdown(sanitizeTerminalText(item.text), 1, 0, markdownTheme))
    } else if (item.kind === "tool-call") {
      this.transcript.addChild(new Text(`${MARK_TOOL}${c.dim(toolSummary(item.name, item.arguments, this.terminal.columns))}`))
    } else if (item.kind === "tool-result") {
      const prefix = item.isError ? MARK_TOOL_ERR : MARK_TOOL
      this.transcript.addChild(new Text(`${prefix}${item.isError ? c.red(singleLine(item.text, 76)) : c.dim(singleLine(item.text, 76))}`))
    } else if (item.kind === "history-boundary") {
      this.transcript.addChild(new Text(c.dim(singleLine(item.text, Math.max(10, this.terminal.columns - 2)))))
    } else {
      this.transcript.addChild(new Text(c.red(`⚠ ${singleLine(item.text, Math.max(10, this.terminal.columns - 4))}`)))
    }
  }

  private renderStatus(state: AppState): string {
    const phase = state.phase === "working" ? c.yellow("working…")
      : state.phase === "cancelling" ? c.yellow("cancelling…")
        : state.phase === "failed" ? c.red("failed")
          : state.phase === "closing" ? c.dim("closing") : c.green("ready")
    const tokens = state.usage.inputTokens || state.usage.outputTokens || state.usage.cacheReadTokens
      ? c.dim(`${state.usage.inputTokens ?? 0}in/${state.usage.outputTokens ?? 0}out/${state.usage.cacheReadTokens ?? 0}cached`)
      : ""
    const cost = state.costUsd === null ? c.dim("—") : c.dim(`$${state.costUsd.toFixed(6)}`)
    const session = state.sessionId ? c.dim(` · ${state.sessionId.slice(0, 8)}`) : ""
    const extra = this.notice || state.backendMessage || ""
    const backend = this.mode === "echo" ? c.dim("echo") : c.blue(singleLine(this.model, 28))
    return `${STATUS_PREFIX} dsh-tui · ${backend} · ${phase}${session} ${tokens} ${cost}${extra ? ` ${c.dim(singleLine(extra, 50))}` : ""}\x1b[0m`
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
