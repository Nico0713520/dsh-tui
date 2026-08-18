# dsh-tui

A safe, readable terminal client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) ACP: streaming Markdown replies, tool cards, permission approval, read-only history, and token/cost status in one pi-tui interface.

## Install

```bash
npm install -g @nico0713520/dsh-tui
dsh-tui --echo
```

`--echo` needs no API key and verifies the install and TTY. To connect to dsh `0.1.0-rc.7`:

```bash
# Set DEEPSEEK_API_KEY in your shell first.
dsh-tui --mode acp --model deepseek-v4-flash
```

Requires Node.js `^22.19.0 || >=24.0.0`.

## Options and keys

Use `--mode echo|acp`, `--model <name>`, `--cwd <path>`, `--persist-root <path>`, `--tool-cards on|off`, or `--backend-command-json '["node","server.mjs"]'`. The backend command is a JSON array and is never shell-split.

Press `Enter` to send, `Esc` to cancel the current request, `Ctrl+R` for read-only history, and `Ctrl+C` twice to exit. History is explicitly read-only; only “New session” creates a real ACP session.

## Troubleshooting

- Run `dsh-tui --version` and `dsh-tui --help` to verify the executable.
- Use `dsh-tui --echo` when no API key is available.
- For ACP failures, check Node, `DEEPSEEK_API_KEY`, the model, and `--cwd`.
- Set `--persist-root` for a custom session directory; `--tool-cards off` disables the JSONL side channel without disabling ACP replies.

MIT License.
