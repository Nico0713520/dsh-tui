# dsh-tui — Codex 交接文档

> 写给下一个 AI（Codex）：你将接手开发 dsh-tui，一个 DeepSeek Harness (dsh) 的终端客户端。本文档包含：项目现状、参考源码地图（抄什么、怎么抄）、待办计划、环境搭建。请通读全文再动手。

---

## 一、项目是什么

**dsh-tui** = DeepSeek Harness 的终端（TUI）客户端。

三层拼装哲学，贯穿始终：

| 层 | 来源 | 原则 |
|---|---|---|
| 渲染引擎 | `@earendil-works/pi-tui`（npm 直装） | 直接用，当黑盒，不改它源码 |
| 后端 | dsh 官方（ACP 协议 + session log） | 只做客户端，协议耦合收敛在 2 个文件 |
| 美术/交互 | CodeWhale（40.8k star 的 Rust TUI） | **只抄设计文档和决策，不抄代码**（Rust→TS 语言不通） |

仓库：`https://github.com/Nico0713520/dsh-tui`（private，clone 后继续开发）
现状：Week 1 全部完成（约 45%），已验证真实模型链路。

---

## 二、已完成清单（别重做）

- [x] ACP 客户端（`src/acp.ts`）：initialize / session/new / session/prompt / 流式 chunk / 权限请求
- [x] 界面（`src/main.ts`）：ScrollView 对话区 + Editor 输入框 + 状态栏，中文渲染无乱码
- [x] 工具调用卡片（`src/logwatch.ts`）：实时 tail dsh session log，tool/call + tool/result 展示
- [x] 审批 overlay：CodeWhale 式风险分级（routine/elevated/critical），E2E 验证通过
- [x] Markdown 渲染：pi 的 Markdown 组件 + 官方主题
- [x] 成本面板：DeepSeek V4 峰谷定价（移植自 CodeWhale），状态栏实时累计
- [x] Windows 工具链：dsh-pwsh-local + dsh-tool-pwsh（bash 沙箱 Windows 起不来，用 pwsh 路线）
- [x] E2E 测试脚本：`src/e2e-tools.ts`、`src/e2e-perm.ts`（改代码后必跑）

---

## 三、参考源码地图（核心资产，都在本机 E:\Desktop\deepseek\）

### 1. refs-pi — pi-tui 源码（渲染层，npm 已装，源码供查 API）

- 位置：`E:\Desktop\deepseek\refs-pi\`（github.com/earendil-works/pi）
- 用途：**组件 API 查询**。README 常和实现有出入，动手前先查 `packages/tui/src/`
- 关键文件：
  - `packages/tui/src/index.ts` — 全部导出清单
  - `packages/tui/src/components/markdown.ts` — Markdown 组件（theme 接口在 L200）
  - `packages/tui/src/components/editor.ts` — Editor（构造必须传 EditorTheme，L228）
  - `packages/tui/test/test-themes.ts` — 官方默认主题（我们的 mdTheme 就是从这抄的）
  - `packages/tui/src/tui.ts` — TUI 接口、Overlay API
- 作者复盘文（设计哲学）:mariozechner.at/posts/2025-11-30-pi-coding-agent/

### 2. refs-dsh — DeepSeek Harness 源码（后端）

- 位置：`E:\Desktop\deepseek\refs-dsh\`（github.com/deepseek-ai/deepseek-harness，已 pnpm install + build）
- 用途：**协议与格式的唯一事实来源**
- 关键文件：
  - `packages/acp/acp/README.md` — ACP 协议契约（每个方法的边界和限制）
  - `packages/session/session-persistence-jsonl/src/format.ts` — **projectKey 函数**（L148，session log 目录命名规则，我们逐行移植到了 logwatch.ts）
  - `examples/acp-agent/dshtui.cordis.yml` — 我们的 ACP 服务器组合配置（必须在 dsh 仓库内）
  - `packages/examples/acp-demo/src/bin.ts` — ACP 服务器入口
- ⚠️ dsh 是 0.1.0-rc.7，破坏性变更风险。耦合点全在 `src/acp.ts` + `src/logwatch.ts`，升级 dsh 后按 README 重测清单回归

### 3. refs-cw — CodeWhale 源码（美术与交互，sparse checkout）

- 位置：`E:\Desktop\deepseek\refs-cw\`（github.com/Hmbown/CodeWhale，只拉了 docs + crates/tui/src）
- 用途：**抄设计决策**。它是 Rust 写的，代码不可直接用，但文档是 40k 用户验证过的交互圣经
- 关键文件：
  - `docs/KEYBINDINGS.md` — 完整键位体系（Esc 语义、审批 y/a/n/e、Esc Esc 回溯等）
  - `crates/tui/src/tui/approval/policy.rs` — **风险分级算法**（已移植到 src/policy.ts，L148 的 classify_risk）
  - `crates/tui/src/pricing.rs` — 定价表（L3973 起，2026-08-17 核实，已移植到 policy.ts）
  - `docs/design/` — 设计决策文档目录
  - `docs/CONFIGURATION.md` — 配置项全景（看成熟工具都暴露什么开关）

### 抄美术的方法论（重要）

1. **配色**：CodeWhale 是"克制的单色系+语义色"：主内容 dim/neutral，语义点缀（成功绿/警告黄/危险红/信息青），绝不彩虹。我们 theme.ts 的 `c` 对象就是这个体系
2. **信息密度**：工具卡片永远一行（名称+关键参数），详情靠展开（Alt+[/Alt-] 跳转工具块，我们待实现）
3. **审批三档**：routine 最简 chrome / elevated 平静确认 / critical 强警告红色系（policy.ts 已实现）
4. **键位惯例**：Esc 永远关最上层、y/n 快捷审批、Ctrl+C 双击退出。照抄 KEYBINDINGS.md 的语义映射
5. **看它的 prompts 目录**：`crates/tui/src/prompts/` 是模型人设和审批文案，学它怎么写给用户看的话

---

## 四、待办计划（按优先级）

### Week 2：用得顺（✅ 已于 2026-08-18 完成，Codex 可跳过，但可打磨）

1. ~~Esc 中断~~ 已实现（session/cancel）
2. ~~会话切换~~ 已实现（Ctrl+R 选择器 + 历史回放 src/sessions.ts，新对话另起）
3. ~~错误恢复~~ 已实现（自动重启≤3次+重放消息、全局异常捕获错误卡片）
4. ~~Ctrl+C 优雅退出~~ 已实现（stdin-EOF→SIGTERM→SIGKILL 三级退出）
5. ~~成本面板~~ 已实现（峰谷定价+token 明细状态栏）
6. （可选打磨）工具卡片详情展开：Alt+[ / Alt-] 跳转（抄 CodeWhale KEYBINDINGS.md L151）

### Week 3：发布（当前阶段，Codex 从这里开始）

6. **npm 打包** — `npx dsh-tui` 一键跑；首次启动检测后端缺失并给指引（后端搭建步骤写进 onboarding 文案）
7. **路径配置化** — main.ts 里 DEFAULT_ACP_CMD 现在是写死的 E 盘绝对路径，改成：配置文件（~/.dsh-tui.json）> 环境变量 > 自动探测（找得到 dsh 仓库就用）
8. **跨终端测试** — Windows Terminal / cmd / Git Bash 三环境，重点：中文宽字符、resize 不碎、CSI 2026 兼容性
9. **发布** — GitHub 转 public + `dsh-plugin` topic + 录 GIF + 提交 awesome-dsh-plugin PR + dsh 官方 Discussions 发帖（探 TUI 需求水温）

### 质量红线（全程遵守）

- 改完必跑：`node src/e2e-tools.ts` + `node src/e2e-perm.ts` + 手动一轮对话
- 不改 pi-tui 源码、不改 dsh 源码，缺功能绕
- dsh 耦合只允许出现在 acp.ts / logwatch.ts
- PowerShell 改含中文的文件必须用文件写入工具，管道会损坏 UTF-8（已踩坑）

---

## 五、环境搭建（新机器）

```bash
# 1. TUI 本体
git clone https://github.com/Nico0713520/dsh-tui && cd dsh-tui && npm install

# 2. dsh 后端（约30分钟）
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm config set fetch-timeout 600000   # 弱网必设，否则 install 超时
pnpm install && pnpm run build

# 3. 配置
cp dsh-tui/cordis.yml deepseek-harness/examples/acp-agent/dshtui.cordis.yml
echo "DEEPSEEK_API_KEY=你的key" > deepseek-harness/.env   # git 默认忽略，不会泄

# 4. 改 main.ts 的 DEFAULT_ACP_CMD 指向新 clone 位置，然后：
DSH_TUI_MODE=acp npm start
```

环境要求：Node ≥ 24（原生跑 TS 无需构建），pnpm 11.7+。

---

## 六、战略背景（为什么做这个）

- dsh 生态六大空白之一就是"桌面 TUI 协议"，竞争为零（生态报告数据）
- CodeWhale（DeepSeek+TUI）40.8k star 证明需求真实；dsh 2026-08-13 刚发布，正处于 CodeWhale 当年爆发的同构时机
- 我们的差异化：Windows 一等公民（bash 沙箱起不来的坑我们已解决）、中文优化、CodeWhale 级体验
- 用户判断：官方短期不会做 TUI（DeepSeek 主业是模型），可放心占位，但发 demo 越早越保险

---

*文档由 HanaAgent 生成于 2026-08-18 凌晨，配合仓库 README.md 与 SecondBrain/01-项目/dsh-tui/PROJECT-STATUS.md 食用。*
