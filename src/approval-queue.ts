import type { PermissionDecision } from "./backend/acp-client.ts"

export interface ApprovalRequestTask<T> {
  run(): Promise<T>
}

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
  enqueue<T extends PermissionDecision>(task: () => Promise<T>): Promise<T> {
    const run = (): Promise<T> => {
      const startedAtMs = this.now()
      let timer: ReturnType<typeof setTimeout> | undefined
      return new Promise<T>((resolve) => {
        timer = this.setTimeoutFn(() => {
          this.onTimeout?.(this.now() - startedAtMs)
          resolve({ outcome: "cancelled" } as T)
        }, this.timeoutMs)
        const settle = (decision: T) => {
          if (timer !== undefined) this.clearTimeoutFn(timer)
          resolve(decision)
        }
        task().then(
          (decision) => settle(decision),
          () => settle({ outcome: "cancelled" } as T),
        )
      })
    }
    const result = this.tail.then(run, run)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}
