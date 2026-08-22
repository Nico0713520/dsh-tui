import { open, readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { StringDecoder } from "node:string_decoder"
import type { FileHandle } from "node:fs/promises"
import type { Usage } from "../usage.ts"

export type SessionLogEvent =
  | { kind: "tool-call"; callId: string; name: string; arguments: string }
  | { kind: "tool-result"; callId: string; name: string; text: string; isError: boolean }
  | { kind: "usage"; usage: Usage; turn?: number; step?: number }

export interface SessionInfo {
  id: string
  mtimeMs: number
  title: string
  firstUserMessage: string
}

export type HistoryEntry =
  | { kind: "user" | "assistant" | "diagnostic"; text: string }
  | { kind: "tool-call"; name: string; arguments: string }
  | { kind: "tool-result"; name: string; text: string; isError: boolean }

export interface SessionLogWatchOptions {
  persistRoot: string
  cwd: string
  sessionId: string
  onEvent(event: SessionLogEvent): void
  onDiagnostic?: (message: string) => void
}

interface RecordValue {
  [key: string]: unknown
}

interface TextBlock {
  type: "text"
  text: string
}

interface ToolResultBlock {
  type: "tool-result"
  toolCallId?: string
  isError?: boolean
  content?: unknown[]
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null
}

function isTextBlock(value: unknown): value is TextBlock {
  return isRecord(value) && value.type === "text" && typeof value.text === "string"
}

function isToolResultBlock(value: unknown): value is ToolResultBlock {
  return isRecord(value) && value.type === "tool-result"
}

function textBlocks(value: unknown): string {
  return Array.isArray(value) ? value.filter(isTextBlock).map((block) => block.text).join("\n") : ""
}

function stringArgument(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined) return ""
  try { return JSON.stringify(value) } catch { return "[unserializable arguments]" }
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function coordinate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function usageFrom(value: unknown): Usage | null {
  if (!isRecord(value)) return null
  const inputTokens = numeric(value.inputTokens)
  const outputTokens = numeric(value.outputTokens)
  const cacheReadTokens = numeric(value.cacheReadTokens)
  if (inputTokens === undefined && outputTokens === undefined && cacheReadTokens === undefined) return null
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
  }
}

/** Port of DSH session-persistence-jsonl's projectKey algorithm. */
export function projectKey(cwd: string): string {
  let readable = ""
  let separatorRun = false
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character === "/" || character === "\\" || character === ":") {
      if (!separatorRun) readable += "-"
      separatorRun = true
    } else if (code !== 126 && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, "") || "root"
  return `--${slug.slice(0, 251)}--`
}

export function resolveSessionLogPath(persistRoot: string, cwd: string, sessionId: string): string {
  if (!sessionId || sessionId.includes("/") || sessionId.includes("\\") || sessionId === "." || sessionId === "..") {
    throw new Error("session id contains an invalid path component")
  }
  return join(persistRoot, projectKey(cwd), sessionId, "session.jsonl")
}

export class SessionLogReader {
  private readonly pollIntervalMs: number
  private readonly readChunkSize: number
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private fileHandle: FileHandle | null = null
  private filePath: string | null = null
  private offset = 0
  private decoder = new StringDecoder("utf8")
  private partialLine = ""
  private callNames = new Map<string, { name: string; arguments: string }>()
  private lastMetadataStamp: string | null = null
  private options: SessionLogWatchOptions | null = null
  private pumping: Promise<void> = Promise.resolve()

  constructor(options: { pollIntervalMs?: number; readChunkSize?: number } = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 250
    this.readChunkSize = options.readChunkSize ?? 64 * 1024
  }

  lookupCall(callId: string): { name: string; arguments: string } | undefined {
    return this.callNames.get(callId)
  }

  listHistory(persistRoot: string, cwd: string, options?: HistoryListOptions): Promise<SessionInfo[]> {
    return listHistory(persistRoot, cwd, options)
  }

  loadHistory(persistRoot: string, cwd: string, sessionId: string): Promise<HistoryEntry[]> {
    return loadHistory(persistRoot, cwd, sessionId)
  }

  watch(options: SessionLogWatchOptions): void {
    const filePath = resolveSessionLogPath(options.persistRoot, options.cwd, options.sessionId)
    if (this.options && this.filePath === filePath) {
      this.options = options
      return
    }
    this.stop()
    this.options = options
    this.filePath = filePath
    const generation = this.generation
    void this.tick(generation)
  }

  stop(): void {
    this.generation += 1
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const handle = this.fileHandle
    this.fileHandle = null
    if (handle) void handle.close().catch(() => undefined)
    this.filePath = null
    this.options = null
    this.offset = 0
    this.decoder = new StringDecoder("utf8")
    this.partialLine = ""
    this.callNames.clear()
    this.lastMetadataStamp = null
  }

  /** Immediately consume records currently visible on disk without creating another poll timer. */
  async synchronize(): Promise<void> {
    const generation = this.generation
    if (!this.options) return
    try {
      await this.enqueuePump(generation)
    } catch (error) {
      if (generation === this.generation) this.options?.onDiagnostic?.(`session log read failed: ${String(error)}`)
    }
  }

  private async tick(generation: number): Promise<void> {
    if (generation !== this.generation || !this.options) return
    try {
      await this.enqueuePump(generation)
    } catch (error) {
      if (generation === this.generation) this.options.onDiagnostic?.(`session log read failed: ${String(error)}`)
    }
    if (generation === this.generation && this.options) {
      this.timer = setTimeout(() => { void this.tick(generation) }, this.pollIntervalMs)
    }
  }

  private enqueuePump(generation: number): Promise<void> {
    const next = this.pumping.then(() => this.pump(generation))
    this.pumping = next.catch(() => undefined)
    return next
  }

  private async pump(generation: number): Promise<void> {
    const options = this.options
    const filePath = this.filePath
    if (!options || !filePath || generation !== this.generation) return
    if (!this.fileHandle) {
      try {
        this.fileHandle = await open(filePath, "r")
      } catch (error) {
        if (isMissing(error)) return
        throw error
      }
    }
    if (generation !== this.generation || !this.fileHandle) return
    let metadata = await this.fileHandle.stat()
    // Fast path: nothing appended and no stamp change means no path identity
    // check is needed; one stat per idle poll instead of three.
    const idleStamp = `${metadata.mtimeMs}:${metadata.ctimeMs}`
    if (metadata.size === this.offset && this.lastMetadataStamp === idleStamp) return
    const pathMetadata = await stat(filePath)
    const handleIdentity = `${metadata.dev}:${metadata.ino}`
    const pathIdentity = `${pathMetadata.dev}:${pathMetadata.ino}`
    const metadataStamp = idleStamp
    const replaced = handleIdentity !== pathIdentity
      || metadata.size < this.offset
      || (metadata.size === this.offset && this.lastMetadataStamp !== null && metadataStamp !== this.lastMetadataStamp)
    if (replaced) {
      await this.fileHandle.close()
      this.fileHandle = await open(filePath, "r")
      this.offset = 0
      this.decoder = new StringDecoder("utf8")
      this.partialLine = ""
      this.callNames.clear()
      metadata = await this.fileHandle.stat()
    }
    this.lastMetadataStamp = `${metadata.mtimeMs}:${metadata.ctimeMs}`
    const buffer = Buffer.allocUnsafe(this.readChunkSize)
    const { bytesRead } = await this.fileHandle.read(buffer, 0, buffer.length, this.offset)
    if (bytesRead === 0 || generation !== this.generation) return
    this.offset += bytesRead
    const settledMetadata = await this.fileHandle.stat()
    this.lastMetadataStamp = `${settledMetadata.mtimeMs}:${settledMetadata.ctimeMs}`
    this.consumeText(this.decoder.write(buffer.subarray(0, bytesRead)), options)
  }

  private consumeText(text: string, options: SessionLogWatchOptions): void {
    this.partialLine += text
    const lines = this.partialLine.split("\n")
    this.partialLine = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      this.consumeLine(line, options)
    }
  }

  private consumeLine(line: string, options: SessionLogWatchOptions): void {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      options.onDiagnostic?.("session log contains a malformed JSON record")
      return
    }
    const event = parseEvent(record, this.callNames)
    if (event) options.onEvent(event)
  }
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT"
}

function parseEvent(record: unknown, callNames: Map<string, { name: string; arguments: string }>): SessionLogEvent | null {
  if (!isRecord(record) || typeof record.type !== "string") return null
  const data = isRecord(record.data) ? record.data : {}
  if (record.type === "tool/call") {
    const callId = typeof data.callId === "string" ? data.callId : ""
    const name = typeof data.name === "string" && data.name ? data.name : "tool"
    const args = stringArgument(data.arguments)
    if (callId) callNames.set(callId, { name, arguments: args })
    return { kind: "tool-call", callId, name, arguments: args }
  }
  if (record.type === "tool/result") {
    const message = isRecord(data.message) ? data.message : {}
    const source = isRecord(message.source) ? message.source : {}
    const content = Array.isArray(message.content) ? message.content : []
    const result = content.find(isToolResultBlock)
    const callIdValue = source.callId ?? (result?.toolCallId)
    const callId = typeof callIdValue === "string" ? callIdValue : ""
    return {
      kind: "tool-result",
      callId,
      name: callNames.get(callId)?.name ?? "tool",
      text: result ? textBlocks(result.content) : "",
      isError: result?.isError === true,
    }
  }
  if (record.type === "assistant/message") {
    const usage = usageFrom(data.usage)
    if (!usage) return null
    const turn = coordinate(data.turn)
    const step = coordinate(data.step)
    return {
      kind: "usage",
      usage,
      ...(turn === undefined ? {} : { turn }),
      ...(step === undefined ? {} : { step }),
    }
  }
  return null
}

interface ReadRecordsResult {
  records: RecordValue[]
  malformed: number
}

/** Bytes read from a history file when listing sessions; enough for title and
 * first user message without loading multi-megabyte transcripts. */
export const HISTORY_LIST_READ_LIMIT = 64 * 1024
/** Maximum number of newest session heads read and returned per history listing. */
export const HISTORY_LIST_ENTRY_LIMIT = 50

export interface HistoryListOptions {
  limit?: number
  previewBytes?: number
}

async function readRecords(filePath: string, byteLimit?: number): Promise<ReadRecordsResult> {
  let content: string
  if (byteLimit === undefined) {
    content = await readFile(filePath, "utf8")
  } else {
    const handle = await open(filePath, "r")
    try {
      const buffer = Buffer.allocUnsafe(byteLimit)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      content = buffer.subarray(0, bytesRead).toString("utf8")
    } finally {
      await handle.close()
    }
  }
  const records: RecordValue[] = []
  let malformed = 0
  for (const line of content.split("\n")) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (isRecord(value)) records.push(value)
      else malformed += 1
    } catch {
      malformed += 1
    }
  }
  return { records, malformed }
}

function firstText(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.message)) return ""
  const message = value.data.message
  return textBlocks(message.content)
}

function isToolMessage(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.message) || !Array.isArray(value.data.message.content)) return false
  return value.data.message.content.some(isToolResultBlock)
}

export async function listHistory(
  persistRoot: string,
  cwd: string,
  options: HistoryListOptions = {},
): Promise<SessionInfo[]> {
  const root = join(persistRoot, projectKey(cwd))
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  const candidates = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const filePath = join(root, entry.name, "session.jsonl")
    try {
      const metadata = await stat(filePath)
      return { id: entry.name, filePath, mtimeMs: metadata.mtimeMs }
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }))
  const newest = candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, Math.max(0, Math.floor(options.limit ?? HISTORY_LIST_ENTRY_LIMIT)))
  const sessions = await Promise.all(newest.map(async (candidate) => {
    try {
      const previewBytes = Math.max(1, Math.floor(options.previewBytes ?? HISTORY_LIST_READ_LIMIT))
      const { records } = await readRecords(candidate.filePath, previewBytes)
      const titleRecord = records.find((record) => record.type === "session/title")
      const title = isRecord(titleRecord?.data) && typeof titleRecord.data.title === "string"
        ? titleRecord.data.title
        : ""
      const userRecord = records.find((record) => record.type === "user/message" && !isToolMessage(record))
      return {
        id: candidate.id,
        mtimeMs: candidate.mtimeMs,
        title,
        firstUserMessage: firstText(userRecord),
      }
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }))
  return sessions.filter((session): session is SessionInfo => session !== null)
}

export async function loadHistory(persistRoot: string, cwd: string, sessionId: string): Promise<HistoryEntry[]> {
  const { records, malformed } = await readRecords(resolveSessionLogPath(persistRoot, cwd, sessionId))
  const entries: HistoryEntry[] = []
  const callNames = new Map<string, { name: string; arguments: string }>()
  for (const record of records) {
    if (record.type === "user/message" && !isToolMessage(record)) {
      const text = firstText(record)
      if (text.trim()) entries.push({ kind: "user", text })
    } else if (record.type === "assistant/message") {
      const text = firstText(record)
      if (text.trim()) entries.push({ kind: "assistant", text })
    } else {
      const event = parseEvent(record, callNames)
      if (event?.kind === "tool-call") {
        entries.push({ kind: "tool-call", name: event.name, arguments: event.arguments })
      } else if (event?.kind === "tool-result") {
        entries.push({ kind: "tool-result", name: event.name, text: event.text, isError: event.isError })
      }
    }
  }
  if (malformed > 0) entries.push({ kind: "diagnostic", text: `History contains ${malformed} malformed record(s).` })
  return entries
}
