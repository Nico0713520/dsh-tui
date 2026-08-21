# dsh-tui Product Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Quiet Signal working experience, unchanged official blue DeepSeek whale branding, persistent DeepSeek Light theme, semantic conversation/tool hierarchy, and on-demand Session Panel while preserving the current TUI's latency and stability.

**Architecture:** Replace raw global ANSI helpers with a small semantic `UiTheme`, render the verified official whale bytes through terminal image capability detection, keep the welcome inside the transcript so it naturally scrolls away, and represent thinking/tool lifecycle with explicit controller data and pure renderers. Build richer information as overlays, not permanent chrome, and retain the current pi-tui render gate and incremental Markdown path.

**Tech Stack:** TypeScript 6, Node.js 22+, `@earendil-works/pi-tui` 0.84.2, Vitest 4, node-pty, ANSI truecolor/256-color fallback, existing DeepSeek Harness rc.7 composition.

## Global Constraints

- Execute all local tasks continuously; do not pause for user review between tasks.
- Do not push, tag, publish, or change repository visibility.
- Default theme preserves the user's terminal background; DeepSeek Light is opt-in and persistent.
- Use the exact transparent official blue whale SVG from DeepSeek API Docs. Do not hand-redraw, recolor, crop, trace, distort, or animate the logo; display scaling must preserve its aspect ratio.
- Render a deterministic transparent PNG cache when Kitty/iTerm2 inline-image capability is available. Apple Terminal and other text-only terminals use a fixed blue Braille silhouette sampled from the same SVG; below 34 columns use clean text-only branding. Never print a filename placeholder.
- Identify `dsh-tui` as an independent community project and do not imply official DeepSeek publication, endorsement, or maintenance.
- The complete welcome is never permanent top chrome and naturally scrolls away after the first prompt.
- Startup motion never delays editor focus, backend startup, session creation, or the first request.
- No new runtime dependency is added unless the existing standard library and pi-tui cannot implement the behavior.
- No raw reasoning text or unobservable Tools, Skills, MCP, Git, or authentication state is fabricated.
- All visual lines fit `120`, `96`, `80`, `60`, `48`, and `32` columns with CJK-safe cell-width handling.
- Existing authentication, History, cancellation, approvals, cleanup, live-record, packaging, and render-backpressure behavior remains green.
- Each task ends in a local commit, but commits are implementation checkpoints rather than user approval gates.

---

### Task 1: Persistent appearance preference and config precedence

**Files:**
- Create: `src/preferences.ts`
- Create: `tests/unit/preferences.test.ts`
- Modify: `src/config.ts`
- Modify: `src/cli.ts`
- Modify: `src/app.ts`
- Modify: `tests/unit/config.test.ts`
- Modify: `tests/unit/cli.test.ts`

**Interfaces:**
- Produces: `ThemePreference`, `preferenceFilePath`, `loadUiPreferences`, `saveThemePreference`.
- Produces: `AppConfig.theme: ThemePreference`.
- Consumes: CLI args, environment, saved preference, and platform-specific config paths.

- [ ] **Step 1: Write failing preference-path and persistence tests**

```ts
expect(preferenceFilePath({}, "/home/test", "linux"))
  .toBe("/home/test/.config/dsh-tui/settings.json")
expect(preferenceFilePath({}, "/Users/test", "darwin"))
  .toBe("/Users/test/Library/Application Support/dsh-tui/settings.json")
await saveThemePreference("deepseek", { env: {}, home, platform: "linux" })
expect(loadUiPreferences({ env: {}, home, platform: "linux" }))
  .toEqual({ theme: "deepseek" })
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `npx vitest run tests/unit/preferences.test.ts`

Expected: FAIL because `src/preferences.ts` does not exist.

- [ ] **Step 3: Implement the preference seam with exact public types**

```ts
export type ThemePreference = "terminal" | "deepseek"

export interface UiPreferences {
  theme: ThemePreference
}

export interface PreferenceOptions {
  env?: NodeJS.ProcessEnv
  home?: string
  platform?: NodeJS.Platform
}

export function preferenceFilePath(
  env?: NodeJS.ProcessEnv,
  home?: string,
  platform?: NodeJS.Platform,
): string

export function loadUiPreferences(options?: PreferenceOptions): UiPreferences

export async function saveThemePreference(
  theme: ThemePreference,
  options?: PreferenceOptions,
): Promise<void>
```

The loader returns `{ theme: "terminal" }` for a missing file. Reject malformed JSON or unknown values with a path-only diagnostic. Save atomically with owner-only directory/file modes on POSIX.

- [ ] **Step 4: Add config precedence tests before implementation**

```ts
expect(loadConfig([], {}, "linux", { theme: "deepseek" }).theme).toBe("deepseek")
expect(loadConfig([], { DSH_TUI_THEME: "terminal" }, "linux", { theme: "deepseek" }).theme)
  .toBe("terminal")
expect(loadConfig(["--theme", "deepseek"], { DSH_TUI_THEME: "terminal" }, "linux").theme)
  .toBe("deepseek")
```

Extend `loadConfig` with a fourth optional `defaults` argument and add `--theme` to `OPTIONS`, `HELP`, and `AppConfig`.

- [ ] **Step 5: Add non-TUI theme management commands**

```ts
await runCli(["theme", "deepseek"], {}, dependencies)
await runCli(["theme", "status"], {}, dependencies)
await runCli(["theme", "terminal"], {}, dependencies)
```

Expected output contains only `terminal` or `deepseek`; these commands never read credentials and never call `runApp`.

- [ ] **Step 6: Load saved preferences before `loadConfig` and pass the resolved theme into `AppView`**

```ts
const preferences = loadUiPreferences({ env, home: dependencies.home, platform: dependencies.platform })
const config = loadConfig(argv, env, dependencies.platform, preferences)
```

Update `runApp` to construct `AppView` with `theme: config.theme`.

- [ ] **Step 7: Run GREEN and commit**

Run: `npx vitest run tests/unit/preferences.test.ts tests/unit/config.test.ts tests/unit/cli.test.ts`

Expected: all tests pass and no theme command starts the TUI or credential prompt.

```bash
git add src/preferences.ts src/config.ts src/cli.ts src/app.ts tests/unit/preferences.test.ts tests/unit/config.test.ts tests/unit/cli.test.ts
git commit -m "feat: persist TUI appearance preference"
```

### Task 2: Semantic theme tokens and root background canvas

**Files:**
- Rewrite: `src/ui/theme.ts`
- Create: `src/ui/theme-canvas.ts`
- Create: `tests/unit/theme.test.ts`
- Create: `tests/unit/theme-canvas.test.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `src/ui/modal-list.ts`
- Modify: `tests/unit/modal-list.test.ts`

**Interfaces:**
- Consumes: Task 1 `ThemePreference`.
- Produces: `UiTheme`, `createUiTheme`, `ThemeCanvas`, themed Markdown/select/editor primitives.
- Later tasks consume one `UiTheme` instance and never import hard-coded color names.

- [ ] **Step 1: Write failing semantic-role tests**

```ts
for (const name of ["terminal", "deepseek"] as const) {
  const theme = createUiTheme(name, { color: true })
  expect(theme.name).toBe(name)
  expect(theme.fg("brand", "brand")).toContain("brand")
  expect(theme.fg("error", "error")).toContain("error")
  expect(theme.markdown.heading("heading")).toContain("heading")
}
expect(createUiTheme("terminal", { color: true }).canvasBackground).toBeNull()
expect(createUiTheme("deepseek", { color: true }).canvasBackground).toBe("#F7F9FF")
```

- [ ] **Step 2: Define the exact theme contract**

```ts
export type ForegroundRole =
  | "brand" | "accent" | "text" | "muted" | "subtle"
  | "success" | "warning" | "error" | "border" | "borderFocus"

export type SurfaceRole =
  | "canvas" | "user" | "toolPending" | "toolSuccess" | "toolError" | "overlay"

export interface UiTheme {
  name: ThemePreference
  canvasBackground: string | null
  fg(role: ForegroundRole, text: string): string
  bg(role: SurfaceRole, text: string): string
  markdown: MarkdownTheme
  select: SelectListTheme
  editorBorder(phase: AppPhase, focused: boolean, text: string): string
}

export function createUiTheme(
  name: ThemePreference,
  options?: { color?: boolean },
): UiTheme
```

Terminal body text uses ANSI default foreground and never sets a background. DeepSeek Light uses the exact palette from the approved design spec. Style closures end with foreground/background-specific resets rather than unscoped `\x1b[0m` inside a painted line.

- [ ] **Step 3: Write failing canvas fill/reset tests**

```ts
const canvas = new ThemeCanvas(() => 4, createUiTheme("deepseek"))
canvas.addChild(child)
const lines = canvas.render(20)
expect(lines).toHaveLength(4)
expect(lines.every((line) => visibleWidth(line) === 20)).toBe(true)
expect(stripTerminalSequences(lines.join("\n"))).toContain("content")
```

- [ ] **Step 4: Implement `ThemeCanvas` as the single root component**

```ts
export class ThemeCanvas extends Container {
  constructor(
    private readonly rows: () => number,
    private readonly theme: UiTheme,
  ) { super() }

  render(width: number): string[] {
    const rendered = super.render(width)
    if (this.theme.canvasBackground === null) return rendered
    rendered.splice(this.rows())
    while (rendered.length < this.rows()) rendered.push("")
    return rendered.map((line) => paintFullWidth(line, width, this.theme))
  }
}
```

`paintFullWidth` measures ANSI/CJK visible width, pads exactly to `width`, reapplies the canvas background after inner resets, and emits a final reset at line end.

- [ ] **Step 5: Refactor `AppView` and `ModalList` to receive a `UiTheme` instance**

Remove direct imports of `c`, `markdownTheme`, and `selectTheme`. Put the welcome/transcript/editor/footer children inside `ThemeCanvas`; Terminal theme remains visually transparent.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/theme.test.ts tests/unit/theme-canvas.test.ts tests/unit/modal-list.test.ts tests/unit/app-view.test.ts`

```bash
git add src/ui/theme.ts src/ui/theme-canvas.ts src/ui/app-view.ts src/ui/modal-list.ts tests/unit/theme.test.ts tests/unit/theme-canvas.test.ts tests/unit/modal-list.test.ts tests/unit/app-view.test.ts
git commit -m "feat: add semantic terminal themes"
```

### Task 3: Welcome composition and natural transcript retreat

**Files:**
- Create: `assets/brand/deepseek-whale.svg`
- Create: `assets/brand/deepseek-whale.png.base64`
- Create: `assets/brand/README.md`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `src/ui/brand-logo.ts`
- Create: `tests/unit/brand-logo.test.ts`
- Rewrite: `src/ui/welcome-panel.ts`
- Modify: `src/ui/deep-pulse.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `src/app.ts`
- Modify: `package.json`
- Modify: `tests/unit/welcome-panel.test.ts`
- Modify: `tests/unit/deep-pulse.test.ts`
- Modify: `tests/unit/app-view.test.ts`
- Modify: `tests/pty/tui-echo.test.ts`

**Interfaces:**
- Consumes: Task 2 `UiTheme`.
- Produces: `createBrandLogo`, `resolveBrandAsset`, `welcomePanelText`, `compactIdentityText`, `WelcomeTranscriptComponent` behavior.
- Removes: permanent root `header` behavior after the first prompt.

- [ ] **Step 1: Acquire and freeze the unchanged official whale source and terminal cache**

Use the transparent whale published by official DeepSeek API Docs:

```bash
mkdir -p assets/brand
curl -L --fail 'https://api-docs.deepseek.com/img/favicon.svg' -o assets/brand/deepseek-whale.svg
shasum -a 256 assets/brand/deepseek-whale.svg
```

Expected SHA-256:

```text
0bf5e13ce954f13423a692f083f5cb0f4bcfde35c8b812f64efe89dabfdaed20
```

Keep this SVG byte-for-byte unchanged. Store the already verified `63×46`, transparent `#4D6BFE` PNG protocol cache as base64 text with decoded SHA-256 `ea65ee127a76ec8617ae01895ddbda3806ab81bdb4edc53f9d27ae29cdd7f372`. Record the source URL, both hashes, unchanged-source rule, terminal-render derivation, and independent-community-project wording in `assets/brand/README.md` and `THIRD_PARTY_NOTICES.md`.

- [ ] **Step 2: Write failing brand-asset and capability tests**

```ts
expect(await sha256(assetPath))
  .toBe("0bf5e13ce954f13423a692f083f5cb0f4bcfde35c8b812f64efe89dabfdaed20")
expect(brandLogoMode({ images: "iterm2" }, 120)).toBe("image")
expect(brandLogoMode({ images: null }, 120)).toBe("braille")
expect(brandLogoMode({ images: null }, 32)).toBe("text")
expect(whaleBraille(11)).toEqual([
  "⢀⣴⣶⣶⣶⣿⡀⢸⣦⣤⣴",
  "⣾⠛⠻⢿⣿⣿⡿⣶⣿⡟⠁",
  "⢿⣆⠀⠀⠙⣿⣷⣿⡿⠁",
  "⠈⠻⢷⣾⣿⣮⡿⠿⠶",
])
```

The Braille constants are generated once from the official alpha mask at `11×4` and `8×3`; they are not hand-drawn. The unsupported path must not invoke pi-tui's generic filename fallback.

- [ ] **Step 3: Implement exact-image rendering and package-safe asset resolution**

`createBrandLogo` reads the verified base64 cache and constructs pi-tui's `Image` only when `capabilities.images` is `"kitty"` or `"iterm2"`. Otherwise it returns a blue `Text` component using `whaleBraille(11)` or `whaleBraille(8)` according to width. Set only bounded cell dimensions; preserve the source aspect ratio and keep every logo mode static.

Resolve the asset from both source and bundled entry points without using the process working directory:

```ts
export function resolveBrandAsset(moduleUrl: string): string {
  return fileURLToPath(new URL("../assets/brand/deepseek-whale.png.base64", moduleUrl))
}
```

Pass the resolved path and terminal capabilities from `src/app.ts` into `AppView`. Add both brand assets, `assets/brand/README.md`, and `THIRD_PARTY_NOTICES.md` to the package allowlist.

- [ ] **Step 4: Replace old height expectations with the approved row budgets**

```ts
const expectedMaxRows = new Map([[120, 9], [96, 9], [80, 6], [60, 6], [48, 3], [32, 1]])
for (const [columns, maxRows] of expectedMaxRows) {
  const text = welcomePanelText({ ...base, columns, theme })
  expect(text.split("\n").length).toBeLessThanOrEqual(maxRows)
  expect(text.split("\n").every((line) => visibleWidth(line) <= columns)).toBe(true)
}
```

- [ ] **Step 5: Standardize product naming and priority**

On image-capable terminals, the full tier contains the official whale once at `10×4` cells. Text terminals use the official-shape `11×4` Braille silhouette in the same left track. `DeepSeek Harness` appears once as the primary name, `dsh-tui` once as secondary CLI identity, followed by model/state, workspace/session/safety, and essential keys. Remove duplicate slogans and the permanent `dsh-tui — Enter send...` header copy.

- [ ] **Step 6: Add compact identity tests**

```ts
const line = compactIdentityText({ columns: 80, model: "deepseek-v4-flash", cwd, theme })
expect(stripTerminalSequences(line)).toContain("DeepSeek Harness")
expect(stripTerminalSequences(line)).toContain("deepseek-v4-flash")
expect(visibleWidth(line)).toBeLessThanOrEqual(80)
```

- [ ] **Step 7: Move welcome from root chrome to transcript position zero**

Construct the transcript in this exact order:

```ts
this.transcript.addChild(this.welcomeTranscript)
this.transcript.addChild(this.committedTranscript)
this.transcript.addChild(this.activeActivity)
this.transcript.addChild(this.partialAssistant.element)
```

`welcomeTranscript` renders the full panel while no user item exists, then one compact identity row. Remove `this.tui.addChild(this.header)`. A new session updates the same component back to full without adding duplicate transcript children.

- [ ] **Step 8: Keep existing motion non-blocking and input-cancellable**

Preserve the `80 ms` sweep and `160 ms` completion pulse for adjacent divider/status/text accents only. The whale image never changes between frames. `handleGlobalInput` still calls `pulseClock.collapse()` before shortcut dispatch. Full/reduced/off output must have identical static text after ANSI removal.

- [ ] **Step 9: Add PTY lifecycle assertions**

At `120x30`, cover both capability paths. With image capability, assert a valid inline-image sequence is present and no fallback filename is printed. Without image capability, assert the stable Braille whale and `DeepSeek Harness` appear without an image escape sequence. At `32` columns assert text-only branding. Submit `hello`, wait for Echo output, and assert the current screen no longer contains the full welcome description or whale. Send enough messages to prove the compact identity row scrolls out rather than remaining fixed.

- [ ] **Step 10: Run GREEN and commit**

Run: `npx vitest run tests/unit/brand-logo.test.ts tests/unit/welcome-panel.test.ts tests/unit/deep-pulse.test.ts tests/unit/app-view.test.ts tests/pty/tui-echo.test.ts`

```bash
git add assets/brand/deepseek-whale.svg assets/brand/deepseek-whale.png.base64 assets/brand/README.md THIRD_PARTY_NOTICES.md src/ui/brand-logo.ts src/ui/welcome-panel.ts src/ui/deep-pulse.ts src/ui/app-view.ts src/app.ts package.json tests/unit/brand-logo.test.ts tests/unit/welcome-panel.test.ts tests/unit/deep-pulse.test.ts tests/unit/app-view.test.ts tests/pty/tui-echo.test.ts
git commit -m "feat: let the welcome retreat into transcript"
```

### Task 4: Conversation hierarchy and reusable transcript components

**Files:**
- Create: `src/ui/transcript-components.ts`
- Create: `tests/unit/transcript-components.test.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `tests/unit/app-view.test.ts`

**Interfaces:**
- Consumes: Task 2 `UiTheme` and existing `TranscriptItem`.
- Produces: `renderUserMessage`, `renderAssistantMessage`, `renderDiagnostic`, `renderHistoryBoundary`.

- [ ] **Step 1: Write failing role-hierarchy tests**

```ts
const terminalUser = renderUserMessage("你好", 48, createUiTheme("terminal"))
expect(stripTerminalSequences(terminalUser.render(48).join("\n"))).toContain("你好")
expect(terminalUser.render(48).every((line) => visibleWidth(line) <= 48)).toBe(true)

const lightUser = renderUserMessage("hello", 48, createUiTheme("deepseek"))
expect(lightUser.render(48).join("\n")).not.toBe(terminalUser.render(48).join("\n"))
```

- [ ] **Step 2: Implement exact visual behavior**

- Terminal user message: one-cell DeepSeek-blue rail plus wrapped body, no yellow arrow.
- DeepSeek Light user message: pale-blue full-width surface plus blue rail.
- Assistant message: Markdown with one horizontal cell of breathing room, no avatar or permanent role icon.
- Diagnostic: warning/error prefix plus subdued text, never a full red paragraph.
- History boundary: centered or clipped dim rule, not a chat message.

- [ ] **Step 3: Replace `addTranscriptItem` raw `Text` construction**

Use one renderer dispatch from `transcript-components.ts`; preserve component index stability required by in-place tool replacement.

- [ ] **Step 4: Verify Markdown and CJK behavior**

Run: `npx vitest run tests/unit/transcript-components.test.ts tests/unit/app-view.test.ts tests/unit/text.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/ui/transcript-components.ts src/ui/app-view.ts tests/unit/transcript-components.test.ts tests/unit/app-view.test.ts
git commit -m "feat: clarify transcript visual hierarchy"
```

### Task 5: Thinking traces and semantic tool lifecycle cards

**Files:**
- Create: `src/ui/activity-line.ts`
- Create: `src/ui/tool-card.ts`
- Create: `tests/unit/activity-line.test.ts`
- Create: `tests/unit/tool-card.test.ts`
- Modify: `src/controller.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `tests/unit/controller.test.ts`
- Modify: `tests/unit/app-view.test.ts`

**Interfaces:**
- Adds: `TranscriptItem` kind `thinking-trace`.
- Extends: tool results with arguments and optional duration.
- Produces: `activityLineText`, `toolCardText`, and `toolCardComponent`.

- [ ] **Step 1: Add failing controller lifecycle tests with an injected clock**

```ts
let now = 1_000
const controller = createController({ now: () => now })
await controller.submit("hello")
now = 2_250
controller.onAssistantText("Hi")
expect(controller.state.transcript).toContainEqual({ kind: "thinking-trace", durationMs: 1_250 })
```

Add `now?: () => number` to the controller constructor options and default it to `Date.now`.

- [ ] **Step 2: Extend transcript types without exposing raw reasoning**

```ts
export type TranscriptItem =
  | { kind: "user" | "assistant" | "diagnostic"; text: string }
  | { kind: "thinking-trace"; durationMs: number }
  | { kind: "tool-call"; name: string; arguments: string }
  | { kind: "tool-result"; name: string; arguments?: string; text: string; isError: boolean; durationMs?: number }
  | { kind: "history-boundary"; text: string }
```

Commit a thinking trace only when a real thinking interval transitions to responding, tool execution, cancellation, or turn completion. Do not add empty or duplicate traces.

- [ ] **Step 3: Preserve tool arguments and calculate duration**

Change `liveTools` values to:

```ts
{ name: string; arguments: string; transcriptIndex: number; startedAtMs: number }
```

When `tool-end` arrives, replace the pending call with a result containing the original arguments and `Math.max(0, now() - startedAtMs)`.
History-loaded tool results keep `arguments` and `durationMs` absent; the renderer treats a missing argument string as `"{}"` and omits duration instead of inventing values.

- [ ] **Step 4: Write compact and expanded renderer tests**

```ts
const compact = toolCardText(result, { columns: 80, expanded: false, theme })
expect(stripTerminalSequences(compact)).toMatch(/read_file|src\/app\.ts/)
expect(visibleWidth(compact.split("\n")[0]!)).toBeLessThanOrEqual(80)

const expanded = toolCardText(result, { columns: 80, expanded: true, theme })
expect(stripTerminalSequences(expanded)).toContain("full tool output")
```

- [ ] **Step 5: Implement semantic states**

- Pending: `◌ tool target` in brand/accent tone.
- Success: `✓ tool target · duration` in success tone with output summary dimmed.
- Error: `✕ tool target · duration` in error tone with bounded error preview.
- Compact output: one summary row plus at most one preview row.
- Expanded output: at most eight rows followed by an omitted-line count.
- CJK and ANSI text remain bounded by cell width.

- [ ] **Step 6: Add `Ctrl+O` tool-detail toggle**

The toggle is local view state, rebuilds transcript components, and never sends `Ctrl+O` or `/status` content to the model. It does not alter controller history.

- [ ] **Step 7: Run GREEN and commit**

Run: `npx vitest run tests/unit/controller.test.ts tests/unit/activity-line.test.ts tests/unit/tool-card.test.ts tests/unit/app-view.test.ts`

```bash
git add src/controller.ts src/ui/activity-line.ts src/ui/tool-card.ts src/ui/app-view.ts tests/unit/controller.test.ts tests/unit/activity-line.test.ts tests/unit/tool-card.test.ts tests/unit/app-view.test.ts
git commit -m "feat: add thinking and tool lifecycle visuals"
```

### Task 6: Adaptive composer, footer, and notice priority

**Files:**
- Create: `src/ui/footer.ts`
- Create: `tests/unit/footer.test.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `tests/unit/app-view.test.ts`
- Modify: `tests/pty/tui-echo.test.ts`

**Interfaces:**
- Produces: `footerText`, `footerSegments`, phase-aware editor border styling.
- Consumes: `AppState`, model, mode, cwd, elapsed time, notice, and `UiTheme`.

- [ ] **Step 1: Write failing progressive-disclosure tests**

```ts
const wide = stripTerminalSequences(footerText(state, options, 120, theme))
expect(wide).toContain("deepseek-v4-flash")
expect(wide).toContain("cached")
expect(wide).toContain("$")

const narrow = stripTerminalSequences(footerText(state, options, 32, theme))
expect(narrow).toContain("ready")
expect(narrow).toContain("deep")
expect(narrow).not.toContain("cached")
expect(visibleWidth(narrow)).toBeLessThanOrEqual(32)
```

- [ ] **Step 2: Extract footer priority into a pure renderer**

```ts
export interface FooterOptions {
  mode: RunMode
  model: string
  cwd: string
  notice?: string
  elapsedSeconds?: number
}

export function footerText(
  state: AppState,
  options: FooterOptions,
  columns: number,
  theme: UiTheme,
): string
```

Use the approved removal order: cost, detailed tokens/cache, session, elapsed, workspace tail. Notice/backend error/interruption replaces low-priority content.

- [ ] **Step 3: Make editor border styling stateful without geometry changes**

The existing `EditorTheme.borderColor` closure reads current phase/focus and uses `theme.editorBorder`. Ready focus is brand blue, working is accent, approval/warning is warning, failure is error, and unfocused is border/muted.

- [ ] **Step 4: Update key copy**

Working key hints are limited to `Enter send · Esc stop · Ctrl+R history · Ctrl+O tools · Ctrl+C ×2 exit`, with lower-priority hints removed at narrow widths.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/footer.test.ts tests/unit/app-view.test.ts tests/pty/tui-echo.test.ts`

```bash
git add src/ui/footer.ts src/ui/app-view.ts tests/unit/footer.test.ts tests/unit/app-view.test.ts tests/pty/tui-echo.test.ts
git commit -m "feat: add adaptive composer and footer chrome"
```

### Task 7: Approval, History, and truthful Session Panel overlays

**Files:**
- Create: `src/ui/modal-panel.ts`
- Create: `src/ui/approval-panel.ts`
- Create: `src/ui/session-panel.ts`
- Create: `tests/unit/modal-panel.test.ts`
- Create: `tests/unit/approval-panel.test.ts`
- Create: `tests/unit/session-panel.test.ts`
- Modify: `src/ui/modal-list.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `tests/unit/modal-list.test.ts`
- Modify: `tests/unit/app-view.test.ts`

**Interfaces:**
- Produces: `showModalPanel`, `showApprovalPanel`, `sessionPanelText`.
- Consumes: observable `AppState`, view config, current theme, and existing approval stakes.

- [ ] **Step 1: Write failing Session Panel truthfulness tests**

```ts
const text = stripTerminalSequences(sessionPanelText({ state, model, cwd, mode, motion, theme }))
expect(text).toContain(model)
expect(text).toContain(cwd)
expect(text).toContain(state.sessionId!)
expect(text).not.toMatch(/MCP|Skills|Git/)
```

- [ ] **Step 2: Implement a non-selectable modal panel**

`ModalPanel` renders a title, bounded body, and `Esc close` hint. It owns its overlay handle, consumes Escape, and restores editor focus on close. Width is `70%` with minimum/maximum bounds; narrow terminals use full available width minus two columns.

- [ ] **Step 3: Build the Session Panel from observable facts only**

Rows: model, workspace, session, phase/activity, safety posture, theme, motion, usage/context, cost, and current interruption/backend notice. `/status` is intercepted by `AppView` before model submission.

- [ ] **Step 4: Replace the generic approval list with a risk-aware approval panel**

Header tone follows `low`, `medium`, or `high` stakes. Show the tool name and bounded target/command summary once, then selectable allow/reject choices. Never duplicate raw arguments or reveal secrets.

- [ ] **Step 5: Keep History selection behavior but theme its chrome**

History remains a list and keeps current cancellation/new-session semantics. Only its spacing, title, selected row, and hints change.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/modal-panel.test.ts tests/unit/approval-panel.test.ts tests/unit/session-panel.test.ts tests/unit/modal-list.test.ts tests/unit/app-view.test.ts tests/unit/policy.test.ts`

```bash
git add src/ui/modal-panel.ts src/ui/approval-panel.ts src/ui/session-panel.ts src/ui/modal-list.ts src/ui/app-view.ts tests/unit/modal-panel.test.ts tests/unit/approval-panel.test.ts tests/unit/session-panel.test.ts tests/unit/modal-list.test.ts tests/unit/app-view.test.ts
git commit -m "feat: add focused decision and session overlays"
```

### Task 8: Shared motion clock, reduced-motion parity, and render stability

**Files:**
- Modify: `src/ui/deep-pulse.ts`
- Modify: `src/ui/activity-line.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `src/ui/render-backpressure.ts`
- Modify: `tests/unit/deep-pulse.test.ts`
- Modify: `tests/unit/activity-line.test.ts`
- Modify: `tests/unit/render-backpressure.test.ts`
- Modify: `tests/unit/perf.test.ts`

**Interfaces:**
- Produces: one shared visual tick for welcome accents/thinking/tool pending animation; every official-logo renderer is static and never subscribes to the clock.
- Preserves: immediate keyboard priority and latest-state render coalescing.

- [ ] **Step 1: Add timer-count and parity tests**

```ts
const clock = new VisualClock("full", onTick)
clock.start()
expect(vi.getTimerCount()).toBe(1)
clock.setOccluded(true)
expect(vi.getTimerCount()).toBe(0)
clock.setOccluded(false)
expect(vi.getTimerCount()).toBe(1)
clock.dispose()
```

After ANSI removal, full/reduced/off render the same labels, model, workspace, state, and controls.

- [ ] **Step 2: Consolidate animation timers**

Keep the elapsed one-second clock separate. Welcome divider/status/text accents and active thinking/tool frames consume one `VisualClock`; the official image/Braille whale and committed transcript rows never animate.

- [ ] **Step 3: Stop invisible animation while an overlay is active**

When `tui.hasOverlay()` is true, pause visual-frame ticks. Closing the overlay resumes from current wall-clock state without replaying the entrance.

- [ ] **Step 4: Preserve render priorities**

Keyboard-driven draft/editor work remains immediate. Streaming state uses `LatestRenderGate`; ready/failure/closing and tool completion remain priority renders. No animation callback reparses stable Markdown.

- [ ] **Step 5: Run targeted performance tests and commit**

Run: `npx vitest run tests/unit/deep-pulse.test.ts tests/unit/activity-line.test.ts tests/unit/render-backpressure.test.ts tests/unit/perf.test.ts tests/unit/app-view.test.ts`

```bash
git add src/ui/deep-pulse.ts src/ui/activity-line.ts src/ui/app-view.ts src/ui/render-backpressure.ts tests/unit/deep-pulse.test.ts tests/unit/activity-line.test.ts tests/unit/render-backpressure.test.ts tests/unit/perf.test.ts tests/unit/app-view.test.ts
git commit -m "perf: share TUI motion without delaying input"
```

### Task 9: PTY visual matrix and regression hardening

**Files:**
- Create: `tests/unit/visual-layout.test.ts`
- Modify: `tests/pty/tui-echo.test.ts`
- Modify: `tests/pty/tui-acp.test.ts`
- Modify: `tests/pty/pty-harness.ts`
- Modify: `tests/integration/acp-client.test.ts`

**Interfaces:**
- Consumes: all visual-system tasks.
- Produces: deterministic layout/flow evidence for both themes and all supported widths.

- [ ] **Step 1: Add pure layout-matrix tests**

For each theme and width in `[120, 96, 80, 60, 48, 32]`, render welcome in both image-capable and text-only modes, compact identity, user, assistant, thinking, pending tool, success tool, error tool, footer, approval, History, and Session Panel. Assert every visible line fits and no output contains control characters other than valid ANSI or supported inline-image sequences.

- [ ] **Step 2: Extend Echo PTY through the entire user journey**

Verify in one continuous test:

1. Immediate complete welcome, with the faithful image on an image-capable pseudo-terminal, stable Braille whale on a text pseudo-terminal, and text-only branding below 34 columns.
2. Typing during startup remains responsive.
3. First prompt collapses the welcome.
4. Multiple messages scroll the identity away.
5. `/status` opens and Escape closes the Session Panel.
6. `Ctrl+O` toggles tool details without entering editor text.
7. Resize through `120 → 80 → 48 → 32 → 80` with no overflow.
8. Ctrl+C notice appears and clears.
9. Double Ctrl+C exits cleanly.

- [ ] **Step 3: Add DeepSeek Light PTY coverage**

Launch with `--theme deepseek`, assert the rendered stream contains the configured canvas background sequence, submit and resize, then assert shutdown emits a full terminal reset. Repeat with `NO_COLOR` to verify layout remains present without decorative color.

- [ ] **Step 4: Re-run ACP integration behavior**

Confirm visual changes do not alter request ordering, permission decisions, cancellation, live-record reconciliation, session History, or API key redaction.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/visual-layout.test.ts tests/pty/tui-echo.test.ts tests/pty/tui-acp.test.ts tests/integration/acp-client.test.ts`

```bash
git add tests/unit/visual-layout.test.ts tests/pty/tui-echo.test.ts tests/pty/tui-acp.test.ts tests/pty/pty-harness.ts tests/integration/acp-client.test.ts
git commit -m "test: cover the complete TUI visual journey"
```

### Task 10: Documentation, visual verification, and final local release check

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Create: `docs/release/v0.1.0-visual-verification.md`
- Modify: `docs/release/v0.1.0-local-verification.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a release-facing explanation of both themes, lifecycle, shortcuts, and local verification evidence.

- [ ] **Step 1: Update user-facing appearance documentation**

Document:

- Terminal default and DeepSeek Light.
- Official logo source, unchanged-SVG policy, terminal image/Braille/text tiers, and independent-community-project notice.
- `deepseek theme status|terminal|deepseek`.
- `--theme` and `DSH_TUI_THEME` precedence.
- Welcome retreat behavior.
- `/status` and `Ctrl+O`.
- Full/reduced/off motion.
- Narrow-terminal behavior.

Use only real implemented command output and redacted examples.

- [ ] **Step 2: Record a fixed manual visual matrix**

In `v0.1.0-visual-verification.md`, record pass/fail observations for:

- iTerm2/Kitty image-capable dark terminal at `120x30` and `80x24`, including visual confirmation that the whale is not cropped, recolored, distorted, or animated.
- macOS Terminal or another non-image-capable terminal at `120x30` and `80x24`, confirming the stable Braille whale with no broken-image output; verify the `32`-column text-only fallback separately.
- Terminal theme on a light terminal.
- DeepSeek Light at `120x30` and `80x24`.
- `48x16` and `32x14` resize fallbacks.
- Chinese prompt, long path, long model name, tool error, approval, History, `/status`, reduced motion, and clean exit.

- [ ] **Step 3: Run source and package verification**

Run: `npm run check:source`

Expected: lint, typecheck, all unit/integration/PTY/live tests, and build pass.

Run: `npm run check && npm run install:check`

Expected: composition, publint, package contents, packed install, and shortcut launch checks pass.

- [ ] **Step 4: Inspect the packed artifact**

Run: `npm pack --dry-run`

Expected: new runtime source is compiled into `dist`; the verified SVG, terminal PNG cache, source/hash record, and `THIRD_PARTY_NOTICES.md` are included; README files describe only shipped behavior; no test fixtures, secrets, private paths, or local preference files are included.

- [ ] **Step 5: Review the full diff and working tree**

Run: `git diff --check && git status --short && git log --oneline -12`

Expected: no whitespace errors; only planned source, test, and documentation changes are present; all task commits are local.

- [ ] **Step 6: Commit final documentation**

```bash
git add README.md README.zh-CN.md docs/release/v0.1.0-visual-verification.md docs/release/v0.1.0-local-verification.md
git commit -m "docs: document the finished TUI visual system"
```

Stop after final local verification. Do not push, tag, publish, or change repository visibility.
