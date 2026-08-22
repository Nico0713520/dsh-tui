# dsh-tui

[English](README.md)

![dsh-tui 欢迎页与对话界面](https://raw.githubusercontent.com/Nico0713520/dsh-tui/master/assets/screenshot.png)

一个轻量、舒服耐看的 DeepSeek Harness TUI。它保留原本的 DSH 包与 ACP 工作流，在上面增加流式回复、工具状态、明确审批、只读历史和诚实 usage 状态的终端界面。

- **原汁原味的 Harness 流程：** 直接建立在 DeepSeek Harness composition 上，不重写 agent 后端。
- **轻量交互：** 输入响应及时，渲染工作有上限；可选实时事件管道不可用时会稳妥回退。
- **舒服耐看：** 克制的欢迎面板、随对话自然上移的排版，以及原终端背景和 DeepSeek 蓝白两套主题。

DeepSeek 名称和官方蓝色鲸鱼图标归其权利人所有。本项目不是 DeepSeek 官方开发、背书、赞助或发布的产品。

[![CI](https://github.com/Nico0713520/dsh-tui/actions/workflows/ci.yml/badge.svg)](https://github.com/Nico0713520/dsh-tui/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-22.19%2B%20%7C%2024%2B-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 安装与启动

~~~bash
git clone https://github.com/Nico0713520/dsh-tui.git
cd dsh-tui
npm ci
npm run build
npm link
dsh-tui auth login
dsh-tui
~~~

公开的 v0.1 预览版目前从源码安装，npm 包尚未发布。

`auth login` 会隐藏输入 DeepSeek API key 并只保存一次；以后启动不再重复询问。如果直接启动 ACP 且尚未配置，也会进入同一次隐藏设置。默认模型是 `deepseek-v4-flash`，默认推理档位是 `quick`（DSH `low`）；只有确实需要最强推理的任务才使用 `--effort deep`。

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

dsh-tui 会同时启动后台和非阻塞的 Quiet Signal 入场效果。空的新会话会展示完整响应式欢迎面板；第一条及后续消息都接在它的下方，欢迎面板本身不切换、不折叠，只会随着对话增长自然滚出屏幕。用户可以立即输入：启动期间提交的一条 prompt 仍可编辑，ACP session ready 后只会发送一次。

任务进行时，状态栏会区分 thinking、responding、工具调用和审批。短暂活动与流式文本通过可选、有上限的事件管道到达，ACP 仍然是最终回复与 prompt 结算的权威来源。下一条 prompt 开始前，客户端会用不携带内容的控制屏障排空事件管道，避免中断 turn 的延迟记录串入新回复。任一实时管道缺失或异常时，客户端会自动退回 ACP 和 session JSONL，不会让 prompt 失败。推理正文不会被展示，也不会进入诊断信息。

前端会合并密集更新，并且只重新解析正在增长的 Markdown 尾部。这能降低事件到画面的延迟和终端抖动，但无法缩短 DeepSeek 网络或服务端的首 token 时间。

## 外观

默认 `terminal` 主题保留用户原终端背景；可选的 `deepseek` 主题会绘制 DeepSeek 蓝与柔和蓝白画布，但不会修改终端 Profile：

~~~bash
dsh-tui theme status
dsh-tui theme deepseek
dsh-tui theme terminal
~~~

解析优先级为 `--theme terminal|deepseek`、`DSH_TUI_THEME`、已保存偏好、`terminal`。单次启动覆盖不会改写已保存设置。`NO_COLOR` 只关闭装饰颜色，不破坏布局，也不会擅自修改明确指定的动效策略。

欢迎页采用克制的带框双栏排版：左侧是居中的 DeepSeek 品牌区，右侧只有两段简短的开始提示；Session ID 和安全诊断不再堆在首屏，仍可通过 `/status` 查看。Kitty/iTerm2 会显示未经改动的官方 `#4D6BFE` 透明鲸鱼图片；宽屏文字终端显示从同一轮廓重新采样的固定 18×6 实心块图形。macOS 自带 Terminal 不支持这些内嵌图片协议，因此使用实心回退图；窄于 34 列时使用纯文字。鲸鱼本体永不动画。详见[第三方声明](THIRD_PARTY_NOTICES.md)。

## 按键与选项

- Enter 发送编辑器内容。
- Esc 中断正在运行的 prompt；有审批/历史弹窗时只关闭当前弹窗。
- Ctrl+R 打开只读 History。
- Ctrl+O 只在本地切换工具输出的紧凑/展开视图，不会发送给模型。
- `/status` 打开只读 Session 面板，只展示运行时可证实的信息。
- Ctrl+C 连按两次退出；第一次会显示临时提示。

常用选项：

~~~text
--mode <echo|acp>
--model <name>
--cwd <path>
--persist-root <path>
--tool-cards <on|off>
--motion <full|reduced|off>
--theme <terminal|deepseek>
--effort <quick|deep>
--perf
dsh-tui --backend-command-json '["node","server.mjs"]'
~~~

backend command 接收 JSON 数组，不是 shell 命令字符串，也不会交给 shell 拆分。

## 要求与配置

- Node.js ^22.19.0 或 >=24.0.0。
- 当前 bundled Harness composition 固定使用 DeepSeek Harness 0.1.1-rc.2，所有直接 DSH 依赖精确锁在同一版本。
- 内置能力是 Code-light：有上限的 `AGENTS.md`/`CLAUDE.md` 工作区指令、文件读写编辑、文件搜索、Shell、审批和单活跃 Todo。它不等于官方完整 Code preset；Goal、Subagent、Workflow、Web Search 和后台任务宿主仍不在本阶段范围内。
- 托管凭证保存在 `$DSH_HOME/.credentials.yaml`，默认是 `~/.dsh/.credentials.yaml`；POSIX 下目录/文件权限为 `0700`/`0600`。
- 非空的进程环境变量 `DEEPSEEK_API_KEY` 始终优先，`auth` 命令不会修改它。
- --persist-root 修改读取和观察 session JSONL 的位置。
- --tool-cards off 只关闭 JSONL 旁路卡片，不影响 ACP 回复。
- DSH_TUI_MOTION 接受 full、reduced 或 off；NO_COLOR 不再暗中改变动效策略。
- DSH_TUI_THEME 接受 terminal 或 deepseek；优先级依次是 CLI、环境变量、已保存偏好、terminal。
- DSH_TUI_EFFORT 接受 quick 或 deep；`--effort` 优先，并分别映射为 DSH `low` 与 `max` 推理。
- DSH_TUI_PERF=1 或 --perf 会增加不含事件内容的单轮延迟诊断。

所有者专用文件权限可以防止其他 OS 用户读取 key，但无法隔离同一系统用户运行的所有进程；不要把这个本地存储当成对 coding agent 本身的安全边界。

## 只读 History 与新会话

按 Ctrl+R，选择历史 session，可以回放 user message、assistant message、tool call、tool result、错误和历史边界。回放是只读的，不会调用 ACP resume/restore。

选择 + New session 会创建真实 ACP session。在新 session ready 前，旧 transcript、未完成回复、usage、cost 和历史边界都会清空。

## 已知限制

- 当前预览 bundled Harness composition 固定为 0.1.1-rc.2。
- 同时只能有一个 prompt 在执行。
- 模型价格未知时显示 unavailable，不会猜一个 cost。
- 后端退出或超时时不会自动重放 prompt，因为副作用结果未知。
- 当前 v0.1 预览版通过源码分发，npm 包尚未发布。

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
