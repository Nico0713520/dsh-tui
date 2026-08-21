# Natural Welcome Scroll and Whale Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the complete welcome card in the conversation's natural scroll history and replace the wide-terminal 16×6 whale fallback with a directly sampled, slightly longer 18×6 silhouette.

**Architecture:** `WelcomeTranscriptComponent` always renders the responsive card; `ScrollView({ follow: "end" })` alone decides when old content leaves the viewport. `brand-logo.ts` keeps exact PNG rendering for Kitty/iTerm2, keeps the compact text fallback unchanged, and stores one deterministic 18×6 full fallback sampled from the official PNG alpha mask.

**Tech Stack:** TypeScript 6, Node.js 22+, `@earendil-works/pi-tui`, Vitest 4, node-pty.

## Global Constraints

- Keep `assets/brand/deepseek-whale.svg` and `assets/brand/deepseek-whale.png.base64` byte-for-byte unchanged.
- macOS Terminal does not support the Kitty/iTerm2 inline-image path; it must receive the solid text fallback.
- Do not add a dependency or a runtime image converter.
- Do not change ACP, model, credentials, transcript semantics, tool cards, publishing state, tags, or remotes.
- Do not push or publish.

---

### Task 1: Make the complete welcome card part of natural transcript history

**Files:**
- Modify: `src/ui/welcome-panel.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `tests/unit/welcome-panel.test.ts`
- Modify: `tests/unit/visual-layout.test.ts`
- Modify: `tests/pty/tui-echo.test.ts`

**Interfaces:**
- Consumes: `WelcomePanelOptions`, `WelcomeCard`, and `ScrollView({ follow: "end" })`.
- Produces: `new WelcomeTranscriptComponent(options)` and `update(options)` with no `expanded` mode; the component always returns the responsive welcome card.

- [ ] **Step 1: Change the public-seam tests so the old collapse behavior fails**

In `tests/unit/welcome-panel.test.ts`, remove imports and assertions for `compactIdentityText` and `shouldExpandWelcome`, remove every `expanded: true`, and add:

```ts
it("keeps the complete card when the session starts working", () => {
  const component = new WelcomeTranscriptComponent({
    ...base,
    columns: 120,
    capabilities: textCapabilities,
    assetPath,
  })

  component.update({ ...base, columns: 120, phase: "working" })
  const text = stripTerminalSequences(component.render(120).join("\n"))

  expect(text).toContain("Welcome back!")
  expect(text).toContain("Tips for getting started")
  expect(text).toContain("Quick actions")
})
```

In `tests/unit/visual-layout.test.ts`, remove `compactIdentityText` from the import and `textRows`, and remove `expanded: true` from the welcome fixture.

In the first test in `tests/pty/tui-echo.test.ts`, rename it to `shows the complete welcome immediately and keeps it above the first exchange`, then replace the post-submit absence assertions with:

```ts
expect(terminal.screenText()).toContain("Welcome back!")
expect(terminal.screenText()).toContain("▗█████████▙▖")
expect(terminal.screenText()).toContain("[echo] hello")
```

Keep the existing long-conversation test: after four exchanges in a 12-row viewport, it must still assert that `DeepSeek Harness` has naturally scrolled away.

- [ ] **Step 2: Run the focused tests and verify red**

Run:

```bash
npx vitest run tests/unit/welcome-panel.test.ts tests/unit/visual-layout.test.ts tests/pty/tui-echo.test.ts
```

Expected: FAIL because the first submitted prompt still sets `expanded: false` and replaces the card with compact identity.

- [ ] **Step 3: Remove the collapse mode with the smallest implementation**

In `src/ui/welcome-panel.ts`:

```ts
export class WelcomeTranscriptComponent implements Component {
  private options: WelcomePanelOptions
  private readonly capabilities: TerminalCapabilities
  private readonly assetPath: string | URL
  private readonly logoCache = new Map<string, Component | null>()

  constructor(options: WelcomePanelOptions & {
    capabilities: TerminalCapabilities
    assetPath: string | URL
  }) {
    const { capabilities, assetPath, ...presentation } = options
    this.options = presentation
    this.capabilities = capabilities
    this.assetPath = assetPath
  }

  update(options: WelcomePanelOptions): void {
    this.options = options
  }

  render(width: number): string[] {
    const columns = Math.max(1, width)
    return new WelcomeCard({
      columns,
      logo: columns >= 48 ? this.logo(columns) : null,
      model: this.options.model,
      cwd: this.options.cwd,
      phase: this.options.phase,
      theme: this.options.theme,
    }).render(columns)
  }
}
```

Delete `CompactIdentityOptions`, `fit`, the duplicate `phaseText`, `compactIdentityText`, and `shouldExpandWelcome`. Remove their now-unused imports.

In `src/ui/app-view.ts`, import only `WelcomeTranscriptComponent`, remove `expanded: true` from construction, and remove the `expanded` field from `updateWelcome()`.

- [ ] **Step 4: Run the focused tests and verify green**

Run the same Vitest command.

Expected: all focused unit and PTY tests PASS, including first-message retention and long-conversation natural scrolling.

- [ ] **Step 5: Commit the lifecycle correction**

```bash
git add src/ui/welcome-panel.ts src/ui/app-view.ts tests/unit/welcome-panel.test.ts tests/unit/visual-layout.test.ts tests/pty/tui-echo.test.ts
git commit -m "fix: keep welcome in natural scroll history"
```

### Task 2: Replace the full fallback with the approved 18×6 sample

**Files:**
- Modify: `src/ui/brand-logo.ts`
- Modify: `tests/unit/brand-logo.test.ts`
- Modify: `tests/unit/welcome-card.test.ts`

**Interfaces:**
- Consumes: unchanged official `63×46` PNG alpha mask and `WhalePixelTier`.
- Produces: `whalePixelArt("full")` with six rows whose visible width is at most 18 cells; compact remains at most 12 cells.

- [ ] **Step 1: Freeze the independently generated 18×6 expected silhouette in a failing test**

Replace the full expected literal in `tests/unit/brand-logo.test.ts` with:

```ts
expect(whalePixelArt("full")).toEqual([
  "  ▄▄▄▙▄██▌  █▄▖▗▄▄",
  "▗█████████▙▖▀████▀",
  "█▌ ▝▀▀████▛████",
  "▜▙     ▀██▙▄██▛",
  "▝▜█▄  ▄▄▝▜███▘",
  "  ▝▀██████▀▀▀▀",
])
expect(whalePixelArt("full").every((line) => visibleWidth(line) <= 18)).toBe(true)
```

Update `tests/unit/welcome-card.test.ts` to assert the second full row contains `▗█████████▙▖▀████▀`.

- [ ] **Step 2: Run the logo tests and verify red**

Run:

```bash
npx vitest run tests/unit/brand-logo.test.ts tests/unit/welcome-card.test.ts
```

Expected: FAIL because the production full glyph is still the 16×6 sample.

- [ ] **Step 3: Install the exact sampled rows and matching image layout box**

In `src/ui/brand-logo.ts`, replace only `WHALE_PIXELS.full` with:

```ts
full: [
  "  ▄▄▄▙▄██▌  █▄▖▗▄▄",
  "▗█████████▙▖▀████▀",
  "█▌ ▝▀▀████▛████",
  "▜▙     ▀██▙▄██▛",
  "▝▜█▄  ▄▄▝▜███▘",
  "  ▝▀██████▀▀▀▀",
],
```

Keep `WHALE_PIXELS.compact` unchanged. Change the image-capable full size from `maxWidthCells: 16` to `maxWidthCells: 18`; keep `maxHeightCells: 6`, PNG dimensions, and aspect preservation unchanged.

- [ ] **Step 4: Run logo, welcome, and visual matrix tests and verify green**

Run:

```bash
npx vitest run tests/unit/brand-logo.test.ts tests/unit/welcome-card.test.ts tests/unit/welcome-panel.test.ts tests/unit/visual-layout.test.ts
```

Expected: all tests PASS; the official asset hash assertions remain unchanged.

- [ ] **Step 5: Commit the whale refinement**

```bash
git add src/ui/brand-logo.ts tests/unit/brand-logo.test.ts tests/unit/welcome-card.test.ts
git commit -m "fix: refine the terminal whale silhouette"
```

### Task 3: Synchronize product copy and verify the complete local build

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `assets/brand/README.md`
- Modify: `docs/release/v0.1.0-visual-verification.md`
- Modify: `docs/release/v0.1.0-local-verification.md`

**Interfaces:**
- Consumes: verified PTY behavior and final full-fallback dimensions.
- Produces: public documentation that describes natural scrolling, exact-image capability limits, and the 18×6 fallback without claiming macOS Terminal supports inline images.

- [ ] **Step 1: Update lifecycle and renderer documentation**

Use this lifecycle statement in both public READMEs, translated naturally in Chinese:

```md
A fresh session shows the complete responsive welcome surface. The first prompt and every later message are appended below it, so the unchanged card leaves the viewport only through natural conversation scrolling.
```

In `assets/brand/README.md`, change `32 × 12` to `36 × 12` and record that macOS Terminal uses the solid fallback because it does not implement the Kitty/iTerm2 protocols.

In the release verification files, replace first-message collapse language with first-message retention and natural long-conversation scrolling; record the full fallback as `18×6`.

- [ ] **Step 2: Run the complete validation suite**

Run:

```bash
npm run check
npm run install:check
```

Expected: lint, typecheck, all unit/integration/PTY tests, build, composition, package checks, and installed CLI smoke checks PASS. The live DeepSeek test may remain skipped unless explicitly enabled.

- [ ] **Step 3: Run the installed CLI in a real 120×30 macOS Terminal**

Run `deepseek` in the user's configured terminal and verify:

```text
1. The complete card and 18×6 solid whale appear on startup.
2. After one short prompt, the same card remains above the exchange.
3. After enough messages, it naturally scrolls out of view.
4. No raw OSC image payload, broken border, overflow, or input delay appears.
```

- [ ] **Step 4: Commit documentation and verification evidence**

```bash
git add README.md README.zh-CN.md assets/brand/README.md docs/release/v0.1.0-visual-verification.md docs/release/v0.1.0-local-verification.md
git commit -m "docs: record natural welcome scrolling"
```
