# Native Terminal Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give dsh-tui a Claude-like main-screen flow with a welcome-adjacent initial composer and native Apple Terminal mouse-wheel scrollback.

**Architecture:** Keep `TuiMainScreen` and render the transcript, a one-row separator, editor, and footer as one natural document. Remove the fixed-height `MainScreenLayout`, `ScrollView`, and custom keyboard-scroll state so the terminal owns history and mouse gestures.

**Tech Stack:** TypeScript 6, Node.js 22+, `@earendil-works/pi-tui` 0.84.2, Vitest 4, node-pty.

## Global Constraints

- Do not switch to `TuiAltScreen`.
- Do not enable terminal mouse-reporting modes.
- Preserve all ACP, credential, transcript, overlay, resize, theme, and editor behavior outside scrolling/layout.
- Do not push, tag, publish, or change repository visibility.
- Do not stage the existing untracked `docs/superpowers/plans/2026-08-21-dsh-tui-v0.2-optimization-implementation.md`.

---

### Task 1: Lock the Claude-like main-screen behavior at the PTY seam

**Files:**
- Modify: `tests/pty/tui-echo.test.ts`
- Delete: `tests/unit/main-screen-layout.test.ts`
- Delete: `tests/unit/scroll-keys.test.ts`

**Interfaces:**
- Consumes: `spawnTui(...).screenText()` and `.raw()`.
- Produces: regression coverage for fresh composer placement, natural transcript growth, and absence of terminal mouse capture.

- [x] **Step 1: Write the failing fresh-layout assertion**

After the welcome is ready, split `screenText()` into rows and assert that the
first editor border appears no more than two rows below the welcome card's bottom
border. On the current fixed-height layout this fails because the editor is
padded to the bottom of the 30-row screen.

- [x] **Step 2: Replace the application-scroll PTY assertion**

Keep the long-conversation exchange assertions, remove synthetic PageUp and
Ctrl+End input, and assert that raw startup output does not contain any of:

```ts
for (const mode of [1000, 1002, 1003, 1006]) {
  expect(terminal.raw()).not.toContain(`\x1b[?${mode}h`)
}
```

- [x] **Step 3: Run the focused PTY test and verify red**

Run:

```bash
npx vitest run tests/pty/tui-echo.test.ts
```

Expected: FAIL on the fresh composer placement while the current bottom-pinned
layout remains installed.

### Task 2: Replace the bounded viewport with the natural document

**Files:**
- Modify: `src/ui/app-view.ts`
- Delete: `src/ui/main-screen-layout.ts`
- Delete: `src/ui/scroll-keys.ts`

**Interfaces:**
- Consumes: existing `transcript`, `Editor`, `status`, `ThemeCanvas`, and `TuiMainScreen` components.
- Produces: a natural main-screen child order of transcript → one-row separator → editor → status.

- [x] **Step 1: Remove application-owned scroll state**

Delete the `ScrollView`, `MainScreenLayout`, and `resolveScrollKey` imports,
remove the `scroller` field, remove `handleScrollKey()` and
`flashScrollNotice()`, and stop consuming scroll-key escape sequences in
`handleGlobalInput()`.

- [x] **Step 2: Mount the natural component order**

Import `Spacer` and replace the custom layout child with:

```ts
this.canvas.addChild(this.transcript)
this.canvas.addChild(new Spacer(1))
this.canvas.addChild(this.editor)
this.canvas.addChild(this.status)
```

Keep `ThemeCanvas` width clipping. For the DeepSeek painted theme, pad only after
all natural children so the blank canvas never separates the welcome from the
composer.

- [x] **Step 3: Run focused tests and verify green**

Run:

```bash
npx vitest run tests/pty/tui-echo.test.ts tests/unit/app-view.test.ts tests/unit/theme-canvas.test.ts
```

Expected: PASS; fresh composer is adjacent, long conversations remain visible at
the bottom, and no mouse-reporting mode is enabled.

### Task 3: Align help text and verify the whole source tree

**Files:**
- Modify: `src/ui/welcome-card.ts`
- Modify: `src/ui/app-view.ts`
- Modify: `src/cli.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Consumes: the native terminal behavior from Task 2.
- Produces: accurate public guidance that names mouse-wheel/trackpad scrolling rather than removed application-owned PageUp behavior.

- [x] **Step 1: Update visible guidance**

Replace PageUp/PageDown transcript-scrolling claims with concise native wording:
`Wheel scroll` in compact English UI, `mouse wheel / trackpad` in English docs,
and `鼠标滚轮 / 触控板` in Chinese docs. Do not claim that dsh-tui draws or can
force the macOS scrollbar.

- [x] **Step 2: Run all source checks**

Run:

```bash
npm run check:source
```

Expected: lint, typecheck, all tests, and build PASS.

- [x] **Step 3: Inspect the built PTY at 120×30 and 80×24**

Run the built Echo mode in a PTY, verify the fresh and post-message row order,
and inspect raw output for mouse-reporting sequences. Expected: no overflow,
crash, mouse capture, bottom-pinned fresh composer, or regression in Home/End.

- [x] **Step 4: Commit only the scoped change**

```bash
git add src/ui/app-view.ts src/ui/theme-canvas.ts src/ui/welcome-card.ts src/cli.ts README.md README.zh-CN.md tests/pty/tui-echo.test.ts docs/superpowers/specs/2026-08-22-dsh-tui-native-terminal-flow.md docs/superpowers/plans/2026-08-22-dsh-tui-native-terminal-flow-implementation.md
git add -u src/ui/main-screen-layout.ts src/ui/scroll-keys.ts tests/unit/main-screen-layout.test.ts tests/unit/scroll-keys.test.ts
git commit -m "fix: restore native terminal scrolling"
```
