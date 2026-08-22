# dsh-tui v0.2.0 开发交接

dsh-tui 是一个社区维护的 DeepSeek Harness TUI，不是 DeepSeek 官方客户端。当前本地发布候选建立在 DSH `0.1.1-rc.2`、ACP 与 `@earendil-works/pi-tui` 之上；直接 DSH 依赖全部精确锁定到同一版本。

## 当前产品边界

- 默认模型 `deepseek-v4-flash`，默认 Quick 对应 DSH `low`；`--effort deep` 对应 `max`。
- 内置 Code-light composition 提供工作区指令、文件读写编辑、文件搜索、Shell、审批与单活跃 Todo；不包含 Goal、Subagent、Workflow、Web Search 或后台任务宿主。
- 同时只允许一个 ACP prompt，在运行期间可排队并继续编辑一条 follow-up。
- ACP 负责最终回复和 prompt 结算；可选 live channel 提供低延迟文本/工具事件；JSONL 是工具元数据与历史回退。
- 每轮 ACP 结束后先用 live barrier 排空同轮事件，再生成工具计数和任务摘要。
- 主动中断显示 `Interrupted draft`；未知结果显示 `Unconfirmed draft`，且不会自动重放可能有副作用的 prompt。
- API key 可通过一次隐藏的 `dsh-tui auth login` 保存；环境变量仅作为本次启动的只读覆盖。

## 关键模块

| 路径 | 责任 |
| --- | --- |
| `src/main.ts` | 进程入口与错误出口 |
| `src/cli.ts`, `src/version.ts` | CLI、认证/主题命令与统一版本 |
| `src/app.ts` | DSH/Echo、Controller、日志与 View 组合根 |
| `src/controller.ts` | 会话、任务、队列、中断、审批与摘要状态机 |
| `src/backend/acp-client.ts` | 类型化 ACP transport、live barrier 与关闭顺序 |
| `src/backend/assistant-stream.ts` | live 文本分块、排序与 ACP committed reconciliation |
| `src/backend/session-log.ts` | JSONL 增量观察、最近 50 条预览与只读历史 |
| `src/tool-timeline.ts` | live/JSONL 工具生命周期去重 |
| `src/approval-queue.ts` | 串行审批、120 秒超时与 abort |
| `src/ui/app-view.ts` | pi-tui 组合、输入、overlay 与增量 transcript |
| `src/ui/welcome-card.ts`, `src/ui/theme.ts` | 响应式欢迎卡和 Terminal/DeepSeek Light 主题 |
| `config/cordis.posix.yml`, `config/cordis.windows.yml` | Code-light DSH composition |

## 本地安装与开发

```bash
git clone https://github.com/Nico0713520/dsh-tui.git
cd dsh-tui
npm ci
npm run build
npm link
dsh-tui auth login
dsh-tui
```

npm 包实际发布前只写源码安装方式。离线界面验证可运行 `dsh-tui --echo`。

## 验收命令

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:pty
npm run composition:check
npm run compat:check
npm run build
npm run publint
npm run pack:check
npm run install:check
```

`tests/pty/tui-stress.test.ts` 使用标准 ACP 覆盖 10,000 text chunks、100 tools、resize storm、慢速分块与 queued follow-up。真实 DeepSeek 验收保持 opt-in：仅在执行环境已经安全提供凭证时运行 `DSH_LIVE=1 npm run test -- tests/live/dsh-live.test.ts`；不得把 key 写入命令参数、文档、日志或测试夹具。

## 后续维护注意事项

- 先更新并验证 DSH composition，再改变 pin；不要让直接依赖混用不同 RC。
- 保持 ACP、live、JSONL 三条信道的职责边界和 callId 去重。
- 视觉改动必须继续覆盖 120/96/80/60/48/32 列、两套主题和图片/文字 Logo。
- 旧会话只读回放；只有 `+ New session` 创建真实的新 ACP session。
- 远端仓库状态、npm 发布状态和 CI 结果应在操作当时重新核验，不要从这份本地交接文档推断。
