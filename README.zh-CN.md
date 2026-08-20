# dsh-tui

![dsh-tui ACP 演示](https://raw.githubusercontent.com/Nico0713520/dsh-tui/main/assets/demo.gif)

![dsh-tui 审批界面](https://raw.githubusercontent.com/Nico0713520/dsh-tui/main/assets/screenshot.png)

在终端里安全、清晰地使用 DeepSeek Harness ACP：流式 Markdown、工具卡片、明确的权限审批、只读历史，以及不乱猜价格的 token/cost 状态。

[![CI](https://github.com/Nico0713520/dsh-tui/actions/workflows/ci.yml/badge.svg)](https://github.com/Nico0713520/dsh-tui/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40nico0713520%2Fdsh-tui?label=npm)](https://www.npmjs.com/package/@nico0713520/dsh-tui)
[![Node.js](https://img.shields.io/badge/node-22.19%2B%20%7C%2024%2B-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 安装与启动

~~~bash
npm install -g @nico0713520/dsh-tui
dsh-tui auth login
dsh-tui
~~~

`auth login` 会隐藏输入 DeepSeek API key 并只保存一次；以后启动不再重复询问。如果直接启动 ACP 且尚未配置，也会进入同一次隐藏设置。默认模型是 `deepseek-v4-flash`。

不进入 TUI 也可以管理凭证：

~~~bash
dsh-tui auth status
dsh-tui auth login
dsh-tui auth logout
~~~

当前进程继承到的 `DEEPSEEK_API_KEY` 会作为本次启动的只读覆盖，优先级高于已保存凭证。

只想验证安装和 TTY，可以显式使用离线 Echo 模式：

~~~bash
dsh-tui --echo
~~~

Echo 只是本地 smoke/demo 后端，不会调用模型。

## 20 秒操作链路

输入类似请求：

~~~text
请读取 README.md，做一次安全编辑，然后运行只读验证。
~~~

正常链路会在终端里清楚显示：

~~~text
⚙ read_file ~/demo-project/README.md
⚙ run_command git diff --check
CRITICAL approval
→ Allow · run_command
✓ verification passed
~~~

审批弹窗只接受 ACP 实际提供的 option。历史回放会明确标记为只读，不会伪装成恢复旧 ACP session。

## 实时体验

dsh-tui 会同时启动后台和非阻塞的 Deep Pulse 入场动画。空的新会话会展示完整响应式欢迎面板；发送第一条消息后自动收成一行品牌栏，把空间还给对话。用户可以立即输入：启动期间提交的一条 prompt 仍可编辑，ACP session ready 后只会发送一次。

任务进行时，状态栏会区分 thinking、responding、工具调用和审批。短暂活动与流式文本通过可选、有上限的事件管道到达，ACP 仍然是最终回复与 prompt 结算的权威来源。下一条 prompt 开始前，客户端会用不携带内容的控制屏障排空事件管道，避免中断 turn 的延迟记录串入新回复。任一实时管道缺失或异常时，客户端会自动退回 ACP 和 session JSONL，不会让 prompt 失败。推理正文不会被展示，也不会进入诊断信息。

前端会合并密集更新，并且只重新解析正在增长的 Markdown 尾部。这能降低事件到画面的延迟和终端抖动，但无法缩短 DeepSeek 网络或服务端的首 token 时间。

## 按键与选项

- Enter 发送编辑器内容。
- Esc 中断正在运行的 prompt；有审批/历史弹窗时只关闭当前弹窗。
- Ctrl+R 打开只读 History。
- Ctrl+C 连按两次退出；第一次会显示临时提示。

常用选项：

~~~text
--mode <echo|acp>
--model <name>
--cwd <path>
--persist-root <path>
--tool-cards <on|off>
--motion <full|reduced|off>
--perf
dsh-tui --backend-command-json '["node","server.mjs"]'
~~~

backend command 接收 JSON 数组，不是 shell 命令字符串，也不会交给 shell 拆分。

## 要求与配置

- Node.js ^22.19.0 或 >=24.0.0。
- 当前 v0.1 预览固定使用 bundled Harness composition 0.1.0-rc.7。
- 托管凭证保存在 `$DSH_HOME/.credentials.yaml`，默认是 `~/.dsh/.credentials.yaml`；POSIX 下目录/文件权限为 `0700`/`0600`。
- 非空的进程环境变量 `DEEPSEEK_API_KEY` 始终优先，`auth` 命令不会修改它。
- --persist-root 修改读取和观察 session JSONL 的位置。
- --tool-cards off 只关闭 JSONL 旁路卡片，不影响 ACP 回复。
- DSH_TUI_MOTION 接受 full、reduced 或 off；NO_COLOR 不再暗中改变动效策略。
- DSH_TUI_PERF=1 或 --perf 会增加不含事件内容的单轮延迟诊断。

所有者专用文件权限可以防止其他 OS 用户读取 key，但无法隔离同一系统用户运行的所有进程；不要把这个本地存储当成对 coding agent 本身的安全边界。

## 只读 History 与新会话

按 Ctrl+R，选择历史 session，可以回放 user message、assistant message、tool call、tool result、错误和历史边界。回放是只读的，不会调用 ACP resume/restore。

选择 + New session 会创建真实 ACP session。在新 session ready 前，旧 transcript、未完成回复、usage、cost 和历史边界都会清空。

## 已知限制

- 当前 v0.1 预览 bundled Harness composition 固定为 0.1.0-rc.7。
- 同时只能有一个 prompt 在执行。
- 模型价格未知时显示 unavailable，不会猜一个 cost。
- 后端退出或超时时不会自动重放 prompt，因为副作用结果未知。
- 远端 GitHub Actions 和包发布属于发布负责人动作；本仓库不宣称这些动作已在本地完成。

## 故障排查

~~~bash
dsh-tui --version
dsh-tui --help
dsh-tui auth status
dsh-tui --echo
~~~

ACP 启动失败时检查 Node 版本、`dsh-tui auth status`、模型名和 --cwd。可以用 --persist-root 指定已知可写的 session 目录。接入自定义 ACP 实现时，用 --backend-command-json 传入可执行文件参数数组。

## 开发

~~~bash
npm ci
npm run check
npm run install:check
npm run test:pty
npm run build
npm run publint
npm run pack:check
~~~

真实 DeepSeek 验证是显式开启的，并要求凭证已经存在于环境变量：

~~~bash
DSH_LIVE=1 npm run test -- tests/live/dsh-live.test.ts
~~~

## 许可证

MIT。
