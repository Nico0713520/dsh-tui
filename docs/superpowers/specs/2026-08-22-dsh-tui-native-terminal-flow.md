# dsh-tui Native Terminal Flow

## Goal

Make the main conversation behave like Claude Code in Apple Terminal: the fresh
composer sits directly below the welcome card, conversation growth moves the
composer down naturally, and the terminal's own scrollback handles mouse-wheel
and trackpad review.

## Root cause

`AppView` currently places a `ScrollView` inside a custom fixed-height
`MainScreenLayout` even though the app uses `TuiMainScreen`. That layout pads the
transcript to the terminal height, pins the composer to the bottom immediately,
and only exposes hand-written keyboard scrolling. It does not enable pi-tui's
alternate-screen mouse routing, while its bounded repaint also prevents the main
terminal buffer from accumulating the natural document users expect.

## Approved interaction

- Keep `TuiMainScreen`; do not switch to the alternate screen.
- Render one natural vertical document: transcript, one blank separator row,
  composer, then compact status/help.
- Keep the full welcome card as the first transcript item. It moves upward only
  as messages are appended.
- Do not enable terminal mouse-reporting modes. Mouse wheel and two-finger
  trackpad gestures remain owned by Apple Terminal and scroll its native history.
- The right-side scrollbar is the terminal application's scrollbar. Its exact
  visibility follows the user's macOS/Terminal scrollbar preference.
- Remove application-owned PageUp/PageDown/Ctrl+Home/Ctrl+End transcript state
  and its paused/following notices from the main screen.
- Keep prompt Home/End editing, overlays, streaming, resize handling, themes,
  ACP behavior, and credentials unchanged.

## Acceptance criteria

1. At 120×30 with an empty session, the composer begins within two rows of the
   welcome card rather than at the bottom of the window.
2. After messages are sent, the welcome and exchanges remain earlier in the
   same terminal document and the composer follows the latest content.
3. A long conversation creates native terminal scrollback and does not emit
   mouse-reporting enable sequences (`CSI ? 1000/1002/1003/1006 h`).
4. Mouse wheel or two-finger trackpad scrolling in Apple Terminal reveals older
   content and uses the terminal's native right-side scrollbar.
5. Focus, submission, prompt Home/End, resize, overlays, both themes, and the
   full source check remain green.

## Out of scope

- Reimplementing Apple Terminal's scrollbar inside the app.
- Alternate-screen application-owned scrolling.
- Changes to DeepSeek Harness, the ACP backend, models, credentials, or release
  state.
