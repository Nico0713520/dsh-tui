export type TurnPerfMark =
  | "submit"
  | "first-live-event"
  | "first-visible-activity"
  | "first-live-text"
  | "first-live-text-paint"
  | "acp-committed"
  | "settled"

export class TurnPerf {
  private readonly marks = new Map<TurnPerfMark, number>()

  start(now = performance.now()): void {
    this.marks.clear()
    this.marks.set("submit", now)
  }

  mark(name: Exclude<TurnPerfMark, "submit">, now = performance.now()): void {
    const submit = this.marks.get("submit")
    if (submit === undefined || now < submit || this.marks.has(name)) return
    this.marks.set(name, now)
  }

  report(): string {
    const submit = this.marks.get("submit")
    if (submit === undefined) return ""
    const spans: string[] = []
    this.pushSpan(spans, "backend", submit, this.marks.get("first-live-event"))
    this.pushSpan(spans, "text", submit, this.marks.get("first-live-text"))
    this.pushSpan(spans, "paint", this.marks.get("first-live-text"), this.marks.get("first-live-text-paint"))
    this.pushSpan(spans, "settle", submit, this.marks.get("settled"))
    return spans.join(" · ")
  }

  reset(): void {
    this.marks.clear()
  }

  private pushSpan(parts: string[], label: string, start: number | undefined, end: number | undefined): void {
    if (start === undefined || end === undefined || end < start) return
    parts.push(`${label} ${Math.round(end - start)}ms`)
  }
}
