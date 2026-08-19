# dsh-tui Live Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dsh-tui feel immediate by carrying real DSH activity and text over an optional fd 3 event pipe, reconciling it with authoritative ACP output, preserving startup input, rendering streamed Markdown incrementally, and adding a non-blocking Deep Pulse entrance.

**Architecture:** ACP stdout remains the correctness channel, a shipped Cordis plugin writes normalized transient events to child fd 3, and JSONL remains history and fallback telemetry. The parent validates the live wire through a decoder module, an assistant-stream module hides ordering and reconciliation, the controller owns lifecycle/activity/queue state, and the view coalesces incremental rendering and animation behind its existing interface.

**Tech Stack:** Node.js 22+, TypeScript 6, Vitest 4, `@deepseek-ai/dsh-*` 0.1.0-rc.7, `@earendil-works/pi-tui` 0.84.2, JSONL/NDJSON, node-pty.

## Global Constraints

- ACP stdout is authoritative for prompts, permissions, cancellation, session lifecycle, committed output, and prompt settlement.
- fd 3 is optional and may carry only normalized version-1 activity, assistant text, tool, usage, and turn records.
- JSONL remains durable history, diagnostics, usage/tool fallback, and post-run observability.
- Raw model reasoning text must be discarded inside the child and must never cross fd 3, enter diagnostics, or render in the TUI.
- Live records and unfinished decoder buffers are limited to 1 MiB; tool arguments and results are limited to 64 KiB.
- A malformed, absent, closed, or unknown-version live pipe must degrade to ACP without failing a prompt.
- The application must not add a 60 Hz render loop; ordinary paint scheduling remains coalesced by pi-tui.
- Entrance animation uses at most 13 frames per second, never delays input or backend startup, and respects `NO_COLOR`, non-TTY, `off`, and `reduced` motion.
- Tests cross only the confirmed decoder, assistant-stream, controller/view, and CLI PTY seams.
- No test depends on a real API key, network call, or external model latency.
- Do not push, tag, publish, create a GitHub Release, or change repository visibility.

---

## File Map

- Create `src/backend/live-record.ts`: normalized wire types, bounded incremental decoder, record validation, and sanitized diagnostics.
- Create `src/backend/assistant-stream.ts`: ordered live assistant assembly and authoritative ACP reconciliation behind one five-method interface.
- Create `config/dsh-tui-live-events.mjs`: Cordis session-event tap that writes safe version-1 records to fd 3.
- Modify `config/cordis.posix.yml` and `config/cordis.windows.yml`: load the shipped tap before the ACP composition.
- Modify `src/backend/acp-client.ts`: spawn fd 3, decode live records, dispatch them, and keep ACP output authoritative.
- Modify `tests/fixtures/fake-acp-server.mjs`: deterministic live-pipe scenarios with split UTF-8, activity, final text, malformed input, and pipe closure.
- Create `src/perf.ts`: monotonic per-turn marks and opt-in sanitized diagnostics.
- Modify `src/controller.ts`: activity, startup queue, stream snapshots, live tools/usage dedupe, interruption state, and perf marks.
- Modify `src/app.ts`: wire live events, editor draft actions, stream module, and cleanup.
- Create `src/ui/streaming-markdown.ts`: append-only stable-block scanner and cached stable/tail Markdown containers.
- Create `src/ui/deep-pulse.ts`: pure responsive frame selection and disposable 80 ms animation clock.
- Modify `src/ui/app-view.ts`: startup queue editor behavior, live activity/status, streaming Markdown, entrance rendering, elapsed timer, and perf paint mark.
- Modify `src/config.ts` and `src/cli.ts`: strict `DSH_TUI_MOTION` and `DSH_TUI_PERF` configuration.
- Create `tests/unit/live-record.test.ts`, `tests/unit/assistant-stream.test.ts`, `tests/unit/perf.test.ts`, `tests/unit/deep-pulse.test.ts`: behavior at the approved seams.
- Modify `tests/integration/acp-client.test.ts`, `tests/unit/controller.test.ts`, `tests/unit/app-view.test.ts`, and `tests/pty/tui-acp.test.ts`: end-to-end live, queue, render, failure, and cleanup behavior.
- Modify `scripts/check-composition.mjs`: assert both compositions load the shipped live plugin.
- Modify `README.md` and `README.zh-CN.md`: document visible activity, motion/perf controls, and latency limits without promising provider speed.

---

### Task 1: Decode and validate the optional live-event wire

**Files:**
- Create: `src/backend/live-record.ts`
- Create: `tests/unit/live-record.test.ts`

**Interfaces:**
- Consumes: arbitrary `Buffer | string` chunks from child fd 3.
- Produces: `DshLiveRecord`, `LiveRecordDecoder.push(chunk)`, `LiveRecordDecoder.end()`, and one bounded diagnostic callback.

- [x] **Step 1: Write a failing decoder test for split UTF-8 and split lines**

```ts
it("decodes split UTF-8 records without waiting for another line", () => {
  const records: DshLiveRecord[] = []
  const decoder = new LiveRecordDecoder({ sessionId: () => "s-1", onRecord: (record) => records.push(record), onDiagnostic: () => {} })
  const line = Buffer.from(`${JSON.stringify({ v: 1, sessionId: "s-1", seq: 3, kind: "text-delta", turn: 1, step: 1, index: 0, text: "你好" })}\n`)
  decoder.push(line.subarray(0, line.length - 2))
  decoder.push(line.subarray(line.length - 2))
  expect(records).toEqual([{ v: 1, sessionId: "s-1", seq: 3, kind: "text-delta", turn: 1, step: 1, index: 0, text: "你好" }])
})
```

- [x] **Step 2: Run the focused test and verify red**

Run: `npx vitest run tests/unit/live-record.test.ts`

Expected: FAIL because `src/backend/live-record.ts` does not exist.

- [x] **Step 3: Implement the bounded decoder and discriminated record validation**

Implement `LIVE_LINE_LIMIT = 1_048_576`, `LIVE_TOOL_TEXT_LIMIT = 65_536`, the exact `DshLiveRecord` union from the design, and:

```ts
export class LiveRecordDecoder {
  constructor(options: {
    sessionId(): string | null
    onRecord(record: DshLiveRecord): void
    onDiagnostic(message: string): void
  })
  push(chunk: Buffer | string): void
  end(): void
}
```

Use `StringDecoder("utf8")`, split only on newline, reject records whose version, session, finite non-negative integer coordinates, activity enum, booleans, or bounded strings are invalid, and emit only one generic diagnostic per failure class. Never include the rejected line in diagnostics.

- [x] **Step 4: Add one test per security/degradation behavior**

Cover stale sessions, unknown version, malformed JSON, terminal-control sanitization, a line over 1 MiB, an unfinished buffer over 1 MiB, invalid numbers, and repeated malformed input producing one bounded diagnostic.

- [x] **Step 5: Run checks and commit**

Run: `npx vitest run tests/unit/live-record.test.ts && npm run typecheck`

Expected: PASS.

Commit: `feat: decode bounded live backend records`

---

### Task 2: Assemble transient assistant output and reconcile ACP commits

**Files:**
- Create: `src/backend/assistant-stream.ts`
- Create: `tests/unit/assistant-stream.test.ts`

**Interfaces:**
- Consumes: validated `DshLiveRecord` values and committed ACP text.
- Produces: `AssistantStream` and immutable `AssistantStreamSnapshot` exactly as specified in the design.

- [x] **Step 1: Write the failing tracer test**

```ts
it("replaces streamed deltas with the matching final block and then exact ACP text", () => {
  const stream = createAssistantStream()
  stream.begin("s-1")
  stream.apply({ v: 1, sessionId: "s-1", seq: 1, kind: "turn-start", turn: 1 })
  stream.apply({ v: 1, sessionId: "s-1", seq: 2, kind: "text-delta", turn: 1, step: 1, index: 0, text: "hel" })
  expect(stream.apply({ v: 1, sessionId: "s-1", seq: 3, kind: "text-final", turn: 1, step: 1, index: 0, text: "hello" }).text).toBe("hello")
  expect(stream.reconcileCommitted("hello!")).toMatchObject({ text: "hello!", committed: true })
})
```

- [x] **Step 2: Run the test and verify red**

Run: `npx vitest run tests/unit/assistant-stream.test.ts`

Expected: FAIL because the stream module does not exist.

- [x] **Step 3: Implement the deep module**

Expose only:

```ts
export interface AssistantStream {
  begin(sessionId: string): AssistantStreamSnapshot
  apply(record: DshLiveRecord): AssistantStreamSnapshot
  reconcileCommitted(text: string): AssistantStreamSnapshot
  interrupt(kind: "cancelled" | "outcome-unknown"): AssistantStreamSnapshot
  reset(): AssistantStreamSnapshot
}

export function createAssistantStream(): AssistantStream
```

Hide the block map, highest sequence, turn, and step ordering. Ignore duplicate/stale sequences and wrong sessions; replace block text on `text-final`; preserve block-index order; make repeated ACP reconciliation idempotent; and return fresh frozen snapshots.

- [x] **Step 4: Add ordering, dedupe, interruption, reset, and stale-event tests**

Use known literal snapshots for multiple indexes, duplicate `seq`, an older turn after a newer turn, wrong session, cancellation, unknown outcome, and post-reset records.

- [x] **Step 5: Run checks and commit**

Run: `npx vitest run tests/unit/assistant-stream.test.ts && npm run typecheck`

Expected: PASS.

Commit: `feat: reconcile live and committed assistant output`

---

### Task 3: Tap DSH session events and carry them over fd 3

**Files:**
- Create: `config/dsh-tui-live-events.mjs`
- Modify: `config/cordis.posix.yml`
- Modify: `config/cordis.windows.yml`
- Modify: `src/backend/acp-client.ts`
- Modify: `tests/fixtures/fake-acp-server.mjs`
- Modify: `tests/integration/acp-client.test.ts`
- Modify: `scripts/check-composition.mjs`

**Interfaces:**
- Consumes: Cordis `session/event` records and child fd 3 bytes.
- Produces: `AcpClientEvents.onLiveRecord(record)` while preserving existing ACP callbacks.

- [x] **Step 1: Extend the fake backend and write a failing integration test**

The fake `live-stream` scenario writes a thinking record, two text deltas, and a text final to fd 3 before sending one authoritative ACP `agent_message_chunk`. Assert live callbacks arrive before prompt settlement and ACP text still arrives separately.

```ts
expect(events.live.map((record) => record.kind)).toEqual(["turn-start", "activity", "text-delta", "text-delta", "text-final", "turn-end"])
expect(events.chunks).toEqual(["hello!"])
```

- [x] **Step 2: Run the integration test and verify red**

Run: `npx vitest run tests/integration/acp-client.test.ts -t "carries live records"`

Expected: FAIL because `AcpClientEvents.onLiveRecord` and fd 3 are absent.

- [x] **Step 3: Implement child fd 3 ownership in `AcpClient`**

Spawn with `stdio: ["pipe", "pipe", "pipe", "pipe"]`; type the child as `ChildProcessByStdio<Writable, Readable, Readable>` plus `stdio[3]`; connect `LiveRecordDecoder`; close/end the decoder during child finalization; and ensure live-pipe errors emit one sanitized diagnostic but never reject ACP requests.

- [x] **Step 4: Implement the shipped Cordis event tap**

Export `name = "dsh-tui-live-events"` and `apply(ctx)`. Open fd 3 with `createWriteStream(null, { fd: 3, autoClose: false })`, stop after stream error/backpressure failure, and map only `turn/start`, `turn/end`, `assistant/chunk`, `assistant/message`, `tool/call`, and `tool/result`. Map reasoning chunks to generic `activity: "thinking"` without text; map text chunks to `activity: "responding"` plus `text-delta`; map text block ends/messages to bounded `text-final`; reduce tool result content to bounded safe text; include the original `event.seq` in every output record.

- [x] **Step 5: Load the plugin in both platform compositions**

Insert this entry before `acp-agent`:

```yaml
- id: dsh-tui-live-events
  name: './dsh-tui-live-events.mjs'
```

Extend composition checks to require the relative module and verify the package includes it.

- [x] **Step 6: Add live-pipe degradation integration cases**

Cover split UTF-8, malformed live JSON, wrong session before session creation, early fd 3 close, oversized lines, and normal ACP completion after each live failure.

- [x] **Step 7: Run checks and commit**

Run: `npx vitest run tests/unit/live-record.test.ts tests/integration/acp-client.test.ts && npm run composition:check && npm run typecheck`

Expected: PASS.

Commit: `feat: stream DSH activity over a side channel`

---

### Task 4: Add controller activity, editable startup queue, live tools, and exactly-once usage

**Files:**
- Modify: `src/controller.ts`
- Modify: `src/app.ts`
- Modify: `tests/unit/controller.test.ts`

**Interfaces:**
- Consumes: backend ACP events, assistant-stream snapshots, live tool/usage records, session-log fallback, and editor draft changes.
- Produces: observable `AppState` with `activity`, `queuedPrompt`, `partialAssistantText`, interruption, stable tool cards, and deduplicated usage.

- [x] **Step 1: Write a failing startup-queue controller test**

Hold `backend.newSession()`, call `submit("first")`, call `updateDraft("first edited")`, release session creation, and assert `backend.prompt` is called exactly once with `"first edited"`; assert no diagnostic says the backend is unready.

- [x] **Step 2: Run the test and verify red**

Run: `npx vitest run tests/unit/controller.test.ts -t "queues one editable startup prompt"`

Expected: FAIL because `queuedPrompt` and `updateDraft` do not exist.

- [x] **Step 3: Add controller state and normal prompt-path queue draining**

Add:

```ts
export type AppActivity =
  | { kind: "boot"; stage: "backend" | "session" }
  | { kind: "idle" | "thinking" | "responding" }
  | { kind: "tool" | "approval"; name: string }

interface AppState {
  activity: AppActivity
  queuedPrompt: string | null
  interruption: "cancelled" | "outcome-unknown" | null
}
```

Make `start()` set backend/session boot stages, queue one starting submission, let `updateDraft()` replace it, drain the latest value through the same private prompt method after readiness, keep failed startup text queued, and reject second Enter without destroying draft content.

- [x] **Step 4: Write and pass live-stream reconciliation tests**

Inject `AssistantStream`; assert thinking activity appears before text, live text replaces rather than duplicates final blocks, ACP commit is exact and idempotent, stale records after a new session are ignored, cancellation preserves text with a cancelled marker, and backend exit preserves text with outcome unknown.

- [x] **Step 5: Write and pass live tool/usage dedupe tests**

Maintain live tool entries by call id and dedupe terminal tool states. Key usage by `turn:step`; when JSONL later reports the same assistant-message usage, do not add it again. Keep JSONL-only sessions working.

- [x] **Step 6: Wire the stream in `runApp`**

Create one assistant stream, call `begin()` on session change, route `onLiveRecord`, route committed ACP text through `reconcileCommitted`, and connect editor draft changes to `controller.updateDraft`.

- [x] **Step 7: Run checks and commit**

Run: `npx vitest run tests/unit/controller.test.ts tests/unit/app.test.ts && npm run typecheck`

Expected: PASS.

Commit: `feat: expose live turn state and preserve startup input`

---

### Task 5: Render streamed Markdown incrementally

**Files:**
- Create: `src/ui/streaming-markdown.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `tests/unit/app-view.test.ts`

**Interfaces:**
- Consumes: monotonically extending assistant text or a replacement after reconciliation.
- Produces: visually equivalent stable Markdown blocks plus one mutable active tail through the controller/view seam.

- [ ] **Step 1: Write a failing view-seam test for append-only parsing**

Inject a counted Markdown factory into the streaming view module, append a paragraph, a blank line, a fenced code block split across updates, and a final paragraph. Assert frozen blocks are not reparsed when only the tail grows and the concatenated source remains the exact input.

- [ ] **Step 2: Run the test and verify red**

Run: `npx vitest run tests/unit/app-view.test.ts -t "reparses only the active Markdown tail"`

Expected: FAIL because the streaming Markdown module does not exist.

- [ ] **Step 3: Implement the append-only scanner and view adapter**

Expose one small module interface:

```ts
export interface StreamingMarkdownView {
  setText(text: string): void
  reset(): void
  readonly element: Container
}

export function createStreamingMarkdownView(options: { markdown(text: string): Markdown }): StreamingMarkdownView
```

Scan only newly complete lines, freeze at blank-line boundaries outside triple-backtick/tilde fences and `$$` display math, reset when the incoming text is not a prefix, keep stable Markdown instances immutable, and update only one tail instance while text extends.

- [ ] **Step 4: Replace the single mutable partial Markdown in `AppView`**

Keep committed transcript caching unchanged, insert the stream element where `partialAssistant` currently lives, reset it after commit/session reset, sanitize text before passing it to the stream, and rely on pi-tui's ordinary render coalescing.

- [ ] **Step 5: Add equivalence and linear-growth tests**

Cover headings, paragraphs, lists, CJK text, split fences, split display math, final ACP replacement, shrinking text, and 200 appended blocks. Assert counted source bytes parsed remain below a fixed linear bound derived from the fixture, not from the implementation.

- [ ] **Step 6: Run checks and commit**

Run: `npx vitest run tests/unit/app-view.test.ts && npm run typecheck`

Expected: PASS.

Commit: `perf: render only the active Markdown tail`

---

### Task 6: Add Deep Pulse motion, stable activity status, and responsive editor behavior

**Files:**
- Create: `src/ui/deep-pulse.ts`
- Create: `tests/unit/deep-pulse.test.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `src/config.ts`
- Modify: `src/cli.ts`
- Modify: `tests/unit/config.test.ts`
- Modify: `tests/unit/app-view.test.ts`

**Interfaces:**
- Consumes: width, motion preference, TTY/color capability, app phase/activity, elapsed time, and first user input.
- Produces: a compact original header frame, one disposable animation clock, stable-width status copy, and editor submit/draft state.

- [ ] **Step 1: Write failing configuration and pure-frame tests**

Assert `off`, `reduced`, and `full` parse; invalid values throw; `NO_COLOR` and non-TTY force static mode; widths below 52 use one line; widths below 34 contain no decorative art; frame indexes above 9 settle; no frame exceeds its terminal width.

- [ ] **Step 2: Run the focused tests and verify red**

Run: `npx vitest run tests/unit/config.test.ts tests/unit/deep-pulse.test.ts`

Expected: FAIL because motion configuration and frames are absent.

- [ ] **Step 3: Implement strict motion/perf configuration**

Add `motion: "full" | "reduced" | "off"` and `perf: boolean` to `AppConfig`; read `DSH_TUI_MOTION` and `DSH_TUI_PERF`; accept only `full|reduced|off` and `0|1`; force off when `NO_COLOR` is present; expose both settings in CLI help.

- [ ] **Step 4: Implement Deep Pulse and timer ownership**

Use 8–10 precomputed cyan/blue wordmark frames at 80 ms, one readiness completion pulse, and a static settled header. Export a pure `deepPulseFrame()` and a `DeepPulseClock` with `start()`, `collapse()`, `complete()`, and `dispose()`; use `unref()`; never sleep or await animation.

- [ ] **Step 5: Integrate activity, elapsed time, editor queue, and responsive disclosure**

Set `editor.disableSubmit` whenever a startup prompt is queued, a prompt is working/cancelling, or an overlay is active. Restore queued startup text after pi-tui clears submission, keep `editor.onChange` linked to the queued value, collapse decoration on any user input, show activity labels `thinking`, `responding`, `tool <name>`, or `approval <name>`, tick elapsed time once per second only while active, and hide cost/tokens/session before phase/model on narrow terminals.

- [ ] **Step 6: Add timer disposal and stable-width status tests**

Use fake timers to prove no 80 ms timer remains after collapse/settle/stop, elapsed time stops outside active phases, animation stays under 13 fps, and changing activity labels does not shift the model segment.

- [ ] **Step 7: Run checks and commit**

Run: `npx vitest run tests/unit/config.test.ts tests/unit/deep-pulse.test.ts tests/unit/app-view.test.ts && npm run typecheck`

Expected: PASS.

Commit: `feat: add a non-blocking Deep Pulse entrance`

---

### Task 7: Measure event-to-paint latency and coalesce terminal backpressure

**Files:**
- Create: `src/perf.ts`
- Create: `tests/unit/perf.test.ts`
- Modify: `src/controller.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `tests/unit/controller.test.ts`
- Modify: `tests/unit/app-view.test.ts`

**Interfaces:**
- Consumes: named monotonic turn marks and paint notifications.
- Produces: sanitized backend-wait/frontend-paint metrics only when `DSH_TUI_PERF=1`, plus newest-state coalescing while stdout needs drain.

- [ ] **Step 1: Write a failing perf report test**

Use a fake clock with submit at 100, first live event at 140, first text at 160, first text paint at 172, ACP commit at 300, and settlement at 310. Assert the report is exactly `backend 40ms · text 60ms · paint 12ms · settle 210ms` and contains no event payload.

- [ ] **Step 2: Run the test and verify red**

Run: `npx vitest run tests/unit/perf.test.ts`

Expected: FAIL because `src/perf.ts` does not exist.

- [ ] **Step 3: Implement monotonic marks and sanitized report generation**

Expose `TurnPerf.start(now)`, `mark(name, now)`, `report()`, and `reset()`. Store numbers only. Ignore duplicate marks after their first value and omit unavailable segments.

- [ ] **Step 4: Wire controller and paint marks**

Mark submit, first live event, first visible activity, first live text, ACP commit, and settlement in the controller; let the view acknowledge the first frame containing the current live text; expose only the compact report when perf mode is enabled.

- [ ] **Step 5: Coalesce state while terminal output is backpressured**

In `AppView`, when `process.stdout.writableNeedDrain` is true, retain only the latest state and install one `drain` listener. Input-triggered editor rendering remains owned by pi-tui. Flush the latest state after drain; always flush a final committed state; remove the listener on stop.

- [ ] **Step 6: Add fake-backend latency and backpressure tests**

Drive 100 live snapshots through the view while a fake writable is blocked, release drain, and assert only the newest snapshot renders. Run 50 deterministic event-to-paint samples and assert local P95 is at most 50 ms without network access.

- [ ] **Step 7: Run checks and commit**

Run: `npx vitest run tests/unit/perf.test.ts tests/unit/controller.test.ts tests/unit/app-view.test.ts && npm run typecheck`

Expected: PASS.

Commit: `perf: coalesce live paints and report frontend latency`

---

### Task 8: Prove user-visible behavior in a real PTY and finish release documentation

**Files:**
- Modify: `tests/fixtures/fake-acp-server.mjs`
- Modify: `tests/pty/tui-acp.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/superpowers/plans/2026-08-19-dsh-tui-live-experience-implementation.md`

**Interfaces:**
- Consumes: real key bytes, terminal resize, fake ACP/live records, fd 3 failure, and process shutdown.
- Produces: visible immediate shell/editor/activity/text behavior and clean exit through the CLI PTY seam.

- [ ] **Step 1: Write failing PTY cases for startup queue and live activity**

Add a `slow-start-live` fake scenario. Type and submit before `session/new` settles, edit the queued prompt, and assert it appears once after readiness. Assert `thinking` appears before authoritative ACP text and final text appears once.

- [ ] **Step 2: Run focused PTY tests and verify red**

Run: `npm run test:pty -- -t "startup queue|live activity"`

Expected: at least one new case FAIL before the complete wiring is present.

- [ ] **Step 3: Add PTY regressions for interruption and failure**

Cover cancellation after partial live text, outcome-unknown exit after partial text, malformed/closed fd 3 with successful ACP completion, permission overlay focus, resize below 52 and 34 columns, CJK input, final-output dedupe, and double Ctrl+C cleanup.

- [ ] **Step 4: Document the actual behavior and limitations**

Document the three channels, startup queue, activity labels, Deep Pulse controls, `DSH_TUI_PERF=1`, graceful live-pipe fallback, and the fact that provider time-to-first-token is outside frontend control. Do not document the API key value or imply raw reasoning is shown.

- [ ] **Step 5: Run the complete quality gate**

Run: `npm run check`

Expected: lint, typecheck, all unit/integration/PTy tests, build, composition check, publint, and package checks all PASS.

- [ ] **Step 6: Run one packaged smoke test**

Run: `npm pack --dry-run && npm run install:check`

Expected: the package contains `config/dsh-tui-live-events.mjs`, installed CLI starts in echo mode, and exits cleanly.

- [ ] **Step 7: Mark the plan complete and commit**

Change every completed checkbox in this plan to `[x]`, rerun `git diff --check`, and inspect `git status --short` for only intended files.

Commit: `docs: complete the live experience implementation`

---

## Self-Review Record

- Spec coverage: every objective, three-channel authority rule, security limit, queue behavior, incremental rendering requirement, animation rule, observability mark, degradation path, cleanup rule, and distribution restriction maps to Tasks 1–8.
- Placeholder scan: no unresolved placeholders or future filler remain; every behavior has a file, interface, test command, and expected outcome.
- Type consistency: `DshLiveRecord`, `AssistantStreamSnapshot`, `AppActivity`, `queuedPrompt`, motion values, and perf mark names remain identical from producer through controller/view and tests.
- Execution choice: the user explicitly selected continuous inline execution, so implementation begins immediately after this plan is committed and does not pause for another review gate.
