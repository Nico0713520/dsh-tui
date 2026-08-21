# dsh-tui Product Visual System Design

## Goal

Turn the existing functional TUI into a recognizable, calm, release-quality DeepSeek Harness product without sacrificing terminal compatibility, input latency, streaming speed, or long-session readability.

The product uses one coherent system with three layers:

1. **Quiet Signal** is the default working experience on the user's existing terminal background.
2. **DeepSeek Light** is an optional persistent blue-white presentation theme.
3. **Session Panel** exposes richer Harness/session information on demand instead of keeping it in permanent chrome.

## Product identity

- Primary product name: `DeepSeek Harness`.
- CLI/package name: `dsh-tui`.
- Shell shortcut: `deepseek`.
- Primary logo: the transparent official blue whale SVG published by DeepSeek API Docs at `https://api-docs.deepseek.com/img/favicon.svg`. Keep the source path, `#4D6BFE` color, proportions, and artwork unchanged; do not hand-redraw, recolor, crop, trace, distort, or animate the whale itself.
- The repository stores that exact verified SVG at `assets/brand/deepseek-whale.svg`, with its origin and SHA-256 recorded beside it. A deterministic transparent PNG render is stored only as a terminal-protocol cache; display scaling always preserves aspect ratio.
- Image-capable terminals render the PNG cache. Apple Terminal and other text-only terminals render a fixed blue Braille silhouette sampled from the same official SVG, never an independently designed mascot. The original SVG remains the single source of truth.
- This is an independent community TUI. Product copy and notices must not imply that DeepSeek officially publishes, endorses, or maintains it.
- DeepSeek blue is the only persistent brand accent. Green, yellow, and red are reserved for semantic state.
- Marketing state may be visually expressive. Working state must be quiet.

## Experience lifecycle

### Immediate first frame

- The editor is focused immediately.
- A static welcome frame renders before asynchronous backend/session work completes.
- Terminals with Kitty or iTerm2 inline-image support render the faithful transparent image. Other truecolor terminals render the official-shape Braille silhouette; `NO_COLOR` preserves the silhouette without blue. Extremely narrow terminals use text-only branding.
- Backend startup, credential resolution, session creation, and update checks never wait for visual animation.
- Any keyboard input ends the entrance animation immediately.

### Empty session welcome

At `120x30`, the complete welcome surface consumes no more than nine rows:

1. Official blue DeepSeek whale at `10×4` cells beside the product name and runtime facts. Text-only terminals use the `11×4` Braille silhouette in the same left track; no white tile or filename fallback is allowed.
2. One divider row.
3. Model/state row.
4. Workspace/session/safety row, wrapping only in the medium tier.
5. One primary-key row.

The welcome is the first component inside the transcript scroll surface. It is not permanent top chrome.

### First prompt transition

- When the first user transcript item is committed, the full welcome becomes one compact identity row.
- That row stays at transcript position zero and naturally scrolls away.
- No fixed brand header remains during normal conversation.
- A genuinely new session restores the complete welcome. History replay never creates a second welcome.

### Working conversation

- User messages use a restrained DeepSeek-blue rail in Terminal theme and a pale-blue surface in DeepSeek Light.
- Assistant prose has no avatar, box, or permanent role label.
- Streaming output uses one subtle cursor only while text is active.
- Thinking is represented by a compact activity/trace row. Raw chain-of-thought is never fabricated.
- Tool calls use compact semantic cards and replace their pending state in place when a result arrives.
- Diagnostics, interruption boundaries, and history boundaries remain visually distinct without competing with assistant text.

### Decision surfaces

- Approvals are the highest-attention surface: risk tone, tool, target summary, choices, and key hints.
- History remains a selectable overlay.
- `/status` opens a read-only Session Panel showing only observable facts: model, workspace, session, phase, safety posture, theme, motion, usage, cost, and current activity.
- The panel must not invent Tool, Skill, MCP, Git, or authentication data that the current runtime cannot prove.

## Theme system

### Semantic roles

Every component consumes semantic roles rather than raw ANSI color names:

- `brand`, `accent`, `text`, `muted`, `subtle`
- `success`, `warning`, `error`
- `border`, `borderFocus`
- `userSurface`, `toolPendingSurface`, `toolSuccessSurface`, `toolErrorSurface`
- Markdown roles for heading, link, inline code, code block, quote, rule, and list marker

### Terminal theme

- Default theme.
- Never paints or changes the terminal background.
- Uses the terminal's default foreground for body text.
- User messages use a blue rail rather than an assumed dark-only background fill.
- Secondary metadata uses dim/default-safe ANSI colors.

### DeepSeek Light theme

- User-facing name: `deepseek`.
- Background: `#F7F9FF`.
- Primary surface: `#FFFFFF`.
- Secondary surface: `#EEF3FF`.
- Border: `#DCE5FF`.
- Brand: `#4D6BFE`.
- Accent: `#5B8CFF`.
- Text: `#182033`.
- Muted: `#687089`.
- Success: `#218A56`.
- Warning: `#A56A00`.
- Error: `#C93C4A`.
- Every line is padded and repainted through a root canvas so nested resets do not leave dark holes.
- Terminal state is fully reset on shutdown and failure.

### Persistence and precedence

Theme resolution order:

1. `--theme terminal|deepseek`
2. `DSH_TUI_THEME`
3. saved UI preference
4. `terminal`

`deepseek theme terminal`, `deepseek theme deepseek`, and `deepseek theme status` manage the saved preference without launching the TUI.

## Responsive system

- `>= 96` columns: full welcome, complete footer, wide overlays.
- `60-95` columns: `8×3` whale plus compact runtime facts, compact footer, narrower overlays.
- `34-59` columns: three-row welcome, status/model/footer essentials only.
- `< 34` columns: one-row identity/status fallback with no decorative art.
- Primary visual verification viewport: `120x30`.
- Minimum complete working viewport: `80x24`.
- Hard overflow verification widths: `120`, `96`, `80`, `60`, `48`, and `32` columns.
- All truncation uses terminal cell width and remains correct for CJK and ANSI text.

## Motion system

- Full entrance: `600-800 ms`, non-blocking and input-cancellable.
- The official whale and its Braille silhouette remain static. Entrance motion is limited to the adjacent divider, status, or text accents and never transforms the logo asset.
- Sweep tick: existing `80 ms` cadence.
- Completion pulse: existing `160 ms` cadence.
- Reduced motion: static first frame plus one completion emphasis.
- Off: static rendering with no timers.
- Thinking/tool animations share one clock; do not create a timer per row.
- Elapsed time updates once per second.
- Resize and streaming updates remain coalesced through existing render backpressure.
- Hidden or occluded overlays do not keep invisible animation timers running.

## Footer and composer priority

The editor remains the working-state visual anchor. Its border reflects focus and phase without changing geometry.

Footer information is removed in this order as width decreases:

1. Cost
2. Cache/token details
3. Session id
4. Elapsed time
5. Workspace tail

Current activity and model remain longest. A transient notice replaces low-priority footer content instead of being appended to an already crowded row.

## Accessibility and compatibility

- Layout and state remain understandable with color disabled.
- `NO_COLOR` disables decorative color, not layout or requested motion.
- Full, reduced, and off motion all expose the same information.
- No essential state is represented only by an Emoji.
- Inline-image capability is detected before adding the logo component. Unsupported terminals receive the faithful Braille renderer, never a filename placeholder or broken-image escape sequence; widths below 34 columns receive clean text-only branding.
- The packed package includes the exact official SVG, deterministic terminal render cache, source/hash record, and a third-party/brand notice.
- DeepSeek Light is opt-in and never mutates the user's terminal profile.
- Transparent terminals remain transparent in Terminal theme.
- Existing credential, ACP, History, cancellation, cleanup, packaging, and performance behavior must remain unchanged.

## Verification contract

- Pure renderers have bounded-width unit tests at all responsive tiers.
- Brand tests verify the official SVG's exact SHA-256, the render-cache SHA-256, aspect-preserving image output on supported terminals, stable `11×4`/`8×3` Braille output on unsupported terminals, and text-only fallback below 34 columns.
- Theme tests verify role coverage and prohibit raw unscoped resets inside DeepSeek Light components.
- Controller tests cover thinking traces and tool duration/result replacement.
- PTY tests cover first frame, first-prompt retreat, both themes, resize, CJK, reduced/off motion, overlays, interruption, and clean exit.
- Existing render-backpressure and streaming Markdown linearity tests remain green.
- No push, tag, publish, or repository visibility change is part of this work.
