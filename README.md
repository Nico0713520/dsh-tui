# dsh-tui

![dsh-tui ACP demo](https://raw.githubusercontent.com/Nico0713520/dsh-tui/main/assets/demo.gif)

![dsh-tui approval view](https://raw.githubusercontent.com/Nico0713520/dsh-tui/main/assets/screenshot.png)

An independent community TUI for DeepSeek Harness ACP: streaming Markdown, semantic tool cards, explicit permission approval, read-only history, and honest token/cost status.

DeepSeek and the official blue whale mark belong to their respective owner. This project is not developed, endorsed, sponsored, or published by DeepSeek.

[![CI](https://github.com/Nico0713520/dsh-tui/actions/workflows/ci.yml/badge.svg)](https://github.com/Nico0713520/dsh-tui/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40nico0713520%2Fdsh-tui?label=npm)](https://www.npmjs.com/package/@nico0713520/dsh-tui)
[![Node.js](https://img.shields.io/badge/node-22.19%2B%20%7C%2024%2B-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Install and start

~~~bash
npm install -g @nico0713520/dsh-tui
dsh-tui auth login
dsh-tui
~~~

`auth login` reads the DeepSeek API key without echoing it and saves it once. Later launches start without asking again. A bare ACP launch also offers this one-time hidden setup when no credential exists. The default model is `deepseek-v4-flash`.

Manage the saved credential without starting the TUI:

~~~bash
dsh-tui auth status
dsh-tui auth login
dsh-tui auth logout
~~~

An inherited `DEEPSEEK_API_KEY` is a read-only override for that launch and takes precedence over the saved credential.

For an offline installation and TTY smoke test, use the explicit Echo mode:

~~~bash
dsh-tui --echo
~~~

Echo is only a local smoke/demo backend; it never calls a model.

## A 20-second flow

Type a request such as:

~~~text
Please read README.md, make one safe edit, and run a read-only verification.
~~~

The normal flow is visible in the terminal:

~~~text
⚙ read_file ~/demo-project/README.md
⚙ run_command git diff --check
CRITICAL approval
→ Allow · run_command
✓ verification passed
~~~

The approval overlay only accepts an option supplied by ACP. History replay is marked read-only and does not pretend to restore the old ACP session.

## Live experience

dsh-tui starts the backend and the non-blocking Quiet Signal entrance together. A fresh session shows the complete responsive welcome surface; the first submitted prompt folds it into a one-line identity row that naturally scrolls away with the conversation. You can type immediately: one prompt submitted during startup stays editable and is sent exactly once when the ACP session is ready.

During a turn, the status distinguishes thinking, responding, tool activity, and approval. Transient activity and text arrive over an optional bounded event pipe, while ACP remains authoritative for committed replies and prompt settlement. A content-free control barrier drains the event pipe before the next prompt, so delayed records from an interrupted turn cannot appear in the new turn. If either live pipe is unavailable or malformed, the client falls back to ACP and session JSONL without failing the prompt. Reasoning text is never displayed or copied into diagnostics.

The frontend coalesces bursty updates and reparses only the active Markdown tail. This reduces event-to-paint delay and terminal churn, but it cannot reduce DeepSeek network or provider time-to-first-token.

## Appearance

The default `terminal` theme preserves the terminal's own background. The optional `deepseek` theme paints a persistent DeepSeek-blue and soft-white canvas without changing the terminal profile:

~~~bash
dsh-tui theme status
dsh-tui theme deepseek
dsh-tui theme terminal
~~~

The saved preference is resolved after `--theme terminal|deepseek` and `DSH_TUI_THEME`, so a launch-specific override never rewrites the saved setting. `NO_COLOR` disables decorative color while keeping layout and the explicitly requested motion policy.

The welcome uses a calm framed split layout: a centered DeepSeek identity area on the left and two short getting-started sections on the right. Session IDs and safety diagnostics stay out of the hero and remain available through `/status`. The unchanged official `#4D6BFE` whale is rendered as a transparent inline image in Kitty/iTerm2 and as a fixed solid block sample of the same silhouette in text terminals; terminals below 34 columns use text-only identity. The whale itself is never animated. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Keys and options

- Enter sends the editor contents.
- Esc cancels a working prompt; with an approval/history overlay it closes only that overlay.
- Ctrl+R opens read-only History.
- Ctrl+O toggles compact/expanded tool output locally; it is never sent to the model.
- `/status` opens a read-only Session panel built only from observable runtime facts.
- Ctrl+C twice exits; the first press shows a temporary notice.

Useful options:

~~~text
--mode <echo|acp>
--model <name>
--cwd <path>
--persist-root <path>
--tool-cards <on|off>
--motion <full|reduced|off>
--theme <terminal|deepseek>
--perf
dsh-tui --backend-command-json '["node","server.mjs"]'
~~~

The backend command is a JSON array, not a shell command string. It is never shell-split.

## Requirements and configuration

- Node.js ^22.19.0 or >=24.0.0.
- DeepSeek Harness 0.1.0-rc.7 is bundled as the current ACP composition.
- Managed credentials use `$DSH_HOME/.credentials.yaml`, defaulting to `~/.dsh/.credentials.yaml`; the directory/file are `0700`/`0600` on POSIX.
- A non-empty inherited `DEEPSEEK_API_KEY` always wins and is never modified by `auth` commands.
- --persist-root changes where session JSONL is read and observed.
- --tool-cards off disables the JSONL side channel while keeping ACP replies.
- DSH_TUI_MOTION accepts full, reduced, or off. NO_COLOR does not silently change motion policy.
- DSH_TUI_THEME accepts terminal or deepseek; CLI override, environment, saved preference, then terminal is the precedence order.
- DSH_TUI_PERF=1 or --perf adds a sanitized per-turn latency diagnostic without event content.

Owner-only file permissions protect a managed key from other OS users, not from every process running as your own user. Do not treat this local store as an isolation boundary from the coding agent itself.

## Read-only History and new sessions

Press Ctrl+R and choose a recorded session to replay its user messages, assistant messages, tool calls, tool results, errors, and history boundaries. This replay is read-only and does not call ACP resume/restore.

Choose + New session to create a real ACP session. The previous transcript, partial reply, usage, cost, and history boundaries are cleared before the new session becomes ready.

## Known limitations

- The bundled Harness composition is pinned to 0.1.0-rc.7 for this v0.1 preview.
- Only one prompt may be in flight at a time.
- If the model price is unknown, cost is shown as unavailable instead of guessed.
- A backend exit or timeout does not automatically replay the prompt because its side effects are unknown.
- Remote GitHub Actions and package publication are release-owner actions; this repository does not claim they have run locally.

## Troubleshooting

~~~bash
dsh-tui --version
dsh-tui --help
dsh-tui auth status
dsh-tui --echo
~~~

If ACP does not start, check the Node version, `dsh-tui auth status`, model name, and --cwd. Use --persist-root for a known writable session directory. For a custom ACP implementation, pass an executable argument array with --backend-command-json.

## Development

~~~bash
npm ci
npm run check
npm run install:check
npm run test:pty
npm run build
npm run publint
npm run pack:check
~~~

Live DeepSeek verification is opt-in and requires a credential already present in the environment:

~~~bash
DSH_LIVE=1 npm run test -- tests/live/dsh-live.test.ts
~~~

## License

MIT.
