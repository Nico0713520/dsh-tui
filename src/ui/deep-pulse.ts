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

  constructor(motion: MotionPreference, onTick: (tick: DeepPulseTick) => void) {
    this.motion = motion
    this.onTick = onTick
  }

  start(): void {
    this.disposeTimer()
    if (this.motion !== "full") {
      this.frame = 10
      this.settled = true
      this.onTick({ frame: this.frame, completion: false, settled: true })
      return
    }
    this.frame = 0
    this.settled = false
    this.onTick({ frame: this.frame, completion: false, settled: false })
    this.timer = setInterval(() => {
      this.frame += 1
      if (this.frame >= 10) {
        this.disposeTimer()
        this.settled = true
        this.onTick({ frame: 10, completion: false, settled: true })
        return
      }
      this.onTick({ frame: this.frame, completion: false, settled: false })
    }, 80)
    this.timer.unref?.()
  }

  collapse(): void {
    if (this.settled && this.timer === null) return
    this.disposeTimer()
    this.frame = 10
    this.settled = true
    this.onTick({ frame: this.frame, completion: false, settled: true })
  }

  complete(): void {
    this.disposeTimer()
    if (this.motion === "off") {
      this.frame = 10
      this.settled = true
      this.onTick({ frame: this.frame, completion: false, settled: true })
      return
    }
    this.frame = 0
    this.settled = false
    this.onTick({ frame: this.frame, completion: true, settled: false })
    this.timer = setTimeout(() => {
      this.timer = null
      this.frame = 10
      this.settled = true
      this.onTick({ frame: this.frame, completion: false, settled: true })
    }, 160)
    this.timer.unref?.()
  }

  dispose(): void {
    this.disposeTimer()
  }

  private disposeTimer(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

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
