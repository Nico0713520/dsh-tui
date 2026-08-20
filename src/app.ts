import { fileURLToPath } from "node:url"
import { AcpClient, type AcpClientEvents } from "./backend/acp-client.ts"
import { SessionLogReader } from "./backend/session-log.ts"
import { AppController, type BackendPort } from "./controller.ts"
import type { AppConfig } from "./config.ts"
import { AppView } from "./ui/app-view.ts"
import { safeErrorText } from "./text.ts"

class EchoBackend implements BackendPort {
  private sessionNumber = 0
  private sessionId: string | null = null
  private pending: { resolve: (result: { stopReason: string }) => void; timer: ReturnType<typeof setInterval> } | null = null
  private readonly onText: (text: string) => void

  constructor(onText: (text: string) => void) {
    this.onText = onText
  }

  get activeSessionId(): string | null {
    return this.sessionId
  }

  async start(): Promise<void> {}

  async newSession(): Promise<string> {
    this.sessionId = `echo-${++this.sessionNumber}`
    return this.sessionId
  }

  async prompt(text: string): Promise<{ stopReason: string }> {
    const reply = `[echo] ${text} → 设置 DSH_TUI_MODE=acp 连接真实后端。`
    return new Promise((resolve) => {
      let index = 0
      const timer = setInterval(() => {
        this.onText(reply.slice(index, index + 3))
        index += 3
        if (index >= reply.length) {
          clearInterval(timer)
          this.pending = null
          resolve({ stopReason: "end_turn" })
        }
      }, 20)
      this.pending = { resolve, timer }
    })
  }

  cancel(): void {
    if (!this.pending) return
    clearInterval(this.pending.timer)
    const pending = this.pending
    this.pending = null
    pending.resolve({ stopReason: "cancelled" })
  }

  async close(): Promise<void> {
    this.cancel()
  }
}

export function resolveDefaultBackendCommand(_config: AppConfig, platform: NodeJS.Platform = process.platform): readonly string[] {
  const backendBin = fileURLToPath(import.meta.resolve("@deepseek-ai/dsh-acp-demo/bin"))
  const configFile = platform === "win32" ? "cordis.windows.yml" : "cordis.posix.yml"
  return [
    process.execPath,
    backendBin,
    "--config",
    fileURLToPath(new URL(`../config/${configFile}`, import.meta.url)),
  ]
}

export async function runApp(config: AppConfig): Promise<number> {
  const view = new AppView({ mode: config.mode, model: config.model, cwd: config.cwd, motion: config.motion })
  const logs = new SessionLogReader()
  let controller!: AppController
  let settled = false
  let resolveExit!: (code: number) => void
  const exit = new Promise<number>((resolve) => { resolveExit = resolve })

  const backendEvents: AcpClientEvents = {
    onAssistantText: (text) => controller.onAssistantText(text),
    onLiveRecord: (record) => controller.onLiveRecord(record),
    onSessionChanged: (sessionId) => controller.onSessionChanged(sessionId),
    onDiagnostic: (message) => controller.onDiagnostic(message),
    onPermission: (request) => controller.decidePermission(request),
    onBackendExit: (info) => controller.onBackendExit(info),
  }
  const backend: BackendPort = config.mode === "echo"
    ? new EchoBackend((text) => controller.onAssistantText(text))
    : new AcpClient({
        command: config.backendCommand ?? resolveDefaultBackendCommand(config),
        cwd: config.cwd,
        events: backendEvents,
        env: { ...process.env, DSH_MODEL: config.model, DSH_PERSIST_ROOT: config.persistRoot },
      })

  controller = new AppController({ config, backend, logs, view })

  const removeHandlers = () => {
    process.removeListener("SIGINT", onSignal)
    process.removeListener("SIGTERM", onSignal)
    process.removeListener("uncaughtException", onFatal)
    process.removeListener("unhandledRejection", onFatal)
  }
  const finish = async (code: number): Promise<void> => {
    if (settled) return
    settled = true
    let finalCode = code
    try {
      await controller.close()
    } catch (error) {
      finalCode = 1
      controller.onDiagnostic(`cleanup failed: ${safeErrorText(error)}`)
    } finally {
      view.stop()
      removeHandlers()
      resolveExit(finalCode)
    }
  }
  const onSignal = () => { void finish(0) }
  const onFatal = (reason: unknown) => {
    controller.onDiagnostic(`fatal: ${safeErrorText(reason)}`)
    void finish(1)
  }

  view.bind({
    onSubmit: (text) => { void controller.submit(text) },
    onDraft: (text) => controller.updateDraft(text),
    onLiveTextPaint: () => controller.onLiveTextPaint(),
    onCancel: () => controller.cancel(),
    onHistory: () => { void controller.openHistory() },
    onClose: () => { void finish(0) },
  })
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)
  process.once("uncaughtException", onFatal)
  process.once("unhandledRejection", onFatal)
  view.render(controller.state)
  view.start()
  void controller.start()
  return exit
}
