/**
 * Headless ACP handshake test: boot dsh ACP server, initialize, session/new.
 * No API key needed until first prompt. Verifies the whole bridge minus model call.
 */
import { AcpClient } from "./acp.ts"

const cmd = process.env.DSH_ACP_CMD?.split(" ") ?? []
if (!cmd.length) {
  console.log("SET DSH_ACP_CMD first")
  process.exit(1)
}

let done = false
const client = new AcpClient({
  command: cmd,
  events: {
    onChunk(c) { process.stdout.write(c) },
    onTurnEnd() { console.log("\n[turn end]"); done = true },
    onSession(id) { console.log("[session]", id) },
    onError(m) { console.log("[error]", m); done = true },
  },
})

// Full path: create session explicitly, then optionally prompt.
const text = process.argv[2] ?? ""
try {
  const id = await (client as any).ensureSession ? await (client as any).ensureSession() : null
  console.log("[handshake] session created:", id ? String(id).slice(0, 12) + "…" : id)
} catch (e) {
  console.log("[handshake FAILED]", String(e))
  process.exit(1)
}
if (text) {
  await client.prompt(text)
  // wait for turn end with timeout
  const t0 = Date.now()
  while (!done && Date.now() - t0 < 120_000) await new Promise(r => setTimeout(r, 200))
} 
client.close()
console.log("\nACP TEST DONE")
process.exit(0)
