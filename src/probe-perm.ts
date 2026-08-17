/** Inspect the raw session/request_permission params shape. */
import { spawn } from "node:child_process"

const cmd = process.env.DSH_ACP_CMD!.split(" ")
const p = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "inherit"] })
let buf = ""
let sid: string | null = null
let nextId = 1

p.stdout.on("data", (d) => {
  buf += d
  for (const l of buf.split("\n")) {
    if (!l.trim()) continue
    let m: any
    try { m = JSON.parse(l) } catch { continue }
    if (m.method === "session/request_permission") {
      console.log("PERMISSION PARAMS:")
      console.log(JSON.stringify(m.params, null, 1).slice(0, 1500))
      p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { outcome: { outcome: "selected", optionId: "reject" } } }) + "\n")
      setTimeout(() => { p.kill(); process.exit(0) }, 1000)
    } else if (m.id === 2 && m.result?.sessionId) {
      sid = m.result.sessionId
      p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "用写文件工具创建 hello.txt 内容 hi" }] } }) + "\n")
    }
  }
})

p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "probe", version: "0" } } }) + "\n")
setTimeout(() => {
  p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd(), mcpServers: [] } }) + "\n")
}, 800)
setTimeout(() => { p.kill(); process.exit(0) }, 120000)
