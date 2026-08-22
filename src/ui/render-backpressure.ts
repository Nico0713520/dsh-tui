export interface DrainSource {
  readonly writableNeedDrain: boolean
  once(event: "drain", listener: () => void): unknown
  removeListener(event: "drain", listener: () => void): unknown
}

export interface RenderGateOptions {
  frameMs?: number
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

export class LatestRenderGate<T> {
  private readonly output: DrainSource
  private readonly flush: (value: T) => void
  private readonly frameMs: number
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void
  private pending: T | undefined
  private hasPending = false
  private waiting = false
  private disposed = false
  private lastFlushAt: number | undefined
  private frameTimer: ReturnType<typeof setTimeout> | undefined

  constructor(output: DrainSource, flush: (value: T) => void, options: RenderGateOptions = {}) {
    this.output = output
    this.flush = flush
    this.frameMs = Math.max(0, options.frameMs ?? 33)
    this.now = options.now ?? (() => performance.now())
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer))
  }

  submit(value: T, priority = false): void {
    if (this.disposed) return
    if (priority) {
      this.cancelFrame()
      this.disarmDrain()
      this.pending = undefined
      this.hasPending = false
      this.flushValue(value)
      return
    }

    this.pending = value
    this.hasPending = true
    if (this.output.writableNeedDrain) {
      this.cancelFrame()
      this.armDrain()
      return
    }
    this.disarmDrain()
    this.flushOrSchedule()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelFrame()
    this.disarmDrain()
    this.pending = undefined
    this.hasPending = false
  }

  private readonly onDrain = (): void => {
    this.waiting = false
    if (this.disposed) return
    this.flushOrSchedule()
  }

  private armDrain(): void {
    if (this.waiting) return
    this.waiting = true
    this.output.once("drain", this.onDrain)
  }

  private disarmDrain(): void {
    if (!this.waiting) return
    this.waiting = false
    this.output.removeListener("drain", this.onDrain)
  }

  private flushOrSchedule(): void {
    if (this.disposed || !this.hasPending) return
    if (this.output.writableNeedDrain) {
      this.cancelFrame()
      this.armDrain()
      return
    }

    const elapsed = this.lastFlushAt === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, this.now() - this.lastFlushAt)
    if (elapsed >= this.frameMs) {
      this.flushPending()
      return
    }
    this.armFrame(this.frameMs - elapsed)
  }

  private flushPending(): void {
    if (!this.hasPending) return
    const value = this.pending as T
    this.pending = undefined
    this.hasPending = false
    this.flushValue(value)
  }

  private flushValue(value: T): void {
    this.lastFlushAt = this.now()
    this.flush(value)
  }

  private armFrame(delayMs: number): void {
    if (this.frameTimer !== undefined) return
    this.frameTimer = this.setTimer(() => {
      this.frameTimer = undefined
      this.flushOrSchedule()
    }, Math.max(0, delayMs))
    if (typeof this.frameTimer === "object") this.frameTimer.unref?.()
  }

  private cancelFrame(): void {
    if (this.frameTimer === undefined) return
    this.clearTimer(this.frameTimer)
    this.frameTimer = undefined
  }
}
