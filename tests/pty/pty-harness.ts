import { spawn } from "node-pty"
import { visibleWidth } from "@earendil-works/pi-tui"
import { sanitizeTerminalText } from "../../src/text.ts"

interface ScreenBuffer {
  resize(columns: number, rows: number): void
  write(data: string): void
  text(): string
}

function createScreen(columns: number, rows: number): ScreenBuffer {
  let width = columns
  let height = rows
  let cells = Array.from({ length: height }, () => Array.from({ length: width }, () => " "))
  let cursorRow = 0
  let cursorColumn = 0

  const clear = () => {
    cells = Array.from({ length: height }, () => Array.from({ length: width }, () => " "))
    cursorRow = 0
    cursorColumn = 0
  }
  const clamp = () => {
    cursorRow = Math.max(0, Math.min(height - 1, cursorRow))
    cursorColumn = Math.max(0, Math.min(width, cursorColumn))
  }
  const eraseLine = () => {
    const start = Math.min(width, cursorColumn)
    for (let column = start; column < width; column += 1) cells[cursorRow]![column] = " "
  }
  const advanceRow = () => {
    if (cursorRow < height - 1) {
      cursorRow += 1
      return
    }
    cells.shift()
    cells.push(Array.from({ length: width }, () => " "))
    cursorRow = height - 1
  }
  const applyCsi = (params: string, final: string) => {
    const privateMode = params.startsWith("?")
    const values = params.replace(/^\?/, "").split(";").map((value) => Number.parseInt(value || "0", 10))
    const amount = values[0] || 1
    if (final === "A") cursorRow -= amount
    else if (final === "B") cursorRow += amount
    else if (final === "C") cursorColumn += amount
    else if (final === "D") cursorColumn -= amount
    else if (final === "G") cursorColumn = Math.max(0, amount - 1)
    else if (final === "d") cursorRow = Math.max(0, amount - 1)
    else if (final === "H" || final === "f") {
      cursorRow = Math.max(0, (values[0] || 1) - 1)
      cursorColumn = Math.max(0, (values[1] || 1) - 1)
    } else if (final === "J" && (values[0] === 2 || values[0] === 3)) clear()
    else if (final === "K") {
      if (values[0] === 2) cells[cursorRow] = Array.from({ length: width }, () => " ")
      else eraseLine()
    } else if (privateMode && (final === "h" || final === "l")) {
      // Cursor, bracketed paste, and synchronized output modes do not affect text.
    }
    clamp()
  }

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth
      height = nextHeight
      clear()
    },
    write(data) {
      for (let index = 0; index < data.length; index += 1) {
        const character = data[index]!
        if (character === "\u001b") {
          const next = data[index + 1]
          if (next === "]") {
            index += 2
            while (index < data.length && data[index] !== "\u0007" && !(data[index] === "\u001b" && data[index + 1] === "\\")) index += 1
            if (data[index] === "\u001b") index += 1
            continue
          }
          if (next === "[") {
            let end = index + 2
            while (end < data.length && !/[\x40-\x7e]/.test(data[end]!)) end += 1
            if (end < data.length) {
              applyCsi(data.slice(index + 2, end), data[end]!)
              index = end
            } else index = data.length
            continue
          }
          index += 1
          continue
        }
        if (character === "\r") cursorColumn = 0
        else if (character === "\n") advanceRow()
        else if (character === "\b") cursorColumn = Math.max(0, cursorColumn - 1)
        else if (character >= " ") {
          const cellWidth = Math.max(1, visibleWidth(character))
          if (cursorColumn >= width || cursorColumn + cellWidth > width) {
            cursorColumn = 0
            advanceRow()
          }
          if (cursorRow >= 0 && cursorRow < height && cursorColumn < width) {
            cells[cursorRow]![cursorColumn] = character
            for (let offset = 1; offset < cellWidth && cursorColumn + offset < width; offset += 1) {
              cells[cursorRow]![cursorColumn + offset] = ""
            }
          }
          cursorColumn += cellWidth
        }
        clamp()
      }
    },
    text() {
      return cells.map((row) => row.join("").trimEnd()).join("\n")
    },
  }
}

export interface PtyHarness {
  readonly raw: () => string
  readonly rawLength: () => number
  readonly screenText: () => string
  write(data: string): void
  resize(columns: number, rows: number): void
  waitForText(needle: string, timeoutMs?: number, fromOffset?: number): Promise<void>
  waitForRaw(needle: string, timeoutMs?: number, fromOffset?: number): Promise<void>
  waitForExit(): Promise<{ exitCode: number; signal: number | null }>
  kill(): void
}

export function spawnTui(
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; cols?: number; rows?: number } = {},
): PtyHarness {
  const columns = options.cols ?? 80
  const rows = options.rows ?? 24
  const environment = Object.fromEntries(
    Object.entries({ ...process.env, ...options.env }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  const terminal = spawn(process.execPath, [...args], {
    name: "xterm-256color",
    cols: columns,
    rows,
    cwd: options.cwd ?? process.cwd(),
    env: environment,
    encoding: "utf8",
  })
  const screen = createScreen(columns, rows)
  let raw = ""
  let exit: { exitCode: number; signal: number | null } | null = null
  let resolveExit: ((value: { exitCode: number; signal: number | null }) => void) | null = null
  const exited = new Promise<{ exitCode: number; signal: number | null }>((resolve) => { resolveExit = resolve })
  terminal.onData((data) => {
    raw += data
    screen.write(data)
  })
  terminal.onExit(({ exitCode, signal }) => {
    const result = { exitCode, signal: signal ?? null }
    exit = result
    resolveExit?.(result)
  })

  return {
    raw: () => raw,
    rawLength: () => raw.length,
    screenText: () => screen.text(),
    write(data) { terminal.write(data) },
    resize(nextWidth, nextHeight) {
      screen.resize(nextWidth, nextHeight)
      terminal.resize(nextWidth, nextHeight)
    },
    async waitForText(needle, timeoutMs = 8_000, fromOffset = 0) {
      const started = Date.now()
      while (!sanitizeTerminalText(raw.slice(fromOffset)).includes(needle) && (fromOffset > 0 || !screen.text().includes(needle))) {
        if (Date.now() - started > timeoutMs) {
          const rawTail = sanitizeTerminalText(raw).slice(-500).replace(/\n/g, "\\n")
          const screenTail = screen.text().slice(-1000).replace(/\n/g, "\\n")
          throw new Error(`PTY output did not contain ${needle}; raw tail: ${rawTail}; screen tail: ${screenTail}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    },
    async waitForRaw(needle, timeoutMs = 8_000, fromOffset = 0) {
      const started = Date.now()
      while (!raw.slice(fromOffset).includes(needle)) {
        if (Date.now() - started > timeoutMs) {
          throw new Error(`raw PTY output did not contain ${JSON.stringify(needle)}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    },
    async waitForExit() {
      return exit ?? exited
    },
    kill() {
      try { terminal.kill() } catch {}
    },
  }
}
