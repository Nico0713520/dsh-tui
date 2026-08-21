import { c } from "./theme.ts"
import type { MotionPreference } from "../config.ts"

export interface DeepPulseFrameOptions {
  columns: number
  frame: number
  motion: MotionPreference
  tty: boolean
  completion: boolean
}

export interface DeepPulseTick {
  frame: number
  completion: boolean
  settled: boolean
}

export function deepPulseFrame(options: DeepPulseFrameOptions): string {
  if (options.columns < 34) return ""
  const prefix = options.columns < 52 ? "" : "◌ "
  const word = "dsh-tui"
  if (!options.tty || options.motion === "off") return `${prefix}${word}`
  if (options.motion === "reduced") {
    return `${prefix}${options.completion ? c.bold(c.cyan(word)) : word}`
  }
  if (options.completion) return `${prefix}${c.bold(c.cyan(word))}`
  if (options.frame >= 10) return `${prefix}${word}`
  const highlight = options.frame % word.length
  const animated = Array.from(word).map((character, index) => {
    if (index === highlight) return c.bold(c.cyan(character))
    if (Math.abs(index - highlight) === 1) return c.blue(character)
    return c.dim(character)
  }).join("")
  return `${prefix}${animated}`
}

export class DeepPulseClock {
  private readonly motion: MotionPreference
  private readonly onTick: (tick: DeepPulseTick) => void
  private timer: ReturnType<typeof setTimeout> | null = null
  private frame = 10
  private settled = true
  private completionRequested = false
  private completionPulse = false
  private entrance = false
  private active = false
  private occluded = false

  constructor(motion: MotionPreference, onTick: (tick: DeepPulseTick) => void) {
    this.motion = motion
    this.onTick = onTick
  }

  start(): void {
    this.disposeTimer()
    this.completionRequested = false
    this.completionPulse = false
    if (this.motion !== "full") {
      this.frame = 10
      this.settled = true
      this.entrance = false
      this.onTick({ frame: this.frame, completion: false, settled: true })
      return
    }
    this.frame = 0
    this.settled = false
    this.entrance = true
    this.onTick({ frame: this.frame, completion: false, settled: false })
    this.ensureTicker()
  }

  collapse(): void {
    if (this.settled && this.timer === null) return
    this.disposeTimer()
    this.completionRequested = false
    this.completionPulse = false
    this.entrance = false
    this.frame = 10
    this.settled = true
    this.onTick({ frame: this.frame, completion: false, settled: true })
    if (this.active) this.ensureTicker()
  }

  setActive(active: boolean): void {
    this.active = active
    if (!active && !this.entrance && !this.completionPulse) this.disposeTimer()
    else this.ensureTicker()
  }

  setOccluded(occluded: boolean): void {
    if (this.occluded === occluded) return
    this.occluded = occluded
    if (occluded) {
      this.disposeTimer()
      return
    }
    if (this.completionPulse) {
      this.completionPulse = false
      this.frame = 10
      this.settled = true
      this.onTick({ frame: this.frame, completion: false, settled: true })
    }
    this.ensureTicker()
  }

  complete(): void {
    if (this.motion === "off") {
      this.disposeTimer()
      this.completionRequested = false
      this.completionPulse = false
      this.entrance = false
      this.frame = 10
      this.settled = true
      this.onTick({ frame: this.frame, completion: false, settled: true })
      return
    }
    if (this.motion === "full" && !this.settled && this.frame < 3) {
      this.completionRequested = true
      return
    }
    this.beginCompletionPulse()
  }

  private beginCompletionPulse(): void {
    this.disposeTimer()
    this.completionRequested = false
    this.completionPulse = true
    this.entrance = false
    this.frame = 0
    this.settled = false
    this.onTick({ frame: this.frame, completion: true, settled: false })
    if (this.occluded) {
      this.completionPulse = false
      this.frame = 10
      this.settled = true
      this.onTick({ frame: this.frame, completion: false, settled: true })
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.completionPulse = false
      this.frame = 10
      this.settled = true
      this.onTick({ frame: this.frame, completion: false, settled: true })
      this.ensureTicker()
    }, 160)
    this.timer.unref?.()
  }

  dispose(): void {
    this.active = false
    this.entrance = false
    this.completionPulse = false
    this.disposeTimer()
  }

  private ensureTicker(): void {
    if (this.motion !== "full" || this.occluded || this.completionPulse || this.timer !== null) return
    if (!this.entrance && !this.active) return
    this.timer = setInterval(() => {
      if (this.entrance) {
        this.frame += 1
        if (this.frame >= 10) {
          this.entrance = false
          this.frame = 10
          this.settled = true
          this.onTick({ frame: this.frame, completion: false, settled: true })
          if (!this.active) this.disposeTimer()
          return
        }
        this.onTick({ frame: this.frame, completion: false, settled: false })
        if (this.completionRequested && this.frame >= 3) this.beginCompletionPulse()
        return
      }
      this.frame = (this.frame + 1) % 10
      this.settled = true
      this.onTick({ frame: this.frame, completion: false, settled: true })
    }, 80)
    this.timer.unref?.()
  }

  private disposeTimer(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

/** Shared visual ticker used by welcome, activity, and pending tool accents. */
export class VisualClock extends DeepPulseClock {}

export class ElapsedClock {
  private readonly onTick: (seconds: number) => void
  private readonly now: () => number
  private timer: ReturnType<typeof setInterval> | null = null
  private startedAt = 0

  constructor(onTick: (seconds: number) => void, now: () => number = Date.now) {
    this.onTick = onTick
    this.now = now
  }

  start(): void {
    this.stop()
    this.startedAt = this.now()
    this.onTick(0)
    this.timer = setInterval(() => {
      this.onTick(Math.max(0, Math.floor((this.now() - this.startedAt) / 1_000)))
    }, 1_000)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.stop()
  }
}
