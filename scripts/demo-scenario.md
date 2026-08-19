# dsh-tui v0.1 recording scenario

This is a deterministic recording recipe. Use a disposable, small repository and do not record API keys, usernames, home paths, session identifiers, or unrelated desktop notifications.

1. Start from a clean small repository with a sanitized visible path such as `~/demo-project`, then run `dsh-tui --mode acp --model deepseek-v4-flash`.
2. Submit this short Chinese request: `请读取 README.md，在末尾增加一行“demo verified”，然后运行一个只读验证命令确认这行存在。`.
3. Let the real ACP tool cards show the file read, the visible edit, and the verification command. Confirm the intended elevated/critical approval in the overlay when it appears.
4. Show the changed file and the successful verification result in the terminal; pause long enough for the approval and result text to be readable.
5. Press `Ctrl+R`, choose `+ New session`, and show that the session id, transcript, usage, cost state, partial reply, and history boundaries reset.
6. Stop the recording after the fresh session is ready. Crop a readable horizontal terminal view and, if making a Douyin version, a vertical crop from the same sanitized run.

For an installation-only recording, use `dsh-tui --echo`, type `你好`, show the streamed Echo reply, and exit with two `Ctrl+C` presses. Never create a fake screenshot or empty demo asset.
