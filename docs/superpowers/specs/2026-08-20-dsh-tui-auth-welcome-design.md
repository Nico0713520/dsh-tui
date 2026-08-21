# dsh-tui Persistent Authentication and Welcome Experience Design

## Goal

Make `deepseek` remember a configured DeepSeek API key across launches and replace the current one-line startup header with a responsive, product-quality welcome surface that remains visible until the first prompt is sent.

## Confirmed product behavior

- A user enters the DeepSeek API key once. Later `deepseek` launches do not ask again.
- `DEEPSEEK_API_KEY` remains the explicit per-run override and always wins over managed storage.
- Managed credentials live in the DeepSeek Harness home at `$DSH_HOME/.credentials.yaml`, defaulting to `~/.dsh/.credentials.yaml`.
- The credential directory is owner-only (`0700`) and the document is owner-only (`0600`) on POSIX.
- No command, status message, exception, log, test output, process argument, README example, or session record may reveal a stored value.
- `deepseek auth login`, `deepseek auth status`, and `deepseek auth logout` manage the DeepSeek credential without starting the TUI.
- A normal ACP launch with no configured credential performs the same hidden login once, saves it, then starts. Echo, help, and version commands never require a credential.
- Each empty fresh session shows the complete welcome panel. The panel stays after the backend becomes ready and folds into a compact one-line brand header only after a user transcript item is committed.
- Starting a fresh session reopens the complete welcome panel. Read-only History does not add a second welcome panel.
- Input is focused immediately. Startup art and status updates never sleep, await animation, or delay backend boot.
- No push, tag, publish, or repository visibility change is part of this work.

## Credential architecture

### Resolution order

1. A non-empty inherited `DEEPSEEK_API_KEY`.
2. `DEEPSEEK_API_KEY` in the managed Harness credential document.
3. Missing.

The dsh-tui process only needs to know whether a credential is configured. The backend composition mounts `@deepseek-ai/dsh-credentials-local` before `@deepseek-ai/dsh-llm-deepseek`; the Harness resolves the actual managed value for each model operation. dsh-tui never adds a stored key to its own environment.

### Management surface

`src/credentials.ts` owns the small CLI-facing storage surface:

```ts
export type CredentialSource = "environment" | "managed" | "missing"
export interface CredentialStatus { configured: boolean; source: CredentialSource; writable: boolean }
export function credentialFilePath(env?: NodeJS.ProcessEnv, home?: string): string
export async function describeDeepSeekCredential(options?: CredentialStoreOptions): Promise<CredentialStatus>
export async function storeDeepSeekCredential(value: string, options?: CredentialStoreOptions): Promise<void>
export async function removeDeepSeekCredential(options?: CredentialStoreOptions): Promise<boolean>
```

The writer parses the complete YAML mapping, changes only `DEEPSEEK_API_KEY`, and atomically replaces the document. Invalid or over-permissive documents fail with a redacted diagnostic naming only the path and repair action.

`src/secret-input.ts` owns hidden TTY input and always restores terminal mode. Tests inject a reader instead of simulating private internals.

### CLI behavior

- `auth login`: reject an empty entry, save a non-empty entry, print only the destination and success state.
- `auth status`: print `configured (environment)`, `configured (managed)`, or `not configured`.
- `auth logout`: remove only the managed DeepSeek entry; an active environment override remains visible as read-only.
- Bare ACP startup: if missing, run hidden login once; if configured, start silently.
- `--echo`, `--help`, and `--version`: bypass credential preflight.

## Welcome architecture

`src/ui/welcome-panel.ts` is a pure presentation module. It consumes columns, motion tick, TTY capability, model, cwd, phase, session id, and completion state, and returns bounded terminal text. It contains no controller or timer behavior.

`AppView` decides between complete and compact presentation from observable state:

```ts
const expanded = !state.transcript.some((item) => item.kind === "user")
```

The welcome panel is therefore naturally restored by a real fresh session, naturally collapsed by a committed first prompt, and absent from a replay containing user transcript items.

### Visual hierarchy

The complete tier uses an original compact DSH wordmark, not Hermes artwork:

1. DSH wordmark and `deepseek harness · terminal client` identity.
2. Model, backend state, workspace, session, and safety posture.
3. Primary key hints.

The surface uses the existing cool palette: cyan for identity, blue/dim for secondary metadata, green for ready, yellow for startup and queued states, and red only for actual failure.

### Responsive tiers

- `>= 96` columns: full wordmark, identity line, and complete metadata rows.
- `60–95` columns: compact brand rule and one-column metadata.
- `34–59` columns: product name, model/state, and essential keys.
- `< 34` columns: the existing compact status/header behavior with no decorative art.

Every rendered line must have visible width less than or equal to the current terminal columns. CJK paths and model names are truncated by terminal cell width rather than JavaScript string length.

### Motion

Full motion paints the static first frame immediately, then scans a highlight across the wordmark at 80 ms per frame. If the backend becomes ready immediately, at least four sweep frames remain visible before the 160 ms completion pulse. Reduced motion performs only the completion emphasis. Off renders the complete static panel without timers.

`NO_COLOR` no longer silently changes the requested motion preference. Motion is controlled only by `--motion` / `DSH_TUI_MOTION`; the welcome layout remains present in every mode.

## Error handling

- Invalid credential permissions or YAML stop ACP startup before the TUI takes terminal ownership.
- Credential diagnostics never include source text or parser excerpts.
- Hidden input cancellation exits with status 1 and restores raw mode.
- Welcome rendering has a compact fallback for every width and never prevents editor creation.
- Existing backend failure, cancellation, approval, History, and cleanup behavior remains unchanged.

## Verification seams

- Credential API: status, save, remove, precedence, permissions, and redacted failure.
- CLI API: auth commands and ACP preflight through injected IO/runApp dependencies.
- Welcome renderer: literal hierarchy and bounded widths at 32, 48, 80, and 120 columns.
- Welcome lifecycle: PTY first frame, immediate input, first-submit collapse, resize, and clean exit.
- Composition: both platform files mount the local credential provider before the LLM.
- Packaging: dependency, tarball, and clean-install checks include the provider and welcome module.
