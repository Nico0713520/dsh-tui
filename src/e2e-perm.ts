/** E2E: read-only mode, ask agent to write a file, expect permission request. */
import { AcpClient } from "./acp.ts"

const cmd = process.env.DSH_ACP_CMD?.split(" ") ?? []
let asked = false

const client = new AcpClient({
  command: cmd,
  events: {
    onChunk() {},
    onTurnEnd() { console.log("[turn end]") },
    onSession(id) { console.log("[session]", id.slice(0, 8)) },
    onError(m) { console.log("[error]", m) },
    onPermission(title, detail, respond) {
      asked = true
      console.log("[PERMISSION ASKED]", title, "|", detail.slice(0, 120))
      respond("deny")
    },
  },
})

await client.prompt("用写文件工具在当前目录创建 hello.txt，内容为 hi")
await new Promise(r => setTimeout(r, 2000))
client.close()
console.log(asked ? "E2E PERMISSION PASS" : "E2E: no permission asked")
process.exit(0)
