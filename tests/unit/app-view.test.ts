import { describe, expect, it } from "vitest"
import { Markdown, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui"
import type { Component } from "@earendil-works/pi-tui"
import type { AppState } from "../../src/controller.ts"
import { headerText, statusText, toolResultText } from "../../src/ui/app-view.ts"
import { createStreamingMarkdownView } from "../../src/ui/streaming-markdown.ts"
import { markdownTheme } from "../../src/ui/theme.ts"

const state: AppState = {
  phase: "ready",
  sessionId: "session-1234",
  usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 },
  costUsd: 0.000123,
  activeOverlay: null,
  backendMessage: null,
  transcript: [],
  partialAssistantText: "",
  queuedPrompt: null,
  activity: { kind: "idle" },
  interruption: null,
}

describe("TUI presentation", () => {
  it("reparses only the active Markdown tail while stable blocks keep their identity", () => {
    let parsedBytes = 0
    class CountedMarkdown implements Component {
      constructor(private text: string) { parsedBytes += text.length }
      setText(text: string): void {
        this.text = text
        parsedBytes += text.length
      }
      render(): string[] { return [this.text] }
      invalidate(): void {}
    }
    const stream = createStreamingMarkdownView({ markdown: (text) => new CountedMarkdown(text) })

    stream.setText("First paragraph.\n\n```ts\nconst value = 1\n")
    const firstStable = stream.element.children[0]
    const childrenBeforeTailGrowth = stream.element.children.length
    stream.setText("First paragraph.\n\n```ts\nconst value = 1\nconst next = 2\n")

    expect(stream.text).toBe("First paragraph.\n\n```ts\nconst value = 1\nconst next = 2\n")
    expect(stream.element.children[0]).toBe(firstStable)
    expect(stream.element.children).toHaveLength(childrenBeforeTailGrowth)

    stream.setText(`${stream.text}\`\`\`\n\nLast paragraph.`)
    expect(stream.element.children.length).toBeGreaterThan(childrenBeforeTailGrowth)
    expect(parsedBytes).toBeLessThan(220)
  })

  it("keeps fences and display math active until they close and resets on replacement", () => {
    class LiteralMarkdown implements Component {
      constructor(private text: string) {}
      setText(text: string): void { this.text = text }
      render(): string[] { return [this.text] }
      invalidate(): void {}
    }
    const stream = createStreamingMarkdownView({ markdown: (text) => new LiteralMarkdown(text) })

    stream.setText("```ts\n\ninside fence\n")
    expect(stream.element.children).toHaveLength(1)
    stream.setText(`${stream.text}\`\`\`\n\n$$\n\ninside math\n`)
    expect(stream.element.children).toHaveLength(2)
    stream.setText(`${stream.text}$$\n\n尾部`)
    expect(stream.element.children.length).toBeGreaterThan(2)
    expect(stream.element.render(80).join("")).toBe(stream.text)

    stream.setText("replacement")
    expect(stream.text).toBe("replacement")
    expect(stream.element.children).toHaveLength(1)
    expect(stream.element.render(80).join("")).toBe("replacement")
  })

  it("keeps block-heavy stream parsing growth linear", () => {
    let parsedBytes = 0
    class CountedMarkdown implements Component {
      constructor(private text: string) { parsedBytes += text.length }
      setText(text: string): void {
        this.text = text
        parsedBytes += text.length
      }
      render(): string[] { return [this.text] }
      invalidate(): void {}
    }
    const stream = createStreamingMarkdownView({ markdown: (text) => new CountedMarkdown(text) })
    let source = ""
    for (let index = 0; index < 200; index += 1) {
      source += `Block ${index}\n\n`
      stream.setText(source)
    }

    expect(stream.text).toBe(source)
    expect(parsedBytes).toBeLessThan(source.length * 2)
  })

  it("keeps blank lines inside a list in one Markdown block", () => {
    const source = "1. First item\n\n1. Second item\n\nAfter the list."
    const stream = createStreamingMarkdownView({
      markdown: (text) => new Markdown(text, 1, 0, markdownTheme),
    })
    for (let end = 1; end <= source.length; end += 1) stream.setText(source.slice(0, end))

    expect(stream.element.render(48)).toEqual(new Markdown(source, 1, 0, markdownTheme).render(48))
  })

  it("keeps header copy within narrow terminal widths", () => {
    expect(visibleWidth(headerText(48))).toBeLessThanOrEqual(48)
    expect(visibleWidth(headerText(64))).toBeLessThanOrEqual(64)
    expect(visibleWidth(headerText(80))).toBeLessThanOrEqual(80)
  })

  it("renders starting instead of falsely reporting ready", () => {
    const text = statusText({ ...state, phase: "starting", sessionId: null }, { mode: "acp", model: "deepseek-v4-flash" }, 48)
    expect(text).toContain("starting")
    expect(text).not.toContain("ready")
    expect(visibleWidth(text)).toBeLessThanOrEqual(48)
  })

  it("keeps a transient notice visible in a narrow status bar", () => {
    const text = statusText(state, { mode: "echo", model: "deepseek-v4-flash", notice: "Ctrl+C again to exit" }, 48)
    expect(text).toContain("Ctrl+C again to exit")
    expect(visibleWidth(text)).toBeLessThanOrEqual(48)
  })

  it("shows real activity with a stable-width status segment", () => {
    const activities: AppState["activity"][] = [
      { kind: "thinking" },
      { kind: "responding" },
      { kind: "tool", name: "read_file" },
      { kind: "approval", name: "bash" },
    ]
    const statuses = activities.map((activity) => stripTerminalSequences(statusText(
      { ...state, phase: "working", activity },
      { mode: "acp", model: "deepseek-v4-flash", elapsedSeconds: 3 },
      80,
    )))

    expect(statuses[0]).toContain("thinking")
    expect(statuses[1]).toContain("responding")
    expect(statuses[2]).toContain("tool read_file")
    expect(statuses[3]).toContain("approval bash")
    expect([...new Set(statuses.map((text) => text.indexOf(" · 3s")))]).toHaveLength(1)
    expect(statuses.every((text) => visibleWidth(text) <= 80)).toBe(true)
  })

  it("keeps phase and model ahead of low-priority details on a narrow terminal", () => {
    const text = stripTerminalSequences(statusText(
      { ...state, phase: "working", activity: { kind: "thinking" } },
      { mode: "acp", model: "deepseek-v4-flash", elapsedSeconds: 12 },
      32,
    ))

    expect(text).toContain("thinking")
    expect(text).toContain("deepseek")
    expect(text).not.toContain("cached")
    expect(visibleWidth(text)).toBeLessThanOrEqual(32)

    const responding = stripTerminalSequences(statusText(
      { ...state, phase: "working", activity: { kind: "responding" } },
      { mode: "acp", model: "deepseek-v4-flash" },
      32,
    ))
    expect(responding).toContain("responding")
    expect(responding.indexOf("deepseek")).toBe(text.indexOf("deepseek"))

    const cjkTool = stripTerminalSequences(statusText(
      { ...state, phase: "working", activity: { kind: "tool", name: "读取文件" } },
      { mode: "acp", model: "deepseek-v4-flash" },
      32,
    ))
    expect(visibleWidth(cjkTool.slice(0, cjkTool.indexOf("deepseek"))))
      .toBe(visibleWidth(text.slice(0, text.indexOf("deepseek"))))

    const tighter = stripTerminalSequences(statusText(
      { ...state, phase: "working", activity: { kind: "thinking" } },
      { mode: "acp", model: "deepseek-v4-flash" },
      20,
    ))
    expect(tighter).toContain("thinking")
    expect(tighter).toContain("deep")
    expect(visibleWidth(tighter)).toBeLessThanOrEqual(20)
  })

  it("truncates tool results to the visible terminal width", () => {
    const text = toolResultText({ kind: "tool-result", name: "tool", text: "结果 ".repeat(100), isError: false }, 48)
    expect(visibleWidth(text)).toBeLessThanOrEqual(48)
  })
})
