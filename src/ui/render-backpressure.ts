export interface DrainSource {
  readonly writableNeedDrain: boolean
  once(event: "drain", listener: () => void): unknown
  removeListener(event: "drain", listener: () => void): unknown
}

export class LatestRenderGate<T> {
  private readonly output: DrainSource
  private readonly flush: (value: T) => void
  private pending: T | undefined
  private hasPending = false
  private waiting = false
  private disposed = false

  constructor(output: DrainSource, flush: (value: T) => void) {
    this.output = output
    this.flush = flush
  }

  submit(value: T, priority = false): void {
    if (this.disposed) return
    if (this.output.writableNeedDrain && !priority) {
      this.pending = value
      this.hasPending = true
      this.arm()
      return
    }
    this.disarm()
    this.pending = undefined
    this.hasPending = false
    this.flush(value)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disarm()
    this.pending = undefined
    this.hasPending = false
  }

  private readonly onDrain = (): void => {
    this.waiting = false
    if (!this.hasPending) return
    const value = this.pending as T
    this.pending = undefined
    this.hasPending = false
    this.submit(value)
  }

  private arm(): void {
    if (this.waiting) return
    this.waiting = true
    this.output.once("drain", this.onDrain)
  }

  private disarm(): void {
    if (!this.waiting) return
    this.waiting = false
    this.output.removeListener("drain", this.onDrain)
  }
}
