import type { PermissionDecision } from "./backend/acp-client.ts"

export interface ApprovalQueueOptions {
  /** Milliseconds before an in-flight approval resolves as denied. Default 120s. */
  timeoutMs?: number
  onTimeout?: (waitedMs: number) => void
  now?: () => number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

/**
 * Serializes permission dialogs so overlays never stack, and guarantees
 * progress: an approval that never settles (frozen UI, dead view) times out
 * and resolves as cancelled instead of starving every queued request after it.
 */
export class ApprovalQueue {
  private readonly timeoutMs: number
  private readonly onTimeout: ((waitedMs: number) => void) | undefined
  private readonly now: () => number
  private readonly setTimeoutFn: typeof setTimeout
  private readonly clearTimeoutFn: typeof clearTimeout
  private tail: Promise<void> = Promise.resolve()

  constructor(options: ApprovalQueueOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.onTimeout = options.onTimeout
    this.now = options.now ?? Date.now
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  }

  /** Queue a permission decision; runs after all earlier decisions settled. */
  enqueue<T extends PermissionDecision>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const startedAtMs = this.now()
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      const taskPromise = Promise.resolve()
        .then(() => task(controller.signal))
        .catch(() => ({ outcome: "cancelled" }) as T)
      const timeoutPromise = new Promise<T>((resolve) => {
        timer = this.setTimeoutFn(() => {
          this.onTimeout?.(this.now() - startedAtMs)
          controller.abort()
          resolve({ outcome: "cancelled" } as T)
        }, this.timeoutMs)
        timer.unref?.()
      })
      const decision = await Promise.race([taskPromise, timeoutPromise])
      if (timer !== undefined) this.clearTimeoutFn(timer)
      return decision
    }
    const result = this.tail.then(run, run)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}
