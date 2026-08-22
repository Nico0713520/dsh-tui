# dsh-tui v0.2 recording scenario

This is a deterministic recording recipe. Use a disposable, small repository and do not record API keys, usernames, home paths, session identifiers, or unrelated desktop notifications.

1. Start from a disposable small repository whose visible workspace label is exactly `demo-project`, then run the current v0.2 build with `--mode acp --model deepseek-v4-flash`.
2. Submit this short Chinese request: `请读取 README.md，在末尾增加一行“demo verified”，然后运行一个只读验证命令确认这行存在。`.
3. Let the real ACP tool cards show the file read, the visible edit, and the verification command. Confirm the intended elevated/critical approval in the overlay when it appears.
4. Hold a frame that contains one user request, a thinking/responding trace, at least one completed tool card, and the truthful `Done` summary. Keep the `PgUp/PgDn scroll` affordance visible in either the welcome card or help line.
5. Page up once and return with `Ctrl+End` to prove transcript navigation resumes following output. Then press `Ctrl+R`, choose `+ New session`, and show that the transcript and usage state reset.
6. Capture the default Terminal-theme hero at 120×30. Capture the horizontal GIF, DeepSeek blue/white theme frame, vertical MP4, and social preview from the same current build and sanitized scenario.
7. Inspect every exported frame at native size. It must show `DeepSeek Harness` / `dsh-tui v0.2.0`, `deepseek-v4-flash`, and `demo-project`; it must not show a home-directory username, API key, private repository path, session UUID, or personal terminal history.

For an installation-only recording, use `dsh-tui --echo`, type `你好`, show the streamed Echo reply, and exit with two `Ctrl+C` presses. Never publish an empty asset or a mockup that was not rendered from the current TUI build.
