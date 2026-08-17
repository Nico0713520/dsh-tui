# dsh-tui

Terminal client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

- **Rendering**: [`@earendil-works/pi-tui`](https://github.com/earendil-works/pi) — differential rendering, Markdown component, overlays.
- **Backend**: dsh over ACP (Agent Client Protocol, JSON-RPC stdio) + session-log watching for live tool activity.
- **Policy & cost**: approval risk classification and DeepSeek V4 pricing ported from [CodeWhale](https://github.com/Hmbown/CodeWhale) (MIT).

## Compatibility: tested against dsh `0.1.0-rc.7`

dsh is in developer preview with breaking changes expected. This client's dsh-coupled surface is isolated in two files:

| File | Couples to | Upgrade check |
|---|---|---|
| `src/acp.ts` | ACP protocol details (options format, permission shape) | handshake + one tool turn |
| `src/logwatch.ts` | session log format (`projectKey`, `tool/call`, `usage`) | one session with a tool call renders cards |

Re-test checklist after upgrading dsh: `node src/e2e-tools.ts` → `node src/e2e-perm.ts` → manual turn. If session-log format breaks, set `DSH_TOOL_CARDS=off` to degrade to cards-after-turn (side-channel off, ACP streaming unaffected).

## Status: Phase 2 (Week 1 complete)

- [x] pi-tui layout: transcript + Editor + status bar, CJK-safe
- [x] Real dsh connection (ACP handshake, streaming replies, tool turns)
- [x] Tool-call cards (live, via session-log watch) with degrade switch
- [x] Approval overlay with CodeWhale-style stakes: routine / elevated / critical
- [x] Markdown-rendered assistant replies (pi Markdown component + theme)
- [x] Live cost panel (DeepSeek V4 peak/off-peak pricing, cache-hit aware)
- [ ] Session switching, error recovery, Esc interrupt
- [ ] npm packaging, cross-terminal testing, publish

## Run

```bash
npm install
npm start                        # echo mode, no backend needed

DSH_TUI_MODE=acp npm start       # real dsh backend (see env below)
```

Windows quick command: `deepseek` (from `bin/deepseek.cmd` on PATH).

## Env

| Var | Default | Meaning |
|---|---|---|
| `DSH_TUI_MODE` | `echo` | `echo` or `acp` |
| `DSH_ACP_CMD` | built-in path | command that boots the dsh ACP stdio server |
| `DSH_MODEL` | `deepseek-v4-flash` | model for pricing + display |
| `DSH_TOOL_CARDS` | `on` | `off` disables the session-log side-channel |

## Layout

```
src/
├── main.ts    # app composition (pi-tui), approval overlay, status/cost bar
├── acp.ts     # ACP JSON-RPC stdio client  ← dsh coupling (re-test on upgrade)
├── logwatch.ts# session-log watcher        ← dsh coupling (re-test on upgrade)
├── policy.ts  # risk stakes + pricing (ported from CodeWhale)
└── theme.ts   # palette + tool summaries
```

MIT License.
