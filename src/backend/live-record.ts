import { StringDecoder } from "node:string_decoder"
import { sanitizeTerminalText } from "../text.ts"
import type { Usage } from "../usage.ts"

export const LIVE_LINE_LIMIT = 1_048_576
export const LIVE_TOOL_TEXT_LIMIT = 65_536

interface LiveRecordBase {
  v: 1
  sessionId: string
  seq: number
}

export type DshLiveRecord = LiveRecordBase & (
  | { kind: "turn-start"; turn: number }
  | { kind: "activity"; turn: number; step: number; activity: "thinking" | "responding" }
  | { kind: "text-delta" | "text-final"; turn: number; step: number; index: number; text: string }
  | { kind: "tool-start"; turn: number; step: number; callId: string; name: string; arguments: string }
  | { kind: "tool-end"; turn: number; step: number; callId: string; isError: boolean; text: string }
  | { kind: "usage"; turn: number; step: number; usage: Usage }
  | { kind: "turn-end"; turn: number; reason: string }
)

interface LiveRecordDecoderOptions {
  sessionId(): string | null
  onRecord(record: DshLiveRecord): void
  onDiagnostic(message: string): void
}

export class LiveRecordDecoder {
  private readonly decoder = new StringDecoder("utf8")
  private readonly options: LiveRecordDecoderOptions
  private buffer = ""
  private discardingOversizedLine = false
  private readonly diagnosed = new Set<string>()

  constructor(options: LiveRecordDecoderOptions) {
    this.options = options
  }

  push(chunk: Buffer | string): void {
    let text = typeof chunk === "string" ? chunk : this.decoder.write(chunk)
    if (this.discardingOversizedLine) {
      const newline = text.indexOf("\n")
      if (newline < 0) return
      this.discardingOversizedLine = false
      text = text.slice(newline + 1)
    }
    this.buffer += text
    let newline = this.buffer.indexOf("\n")
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (Buffer.byteLength(line) > LIVE_LINE_LIMIT) this.diagnose("oversized", "live event record exceeded 1 MiB and was ignored")
      else this.decodeLine(line)
      newline = this.buffer.indexOf("\n")
    }
    if (Buffer.byteLength(this.buffer) > LIVE_LINE_LIMIT) {
      this.buffer = ""
      this.discardingOversizedLine = true
      this.diagnose("oversized", "live event record exceeded 1 MiB and was ignored")
    }
  }

  end(): void {
    const rest = this.decoder.end()
    if (this.discardingOversizedLine) {
      this.buffer = ""
      return
    }
    if (rest) this.buffer += rest
    if (this.buffer) {
      if (Buffer.byteLength(this.buffer) > LIVE_LINE_LIMIT) this.diagnose("oversized", "live event record exceeded 1 MiB and was ignored")
      else this.decodeLine(this.buffer)
    }
    this.buffer = ""
  }

  private decodeLine(line: string): void {
    if (!line) return
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      this.diagnose("malformed", "live event pipe emitted malformed JSON")
      return
    }
    if (typeof value === "object" && value !== null && (value as Record<string, unknown>).v !== 1) {
      this.diagnose("version", "live event pipe used an unsupported wire version")
      return
    }
    const record = decodeRecord(value)
    if (!record) {
      this.diagnose("invalid", "live event pipe emitted an invalid record")
      return
    }
    if (record.sessionId !== this.options.sessionId()) return
    this.options.onRecord(record)
  }

  private diagnose(kind: string, message: string): void {
    if (this.diagnosed.has(kind)) return
    this.diagnosed.add(kind)
    this.options.onDiagnostic(message)
  }
}

function decodeRecord(value: unknown): DshLiveRecord | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (record.v !== 1 || !isNonEmptyString(record.sessionId) || !isCoordinate(record.seq) || !isCoordinate(record.turn)) {
    return null
  }
  const base = { v: 1 as const, sessionId: record.sessionId, seq: record.seq }
  if (record.kind === "turn-start") {
    return { ...base, kind: "turn-start", turn: record.turn }
  }
  if (record.kind === "turn-end" && typeof record.reason === "string") {
    return { ...base, kind: "turn-end", turn: record.turn, reason: sanitizeTerminalText(record.reason) }
  }
  if (!isCoordinate(record.step)) return null
  if (record.kind === "activity" && (record.activity === "thinking" || record.activity === "responding")) {
    return { ...base, kind: "activity", turn: record.turn, step: record.step, activity: record.activity }
  }
  if ((record.kind === "text-delta" || record.kind === "text-final") && isCoordinate(record.index) && typeof record.text === "string") {
    return {
      ...base,
      kind: record.kind,
      turn: record.turn,
      step: record.step,
      index: record.index,
      text: sanitizeTerminalText(record.text),
    }
  }
  if (record.kind === "tool-start"
    && isNonEmptyString(record.callId)
    && typeof record.name === "string"
    && isBoundedToolText(record.arguments)) {
    return {
      ...base,
      kind: "tool-start",
      turn: record.turn,
      step: record.step,
      callId: sanitizeTerminalText(record.callId),
      name: sanitizeTerminalText(record.name),
      arguments: sanitizeTerminalText(record.arguments),
    }
  }
  if (record.kind === "tool-end"
    && isNonEmptyString(record.callId)
    && typeof record.isError === "boolean"
    && isBoundedToolText(record.text)) {
    return {
      ...base,
      kind: "tool-end",
      turn: record.turn,
      step: record.step,
      callId: sanitizeTerminalText(record.callId),
      isError: record.isError,
      text: sanitizeTerminalText(record.text),
    }
  }
  if (record.kind === "usage" && isUsage(record.usage)) {
    return { ...base, kind: "usage", turn: record.turn, step: record.step, usage: { ...record.usage } }
  }
  return null
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isBoundedToolText(value: unknown): value is string {
  return typeof value === "string" && Buffer.byteLength(value) <= LIVE_TOOL_TEXT_LIMIT
}

function isUsage(value: unknown): value is Usage {
  if (typeof value !== "object" || value === null) return false
  const usage = value as Record<string, unknown>
  return [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens]
    .every((count) => count === undefined || (typeof count === "number" && Number.isFinite(count) && count >= 0))
}
