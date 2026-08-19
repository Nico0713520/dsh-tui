# dsh-tui

![dsh-tui ACP demo](https://raw.githubusercontent.com/Nico0713520/dsh-tui/main/assets/demo.gif)

![dsh-tui approval view](https://raw.githubusercontent.com/Nico0713520/dsh-tui/main/assets/screenshot.png)

Safe, readable DeepSeek Harness ACP in the terminal: streaming Markdown, tool cards, explicit permission approval, read-only history, and honest token/cost status.

[![CI](https://github.com/Nico0713520/dsh-tui/actions/workflows/ci.yml/badge.svg)](https://github.com/Nico0713520/dsh-tui/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40nico0713520%2Fdsh-tui?label=npm)](https://www.npmjs.com/package/@nico0713520/dsh-tui)
[![Node.js](https://img.shields.io/badge/node-22.19%2B%20%7C%2024%2B-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Install and start

~~~bash
npm install -g @nico0713520/dsh-tui
dsh-tui
~~~

The default command starts the real ACP client and uses deepseek-v4-flash. Set your credential in the shell before starting ACP:

~~~bash
export DEEPSEEK_API_KEY="your-key"
dsh-tui --mode acp --model deepseek-v4-flash
~~~

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

## Keys and options

- Enter sends the editor contents.
- Esc cancels a working prompt; with an approval/history overlay it closes only that overlay.
- Ctrl+R opens read-only History.
- Ctrl+C twice exits; the first press shows a temporary notice.

Useful options:

~~~text
--mode <echo|acp>
--model <name>
--cwd <path>
--persist-root <path>
--tool-cards <on|off>
dsh-tui --backend-command-json '["node","server.mjs"]'
~~~

The backend command is a JSON array, not a shell command string. It is never shell-split.

## Requirements and configuration

- Node.js ^22.19.0 or >=24.0.0.
- DeepSeek Harness 0.1.0-rc.7 is bundled as the current ACP composition.
- ACP mode reads DEEPSEEK_API_KEY from your environment; credentials are not stored by dsh-tui.
- --persist-root changes where session JSONL is read and observed.
- --tool-cards off disables the JSONL side channel while keeping ACP replies.

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
dsh-tui --echo
~~~

If ACP does not start, check the Node version, DEEPSEEK_API_KEY, model name, and --cwd. Use --persist-root for a known writable session directory. For a custom ACP implementation, pass an executable argument array with --backend-command-json.

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
