# dsh-tui v0.1 recording scenario

This is a deterministic recording recipe. Use a disposable, small repository and do not record API keys, usernames, home paths, session identifiers, or unrelated desktop notifications.

1. Start from a clean small repository and run `dsh-tui --mode acp --model deepseek-v4-flash`.
2. Submit this short Chinese request: `请读取 README.md，在末尾增加一行“demo verified”，然后运行一个只读验证命令确认这行存在。`.
3. Let the read-only tool cards show the file read and verification command. Confirm the intended elevated/critical approval in the overlay when it appears.
4. Show the changed file and the successful verification result in the terminal.
5. Press `Ctrl+R`, choose `+ New session`, and show that the session id, transcript, usage, and cost state reset.
6. Stop the recording after the fresh session is ready. Crop a readable horizontal terminal view and, if making a Douyin version, a vertical crop from the same sanitized run.

For an installation-only recording, use `dsh-tui --echo`, type `你好`, show the streamed Echo reply, and exit with two `Ctrl+C` presses. Never create a fake screenshot or empty demo asset.
