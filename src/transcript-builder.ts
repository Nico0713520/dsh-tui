import type { TranscriptItem } from "./controller.ts"
import type { HistoryEntry } from "./backend/session-log.ts"

/**
 * Tracks visible thinking stretches and maps durable history into transcript
 * items. Live/JSONL tool lifecycles are owned by ToolTimeline.
 */
export class TranscriptBuilder {
  private readonly now: () => number
  private thinkingStartedAtMs: number | null = null

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  get isThinking(): boolean {
    return this.thinkingStartedAtMs !== null
  }

  /** Mark the start of a thinking stretch for truthful duration reporting. */
  markThinkingStart(): void {
    this.thinkingStartedAtMs = this.now()
  }

  /**
   * Close an open thinking stretch. Returns its duration when it exceeded the
   * reporting threshold, else null. The returned item should be inserted at the
   * current transcript end.
   */
  closeThinking(thresholdMs = 250): { durationMs: number } | null {
    const startedAt = this.thinkingStartedAtMs
    if (startedAt === null) return null
    this.thinkingStartedAtMs = null
    const durationMs = Math.max(0, this.now() - startedAt)
    return durationMs >= thresholdMs ? { durationMs } : null
  }

}

export function historyToTranscript(entry: HistoryEntry): TranscriptItem {
  if (entry.kind === "user" || entry.kind === "assistant" || entry.kind === "diagnostic") {
    return { kind: entry.kind, text: entry.text }
  }
  if (entry.kind === "tool-call") {
    return { kind: "tool-call", name: entry.name, arguments: entry.arguments }
  }
  if (entry.kind === "tool-result") {
    return { kind: "tool-result", name: entry.name, text: entry.text, isError: entry.isError }
  }
  return { kind: "diagnostic", text: entry.text }
}
