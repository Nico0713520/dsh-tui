/** E2E: boot TUI-less pipeline, send a tool-using prompt, verify tool cards flow. */
import { AcpClient } from "./acp.ts"
import { SessionLogWatcher } from "./logwatch.ts"

const cmd = process.env.DSH_ACP_CMD?.split(" ") ?? []
let toolCalls = 0, toolResults = 0, chunks = 0
const watcher = new SessionLogWatcher()

const client = new AcpClient({
  command: cmd,
  events: {
    onChunk(c) { chunks += c.length },
    onTurnEnd() { console.log(`\n[turn end] chunks=${chunks} toolCalls=${toolCalls} toolResults=${toolResults}`) },
    onSession(id) {
      console.log("[session]", id)
      watcher.watch("E:\\Desktop\\deepseek\\dsh-tui\\.sessions-dshtui", process.cwd(), id, {
        onToolCall(name, args) { toolCalls++; console.log(`[tool] ${name} ${args.slice(0, 60)}`) },
        onToolResult(_n, text, err) { toolResults++; console.log(`[result${err ? "!" : ""}] ${text.slice(0, 50).replace(/\n/g, " ")}`) },
      })
    },
    onError(m) { console.log("[error]", m) },
  },
})

await client.prompt("运行命令 node --version 并告诉我结果")
await new Promise(r => setTimeout(r, 3000))
watcher.stop()
client.close()
console.log(toolCalls > 0 && toolResults > 0 ? "E2E TOOL CARDS PASS" : "E2E FAIL: no tool events")
process.exit(0)
