# dsh-tui Persistent Authentication and Welcome Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a DeepSeek credential after one hidden login and ship a responsive Hermes-inspired, dsh-tui-original welcome surface that folds after the first prompt.

**Architecture:** Mount the Harness local credential provider in both ACP compositions, add a small redacted credential-management seam to the CLI, and keep stored values out of the dsh-tui process environment. Add a pure responsive welcome renderer to the existing pi-tui view and drive it with the existing non-blocking pulse clock and controller state.

**Tech Stack:** TypeScript 6, Node.js 22+, pi-tui, Vitest, node-pty, YAML 2, DeepSeek Harness rc.7 Cordis plugins.

## Global Constraints

- A configured credential is requested once and reused on every later launch.
- Environment credentials are read-only per-run overrides and always win.
- Secrets never appear in argv, output, logs, diagnostics, snapshots, docs, or tests.
- Managed credential directory/file modes are `0700`/`0600` on POSIX.
- The complete welcome panel stays until the first user transcript item is committed.
- Motion never blocks editor focus or backend startup.
- Every visible line fits terminal widths from 32 through 120 columns.
- Do not push, tag, publish, or change repository visibility.

---

### Task 1: Managed credential storage

**Files:**
- Create: `src/credentials.ts`
- Create: `tests/unit/credentials.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `credentialFilePath`, `describeDeepSeekCredential`, `storeDeepSeekCredential`, and `removeDeepSeekCredential`.
- Consumes: Node filesystem primitives and `yaml` parsing/stringifying.

- [ ] **Step 1: Write a failing test for missing, managed, and environment status**

```ts
expect(await describeDeepSeekCredential({ env: {}, home })).toEqual({ configured: false, source: "missing", writable: true })
await storeDeepSeekCredential("test-secret", { env: {}, home })
expect(await describeDeepSeekCredential({ env: {}, home })).toEqual({ configured: true, source: "managed", writable: true })
expect(await describeDeepSeekCredential({ env: { DEEPSEEK_API_KEY: "override" }, home })).toEqual({ configured: true, source: "environment", writable: false })
```

- [ ] **Step 2: Run the credential test and verify RED**

Run: `npx vitest run tests/unit/credentials.test.ts`

Expected: FAIL because `src/credentials.ts` does not exist.

- [ ] **Step 3: Implement strict redacted storage with atomic owner-only writes**

```ts
export interface CredentialStoreOptions { env?: NodeJS.ProcessEnv; home?: string; platform?: NodeJS.Platform }
export async function describeDeepSeekCredential(options: CredentialStoreOptions = {}): Promise<CredentialStatus>
export async function storeDeepSeekCredential(value: string, options: CredentialStoreOptions = {}): Promise<void>
export async function removeDeepSeekCredential(options: CredentialStoreOptions = {}): Promise<boolean>
```

Parse the whole YAML mapping, reject malformed content without embedding parser text, create the parent with `0700`, write a same-directory temporary file with `0600`, rename it, and enforce final modes.

- [ ] **Step 4: Add direct `yaml` and `@deepseek-ai/dsh-credentials-local` dependencies and run GREEN**

Run: `npm install --save-exact yaml@2.9.0 @deepseek-ai/dsh-credentials-local@0.1.0-rc.7 && npx vitest run tests/unit/credentials.test.ts`

Expected: all credential tests pass.

- [ ] **Step 5: Commit the credential storage slice**

```bash
git add package.json package-lock.json src/credentials.ts tests/unit/credentials.test.ts
git commit -m "feat: add managed DeepSeek credentials"
```

### Task 2: Authentication commands and one-time preflight

**Files:**
- Create: `src/secret-input.ts`
- Create: `tests/unit/cli.test.ts`
- Modify: `src/cli.ts`
- Modify: `config/cordis.posix.yml`
- Modify: `config/cordis.windows.yml`
- Modify: `~/.local/bin/deepseek`

**Interfaces:**
- Consumes: Task 1 credential functions.
- Produces: `runAuthCommand`, hidden login preflight, and a thin external shortcut.

- [ ] **Step 1: Write failing CLI tests through injected IO**

```ts
expect(await runCli(["auth", "login"], {}, depsWithSecret("test-secret"))).toBe(0)
expect(stdout).toContain("saved")
expect(stdout).not.toContain("test-secret")
expect(await runCli([], {}, depsWithConfiguredStore())).toBe(7)
expect(runAppCalls).toBe(1)
```

- [ ] **Step 2: Run the CLI test and verify RED**

Run: `npx vitest run tests/unit/cli.test.ts`

Expected: FAIL because auth commands and injectable CLI dependencies do not exist.

- [ ] **Step 3: Implement hidden input and auth command dispatch**

```ts
export interface CliDependencies {
  home?: string
  platform?: NodeJS.Platform
  readSecret?: (prompt: string) => Promise<string>
  stdout?: Pick<NodeJS.WriteStream, "write">
  stderr?: Pick<NodeJS.WriteStream, "write">
  runApp?: typeof runApp
}
```

Intercept `auth` before `loadConfig`; bypass preflight for help/version/echo; run one hidden login for a missing ACP credential; never echo or interpolate the value.

- [ ] **Step 4: Mount `@deepseek-ai/dsh-credentials-local` before the LLM in both compositions**

```yaml
- id: credentials
  name: '@deepseek-ai/dsh-credentials-local'
```

- [ ] **Step 5: Make the external `deepseek` command a thin launcher and run GREEN**

Remove its `read DEEPSEEK_API_KEY` block. Keep only build detection and `exec` with default ACP/model/cwd arguments.

Run: `npx vitest run tests/unit/cli.test.ts tests/unit/credentials.test.ts && npm run composition:check`

Expected: all tests and both compositions pass.

- [ ] **Step 6: Commit the auth command slice**

```bash
git add src/cli.ts src/secret-input.ts tests/unit/cli.test.ts config/cordis.posix.yml config/cordis.windows.yml
git commit -m "feat: remember DeepSeek authentication"
```

### Task 3: Pure responsive welcome renderer

**Files:**
- Create: `src/ui/welcome-panel.ts`
- Create: `tests/unit/welcome-panel.test.ts`
- Modify: `src/ui/deep-pulse.ts`
- Modify: `tests/unit/deep-pulse.test.ts`

**Interfaces:**
- Produces: `welcomePanelText(options)` and `shouldExpandWelcome(state)`.
- Consumes: `DeepPulseTick`, existing theme colors, `singleLine`, `truncateToWidth`, and `visibleWidth`.

- [ ] **Step 1: Write failing responsive and lifecycle tests**

```ts
for (const columns of [32, 48, 80, 120]) {
  const text = welcomePanelText({ ...base, columns })
  expect(text.split("\n").every((line) => visibleWidth(line) <= columns)).toBe(true)
}
expect(shouldExpandWelcome({ ...state, transcript: [] })).toBe(true)
expect(shouldExpandWelcome({ ...state, transcript: [{ kind: "user", text: "hello" }] })).toBe(false)
```

- [ ] **Step 2: Run the renderer test and verify RED**

Run: `npx vitest run tests/unit/welcome-panel.test.ts`

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement four responsive tiers and original DSH art**

Keep each tier pure. Full output includes identity, model, state, workspace, session, safety, and primary keys. Compact tiers remove lower-priority fields before truncating high-priority fields.

- [ ] **Step 4: Add a failing fast-ready motion test, then preserve four sweep frames**

```ts
clock.start()
clock.complete()
vi.advanceTimersByTime(240)
expect(ticks.filter((tick) => !tick.completion).map((tick) => tick.frame)).toEqual([0, 1, 2, 3])
```

Update `DeepPulseClock.complete()` to defer completion until frame 4 only in full motion. Input collapse still settles immediately.

- [ ] **Step 5: Run renderer and pulse tests GREEN and commit**

Run: `npx vitest run tests/unit/welcome-panel.test.ts tests/unit/deep-pulse.test.ts`

```bash
git add src/ui/welcome-panel.ts src/ui/deep-pulse.ts tests/unit/welcome-panel.test.ts tests/unit/deep-pulse.test.ts
git commit -m "feat: add responsive DSH welcome surface"
```

### Task 4: Integrate welcome lifecycle into AppView

**Files:**
- Modify: `src/ui/app-view.ts`
- Modify: `src/app.ts`
- Modify: `src/config.ts`
- Modify: `tests/unit/app-view.test.ts`
- Modify: `tests/unit/config.test.ts`
- Modify: `tests/pty/tui-echo.test.ts`

**Interfaces:**
- Consumes: Task 3 `welcomePanelText` and `shouldExpandWelcome`.
- Produces: immediate full first frame, post-submit compact header, and motion independent from `NO_COLOR`.

- [ ] **Step 1: Write a failing PTY assertion for full welcome then collapse**

Start Echo at 120 columns, wait for `DeepSeek Harness in your terminal`, submit `hello`, then assert the subsequent screen has the compact brand but no full tagline.

- [ ] **Step 2: Run the PTY test and verify RED**

Run: `npx vitest run tests/pty/tui-echo.test.ts`

Expected: FAIL because only the compact header exists.

- [ ] **Step 3: Pass cwd into AppView and select full/compact header from controller state**

Render the complete panel from the first state before `tui.start()`. Keep the editor and backend start order unchanged. Recompute on phase, pulse, transcript, and resize renders.

- [ ] **Step 4: Stop forcing motion off under `NO_COLOR`**

```ts
const motion: MotionPreference = requestedMotion
```

Update the config test so explicit/default motion remains full with `NO_COLOR`, while `DSH_TUI_MOTION=off` remains off.

- [ ] **Step 5: Run unit and PTY GREEN and commit**

Run: `npx vitest run tests/unit/config.test.ts tests/unit/app-view.test.ts tests/pty/tui-echo.test.ts`

```bash
git add src/ui/app-view.ts src/app.ts src/config.ts tests/unit/app-view.test.ts tests/unit/config.test.ts tests/pty/tui-echo.test.ts
git commit -m "feat: keep welcome visible until first prompt"
```

### Task 5: Documentation, packaging, and full verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `tests/pty/tui-acp.test.ts`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: release-ready local documentation and verification evidence.

- [ ] **Step 1: Document one-time login, auth commands, storage, precedence, welcome lifecycle, and motion**

Use redacted placeholders only. State that managed file permissions protect against other OS users but are not an isolation boundary from same-user processes.

- [ ] **Step 2: Run targeted credential and presentation suites**

Run: `npx vitest run tests/unit/credentials.test.ts tests/unit/cli.test.ts tests/unit/welcome-panel.test.ts tests/unit/deep-pulse.test.ts tests/unit/app-view.test.ts tests/pty/tui-echo.test.ts`

Expected: all pass with no credential value in output.

- [ ] **Step 3: Run the complete release checks**

Run: `npm run check && npm run install:check`

Expected: lint, typecheck, all unit/integration/PTY tests, build, composition, publint, package, and clean-install checks pass.

- [ ] **Step 4: Verify the installed user command without revealing a real key**

Run `deepseek auth status`, then launch `deepseek` twice in a terminal. Confirm the first configured launch reaches the full welcome panel and the second launch does not ask for a key. Confirm the first submitted prompt folds the panel.

- [ ] **Step 5: Commit docs and final hardening**

```bash
git add README.md README.zh-CN.md tests
git commit -m "docs: explain authentication and welcome flow"
```

Do not push, tag, publish, or change repository visibility.
