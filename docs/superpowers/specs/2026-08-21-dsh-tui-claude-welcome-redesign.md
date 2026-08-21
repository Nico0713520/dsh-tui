# dsh-tui Claude-style welcome redesign

Date: 2026-08-21  
Status: approved direction, ready for implementation planning

## Objective

Replace the current dense startup block and sparse Braille whale with a calm,
high-recognition welcome surface modeled on the layout anatomy of Claude Code:
a titled outer frame, a centered brand area on the left, two concise guidance
areas on the right, and a separate composer/footer below it.

The interface keeps DeepSeek's official blue whale, dsh-tui's own product copy,
and the existing community-product disclaimer. It does not copy Claude's logo,
wording, colors, tips, or update content.

## Selected direction

Three implementation families were considered:

1. **Claude-style framed split panel — selected.** Strong visual hierarchy,
   recognizable product entrance, and close alignment with the owner's reference.
2. Borderless Hermes-style hero. Lighter, but too similar to the current loose
   information block and weaker at organizing startup guidance.
3. Large inline-image hero. Most faithful to the SVG in supporting terminals,
   but inconsistent across Apple Terminal and SSH and too dominant for a coding TUI.

The selected design uses Claude's layout logic while retaining DeepSeek/dsh-tui
identity and existing terminal compatibility.

## Wide layout

At 96 columns and above, the complete welcome card occupies at most nine rows.
Its target 120-column composition is:

~~~text
╭─ DeepSeek Harness  v0.1.0 ───────────────────────────────────────────────────╮
│          Welcome back!          │  Tips for getting started                  │
│                                 │  Enter a task or ask about this workspace. │
│       <solid blue whale>        │  Use /status for session details.          │
│                                 ├─────────────────────────────────────────────┤
│  deepseek-v4-flash · ready      │  Quick actions                             │
│  ~/current-project              │  Ctrl+R history · Ctrl+O tool details      │
╰─────────────────────────────────┴─────────────────────────────────────────────╯
~~~

Layout rules:

- The left column is approximately 34% of the inner width and has centered
  content. The right column receives the remaining width.
- The card has one thin semantic border. DeepSeek blue is used for the title,
  section labels, and whale; the frame remains muted so the screen does not glow.
- The whale is the visual focal point. Product metadata is secondary and limited
  to model, readiness, and a shortened current directory.
- Session ID, permission policy, workspace-write mode, cost, token usage, and
  diagnostic facts do not appear in the welcome card. They remain available in
  `/status` and the adaptive footer when relevant.
- The right column contains no more than four short content lines. Text wraps or
  truncates within its own column and never spills into the divider.
- The composer begins after one blank row. It is not visually fused to the card.

## Whale artwork

The checked-in official DeepSeek SVG remains the source of truth and must keep its
recorded hash. The artwork is never recolored, distorted, animated, or replaced
with an invented whale.

### Text-terminal renderer

- Replace the current Braille strings with a deterministic solid quadrant-block
  raster sampled from the official SVG alpha mask.
- The full fallback target is 16 columns by 6 terminal rows, equivalent to a
  32×12 binary subpixel grid rendered with Unicode solid block elements.
- Sampling preserves the official aspect ratio and centers the non-empty bounds.
- The eye and inner face separation must remain visible at the full tier. The
  tail, raised back, rounded body, and lower return stroke must read as one
  connected whale silhouette.
- The fallback uses only the semantic `brand` foreground color and transparent
  terminal background. It must look solid like Claude's pixel mascot, not dotted,
  noisy, or calligraphic.
- The compact fallback is separately sampled from a 24×10 subpixel grid into
  12×5 cells; it is not produced by truncating the full string.
- `NO_COLOR` uses the same glyph geometry without ANSI color.

### Image-capable renderer

- Kitty/iTerm2 continue to use the exact cached transparent official PNG.
- The full image fits within 16×6 cells and the compact image within 12×5 cells,
  preserving aspect ratio.
- Inline image and text fallback occupy the same layout box so capability changes
  do not alter the card composition.

## Responsive behavior

- `>= 96` columns: framed two-column card, full 16×6 whale.
- `72–95` columns: framed two-column card with a narrower left rail and compact
  12×5 whale; the right side keeps only one tip and one quick-action line.
- `48–71` columns: framed single-column card. Centered compact whale, product
  identity, one start hint, and no vertical divider.
- `34–47` columns: compact framed identity with the 12×5 whale only when it fits;
  otherwise product name, model, and Enter hint.
- `< 34` columns: the existing one-line text identity. No partial art.

No breakpoint may produce half borders, clipped wide glyphs, orphan divider
segments, or more than nine welcome rows at 120×30.

## Lifecycle

- The complete card appears immediately while the backend/session initializes.
- Startup remains editable; the visual does not delay focus or first input.
- On the first submitted message, the entire framed card becomes one compact
  identity row inside the transcript.
- A new session restores the complete card. History replay does not duplicate it.
- The whale itself is static. Existing optional motion may accent only the title
  divider or readiness label and must stop as soon as the user types.

## Public testing seams

The implementation is verified only through stable public rendering seams:

1. `whalePixelArt(tier)` returns fixed, independently reviewed full and compact
   glyph rows derived from the official asset.
2. `WelcomeTranscriptComponent.render(width)` verifies the framed wide/medium/
   stacked/text layouts and terminal-cell bounds.
3. Real PTY tests verify startup output, immediate input, first-message collapse,
   `NO_COLOR`, and clean resize across 120, 80, 60, 48, and 32 columns.
4. The existing asset-hash test proves the official SVG and PNG cache did not
   change.

No test relies on implementation-private state or screenshot pixels from another
product.

## Acceptance criteria

- At 120×30 in Apple Terminal, the whale is a compact solid blue icon with a
  clearly recognizable DeepSeek silhouette and no visible Braille-dot texture.
- The first glance order is whale/product, start guidance, composer, then status.
- The welcome card contains no session ID or policy/debug text.
- At 120 columns the composition feels intentionally sparse and balanced rather
  than like a table of runtime metadata.
- At 80 columns the card remains structured; at 48 and 32 columns it degrades
  cleanly without overflow.
- After the first prompt, normal conversation has no persistent large logo/card.
- All automated checks, package checks, and installed TTY smoke tests pass.

## Out of scope

- Copying Claude's mascot, orange palette, proprietary wording, or update feed.
- Changing the conversation transcript, tool-card semantics, backend behavior,
  authentication, or model selection.
- Publishing, tagging, pushing, or changing repository visibility.
