# dsh-tui Live Experience, Performance, and Stability Design

## Objective

Upgrade the existing v0.1 release candidate so it feels immediate and polished without weakening ACP correctness. The product should paint and accept input immediately, expose real DeepSeek activity before the committed answer arrives, stream available text without quadratic Markdown work, remain responsive under long output and terminal backpressure, and add a short original entrance treatment that never delays readiness.

This design extends `2026-08-18-dsh-tui-v0.1-design.md`. Its safety, fresh-session, permission, packaging, platform, and no-automatic-replay decisions remain in force. Work is divided by independently testable deliverables, not elapsed time. Implementation batches run continuously with automated checks rather than manual review gates between batches.

## Evidence and Current Constraints

The current renderer is not the primary source of the visible delay:

- `@earendil-works/pi-tui@0.84.2` coalesces ordinary renders to a 16 ms cadence, prioritizes keyboard-triggered rendering, caches `Text` and `Markdown` output by text and width, and writes only changed terminal lines.
- The bundled DSH ACP bridge observes `assistant/message`, then converts committed content into ACP `agent_message_chunk` updates. It does not forward raw `assistant/chunk` events. The current TUI therefore normally receives an answer only after the step has committed.
- DSH persistence already records `assistant/chunk` events including block start/end, reasoning activity, text deltas, usage, and finish. Actual DeepSeek v4-flash sessions sometimes emit sparse text deltas and only provide the complete text at block end, so the UI can guarantee early activity feedback but cannot invent token granularity the provider did not emit.
- `AppController.onAssistantText()` currently copies the growing string and renders the full application state for every update. `AppView.render()` then calls `Markdown.setText()` with the complete accumulated message. Once a genuine live stream is attached, this path becomes a secondary bottleneck because the whole Markdown document is repeatedly parsed.
- The TUI starts before the backend session is ready, but a submission during startup is currently rejected after the editor has cleared it. Startup has no state-driven visual sequence and no preserved first prompt.

The design borrows implementation patterns, not branding, from the MIT-licensed Hermes Agent and pi repositories: direct runtime events, first paint before slow initialization, append-only streamed Markdown blocks, bounded shared animation clocks, changed-line rendering, cached animation frames, backpressure coalescing, responsive progressive disclosure, and explicit timer disposal.

## Product Outcomes

The optimized TUI must provide these user-visible outcomes:

1. The shell, editor, compact brand mark, and real startup state appear immediately.
2. Typing remains responsive during startup, streaming, tool work, and overlays.
3. Submitting while startup is in progress queues one prompt. Readiness sends it automatically. Startup failure restores it as an editable draft instead of losing it.
4. The status changes from working to thinking, responding, running a tool, waiting for approval, cancelling, or failed based on real events.
5. Raw model reasoning text is never rendered, persisted by dsh-tui, or copied into diagnostics. Reasoning events only drive a generic thinking state.
6. Available text deltas appear promptly. A provider that emits only a final text block still shows immediate thinking/responding activity and then the complete block.
7. The committed ACP answer remains authoritative. Live text is reconciled against it and is never duplicated, appended twice, or allowed to overwrite a newer turn.
8. Cancellation and unknown-outcome backend exits preserve already visible live text with an explicit interrupted or outcome-unknown marker; they never replay the prompt automatically.
9. The entrance motion is original to dsh-tui, finishes or collapses quickly, respects reduced-output terminals, and never blocks input or backend startup.

## Architecture

Use three channels with separate authority:

```text
DSH runtime
  |-- stdout: ACP JSON-RPC
  |     prompts, permissions, cancellation, session lifecycle, committed output
  |
  |-- fd 3: dsh-tui live event pipe
  |     transient activity, text deltas/final blocks, tool state, usage, turn identity
  |
  `-- JSONL persistence
        history, diagnostics, usage/tool fallback, post-run observability
```

ACP is the correctness channel. The fd 3 pipe is an optional latency channel. JSONL remains the durable observability and history channel. Losing either non-ACP channel must not prevent a prompt from completing correctly.

### DSH Live Event Tap

Add a small shipped Cordis plugin at `config/dsh-tui-live-events.mjs`. Both platform compositions load it by relative path. `AcpClient` spawns the backend with an additional pipe at child fd 3 and consumes newline-delimited versioned records from `child.stdio[3]`.

The tap listens to DSH `session/event` events and emits only the normalized subset needed by the UI. Every record carries the original monotonic DSH event sequence for deduplication:

```ts
type DshLiveRecord = { v: 1; sessionId: string; seq: number } & (
  | { kind: "turn-start"; turn: number }
  | { kind: "activity"; turn: number; step: number; activity: "thinking" | "responding" }
  | { kind: "text-delta"; turn: number; step: number; index: number; text: string }
  | { kind: "text-final"; turn: number; step: number; index: number; text: string }
  | { kind: "tool-start"; turn: number; step: number; callId: string; name: string; arguments: string }
  | { kind: "tool-end"; turn: number; step: number; callId: string; isError: boolean; text: string }
  | { kind: "usage"; turn: number; step: number; usage: Usage }
  | { kind: "turn-end"; turn: number; reason: string }
)
```

Reasoning delta and reasoning block text are discarded inside the child before the record is written. Unknown event kinds and unknown wire versions are ignored with one bounded diagnostic. The tap stops writing after pipe failure and never writes live records to stdout or ordinary stderr. Its listener and stream error handler are scoped to plugin disposal.

The parent decoder owns partial-line buffering, UTF-8 boundaries, schema validation, terminal-text sanitization, session filtering, and malformed-record diagnostics. A live wire line and its unfinished buffer are each limited to 1 MiB. Tool arguments and tool-result summaries are limited to 64 KiB before serialization. An oversized final assistant block is omitted from the live channel and later arrives through authoritative ACP rather than being partially represented. The raw plugin and decoder are deliberately small adapters around the live-event seam.

### Live Stream Module

Add a deep module whose external interface accepts normalized live records and committed ACP text, then returns one immutable stream snapshot:

```ts
interface AssistantStream {
  begin(sessionId: string): AssistantStreamSnapshot
  apply(record: DshLiveRecord): AssistantStreamSnapshot
  reconcileCommitted(text: string): AssistantStreamSnapshot
  interrupt(kind: "cancelled" | "outcome-unknown"): AssistantStreamSnapshot
  reset(): AssistantStreamSnapshot
}

interface AssistantStreamSnapshot {
  sessionId: string | null
  turn: number | null
  text: string
  activity: "idle" | "thinking" | "responding"
  committed: boolean
  interruption: "cancelled" | "outcome-unknown" | null
}
```

The implementation hides turn/step ordering, block indexes, delta accumulation, final-block replacement, duplicate suppression, stale-session rejection, and ACP reconciliation. Callers do not manipulate block maps or compare strings themselves.

The module accepts only records for the active session and monotonically increasing active turn. A `text-final` record replaces the matching block assembled from deltas rather than appending it. `reconcileCommitted()` replaces transient text with the exact ACP text and marks the snapshot committed. Repeated committed text is idempotent. A stale event after cancellation, reset, session change, or a newer turn is ignored.

### Controller State

Keep lifecycle and activity separate:

```ts
type AppPhase = "starting" | "ready" | "working" | "cancelling" | "failed" | "closing"

type AppActivity =
  | { kind: "boot"; stage: "backend" | "session" }
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "responding" }
  | { kind: "tool"; name: string }
  | { kind: "approval"; name: string }
```

`AppController` remains the sole owner of application transitions. It consumes high-level stream snapshots, not raw DSH chunks. It updates visible activity immediately on submit, incorporates live text, accepts ACP committed text, and settles the turn only after the ACP prompt result.

The controller holds at most one startup-queued prompt in `AppState.queuedPrompt`. A first submission during `starting` is retained, immediately restored to the editor after pi-tui's submit-clear behavior, and visibly marked queued. While queued, editor changes update that same queued value and Enter is disabled, so the user can continue editing without accidentally creating a second queue entry. When session creation succeeds, the same normal prompt path takes the latest queued value, clears the editor, and sends it exactly once. If startup fails, the queued value remains in the editable editor. During an ordinary working turn, submission is disabled but editing remains available, so pressing Enter cannot clear an unsent follow-up draft.

Tool events from the live channel update existing tool cards in place. JSONL tool events remain a fallback and are deduplicated by DSH event sequence when available, then by call id and terminal state. Usage is keyed by turn and step so the live `usage` chunk and the later JSONL `assistant/message` accounting cannot be added twice. Permission requests continue to come from ACP and remain fail-closed.

## Rendering Design

### Incremental Streaming Markdown

Do not send the full growing answer through one mutable `Markdown` instance on every delta. Add a streaming Markdown module with an append-only scanner:

- Scan only newly arrived complete lines.
- Freeze stable top-level blocks at blank-line boundaries outside fenced code and display-math regions.
- Render each frozen block through one cached `Markdown` instance exactly once per width.
- Reparse only the active tail while it is changing.
- Reset the scanner when text no longer extends its known prefix, including final ACP reconciliation or bounded front trimming.
- Stack blocks vertically so split rendering is visually identical to rendering the complete Markdown text.

Committed transcript items remain immutable cached components. Only the live assistant module, status line, active tool card, and entrance mark may change during a normal streaming frame.

### Render Scheduling and Backpressure

Retain pi-tui's 16 ms ordinary render coalescing and immediate keyboard path. The application must not add an independent 60 Hz render loop. State updates may be more frequent than paints, but they request at most one pending ordinary render.

Animation runs on one shared clock and requests a render only while at least one animated surface is visible. Decorative animation uses 80 ms ticks. Elapsed-time status uses a separate 1 second tick only while a turn is active. Timers use `unref()` where available and are disposed on completion, occlusion, failure, and shutdown.

If terminal writes report backpressure, live updates coalesce to the newest snapshot rather than queueing every intermediate frame. The final committed snapshot and input events cannot be dropped.

## Entrance and Visual System

The original entrance treatment is named **Deep Pulse**:

- Frame one paints a compact `dsh-tui` wordmark, editor, and the actual boot stage.
- A cyan-to-blue highlight moves across the wordmark for 8 to 10 frames at 80 ms per frame.
- When the session becomes ready, the mark performs one short completion pulse and settles into the ordinary one-line header.
- If readiness takes longer than the entrance budget, the decorative sweep stops and a low-cost status spinner continues beside the real boot stage.
- Any user typing collapses the decorative portion immediately while preserving the real status.
- Terminals narrower than 52 columns use a single-line mark. Widths below 34 columns hide decorative art and keep only status and editor.
- `NO_COLOR`, non-TTY output, and `DSH_TUI_MOTION=off` use a static mark. `DSH_TUI_MOTION=reduced` uses only the final completion pulse. Invalid values fail configuration parsing rather than silently selecting a mode.

The animation never sleeps the startup path, delays editor focus, waits before marking ready, or occupies a full alternate-screen splash. It uses dsh-tui's existing cyan/yellow semantic palette and does not copy Hermes' caduceus, taglines, pi characters, or third-party ASCII art.

Status content uses progressive disclosure. Phase, model, and interruption affordance have highest priority; token/cost/session details disappear first as width narrows. Activity labels keep a stable display width so cycling states do not move the model and context segments.

## Performance Observability

Add monotonic per-turn marks for:

- submit accepted;
- first live event;
- first visible activity;
- first live text;
- first paint containing live text;
- ACP committed text;
- prompt settlement.

Normal users see only activity and elapsed time. `DSH_TUI_PERF=1` adds a compact diagnostic line or end-of-turn diagnostic containing backend wait and frontend event-to-paint values. Metrics contain no prompt text, model reasoning, API credentials, or raw tool arguments.

Automated performance targets on the local fake backend are:

- keyboard input becomes visible in the immediate keyboard render path;
- live record to visible paint has a local fake-backend P95 target of 50 ms under an idle terminal;
- fd 3 record decoding handles arbitrary UTF-8 and line chunking without waiting for the 250 ms JSONL poll;
- decorative animation never exceeds 13 frames per second;
- a block-heavy streamed reply does not exhibit quadratic total Markdown parse growth;
- no test relies on external model latency to pass.

The benchmark reports trends and regressions; it does not claim that dsh-tui can reduce DeepSeek provider time to first token.

## Failure and Degradation Rules

- If fd 3 is absent, closes, emits a malformed record, or uses an unknown version, ACP continues. The UI shows at most one sanitized degradation diagnostic and falls back to committed ACP output plus JSONL tool/usage events.
- If JSONL is unavailable, live text and ACP still work; history and fallback tool telemetry become unavailable with a bounded diagnostic.
- If ACP fails, the operation follows the existing outcome-unknown policy. Live text is retained as visibly uncommitted evidence, and no automatic retry occurs.
- If the live stream ends after ACP has committed, the committed transcript is unchanged.
- Session changes reset the stream assembler, metrics, activity, live tools, queued rendering work, and JSONL watcher before accepting events for the new session.
- Terminal resize invalidates width-dependent caches and performs the renderer's normal width reflow. It does not restart the turn or animation.
- Shutdown disposes animation clocks, elapsed timers, live-pipe readers, JSONL handles, overlays, and the ACP child in that order before restoring the terminal.

## Security, Privacy, and Distribution

- `DEEPSEEK_API_KEY` remains process-only. No design or implementation file stores, prints, snapshots, or measures it.
- The live tap removes reasoning content before crossing fd 3. Parent diagnostics never include the rejected raw line.
- All live text, tool names, tool summaries, errors, and committed output pass through the existing terminal-control sanitizer before rendering.
- Live record lines and partial buffers have explicit byte limits so an unexpected backend cannot grow memory without bound.
- Hermes and pi are MIT-licensed references. The implementation should independently reproduce the relevant patterns. If a non-trivial source fragment is copied verbatim, retain its MIT notice in a shipped `THIRD_PARTY_NOTICES.md`; branding and artwork are never copied.
- The package remains local-only during this work. Do not push, tag, publish, create a GitHub Release, or modify repository visibility.

## Confirmed Test Seams

Tests cross only these user-relevant seams:

1. **Live record decoder seam:** arbitrary pipe chunks in; validated normalized records and bounded diagnostics out.
2. **Assistant stream seam:** normalized live records and ACP committed text in; one ordered, deduplicated snapshot out.
3. **Controller/view seam:** backend, live stream, log, and user intents in; observable `AppState`, permission decisions, and exactly-once prompt calls out.
4. **CLI PTY seam:** real key bytes, resize, fake ACP/live records, and terminal failures in; visible terminal behavior and clean exit out.

Unit tests do not inspect private block maps, timer fields, or renderer internals. Integration tests use a deterministic fake child process with fd 3 support. PTY tests cover startup typing and queued submission, activity-before-text, streaming completion, cancellation, permission focus, narrow resize, CJK/IME-safe rendering, live-pipe failure, no duplicate final output, and double Ctrl+C cleanup.

An opt-in real DeepSeek test may report measured provider and frontend timings, but it is not part of the keyless default suite and must never print the key.

## Autonomous Implementation Policy

After the implementation plan is approved, execute all local tasks continuously. Each vertical slice follows red-green TDD, runs its focused checks, then commits. Batches may repair newly exposed regressions without waiting for user review as long as they stay inside this design. Stop only after the local plan is complete or a real external-authority blocker appears. Do not push, tag, publish, or change public repository state.
