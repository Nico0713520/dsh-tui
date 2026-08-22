import {
  Container,
  SelectList,
  Text,
  matchesKey,
  truncateToWidth,
  type Component,
  type OverlayHandle,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui"
import type { ApprovalRequest } from "../controller.ts"
import { createUiTheme, toolSummary, type ForegroundRole, type UiTheme } from "./theme.ts"

function redactSensitive(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/gi, "[redacted]")
    .replace(/((?:api[_-]?key|authorization|token)\s*[:=]\s*)[^\s,'"}]+/gi, "$1[redacted]")
}

function stakesTone(stakes: ApprovalRequest["stakes"]): ForegroundRole {
  if (stakes === "critical") return "error"
  if (stakes === "elevated") return "warning"
  return "success"
}

export function approvalPanelSummary(
  request: ApprovalRequest,
  columns: number,
  theme: UiTheme,
): string {
  const width = Math.max(1, columns)
  const headline = theme.strong(theme.fg(stakesTone(request.stakes), `${request.stakes.toUpperCase()} APPROVAL`))
  const target = redactSensitive(toolSummary(request.name, request.arguments, Math.max(8, width - 2)))
  const guidance = request.stakes === "critical"
    ? "Review carefully; this action may be difficult to reverse."
    : request.stakes === "elevated"
      ? "This action can change workspace or external state."
      : "This action is expected to be read-only or low risk."
  return [
    truncateToWidth(headline, width, "…"),
    truncateToWidth(theme.fg("text", target), width, "…"),
    truncateToWidth(theme.fg("muted", guidance), width, "…"),
  ].join("\n")
}

export class ApprovalPanel implements Component {
  private readonly body = new Container()
  private readonly list: SelectList
  private readonly onResult: (value: string | null) => void
  private overlay: OverlayHandle | null = null
  private settled = false

  constructor(
    request: ApprovalRequest,
    onResult: (value: string | null) => void,
    theme: UiTheme = createUiTheme("terminal"),
  ) {
    this.onResult = onResult
    this.body.addChild(new Text(approvalPanelSummary(request, 72, theme), 1, 0))
    const items: SelectItem[] = request.optionIds.map((optionId) => ({
      value: optionId,
      label: optionId.includes("allow")
        ? theme.fg("success", "Allow this action")
        : theme.fg("error", "Reject this action"),
      description: optionId.includes("allow") ? "Continue once" : "Return a cancelled decision",
    }))
    this.list = new SelectList(items, Math.min(8, Math.max(1, items.length)), theme.select)
    this.list.onSelect = (item) => this.finish(item.value)
    this.list.onCancel = () => this.finish(null)
    this.body.addChild(this.list)
    this.body.addChild(new Text(theme.fg("muted", "↑↓ select · Enter choose · Esc cancel"), 1, 0))
  }

  setOverlay(handle: OverlayHandle): void {
    this.overlay = handle
  }

  render(width: number): string[] {
    return this.body.render(width)
  }

  invalidate(): void {
    this.body.invalidate()
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.cancel()
      return
    }
    this.list.handleInput(data)
  }

  cancel(): void {
    this.finish(null)
  }

  private finish(value: string | null): void {
    if (this.settled) return
    this.settled = true
    this.overlay?.hide()
    this.onResult(value)
  }
}

export function showApprovalPanel(
  tui: TUI,
  request: ApprovalRequest,
  theme: UiTheme,
  signal?: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve) => {
    let onAbort: (() => void) | undefined
    const finish = (value: string | null) => {
      if (onAbort) signal?.removeEventListener("abort", onAbort)
      resolve(value)
    }
    const panel = new ApprovalPanel(request, finish, theme)
    const overlay = tui.showOverlay(panel, { width: "70%", minWidth: 30, maxHeight: 12, margin: 1 })
    panel.setOverlay(overlay)
    overlay.focus()
    onAbort = () => panel.cancel()
    if (signal?.aborted) panel.cancel()
    else signal?.addEventListener("abort", onAbort, { once: true })
  })
}
