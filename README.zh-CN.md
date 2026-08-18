# dsh-tui

一个面向 DeepSeek Harness ACP 的安全、可读终端客户端。它保留 pi-tui 的终端交互，同时把实时回复、工具调用、权限审批、只读历史和 token/cost 状态放到一个清晰的 TUI 中。

## 安装与启动

```bash
npm install -g @nico0713520/dsh-tui
dsh-tui --echo
```

`--echo` 不需要 API key，用于确认终端和安装正常。连接 DeepSeek Harness：

```bash
# 先在当前 shell 中设置 DEEPSEEK_API_KEY。
dsh-tui --mode acp --model deepseek-v4-flash
```

首次公开预览固定使用 dsh `0.1.0-rc.7`。Node.js 支持 `^22.19.0 || >=24.0.0`。

## 常用选项

`--mode echo|acp`、`--model <name>`、`--cwd <path>`、`--persist-root <path>`、`--tool-cards on|off` 和 `--backend-command-json '["node","server.mjs"]'`。命令参数只接受 JSON 数组，不会把字符串交给 shell 拆分。

按 `Enter` 发送，`Esc` 中断当前请求，`Ctrl+R` 打开只读历史，`Ctrl+C` 连按两次退出。历史回放不会伪装成 ACP 恢复，会明确标记为只读；“新会话”才会创建真实 ACP session。

## 故障排查

- 先运行 `dsh-tui --version` 和 `dsh-tui --help` 确认安装入口。
- 没有 API key 时使用 `dsh-tui --echo` 验证本地 TTY。
- ACP 启动失败时检查 Node 版本、`DEEPSEEK_API_KEY`、模型名和 `--cwd`。
- 可用 `--persist-root` 指定会话目录；`--tool-cards off` 可关闭 JSONL 旁路卡片而保留 ACP 回复。

MIT License。
