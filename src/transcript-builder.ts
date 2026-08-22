import type { TranscriptItem } from "./controller.ts"
import type { DshLiveRecord } from "./backend/live-record.ts"
import type { HistoryEntry } from "./backend/session-log.ts"
import type { SessionLogEvent } from "./backend/session-log.ts"

export interface ToolLifecycle {
  readonly name: string
  readonly arguments: string
  readonly transcriptItem: Extract<TranscriptItem, { kind: "tool-call" }> | null
  readonly startedAtMs: number
}

export interface ApplyLiveResult {
  /** Transcript after applying the record, or null when the record was already seen. */
  readonly transcript: readonly TranscriptItem[]
  readonly accepted: boolean
}

/** Result of applying a log event: the next transcript, or null when duplicate. */
export type ApplyLogResult = readonly TranscriptItem[] | null

/**
 * Owns transcript assembly and tool-call deduplication.
 * Single source of truth for seen tool starts/ends so the live channel and the
 * JSONL fallback channel converge without double-rendering.
 */
export class TranscriptBuilder {
  private readonly now: () => number
  private readonly seenToolStarts = new Set<string>()
  private readonly seenToolEnds = new Set<string>()
  private readonly liveTools = new Map<string, ToolLifecycle>()
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

  /** Apply a live tool-start record; returns the next transcript or null when duplicate. */
  applyLiveToolStart(record: Extract<DshLiveRecord, { kind: "tool-start" }>, transcript: readonly TranscriptItem[]): ApplyLiveResult {
    if (this.seenToolStarts.has(record.callId) || this.seenToolEnds.has(record.callId)) {
      return { transcript, accepted: false }
    }
    this.seenToolStarts.add(record.callId)
    const transcriptItem: Extract<TranscriptItem, { kind: "tool-call" }> = {
      kind: "tool-call",
      name: record.name,
      arguments: record.arguments,
    }
    this.liveTools.set(record.callId, {
      name: record.name,
      arguments: record.arguments,
      transcriptItem,
      startedAtMs: this.now(),
    })
    return {
      transcript: [...transcript, transcriptItem],
      accepted: true,
    }
  }

  /** Apply a live tool-end record; returns the next transcript or null when duplicate. */
  applyLiveToolEnd(record: Extract<DshLiveRecord, { kind: "tool-end" }>, transcript: readonly TranscriptItem[]): ApplyLiveResult {
    if (this.seenToolEnds.has(record.callId)) {
      return { transcript, accepted: false }
    }
    this.seenToolEnds.add(record.callId)
    this.seenToolStarts.add(record.callId)
    const tool = this.liveTools.get(record.callId)
    const item: TranscriptItem = {
      kind: "tool-result",
      name: tool?.name ?? "tool",
      ...(tool ? { arguments: tool.arguments } : {}),
      text: record.text,
      isError: record.isError,
      ...(tool ? { durationMs: Math.max(0, this.now() - tool.startedAtMs) } : {}),
    }
    return {
      transcript: replaceOrAppend(transcript, tool, item),
      accepted: true,
    }
  }

  /** Apply a JSONL fallback tool-call event; returns null when duplicate. */
  applyLogToolCall(event: Extract<SessionLogEvent, { kind: "tool-call" }>, transcript: readonly TranscriptItem[]): ApplyLogResult {
    if (this.seenToolStarts.has(event.callId) || this.seenToolEnds.has(event.callId)) return null
    this.seenToolStarts.add(event.callId)
    const transcriptItem: Extract<TranscriptItem, { kind: "tool-call" }> = {
      kind: "tool-call",
      name: event.name,
      arguments: event.arguments,
    }
    this.liveTools.set(event.callId, {
      name: event.name,
      arguments: event.arguments,
      transcriptItem,
      startedAtMs: this.now(),
    })
    return [...transcript, transcriptItem]
  }

  /** Apply a JSONL fallback tool-result event; returns null when duplicate. */
  applyLogToolResult(event: Extract<SessionLogEvent, { kind: "tool-result" }>, transcript: readonly TranscriptItem[]): ApplyLogResult {
    if (this.seenToolEnds.has(event.callId)) return null
    this.seenToolEnds.add(event.callId)
    this.seenToolStarts.add(event.callId)
    const tool = this.liveTools.get(event.callId)
    const item: TranscriptItem = {
      kind: "tool-result",
      name: event.name,
      ...(tool ? { arguments: tool.arguments } : {}),
      text: event.text,
      isError: event.isError,
      ...(tool ? { durationMs: Math.max(0, this.now() - tool.startedAtMs) } : {}),
    }
    return replaceOrAppend(transcript, tool, item)
  }

  lookupTool(callId: string): ToolLifecycle | undefined {
    return this.liveTools.get(callId)
  }

  /** Clear per-session deduplication state (thinking stretches keep their clock). */
  resetSessionState(): void {
    this.seenToolStarts.clear()
    this.seenToolEnds.clear()
    this.liveTools.clear()
  }
}

function replaceOrAppend(transcript: readonly TranscriptItem[], tool: ToolLifecycle | undefined, item: TranscriptItem): readonly TranscriptItem[] {
  const next = [...transcript]
  const index = tool?.transcriptItem === null || tool === undefined
    ? -1
    : next.findIndex((candidate) => candidate === tool.transcriptItem)
  if (index >= 0 && next[index]?.kind === "tool-call") next[index] = item
  else next.push(item)
  return next
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
