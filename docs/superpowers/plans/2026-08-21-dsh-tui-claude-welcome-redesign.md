# dsh-tui Claude-style Welcome Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sparse Braille whale and dense startup metadata block with a Claude-style framed welcome card and a solid, recognizable terminal rendering of the official DeepSeek whale.

**Architecture:** Keep `assets/brand/deepseek-whale.svg` and its PNG cache frozen. Give `brand-logo.ts` sole responsibility for capability selection and full/compact logo components; add a focused `welcome-card.ts` component for framed wide/stacked layout; keep `welcome-panel.ts` responsible only for welcome lifecycle, compact identity, and optional divider motion.

**Tech Stack:** TypeScript 6, Node.js 22.19+, `@earendil-works/pi-tui` 0.84.2, Vitest 4, node-pty.

## Global Constraints

- Keep the official SVG and PNG cache byte-for-byte unchanged and preserve their existing hash tests.
- Use DeepSeek blue only through the semantic `brand` theme role; `NO_COLOR` must preserve geometry without ANSI color.
- Do not add a rasterization dependency or runtime SVG parser.
- Do not copy Claude's mascot, text, orange color, update feed, or proprietary product claims.
- The complete welcome must remain immediately interactive and collapse after the first submitted user message.
- Do not push, tag, publish, or modify repository visibility.

## File map

- `src/ui/brand-logo.ts`: full/compact solid whale glyphs, logo tier selection, and inline image component.
- `src/ui/welcome-card.ts`: framed split/stacked card rendering and terminal-cell-safe border composition.
- `src/ui/welcome-panel.ts`: expanded/compact lifecycle and integration with `WelcomeCard`.
- `tests/unit/brand-logo.test.ts`: independently reviewed whale glyph literals and asset integrity.
- `tests/unit/welcome-card.test.ts`: content hierarchy, row budget, borders, and responsive tiers.
- `tests/unit/welcome-panel.test.ts`: compact identity and collapse behavior.
- `tests/unit/visual-layout.test.ts`: cross-theme/capability width matrix.
- `tests/pty/tui-echo.test.ts`: user-visible startup, resize, collapse, `NO_COLOR`, and image protocol journey.
- `docs/release/v0.1.0-visual-verification.md`: owner-review matrix for the revised welcome.

---

### Task 1: Solid official-whale terminal glyph

**Files:**
- Modify: `src/ui/brand-logo.ts`
- Test: `tests/unit/brand-logo.test.ts`

**Interfaces:**
- Produces: `type WhalePixelTier = "full" | "compact"`
- Produces: `whalePixelArt(tier: WhalePixelTier): readonly string[]`
- Produces: `createBrandLogo(...)` with a `16×6` full and `12×5` compact layout box.

- [ ] **Step 1: Replace the old Braille expectation with reviewed solid-glyph fixtures**

```ts
expect(whalePixelArt("full")).toEqual([
  "  ▄▄████  ▄█▄ ▄▄",
  "▄████████▄ ▀███▀",
  "█▀ ▀▀████▀████",
  "██    ▀██████",
  " ██▄ ▄▄ ████",
  "  ▀██████▀▀▀▀",
])
expect(whalePixelArt("full").join("\n")).not.toMatch(/[\u2800-\u28ff]/u)
expect(whalePixelArt("full").every((row) => visibleWidth(row) <= 16)).toBe(true)
expect(whalePixelArt("compact").every((row) => visibleWidth(row) <= 12)).toBe(true)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/brand-logo.test.ts`

Expected: FAIL because `whalePixelArt` is not exported and the existing fallback still contains Braille glyphs.

- [ ] **Step 3: Implement the fixed full and compact half-block samples**

```ts
export type WhalePixelTier = "full" | "compact"

const WHALE_PIXELS: Record<WhalePixelTier, readonly string[]> = {
  full: [
    "  ▄▄████  ▄█▄ ▄▄",
    "▄████████▄ ▀███▀",
    "█▀ ▀▀████▀████",
    "██    ▀██████",
    " ██▄ ▄▄ ████",
    "  ▀██████▀▀▀▀",
  ],
  compact: [
    " ▄████  █▄▄▄",
    "███████▄███▀",
    "█   ▀█████",
    "▀█  ▄▀███▀",
    " ▀█████▀▀",
  ],
}

export function whalePixelArt(tier: WhalePixelTier): readonly string[] {
  return WHALE_PIXELS[tier]
}
```

Update `createBrandLogo` so text terminals color `whalePixelArt(tier).join("\n")`, image terminals use matching `maxWidthCells`/`maxHeightCells`, and widths below 34 still return `null`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/unit/brand-logo.test.ts`

Expected: all brand tests pass; official asset hashes remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/ui/brand-logo.ts tests/unit/brand-logo.test.ts
git commit -m "feat: render a solid DeepSeek whale"
```

---

### Task 2: Claude-style framed welcome card

**Files:**
- Create: `src/ui/welcome-card.ts`
- Create: `tests/unit/welcome-card.test.ts`

**Interfaces:**
- Consumes: `Component`, `UiTheme`, `AppPhase`, and the logo component from Task 1.
- Produces: `WelcomeCardOptions` containing `columns`, `logo`, `model`, `cwd`, `phase`, and `theme`.
- Produces: `class WelcomeCard implements Component`.

- [ ] **Step 1: Write failing wide, medium, stacked, and text-tier tests**

```ts
const lines = new WelcomeCard({ ...base, columns: 120, logo }).render(120)
const plain = stripTerminalSequences(lines.join("\n"))
expect(lines).toHaveLength(8)
expect(plain).toContain("╭─ DeepSeek Harness  v0.1.0")
expect(plain).toContain("Welcome back!")
expect(plain).toContain("Tips for getting started")
expect(plain).toContain("Quick actions")
expect(plain).not.toContain("session-1234")
expect(plain).not.toContain("workspace-write")
expect(lines.every((line) => visibleWidth(line) <= 120)).toBe(true)
```

Add equivalent checks at 80, 60, 48, 34, and 32 columns. The 60/48 tiers must have no vertical divider; 32 columns must return the text identity rather than partial borders.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/welcome-card.test.ts`

Expected: FAIL because `src/ui/welcome-card.ts` does not exist.

- [ ] **Step 3: Implement terminal-cell-safe framing**

```ts
export class WelcomeCard implements Component {
  constructor(private options: WelcomeCardOptions) {}

  render(width: number): string[] {
    const columns = Math.max(1, Math.min(width, this.options.columns))
    if (columns < 34) return [compactCardIdentity(this.options, columns)]
    return columns >= 72
      ? renderSplitCard(this.options, columns)
      : renderStackedCard(this.options, columns)
  }
}
```

Use `truncateToWidth` and `visibleWidth` for every cell; build top, interior, split, and bottom borders from exact allocated widths. Center the left content, keep the right content left-aligned, and apply color to content/border segments only after padding so ANSI does not affect geometry.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/unit/welcome-card.test.ts`

Expected: all card tiers pass their row budget, hierarchy, border, and width checks.

- [ ] **Step 5: Commit**

```bash
git add src/ui/welcome-card.ts tests/unit/welcome-card.test.ts
git commit -m "feat: add a Claude-style welcome card"
```

---

### Task 3: Integrate responsive welcome lifecycle

**Files:**
- Modify: `src/ui/welcome-panel.ts`
- Modify: `tests/unit/welcome-panel.test.ts`
- Modify: `tests/unit/visual-layout.test.ts`

**Interfaces:**
- Consumes: `WelcomeCard` and `createBrandLogo`.
- Preserves: `compactIdentityText(...)` and `shouldExpandWelcome(...)` public behavior.
- Removes: expanded `welcomePanelText(...)` metadata layout after callers/tests migrate.

- [ ] **Step 1: Write failing lifecycle and visual-matrix expectations**

```ts
const expanded = welcome(120, textCapabilities, "terminal").render(120)
expect(stripTerminalSequences(expanded.join("\n"))).toContain("Welcome back!")
expect(stripTerminalSequences(expanded.join("\n"))).not.toContain("approval ask")
expect(expanded.every((line) => visibleWidth(line) <= 120)).toBe(true)
```

Keep the existing first-user collapse assertion and run all widths `[120, 96, 80, 60, 48, 32]` in both themes and both text/image capability paths.

- [ ] **Step 2: Run the integration unit tests and verify RED**

Run: `npx vitest run tests/unit/welcome-panel.test.ts tests/unit/visual-layout.test.ts`

Expected: FAIL because the old welcome still renders dense metadata and has no framed hierarchy.

- [ ] **Step 3: Replace the expanded HStack with `WelcomeCard`**

```ts
const card = new WelcomeCard({
  columns,
  logo: this.logo(columns),
  model: this.options.model,
  cwd: this.options.cwd,
  phase: this.options.phase,
  theme: this.options.theme,
})
return [...card.render(columns), welcomeRule(presentation)]
```

Cache logo components by mode/tier as before, but use full at `>=96`, compact at `34–95`, and text below 34. Keep the existing collapse trigger and non-blocking motion behavior unchanged.

- [ ] **Step 4: Run the integration unit tests and verify GREEN**

Run: `npx vitest run tests/unit/welcome-panel.test.ts tests/unit/visual-layout.test.ts`

Expected: both files pass for all themes, capabilities, and widths.

- [ ] **Step 5: Commit**

```bash
git add src/ui/welcome-panel.ts tests/unit/welcome-panel.test.ts tests/unit/visual-layout.test.ts
git commit -m "feat: integrate the responsive welcome card"
```

---

### Task 4: Real PTY acceptance and release evidence

**Files:**
- Modify: `tests/pty/tui-echo.test.ts`
- Modify: `docs/release/v0.1.0-visual-verification.md`
- Modify: `docs/release/v0.1.0-local-verification.md`

**Interfaces:**
- Consumes: installed `dsh-tui`/`deepseek` CLI and the completed welcome UI.
- Produces: deterministic terminal evidence and updated local release ledger.

- [ ] **Step 1: Update the PTY assertions before implementation verification**

```ts
await terminal.waitForText("Welcome back!")
expect(terminal.screenText()).toContain("Tips for getting started")
expect(terminal.screenText()).toContain("Quick actions")
expect(terminal.screenText()).not.toContain("workspace-write")
expect(terminal.screenText()).not.toMatch(/[\u2800-\u28ff]/u)
```

After the first prompt, assert that `Welcome back!`, the framed card, and whale glyph are absent while the compact `DeepSeek Harness` identity remains. Preserve `/status` verification that hidden details remain accessible. Resize a fresh welcome through 120, 80, 60, 48, and 32 columns and assert no overflow or malformed border fragments.

- [ ] **Step 2: Run the PTY file and verify failures identify stale expectations**

Run: `npm run test:pty -- tests/pty/tui-echo.test.ts`

Expected before final integration: old Braille/dense-metadata expectations fail. Expected after Tasks 1–3: all Echo PTY tests pass.

- [ ] **Step 3: Update visual and local verification ledgers**

Record the revised card tiers, solid whale fallback, exact test totals, built bundle size, and npm package dry-run sizes. Keep subjective Apple Terminal/iTerm owner review marked `PENDING` until the owner actually inspects it.

- [ ] **Step 4: Run the complete local release gate**

Run:

```bash
npm run check
npm run install:check
npm audit --omit=dev
npm pack --dry-run --json --ignore-scripts
deepseek --version
git diff --check
```

Expected: lint, typecheck, all non-live tests, build, composition, publint, package allowlist, clean install, Echo TTY smoke, audit, CLI version, and whitespace checks all pass. The opt-in paid live test remains skipped.

- [ ] **Step 5: Commit**

```bash
git add tests/pty/tui-echo.test.ts docs/release/v0.1.0-visual-verification.md docs/release/v0.1.0-local-verification.md
git commit -m "test: verify the redesigned welcome journey"
```

## Completion boundary

Stop after the local worktree is clean and all checks pass. Do not push, tag,
publish, upload a social preview, or change any public repository state.
