import { describe, expect, it } from "vitest"
import { loadConfig } from "../../src/config.ts"

describe("loadConfig", () => {
  it("gives CLI values precedence over environment values", () => {
    const config = loadConfig(
      ["--model", "deepseek-v4-pro", "--persist-root", "/tmp/cli-sessions"],
      {
        DSH_MODEL: "deepseek-v4-flash",
        DSH_PERSIST_ROOT: "/tmp/env-sessions",
      },
      "linux",
    )

    expect(config.model).toBe("deepseek-v4-pro")
    expect(config.persistRoot).toBe("/tmp/cli-sessions")
  })

  it("accepts a JSON command array without splitting quoted paths", () => {
    const config = loadConfig([], {
      DSH_ACP_CMD_JSON: '["node","C:\\\\Program Files\\\\dsh\\\\bin.js","--config","C:\\\\My App\\\\cordis.yml"]',
    }, "win32")

    expect(config.backendCommand).toEqual([
      "node",
      "C:\\Program Files\\dsh\\bin.js",
      "--config",
      "C:\\My App\\cordis.yml",
    ])
  })

  it("uses platform-safe persistence defaults", () => {
    const win = loadConfig([], { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }, "win32")
    const mac = loadConfig([], {}, "darwin")
    const linux = loadConfig([], { XDG_STATE_HOME: "/tmp/state" }, "linux")

    expect(win.persistRoot).toBe("C:\\Users\\test\\AppData\\Local\\dsh-tui\\sessions")
    expect(mac.persistRoot).toContain("dsh-tui")
    expect(linux.persistRoot).toBe("/tmp/state/dsh-tui/sessions")
  })

  it("defaults to the real ACP client and keeps Echo explicit", () => {
    expect(loadConfig([], {}, "linux").mode).toBe("acp")
    expect(loadConfig(["--echo"], {}, "linux").mode).toBe("echo")
    expect(loadConfig(["--mode", "echo"], {}, "linux").mode).toBe("echo")
    expect(loadConfig(["--mode", "acp"], { DSH_TUI_MODE: "echo" }, "linux").mode).toBe("acp")
  })

  it("rejects ambiguous tool-card values", () => {
    expect(loadConfig([], { DSH_TOOL_CARDS: "off" }, "linux").toolCards).toBe(false)
    expect(loadConfig([], { DSH_TOOL_CARDS: "true" }, "linux").toolCards).toBe(true)
    expect(() => loadConfig([], { DSH_TOOL_CARDS: "sometimes" }, "linux")).toThrow(/tool-cards/i)
  })

  it("parses strict motion and performance controls", () => {
    expect(loadConfig(["--motion", "reduced", "--perf"], {}, "linux")).toMatchObject({ motion: "reduced", perf: true })
    expect(loadConfig([], { DSH_TUI_MOTION: "off", DSH_TUI_PERF: "0" }, "linux")).toMatchObject({ motion: "off", perf: false })
    expect(loadConfig(["--motion", "full"], { NO_COLOR: "1" }, "linux").motion).toBe("full")
    expect(() => loadConfig([], { DSH_TUI_MOTION: "sometimes" }, "linux")).toThrow(/motion/i)
    expect(() => loadConfig([], { DSH_TUI_PERF: "yes" }, "linux")).toThrow(/perf/i)
  })

  it("resolves theme precedence from CLI, environment, saved preference, then terminal", () => {
    expect(loadConfig([], {}, "linux").theme).toBe("terminal")
    expect(loadConfig([], {}, "linux", { theme: "deepseek" }).theme).toBe("deepseek")
    expect(loadConfig([], { DSH_TUI_THEME: "terminal" }, "linux", { theme: "deepseek" }).theme)
      .toBe("terminal")
    expect(loadConfig(["--theme", "deepseek"], { DSH_TUI_THEME: "terminal" }, "linux").theme)
      .toBe("deepseek")
    expect(() => loadConfig([], { DSH_TUI_THEME: "blue" }, "linux")).toThrow(/theme/i)
  })

  it("supports echo mode and rejects malformed configuration", () => {
    expect(loadConfig(["--echo"], {}, "linux").mode).toBe("echo")
    expect(() => loadConfig([], { DSH_TUI_MODE: "bogus" }, "linux")).toThrow(/mode/i)
    expect(() => loadConfig([], { DSH_ACP_CMD_JSON: "node dsh.js" }, "linux")).toThrow(/JSON array/i)
    expect(() => loadConfig([], { DSH_MODEL: "   " }, "linux")).toThrow(/model/i)
  })
})
