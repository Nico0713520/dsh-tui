# dsh-tui v0.1.0 交接文档

这份文档只记录仓库中已经实现并可由本地命令复核的事实。dsh-tui 是 DeepSeek Harness ACP 的 pi-tui 终端客户端，当前实现固定针对 dsh `0.1.0-rc.7`，没有依赖本机的 DSH 源码 checkout。

## 已验证能力

- `AcpClient` 负责 ACP initialize、真实 `session/new`、流式 `session/update`、单请求约束、无 id 的 `session/cancel` 通知、权限选择和完整关闭阶梯。
- 后端异常、超时和未知结果不会自动重放原 prompt；副作用请求必须由用户重新提交。
- 权限选择严格限制在 ACP 提供的 option id 内；缺少、异常或非法选择一律取消。
- `SessionLogReader` 按 project key 定位 JSONL，增量读取、保留半行和 split UTF-8，解析 tool call/result、工具错误和 usage，并支持只读历史列表/回放。
- `AppController` 集中管理 startup、working、cancelling、failed、closing 状态、transcript、session、usage、cost、审批和历史边界；历史回放不会伪装为 ACP 恢复，新会话才会创建真实 session。
- pi-tui 视图包含 Markdown 回复、CJK 安全单行工具卡片、审批/历史模态层、Echo 模式、`Esc` 中断、`Ctrl+R` 历史和双击 `Ctrl+C` 退出。
- 包入口提供 `dsh-tui --help`、`dsh-tui --version`、Echo/ACP、模型、工作目录、持久化目录、tool cards 和 JSON 命令数组配置。

## 代码地图

| 路径 | 责任 |
| --- | --- |
| `src/main.ts` | 进程边界和错误出口 |
| `src/cli.ts` | help/version 和 CLI 分发 |
| `src/app.ts` | Echo、ACP、日志、controller、view 的组合根 |
| `src/controller.ts` | 与 pi-tui/ACP/文件系统解耦的状态机 |
| `src/backend/acp-client.ts` | ACP stdio JSON-RPC transport |
| `src/backend/session-log.ts` | DSH JSONL 旁路观察和只读历史 |
| `src/ui/app-view.ts` | pi-tui 组件、键位和渲染 |
| `src/ui/modal-list.ts` | 可测试的 SelectList overlay |
| `src/policy.ts` | shell 风险和权限 stakes |
| `src/usage.ts` | token/cost 计算 |
| `src/text.ts` | 终端控制符清理和宽度截断 |
| `config/cordis.posix.yml` | macOS/Linux 的 bundled DSH composition |
| `config/cordis.windows.yml` | Windows PowerShell composition |

## 安装与运行

```bash
npm ci
npm run check
npm run install:check

npx --yes @nico0713520/dsh-tui@0.1.0 --echo
```

ACP 模式需要用户在自己的环境中提供 `DEEPSEEK_API_KEY`：

```bash
export DEEPSEEK_API_KEY="your-key"
npx --yes @nico0713520/dsh-tui@0.1.0 --mode acp --model deepseek-v4-flash
```

当前支持 Node.js `^22.19.0 || >=24.0.0`。开发时可运行 `npm start -- --echo`，发布包使用 `bin/dsh-tui.js` 加载 `dist/main.js`。

## 交互和限制

- `Enter` 发送，`Esc` 取消当前 prompt，`Ctrl+R` 打开历史，`Ctrl+C` 连按两次退出。
- 历史是只读回放，不会调用 ACP resume/restore/continue；`+ New session` 才会清空当前状态并创建真实 session。
- `--backend-command-json` 只接收 JSON 字符串数组，不做 shell 拆分，也不搜索某个开发者目录。
- `--tool-cards off` 只关闭 JSONL 旁路卡片，不影响 ACP 流式回复。
- `tests/live/dsh-live.test.ts` 只有在 `DSH_LIVE=1` 时运行；启用时必须有 API key，并会因缺失前置条件或事件失败而非零退出。没有授权时只能诚实记录为未执行。
- `.github/workflows/ci.yml` 定义了 Ubuntu、macOS、Windows 与 Node 22.19/24 的 CI 矩阵；在本地不能宣称远端 Actions 已通过。

## 本地验收命令

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run pack:check
npm run install:check
npx publint
npm audit --omit=dev
```

`npm audit` 的 advisory 应单独记录，不能通过偷偷升级或取消 pin 来隐藏。真实 live 验证使用：

```bash
DSH_LIVE=1 npm run test -- tests/live/dsh-live.test.ts
```

录制流程见 `scripts/demo-scenario.md`。只有真实运行并完成脱敏后才可以创建截图或 GIF；没有真实素材时不要创建占位文件。

## 外部动作边界

本地交接不包含 push、tag、GitHub Release、npm publish、仓库可见性/主题修改、Discussion、awesome-list PR 或抖音发布。后续执行这些动作前，必须由维护者单独决定并在已验收的具体 commit 上操作。
