export type ToolTimelineEvent =
  | {
      kind: "start"
      callId: string
      name: string
      arguments: string
    }
  | {
      kind: "end"
      callId: string
      name: string
      text: string
      isError: boolean
    }

export type ToolTimelineItem =
  | { kind: "tool-call"; name: string; arguments: string }
  | {
      kind: "tool-result"
      name: string
      arguments?: string
      text: string
      isError: boolean
      durationMs?: number
    }

export type ToolMutation =
  | { kind: "none" }
  | { kind: "append"; item: ToolTimelineItem }
  | { kind: "replace"; target: ToolTimelineItem; item: ToolTimelineItem }

export interface ToolLifecycle {
  readonly name: string
  readonly arguments: string
  readonly transcriptItem: Extract<ToolTimelineItem, { kind: "tool-call" }>
  readonly startedAtMs: number
}

/**
 * Merges live and JSONL tool events into one lifecycle. Replacement targets
 * use object identity so transcript rows inserted later cannot stale an index.
 */
export class ToolTimeline {
  private readonly now: () => number
  private readonly started = new Set<string>()
  private readonly ended = new Set<string>()
  private readonly active = new Map<string, ToolLifecycle>()

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  apply(event: ToolTimelineEvent): ToolMutation {
    if (!event.callId) return { kind: "none" }
    if (event.kind === "start") {
      if (this.started.has(event.callId) || this.ended.has(event.callId)) return { kind: "none" }
      this.started.add(event.callId)
      const item: Extract<ToolTimelineItem, { kind: "tool-call" }> = {
        kind: "tool-call",
        name: event.name,
        arguments: event.arguments,
      }
      this.active.set(event.callId, {
        name: event.name,
        arguments: event.arguments,
        transcriptItem: item,
        startedAtMs: this.now(),
      })
      return { kind: "append", item }
    }

    if (this.ended.has(event.callId)) return { kind: "none" }
    this.ended.add(event.callId)
    this.started.add(event.callId)
    const active = this.active.get(event.callId)
    this.active.delete(event.callId)
    const item: ToolTimelineItem = {
      kind: "tool-result",
      name: active?.name ?? event.name,
      ...(active ? { arguments: active.arguments } : {}),
      text: event.text,
      isError: event.isError,
      ...(active ? { durationMs: Math.max(0, this.now() - active.startedAtMs) } : {}),
    }
    return active
      ? { kind: "replace", target: active.transcriptItem, item }
      : { kind: "append", item }
  }

  lookup(callId: string): ToolLifecycle | undefined {
    return this.active.get(callId)
  }

  reset(): void {
    this.started.clear()
    this.ended.clear()
    this.active.clear()
  }
}
