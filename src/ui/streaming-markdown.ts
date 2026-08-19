import { Container, type Component } from "@earendil-works/pi-tui"

interface MutableMarkdown extends Component {
  setText(text: string): void
}

export interface StreamingMarkdownView {
  readonly element: Container
  readonly text: string
  setText(text: string): void
  reset(): void
}

export function createStreamingMarkdownView(options: {
  markdown(text: string): MutableMarkdown
}): StreamingMarkdownView {
  const element = new Container()
  let source = ""
  let stableEnd = 0
  let scanPosition = 0
  let fence: { marker: "`" | "~"; length: number } | null = null
  let displayMath = false
  let tail = options.markdown("")
  element.addChild(tail)

  const reset = (): void => {
    source = ""
    stableEnd = 0
    scanPosition = 0
    fence = null
    displayMath = false
    element.clear()
    tail = options.markdown("")
    element.addChild(tail)
  }

  const append = (text: string): void => {
    source = text
    let newline = source.indexOf("\n", scanPosition)
    while (newline >= 0) {
      const lineEnd = newline + 1
      const line = source.slice(scanPosition, newline)
      updateScanner(line)
      scanPosition = lineEnd
      if (!fence && !displayMath && line.trim() === "") {
        tail.setText(source.slice(stableEnd, lineEnd))
        stableEnd = lineEnd
        tail = options.markdown("")
        element.addChild(tail)
      }
      newline = source.indexOf("\n", scanPosition)
    }
    tail.setText(source.slice(stableEnd))
  }

  const updateScanner = (line: string): void => {
    const trimmed = line.trim()
    const fenceMatch = /^(?<marker>`{3,}|~{3,})/.exec(trimmed)?.groups?.marker
    if (fenceMatch) {
      const marker = fenceMatch[0] as "`" | "~"
      if (!fence) fence = { marker, length: fenceMatch.length }
      else if (fence.marker === marker && fenceMatch.length >= fence.length) fence = null
      return
    }
    if (!fence && trimmed === "$$") displayMath = !displayMath
  }

  return {
    element,
    get text() { return source },
    setText(text) {
      if (text === source) return
      if (!text.startsWith(source)) reset()
      append(text)
    },
    reset,
  }
}
