import { describe, expect, it, vi } from "vitest"
import { ApprovalQueue } from "../../src/approval-queue.ts"
import type { PermissionDecision } from "../../src/backend/acp-client.ts"

function deferred() {
  let resolve!: (value: PermissionDecision) => void
  const promise = new Promise<PermissionDecision>((r) => { resolve = r })
  return { promise, resolve }
}

const cancelled = (): PermissionDecision => ({ outcome: "cancelled" })

describe("ApprovalQueue", () => {
  it("serializes decisions so overlays never stack", async () => {
    const first = deferred()
    const second = deferred()
    const queue = new ApprovalQueue()
    let secondStarted = false

    const p1 = queue.enqueue(() => first.promise)
    const p2 = queue.enqueue(async () => {
      secondStarted = true
      return second.promise
    })

    expect(secondStarted).toBe(false)
    first.resolve(cancelled())
    await expect(p1).resolves.toEqual(cancelled())
    expect(secondStarted).toBe(true)
    second.resolve(cancelled())
    await expect(p2).resolves.toEqual(cancelled())
  })

  it("denies an approval that never settles instead of starving the queue", async () => {
    vi.useFakeTimers()
    try {
      const onTimeout = vi.fn<(waitedMs: number) => void>()
      const queue = new ApprovalQueue({ timeoutMs: 500, onTimeout })
      const stuck = queue.enqueue(() => deferred().promise)
      let ran = false
      const after = queue.enqueue(async () => {
        ran = true
        return { outcome: "selected" as const, optionId: "allow" }
      })

      await vi.advanceTimersByTimeAsync(600)
      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(ran).toBe(true)
      await expect(after).resolves.toEqual({ outcome: "selected", optionId: "allow" })
      await expect(stuck).resolves.toEqual(cancelled())
    } finally {
      vi.useRealTimers()
    }
  })

  it("clears the timeout when the decision settles in time", async () => {
    vi.useFakeTimers()
    try {
      const onTimeout = vi.fn()
      const queue = new ApprovalQueue({ timeoutMs: 1_000, onTimeout })
      const result = queue.enqueue(async () => ({ outcome: "selected" as const, optionId: "once" }))
      await vi.advanceTimersByTimeAsync(100)
      await expect(result).resolves.toEqual({ outcome: "selected", optionId: "once" })
      await vi.advanceTimersByTimeAsync(2_000)
      expect(onTimeout).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
