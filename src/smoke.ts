/** Smoke test without a TTY: verify imports + render pipeline logic. */
import { Text, Container } from "@earendil-works/pi-tui"
import { AcpClient } from "./acp.ts"
import { MARK_ASSISTANT, MARK_USER } from "./theme.ts"

const c = new Container()
const t = new Text(MARK_ASSISTANT)
c.addChild(t)
const lines = t.render(40)
console.log("render ok:", lines.length, "line(s)")

// wrap check with CJK
const t2 = new Text(MARK_USER + "中文宽度测试：终端渲染验证，不闪不乱码。")
console.log("cjk render ok:", t2.render(30).length, "lines")

// ACP client class shape
console.log("acp ok:", typeof AcpClient === "function")
console.log("SMOKE PASS")
