# dsh-tui Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dsh-tui reliably start with current DeepSeek Harness credentials, prevent secret leakage, keep task summaries truthful, restore comfortable transcript navigation, smooth burst rendering, and ship release assets that accurately show v0.2.

**Architecture:** Keep the current ACP process, session-log fallback, controller, and pi-tui composition. Replace only the divergent credential adapter with the official DSH provider; add one central text-redaction boundary; synchronize observability before finalizing each turn; restore ScrollView navigation around the existing transcript; and throttle non-priority state paints without delaying priority transitions.

**Tech Stack:** Node.js 22.19+/24+, TypeScript 6, Vitest 4, `@deepseek-ai/dsh-*` rc.2, Cordis 4, `@earendil-works/pi-tui` 0.84.2.

## Global Constraints

- Work from the current `codex/dsh-tui-v0.2` branch and preserve unrelated or untracked user files.
- Complete every task continuously; automated failures trigger repair and rerun, not a pause for user approval.
- Do not push, tag, publish, or change repository visibility while executing this plan.
- Never print, snapshot, commit, or place a real API key in process arguments; all security tests use dummy strings.
- Keep the official ACP backend and existing DSH composition; Echo remains an explicit offline test/demo mode.
- Preserve both `terminal` and `deepseek` themes, reduced/off motion, narrow-width behavior, approvals, cancellation, history, and queued follow-up.
- Prefer the smallest change that fixes a reproduced defect; do not redesign the controller or visual language wholesale.
- Each task follows red-green-refactor and ends in an independent local commit.
- Final acceptance must include source checks, package checks, real PTY checks, and a live DeepSeek smoke when credentials are configured.

---

## File Structure

- `src/credentials.ts`: thin lifecycle wrapper over the official DSH local credential provider; no private YAML schema.
- `src/text.ts`: the sole untrusted-text sanitization and secret-redaction boundary.
- `src/backend/session-log.ts`: JSONL pump plus an explicit flush/synchronization method.
- `src/controller.ts`: turn lifecycle, observability barrier, and truthful summary ordering.
- `src/ui/app-view.ts`: transcript ScrollView, scroll input, history chooser, and view-level rendering.
- `src/ui/render-backpressure.ts`: newest-state frame gate plus stdout-drain handling.
- `src/ui/activity-line.ts`: one shared duration formatter.
- `src/config.ts`: strict CLI positionals and one reasoning-effort mapping.
- `scripts/check-release-assets.mjs`: deterministic release-asset presence/dimension/version guard.
- `tests/unit/*`, `tests/integration/*`, `tests/pty/*`, `tests/live/*`: focused regressions followed by full acceptance.

---

### Task 1: Replace the divergent credential parser with the official DSH provider

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/credentials.ts`
- Modify: `src/cli.ts`
- Modify: `tests/unit/credentials.test.ts`
- Modify: `tests/unit/cli.test.ts`

**Interfaces:**
- Consumes: `LocalCredentialProvider`, `credentialRef`, `Context`, and `createLaunchEnvironmentSnapshot`.
- Produces: unchanged public functions `describeDeepSeekCredential()`, `storeDeepSeekCredential()`, `removeDeepSeekCredential()`, and `credentialFilePath()`.

- [ ] **Step 1: Add failing versioned-document and migration tests**

Add tests that write a real DSH version-1 document and verify status, update, preservation, and deletion without ever returning the value:

```ts
await writeFile(filename, [
  "version: 1",
  "refs:",
  "  DEEPSEEK_API_KEY: managed-test-secret",
  "  OPENAI_API_KEY: keep-me",
  "",
].join("\n"), { mode: 0o600 })

await expect(describeDeepSeekCredential(options)).resolves.toEqual({
  configured: true,
  source: "managed",
  writable: true,
})
await storeDeepSeekCredential("replacement-test-secret", options)
expect(await readFile(filename, "utf8")).toContain("OPENAI_API_KEY: keep-me")
await expect(removeDeepSeekCredential(options)).resolves.toBe(true)
```

Add a second test starting with the recognized flat pre-release document and assert that the official provider migrates it to `version: 1` with the original value unchanged.

- [ ] **Step 2: Run the focused tests and confirm the current parser fails**

Run:

```bash
npm run test:unit -- tests/unit/credentials.test.ts tests/unit/cli.test.ts
```

Expected: FAIL on the versioned `refs` document with `Invalid credential document`.

- [ ] **Step 3: Add direct dependencies used by the adapter**

Run:

```bash
npm install --save-exact @deepseek-ai/cordis@4.0.1 @deepseek-ai/dsh-app-boot@0.1.1-rc.2 @deepseek-ai/dsh-credentials@0.1.1-rc.2 @deepseek-ai/dsh-launch-environment@0.1.1-rc.2
```

Keep every `@deepseek-ai/dsh-*` package on exactly `0.1.1-rc.2` so `compat:check` remains meaningful.

- [ ] **Step 4: Replace YAML ownership with an official-provider host**

Delete the private YAML parser/writer from `src/credentials.ts`. Build the provider for one short operation and always dispose its Cordis context:

```ts
import { Context } from "@deepseek-ai/cordis"
import { loadLayeredEnv } from "@deepseek-ai/dsh-app-boot"
import { credentialRef, type CredentialProvider } from "@deepseek-ai/dsh-credentials"
import LocalCredentialProvider from "@deepseek-ai/dsh-credentials-local"
import {
  createLaunchEnvironmentSnapshot,
  type LaunchEnvironmentSnapshot,
} from "@deepseek-ai/dsh-launch-environment"

const DEEPSEEK_REF = credentialRef("DEEPSEEK_API_KEY")

async function withProvider<T>(
  options: Required<CredentialStoreOptions>,
  action: (provider: CredentialProvider) => Promise<T>,
): Promise<T> {
  const ctx = new Context()
  ctx.provide("launchEnvironment", credentialLaunchEnvironment(options))
  await ctx.plugin(LocalCredentialProvider, {
    path: credentialFilePath(options.env, options.home),
    watch: false,
  })
  try {
    return await action(ctx.get("credentials"))
  } finally {
    await ctx.fiber.dispose()
  }
}
```

Map official safe status labels without resolving the secret:

```ts
function publicSource(source: string | undefined): CredentialSource {
  if (source === "env") return "environment"
  if (source === "file") return "managed"
  if (source === "project-env") return "project-env"
  if (source === "user-env") return "user-env"
  return "missing"
}
```

Use `provider.describe(DEEPSEEK_REF)`, `provider.set(DEEPSEEK_REF, value)`, and `provider.unset(DEEPSEEK_REF)` for the three exported operations. Do not call `provider.resolve()` because the CLI never needs to retrieve the key.

- [ ] **Step 5: Keep normal startup aligned with official DSH environment layering**

In `src/cli.ts`, keep the one-time prompt only when `describeDeepSeekCredential()` reports missing. Extend `CredentialStoreOptions` with `cwd?: string` and `launchEnvironment?: LaunchEnvironmentSnapshot`. Construct the snapshot exactly once per provider operation:

```ts
function credentialLaunchEnvironment(
  options: Required<Omit<CredentialStoreOptions, "launchEnvironment">>
    & Pick<CredentialStoreOptions, "launchEnvironment">,
): LaunchEnvironmentSnapshot {
  if (options.launchEnvironment) return options.launchEnvironment
  const isRealLaunch = options.env === process.env && options.home === homedir()
  if (isRealLaunch) {
    return loadLayeredEnv("dsh-tui", options.cwd, () => undefined)
  }
  return createLaunchEnvironmentSnapshot([{
    source: "process",
    values: options.env,
  }])
}
```

Pass `cwd: config.cwd` from normal ACP startup and `cwd: process.cwd()` from explicit `auth` commands. Unit tests continue to pass temporary `home` and `env`, which deliberately selects the isolated process-only snapshot.

The observable rules are exact:

```text
inherited process environment > managed credentials file > project .env > ~/.dsh/.env
```

The automatic startup check and `auth status` must recognize all four sources. `auth login` and `auth logout` must reject only when the inherited process environment makes the reference read-only.

- [ ] **Step 6: Verify permanent setup and safe persistence**

Run:

```bash
npm run test:unit -- tests/unit/credentials.test.ts tests/unit/cli.test.ts
node src/main.ts auth status
node src/main.ts --motion off --help
```

Expected: unit tests PASS; status reports only configured/source state; no credential value appears. Then run `npm run compat:check`.

- [ ] **Step 7: Commit the credential fix**

```bash
git add package.json package-lock.json src/credentials.ts src/cli.ts tests/unit/credentials.test.ts tests/unit/cli.test.ts
git commit -m "fix: use official DSH credential provider"
```

---

### Task 2: Enforce central secret redaction on every untrusted text path

**Files:**
- Modify: `src/text.ts`
- Modify: `src/ui/approval-panel.ts`
- Modify: `tests/unit/text.test.ts`
- Modify: `tests/unit/tool-card.test.ts`
- Modify: `tests/integration/acp-client.test.ts`

**Interfaces:**
- Produces: `redactSensitiveText(value: string): string` and a redacting `sanitizeTerminalText(value: string): string`.
- Consumers: CLI errors, backend diagnostics, tool cards, approval text, assistant text, and persisted-history rendering.

- [ ] **Step 1: Write dummy-secret leakage tests**

Use only dummy values and assert exact masking:

```ts
const dummy = "sk-test-only-1234567890abcdef"
expect(redactSensitiveText(`Authorization: Bearer ${dummy}`))
  .toBe("Authorization: Bearer [redacted]")
expect(redactSensitiveText(`DEEPSEEK_API_KEY=${dummy}`))
  .toBe("DEEPSEEK_API_KEY=[redacted]")
expect(redactSensitiveText(`tool returned ${dummy}`))
  .toBe("tool returned [redacted]")
expect(redactSensitiveText("sk-short ordinary prose")).toBe("sk-short ordinary prose")
```

Add one test where ANSI escape sequences split styling around the dummy token, and one ACP fixture test where backend stderr contains the dummy token. Neither captured diagnostic nor rendered tool card may contain `1234567890abcdef`.

- [ ] **Step 2: Run focused tests and confirm leakage**

Run:

```bash
npm run test:unit -- tests/unit/text.test.ts tests/unit/tool-card.test.ts
npm run test:integration -- tests/integration/acp-client.test.ts
```

Expected: FAIL because current sanitization removes terminal controls but preserves secret text.

- [ ] **Step 3: Implement one redaction boundary after control-sequence removal**

Add these bounded patterns to `src/text.ts`:

```ts
const AUTHORIZATION = /(\bauthorization\s*:\s*(?:bearer\s+)?)([^\s,;]+)/giu
const NAMED_SECRET = /(\b(?:DEEPSEEK_API_KEY|OPENAI_API_KEY|api[_-]?key)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu
const API_KEY_TOKEN = /\bsk-[A-Za-z0-9_-]{12,}\b/gu

export function redactSensitiveText(value: string): string {
  return value
    .replace(AUTHORIZATION, "$1[redacted]")
    .replace(NAMED_SECRET, "$1[redacted]")
    .replace(API_KEY_TOKEN, "[redacted]")
}

export function sanitizeTerminalText(value: string): string {
  const plain = removeDisallowedControls(stripTerminalSequences(String(value)))
  return redactSensitiveText(plain)
}
```

Make `approval-panel.ts` reuse this function rather than maintaining a second secret regex. Do not redact paths, ordinary hashes, session IDs, prices, or short prose beginning with `sk-`.

- [ ] **Step 4: Run security regressions and the complete text/UI suite**

```bash
npm run test:unit -- tests/unit/text.test.ts tests/unit/tool-card.test.ts tests/unit/approval-panel.test.ts tests/unit/transcript-components.test.ts
npm run test:integration -- tests/integration/acp-client.test.ts
```

Expected: PASS and no captured output contains the dummy secret suffix.

- [ ] **Step 5: Commit the redaction boundary**

```bash
git add src/text.ts src/ui/approval-panel.ts tests/unit/text.test.ts tests/unit/tool-card.test.ts tests/integration/acp-client.test.ts
git commit -m "fix: redact secrets across terminal surfaces"
```

---

### Task 3: Make turn completion wait for observable tool events

**Files:**
- Modify: `src/backend/session-log.ts`
- Modify: `src/controller.ts`
- Modify: `tests/unit/session-log.test.ts`
- Modify: `tests/unit/controller.test.ts`
- Modify: `tests/fixtures/fake-acp-server.mjs`
- Modify: `tests/pty/tui-acp.test.ts`

**Interfaces:**
- Adds: `SessionLogPort.synchronize(): Promise<void>`.
- Adds: `SessionLogReader.synchronize(): Promise<void>` that pumps the current file immediately without adding another polling timer.
- Changes: successful/cancelled/failed turn finalization runs an observability barrier before appending `TurnSummaryItem`.

- [ ] **Step 1: Add a regression where ACP settles before the JSONL tool result**

Extend the controller harness with a log synchronization callback:

```ts
let synchronizeLogsImpl: () => Promise<void> = async () => {}
const logs: FakeLogs = {
  // existing methods
  async synchronize() { await synchronizeLogsImpl() },
}
```

The regression must release the ACP prompt first, inject one JSONL `tool-result` during `logs.synchronize()`, and expect:

```ts
expect(harness.controller.state.transcript.at(-1)).toEqual({
  kind: "turn-summary",
  status: "done",
  durationMs: expect.any(Number),
  toolCount: 1,
  failedToolCount: 0,
})
```

Add a second case with a queued follow-up and verify the first summary is finalized before the second prompt enters `promptCalls`.

- [ ] **Step 2: Run the regression and confirm the false `0 tools` summary**

```bash
npm run test:unit -- tests/unit/controller.test.ts tests/unit/session-log.test.ts
```

Expected: FAIL because `finishTurn()` currently runs before the fallback reader can flush.

- [ ] **Step 3: Add an immediate JSONL pump that does not duplicate timers**

Refactor `SessionLogReader.tick()` so periodic scheduling remains private, while synchronization calls only `pump()`:

```ts
async synchronize(): Promise<void> {
  const generation = this.generation
  if (!this.options) return
  try {
    await this.pump(generation)
  } catch (error) {
    if (generation === this.generation) {
      this.options?.onDiagnostic?.(`session log read failed: ${String(error)}`)
    }
  }
}
```

Serialize concurrent pumps with a settled promise tail so the timer and explicit barrier cannot read the same byte range concurrently:

```ts
private pumping: Promise<void> = Promise.resolve()

private enqueuePump(generation: number): Promise<void> {
  const next = this.pumping.then(() => this.pump(generation))
  this.pumping = next.catch(() => undefined)
  return next
}
```

Use `enqueuePump()` from both `tick()` and `synchronize()`.

- [ ] **Step 4: Synchronize live and JSONL channels after ACP settles**

Add one controller helper and call it after `backend.prompt()` resolves but before `finishAssistant()`, `finishTurn()`, and `drainQueuedPrompt()`:

```ts
private async synchronizeObservability(): Promise<void> {
  await this.backend.synchronizeLiveEvents?.()
  await this.logs.synchronize()
}
```

Keep the existing pre-prompt live barrier. On cancellation or backend failure, attempt the post-settle barrier in a contained `try/catch`; a failed observation channel adds a diagnostic but must not replace the real ACP outcome.

- [ ] **Step 5: Prove ordering in unit and PTY tests**

The fake ACP server must emit a tool end to JSONL just before returning the ACP result while delaying the watcher path. Assert that the rendered summary comes after the tool card and says `1 tool`. Also assert duplicate live+JSONL endings still count once.

Run:

```bash
npm run test:unit -- tests/unit/controller.test.ts tests/unit/session-log.test.ts tests/unit/tool-timeline.test.ts
npm run test:pty -- tests/pty/tui-acp.test.ts
```

Expected: PASS; no transcript contains a completed tool after a `0 tools` summary for the same turn.

- [ ] **Step 6: Commit truthful finalization**

```bash
git add src/backend/session-log.ts src/controller.ts tests/unit/session-log.test.ts tests/unit/controller.test.ts tests/fixtures/fake-acp-server.mjs tests/pty/tui-acp.test.ts
git commit -m "fix: synchronize tool events before turn summary"
```

---

### Task 4: Restore transcript navigation without sacrificing editor controls

**Files:**
- Modify: `src/ui/app-view.ts`
- Create: `src/ui/scroll-keys.ts`
- Create: `tests/unit/scroll-keys.test.ts`
- Modify: `tests/unit/app-view.test.ts`
- Modify: `tests/pty/tui-echo.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Produces: `resolveScrollKey(data: string, viewportHeight: number): ScrollKeyAction | null`.
- Uses: pi-tui `ScrollView` with `follow: "end"` and `scrollbar: "auto"`.

- [ ] **Step 1: Add pure key-mapping tests**

The exact bindings are:

```text
PageUp/PageDown       one viewport
Shift+Up/Shift+Down   one transcript line
Ctrl+Home/Ctrl+End    transcript top/bottom
Home/End              remain available to the editor
```

Use terminal sequences in `tests/unit/scroll-keys.test.ts` and assert unrelated arrows, Enter, Escape, Home, and End return `null`.

- [ ] **Step 2: Add a real 80x12 PTY regression**

Generate enough Echo turns to hide the welcome card, capture the bottom screen, send PageUp, and assert the screen changes and older content becomes visible. Send Ctrl+End and assert the latest prompt returns. Then emit another streamed reply and assert follow-to-end resumes.

- [ ] **Step 3: Run focused tests and confirm PageUp currently does nothing**

```bash
npm run test:unit -- tests/unit/scroll-keys.test.ts tests/unit/app-view.test.ts
npm run test:pty -- tests/pty/tui-echo.test.ts
```

Expected: FAIL before ScrollView is restored.

- [ ] **Step 4: Mount the existing transcript inside ScrollView**

In `src/ui/app-view.ts`:

```ts
private readonly scroller = new ScrollView(this.transcript, {
  follow: "end",
  scrollbar: "auto",
})

this.canvas.addChild(this.scroller)
this.canvas.addChild(this.editor)
this.canvas.addChild(this.status)
```

Handle `resolveScrollKey()` before Escape. Scrolling away from the bottom pauses follow; Ctrl+End calls `scrollToEnd()` and resumes it. Display a short status notice—`paused · Ctrl+End follows output` or `following output`—without opening an overlay.

- [ ] **Step 5: Expose all 50 history entries already read by the backend**

Change `items.slice(0, 20)` to `items.slice(0, 50)` in `chooseHistory()`. Keep the modal viewport bounded at 16 rows so the list scrolls rather than occupying the whole screen.

- [ ] **Step 6: Update visible key help and rerun narrow-terminal tests**

Mention PageUp/PageDown and Ctrl+End in the welcome quick actions, footer/help text, and both READMEs. Run:

```bash
npm run test:unit -- tests/unit/scroll-keys.test.ts tests/unit/app-view.test.ts tests/unit/footer.test.ts tests/unit/welcome-panel.test.ts
npm run test:pty -- tests/pty/tui-echo.test.ts tests/pty/tui-acp.test.ts
```

- [ ] **Step 7: Commit navigation restoration**

```bash
git add src/ui/app-view.ts src/ui/scroll-keys.ts tests/unit/scroll-keys.test.ts tests/unit/app-view.test.ts tests/pty/tui-echo.test.ts README.md README.zh-CN.md
git commit -m "feat: restore transcript keyboard navigation"
```

---

### Task 5: Coalesce burst rendering and fix duration boundaries

**Files:**
- Modify: `src/ui/render-backpressure.ts`
- Modify: `tests/unit/render-backpressure.test.ts`
- Modify: `src/ui/activity-line.ts`
- Modify: `src/ui/turn-summary.ts`
- Modify: `tests/unit/activity-line.test.ts`
- Modify: `tests/unit/turn-summary.test.ts`
- Modify: `tests/pty/tui-stress.test.ts`

**Interfaces:**
- `LatestRenderGate` gains injectable `now`, `setTimer`, `clearTimer`, and `frameMs` options; default frame is 33ms.
- `formatDuration(durationMs)` becomes the only elapsed-duration formatter.

- [ ] **Step 1: Add fake-clock coalescing tests**

Test these invariants independently:

```text
first unblocked state flushes immediately
100 same-frame non-priority states flush only the newest state
priority state flushes immediately and cancels a pending frame
stdout drain keeps only the newest state
dispose removes drain listeners and frame timers
```

Use an injected fake scheduler; do not make unit tests sleep in real time.

- [ ] **Step 2: Add duration rollover tests**

Assert exact boundaries:

```ts
expect(formatDuration(999)).toBe("999ms")
expect(formatDuration(59_949)).toBe("59.9s")
expect(formatDuration(59_999)).toBe("1m")
expect(formatDuration(119_999)).toBe("2m")
expect(formatDuration(84_000)).toBe("1m 24s")
```

No rendered value may contain `60s` after a minute component.

- [ ] **Step 3: Implement newest-state frame scheduling**

Store every non-priority submission in `pending`. Flush immediately only if at least `frameMs` elapsed since the previous flush; otherwise arm one timer for the remaining interval. A priority submission cancels the timer, clears pending state, and flushes immediately. If `writableNeedDrain` is true, keep only the newest pending state and wait for `drain` before applying frame timing.

The constructor shape is fixed:

```ts
export interface RenderGateOptions {
  frameMs?: number
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

constructor(output: DrainSource, flush: (value: T) => void, options: RenderGateOptions = {})
```

- [ ] **Step 4: Centralize duration formatting**

Move minute formatting into `formatDuration()` and delete `summaryDuration()` from `turn-summary.ts`. Round the total number of seconds first, then split minutes and seconds:

```ts
const totalSeconds = Math.round(safe / 1_000)
const minutes = Math.floor(totalSeconds / 60)
const seconds = totalSeconds % 60
```

- [ ] **Step 5: Run unit and stress acceptance**

```bash
npm run test:unit -- tests/unit/render-backpressure.test.ts tests/unit/activity-line.test.ts tests/unit/turn-summary.test.ts
npm run test:pty -- tests/pty/tui-stress.test.ts
```

Expected: 10,000 stream chunks still preserve final text and tool state; view flush count is bounded by elapsed frames instead of event count; cancellation and ready transitions remain immediate.

- [ ] **Step 6: Commit rendering and duration fixes**

```bash
git add src/ui/render-backpressure.ts tests/unit/render-backpressure.test.ts src/ui/activity-line.ts src/ui/turn-summary.ts tests/unit/activity-line.test.ts tests/unit/turn-summary.test.ts tests/pty/tui-stress.test.ts
git commit -m "perf: coalesce burst rendering at frame boundaries"
```

---

### Task 6: Remove small correctness and maintenance traps

**Files:**
- Modify: `src/config.ts`
- Modify: `src/app.ts`
- Modify: `src/ui/session-panel.ts`
- Modify: `src/backend/tool-timeline.ts`
- Modify: `tests/unit/config.test.ts`
- Modify: `tests/unit/app.test.ts`
- Modify: `tests/unit/session-panel.test.ts`
- Modify: `tests/unit/tool-timeline.test.ts`
- Modify: `CODEX-HANDOFF.md`

**Interfaces:**
- Produces: `reasoningEffort(mode: ReasoningMode): "low" | "max"`.
- Simplifies: `ToolTimelineEvent` no longer carries the unused `source` field.

- [ ] **Step 1: Add strict positional and shared-effort tests**

```ts
expect(() => loadConfig(["typo-command"], {}, "linux")).toThrow(/unexpected argument/i)
expect(reasoningEffort("quick")).toBe("low")
expect(reasoningEffort("deep")).toBe("max")
```

Verify the backend environment and session panel both use the same exported mapping.

- [ ] **Step 2: Reject unknown positionals and centralize effort mapping**

Capture both `values` and `positionals` from `parseArgs`; reject any non-empty positional array outside the already-handled `auth` and `theme` commands. Add:

```ts
export function reasoningEffort(mode: ReasoningMode): "low" | "max" {
  return mode === "deep" ? "max" : "low"
}
```

Use it in `resolveBackendEnvironment()` and `sessionPanelText()`.

- [ ] **Step 3: Remove unused timeline source plumbing**

Remove `source` from `ToolTimelineEvent`, controller call sites, and tests. Task 3 synchronizes both channels before finalization but does not branch on source; deduplication remains keyed by `callId`, exactly as before.

- [ ] **Step 4: Correct the handoff file path**

Replace `src/tool-timeline.ts` with `src/backend/tool-timeline.ts` in `CODEX-HANDOFF.md`. Scan every other referenced path:

```bash
rg -o '`[^`]+\.(ts|mjs|md)`' CODEX-HANDOFF.md
```

Each source/test path must exist.

- [ ] **Step 5: Run focused checks and commit**

```bash
npm run test:unit -- tests/unit/config.test.ts tests/unit/app.test.ts tests/unit/session-panel.test.ts tests/unit/tool-timeline.test.ts
npm run lint
npm run typecheck
git add src/config.ts src/app.ts src/ui/session-panel.ts src/backend/tool-timeline.ts tests/unit/config.test.ts tests/unit/app.test.ts tests/unit/session-panel.test.ts tests/unit/tool-timeline.test.ts CODEX-HANDOFF.md
git commit -m "refactor: tighten CLI and shared domain mappings"
```

---

### Task 7: Refresh release media and run end-to-end acceptance

**Files:**
- Modify: `assets/screenshot.png`
- Modify: `assets/demo.gif`
- Modify: `assets/demo-vertical.mp4`
- Modify: `assets/social-preview.png`
- Create: `assets/release-media.json`
- Modify: `scripts/demo-scenario.md`
- Create: `scripts/check-release-assets.mjs`
- Modify: `package.json`
- Modify: `tests/live/dsh-live.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Adds npm script: `release-assets:check`.
- Extends live acceptance with a queued follow-up after the first streamed response begins.

- [ ] **Step 1: Extend live acceptance before recording media**

After the first live prompt begins responding, submit a second short prompt. Assert:

```ts
expect(promptCalls).toEqual([firstPrompt, secondPrompt])
expect(finalState.queuedPrompt).toBeNull()
expect(finalState.phase).toBe("ready")
expect(finalState.transcript.filter((item) => item.kind === "user")).toHaveLength(2)
```

Keep the existing allow-tool, reject-tool, cancellation, new-session, and history checks.

- [ ] **Step 2: Add deterministic release-asset guards**

`scripts/check-release-assets.mjs` must fail when an asset is absent, zero bytes, has the wrong basic format, or does not match the checked-in release manifest. Check PNG signatures for `screenshot.png` and `social-preview.png`, GIF signature for `demo.gif`, and MP4 `ftyp` box for `demo-vertical.mp4`. Its `--write` mode reads the current `package.json` version and atomically creates `assets/release-media.json` with the SHA-256 digest of each of the four assets. Normal mode requires the manifest version to equal `package.json` and every digest to match. Add:

```json
"release-assets:check": "node scripts/check-release-assets.mjs"
```

Do not attempt OCR or encode a developer username into the guard.

- [ ] **Step 3: Record a sanitized current-version scenario**

Follow `scripts/demo-scenario.md` in a disposable workspace named `demo-project`. The visible frame must show:

```text
DeepSeek Harness / dsh-tui v0.2.0
deepseek-v4-flash
sanitized workspace label such as demo-project
one user request
thinking/responding state
one completed tool card
a truthful turn summary
the restored scroll/help affordance
```

No home-directory username, API key, private repository path, session UUID, or personal terminal history may appear. Capture both terminal and DeepSeek blue/white themes, but keep the README hero focused on the default terminal theme.

- [ ] **Step 4: Replace all four public media assets together**

Export the 120x30 hero screenshot, horizontal GIF, vertical short-video MP4, and social preview from the same current build. Inspect every final frame at native size, then generate the manifest:

```bash
node scripts/check-release-assets.mjs --write
npm run release-assets:check
```

- [ ] **Step 5: Run the complete local gate**

```bash
npm run check
npm run install:check
npm run release-assets:check
git diff --check
npm pack --dry-run --json --ignore-scripts
```

Expected: all tests/build/package checks PASS; package contains only declared runtime files and current sanitized assets.

- [ ] **Step 6: Run real PTY acceptance in three terminal sizes**

Run ACP and Echo at 120x30, 80x24, and 50x16. Verify startup, first message, multi-turn scroll, tool expansion, approval allow/deny, Escape cancellation, queued follow-up, history selection, theme persistence, resize, and Ctrl+C twice exit. No crash, stale overlay, raw JSON, secret, or permanent follow break is allowed.

- [ ] **Step 7: Run the live DeepSeek smoke without extracting the credential**

```bash
DSH_LIVE=1 npm run test -- tests/live/dsh-live.test.ts
```

The test may use the already configured official provider. It must not read or print the credential value. If the service is unavailable, record the external error separately; do not weaken or skip the local release gate.

- [ ] **Step 8: Commit the acceptance and release media**

```bash
git add assets/screenshot.png assets/demo.gif assets/demo-vertical.mp4 assets/social-preview.png assets/release-media.json scripts/demo-scenario.md scripts/check-release-assets.mjs package.json tests/live/dsh-live.test.ts README.md README.zh-CN.md
git commit -m "docs: refresh v0.2 release experience"
```

Stop after this local commit. Do not push, tag, publish to npm, create a GitHub release, or change repository visibility.

---

## Final Self-Review Checklist

- [ ] Every reproduced blocker maps to one task: credentials (1), redaction (2), false summary (3), scrolling/history (4), render/duration (5), CLI/docs debt (6), stale media/live follow-up (7).
- [ ] No task replaces the ACP backend or creates a parallel session architecture.
- [ ] No test fixture contains a real key, username, private path, or reusable credential.
- [ ] Every new public function and interface is introduced before later tasks consume it.
- [ ] Every batch has focused tests, a full-gate path, and a local commit.
- [ ] Execution proceeds continuously and stops before any remote/public action.
