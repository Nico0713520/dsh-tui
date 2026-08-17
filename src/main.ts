/**
 * dsh-tui — Terminal client for DeepSeek Harness.
 * Rendering: @earendil-works/pi-tui (MIT) — Markdown, overlays, SelectList.
 * Backend: dsh ACP (JSON-RPC stdio) + session-log watch for tool activity.
 * Policy/cost: ported from CodeWhale approval/policy.rs + pricing.rs (MIT).
 */
import {
  ProcessTerminal, TuiMainScreen, Text, Container, ScrollView, Editor, SelectList, Markdown,
  matchesKey, truncateToWidth,
  type TUI, type EditorTheme, type OverlayHandle, type MarkdownTheme,
} from "@earendil-works/pi-tui"
import { AcpClient, type AcpEvents } from "./acp.ts"
import { SessionLogWatcher } from "./logwatch.ts"
import { classifyStakes, estimateCostUsd, type Usage } from "./policy.ts"
import { listSessions, loadReplay } from "./sessions.ts"
import { MARK_USER, MARK_TOOL, MARK_TOOL_ERR, STATUS_PREFIX, c, toolSummary } from "./theme.ts"

const terminal = new ProcessTerminal()
const tui: TUI = new TuiMainScreen(terminal)

// ---------------------------------------------------------------- config
const MODE = process.env.DSH_TUI_MODE ?? "echo"
const MODEL = process.env.DSH_MODEL ?? "deepseek-v4-flash"
const PERSIST_ROOT = process.env.DSH_PERSIST_ROOT ?? "E:\\Desktop\\deepseek\\dsh-tui\\.sessions-dshtui"
const TOOL_CARDS = process.env.DSH_TOOL_CARDS !== "off"
const DEFAULT_ACP_CMD = [
  "node",
  "E:\\Desktop\\deepseek\\refs-dsh\\packages\\examples\\acp-demo\\src\\bin.ts",
  "--config",
  "E:\\Desktop\\deepseek\\refs-dsh\\examples\\acp-agent\\dshtui.cordis.yml",
]

// ---------------------------------------------------------------- state
let busy = false
let lastCtrlC = 0
let sessionUsage: Usage = {}
let sessionCost = 0
let shuttingDown = false

// ---------------------------------------------------------------- markdown theme (pi's default, ported)
const mdTheme: MarkdownTheme = {
  heading: (t) => c.bold(c.cyan(t)),
  link: (t) => c.blue(t),
  linkUrl: (t) => c.dim(t),
  code: (t) => c.yellow(t),
  codeBlock: (t) => c.green(t),
  codeBlockBorder: (t) => c.dim(t),
  quote: (t) => "\x1b[3m" + t + "\x1b[0m",
  quoteBorder: (t) => c.dim(t),
  hr: (t) => c.dim(t),
  listBullet: (t) => c.cyan(t),
  bold: (t) => c.bold(t),
  italic: (t) => "\x1b[3m" + t + "\x1b[0m",
  strikethrough: (t) => "\x1b[9m" + t + "\x1b[0m",
  underline: (t) => "\x1b[4m" + t + "\x1b[0m",
}

// ---------------------------------------------------------------- layout
const transcript = new Container()
const scroller = new ScrollView(transcript, { follow: "end" })
const editorTheme: EditorTheme = {
  borderColor: (s) => c.dim(s),
  selectList: { selectedPrefix: c.cyan("> "), unselectedPrefix: "  ", selectedSuffix: "", unselectedSuffix: "" } as any,
}
const editor = new Editor(tui, editorTheme)
const status = new Text("")

function setStatus(extra = "") {
  const tok = sessionUsage.outputTokens ? `${c.dim(`${sessionUsage.inputTokens ?? 0}in/${sessionUsage.outputTokens}out`)}` : ""
  const cost = sessionCost > 0 ? ` ${c.dim("$" + sessionCost.toFixed(4))}` : ""
  const left = ` dsh-tui ${c.dim("·")} ${MODE === "acp" ? c.blue(MODEL) : c.dim("echo")} ${c.dim("·")} ${busy ? c.yellow("working…") : c.green("ready")}${tok ? " " + tok : ""}${cost}`
  status.setText(truncateToWidth(STATUS_PREFIX + left + (extra ? " " + c.dim(extra) : ""), terminal.columns) + "\x1b[0m")
}

tui.addChild(new Text(`${c.bold("dsh-tui")} ${c.dim("— Enter send · Esc interrupt · Ctrl+R sessions · Ctrl+C ×2 exit")}`))

// ---------------------------------------------------------------- streams
let streamMd: Markdown | null = null
let streamText = ""
function beginAssistant(): Markdown {
  streamText = ""
  const m = new Markdown("", 1, 0, mdTheme)
  transcript.addChild(m)
  return m
}
function appendChunk(chunk: string) {
  streamText += chunk
  streamMd?.setText(streamText)
  tui.requestRender()
}
function addUser(text: string) {
  transcript.addChild(new Text(MARK_USER + text.replace(/\n/g, " ")))
}
function addToolCard(name: string, args: string) {
  transcript.addChild(new Text(`${MARK_TOOL}${c.dim(toolSummary(name, args, terminal.columns))}`))
  tui.requestRender()
}
function addToolResult(text: string, isError: boolean) {
  const oneLine = text.split("\n").filter(Boolean).slice(-1)[0] ?? ""
  transcript.addChild(new Text(`${isError ? MARK_TOOL_ERR : MARK_TOOL}${isError ? c.red(oneLine) : c.dim(oneLine.slice(0, 76))}`))
  tui.requestRender()
}
function addErrorCard(msg: string) {
  transcript.addChild(new Text(c.red("⚠ ") + msg.replace(/\n/g, " ").slice(0, 120)))
  tui.requestRender()
}

// ---------------------------------------------------------------- session picker overlay (Ctrl+R)
function showSessionPicker() {
  const sessions = listSessions(PERSIST_ROOT, process.cwd())
  if (!sessions.length) {
    addErrorCard("no past sessions in this workspace yet")
    return
  }
  const items = sessions.slice(0, 20).map((s) => {
    const when = new Date(s.mtime).toLocaleString("MM-dd HH:mm")
    const label = s.title || s.firstUserMsg || s.id.slice(0, 8)
    return { id: s.id, primary: `${c.dim(when)} ${label.slice(0, 44)}` }
  })
  items.unshift({ id: "__new__", primary: c.green("+ new session") })
  const list = new SelectList(items, tui)
  list.onSelect = (item: any) => {
    handle.hide()
    if (item.id === "__new__") return
    replaySession(item.id)
  }
  const box = new Container()
  box.addChild(new Text(c.bold(c.cyan("Sessions")) + c.dim("  ↑↓ select · Enter replay · Esc close")))
  box.addChild(new Text(""))
  box.addChild(list)
  const handle: OverlayHandle = tui.showOverlay(box, { width: 60, maxHeight: 16 })
}

function replaySession(id: string) {
  const entries = loadReplay(PERSIST_ROOT, process.cwd(), id)
  if (!entries.length) {
    addErrorCard("session log unreadable or empty")
    return
  }
  transcript.addChild(new Text(c.dim(`── replay ${id.slice(0, 8)} (${entries.length} entries) ──`)))
  for (const e of entries) {
    if (e.kind === "user") transcript.addChild(new Text(MARK_USER + e.text.replace(/\n/g, " ").slice(0, 100)))
    else if (e.kind === "assistant") transcript.addChild(new Markdown(e.text, 1, 0, mdTheme))
    else transcript.addChild(new Text(`${MARK_TOOL}${c.dim(e.text.slice(0, 76))}`))
  }
  transcript.addChild(new Text(c.dim(`── end replay · new messages start a fresh session ──`)))
  tui.requestRender()
}

// ---------------------------------------------------------------- approval overlay
function askApproval(toolCallId: string, optionIds: string[]): Promise<string> {
  return new Promise((resolve) => {
    const info = watcher.lookupCall(toolCallId)
    const name = info?.name ?? "tool"
    let parsedArgs: any = {}
    try { parsedArgs = JSON.parse(info?.args ?? "{}") } catch {}
    const summary = info ? toolSummary(info.name, info.args, 58) : toolCallId.slice(0, 24)
    const stakes = classifyStakes(name, parsedArgs)

    const stakesLine =
      stakes === "critical" ? c.red("● critical — destructive/irreversible action")
      : stakes === "elevated" ? c.yellow("● elevated — modifies state")
      : c.dim("○ routine — read-only")

    const items = optionIds.map((id) => ({
      id,
      primary: id.includes("allow")
        ? (stakes === "critical" ? c.yellow(`y ${name}: ${summary}`.slice(0, 44)) : c.green(`y ${name}: ${summary}`.slice(0, 44)))
        : c.red("n Reject"),
    }))
    if (!items.length) items.push({ id: "allow-once", primary: c.green("y Allow once") })
    const list = new SelectList(items, tui)
    list.onSelect = (item: any) => {
      handle.hide()
      resolve(item.id)
    }
    const box = new Container()
    box.addChild(new Text(stakes === "critical" ? c.bold(c.red("⚠ CRITICAL approval")) : c.bold(c.yellow("⚠ Approval requested"))))
    box.addChild(new Text(`${c.bold(name)} ${c.dim(summary)}`))
    box.addChild(new Text(stakesLine))
    box.addChild(new Text(""))
    box.addChild(list)
    const handle: OverlayHandle = tui.showOverlay(box, { width: 48, maxHeight: 9 })
  })
}

// ---------------------------------------------------------------- backend
const watcher = new SessionLogWatcher()
const acp: AcpEvents = {
  onChunk(chunk) {
    if (!streamMd) streamMd = beginAssistant()
    appendChunk(chunk)
  },
  onTurnEnd() {
    streamMd = null
    busy = false
    setStatus()
  },
  onSession(id) {
    setStatus(`(session ${id.slice(0, 8)})`)
    if (MODE === "acp" && TOOL_CARDS) {
      watcher.watch(PERSIST_ROOT, process.cwd(), id, {
        onToolCall: (name, args) => addToolCard(name, args),
        onToolResult: (_n, text, err) => addToolResult(text, err),
        onUsage: (u) => {
          sessionUsage = {
            inputTokens: (sessionUsage.inputTokens ?? 0) + (u.inputTokens ?? 0),
            outputTokens: (sessionUsage.outputTokens ?? 0) + (u.outputTokens ?? 0),
            cacheReadTokens: (sessionUsage.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0),
          }
          sessionCost = estimateCostUsd(MODEL, sessionUsage)
          setStatus()
        },
      })
    }
  },
  onError(err) {
    addErrorCard(err)
    busy = false
    setStatus()
  },
  onRestart(attempt) {
    addErrorCard(`backend restarted (attempt ${attempt}), replaying your message`)
  },
  onPermission(toolCallId, optionIds, respond) {
    void askApproval(toolCallId, optionIds).then(respond)
  },
}
let client: AcpClient | null =
  MODE === "acp"
    ? new AcpClient({
        model: MODEL,
        command: process.env.DSH_ACP_CMD?.split(" ") ?? DEFAULT_ACP_CMD,
        events: acp,
      })
    : null

async function send(text: string) {
  addUser(text)
  busy = true
  setStatus()
  if (!client) {
    streamMd = beginAssistant()
    const reply = `[echo] ${text} → 设置 DSH_TUI_MODE=acp 连接真实后端。`
    let i = 0
    const timer = setInterval(() => {
      appendChunk(reply.slice(i, i + 3))
      i += 3
      if (i >= reply.length) {
        clearInterval(timer)
        streamMd = null
        busy = false
        setStatus()
      }
    }, 30)
    return
  }
  try {
    await client.prompt(text)
  } catch (e) {
    addErrorCard(String(e))
    streamMd = null
    busy = false
    setStatus()
  }
}

editor.onSubmit = (text) => {
  const t = text.trim()
  if (!t) return
  void send(t)
}
tui.addChild(scroller)
tui.addChild(editor)
tui.addChild(status)
tui.setFocus(editor)

// ---------------------------------------------------------------- graceful shutdown
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  try { watcher.stop() } catch {}
  try { client?.close() } catch {}
  try { tui.stop() } catch {}
  process.exit(0)
}
process.on("uncaughtException", (err) => {
  try { addErrorCard(`uncaught: ${err.message}`); shuttingDown = false } catch { shutdown() }
})
process.on("unhandledRejection", (reason) => {
  try { addErrorCard(`unhandled: ${String(reason)}`) } catch { shutdown() }
})

// ---------------------------------------------------------------- keys (CodeWhale-style)
tui.addInputListener((data) => {
  if (matchesKey(data, "ctrl+c")) {
    const now = Date.now()
    if (now - lastCtrlC < 1500) shutdown()
    lastCtrlC = now
    setStatus(c.yellow("(Ctrl+C again to exit)"))
  } else if (matchesKey(data, "ctrl+r")) {
    showSessionPicker()
  } else if (matchesKey(data, "escape")) {
    if (busy && client) {
      void client.cancel().then(() => {
        streamMd = null
        busy = false
        setStatus(c.dim("(interrupted)"))
      })
    }
  }
})

setStatus()
tui.start()
