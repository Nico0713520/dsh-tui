import { afterEach, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import {
  resetCapabilitiesCache,
  setCapabilities,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui"
import {
  brandLogoMode,
  createBrandLogo,
  whalePixelArt,
} from "../../src/ui/brand-logo.ts"
import { createUiTheme } from "../../src/ui/theme.ts"

const svgPath = new URL("../../assets/brand/deepseek-whale.svg", import.meta.url)
const cachePath = new URL("../../assets/brand/deepseek-whale.png.base64", import.meta.url)

afterEach(() => resetCapabilitiesCache())

describe("official DeepSeek whale", () => {
  it("keeps the official SVG and deterministic terminal cache frozen", async () => {
    const svg = await readFile(svgPath)
    const base64 = (await readFile(cachePath, "utf8")).replace(/\s+/g, "")
    const officialSvgBytes = svg.at(-1) === 0x0a ? svg.subarray(0, -1) : svg
    expect(createHash("sha256").update(officialSvgBytes).digest("hex"))
      .toBe("0bf5e13ce954f13423a692f083f5cb0f4bcfde35c8b812f64efe89dabfdaed20")
    expect(createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex"))
      .toBe("ea65ee127a76ec8617ae01895ddbda3806ab81bdb4edc53f9d27ae29cdd7f372")
  })

  it("selects image, solid pixel, and text tiers by capability and width", () => {
    expect(brandLogoMode({ images: "iterm2", trueColor: true, hyperlinks: true }, 120)).toBe("image")
    expect(brandLogoMode({ images: null, trueColor: true, hyperlinks: true }, 120)).toBe("pixel")
    expect(brandLogoMode({ images: "kitty", trueColor: true, hyperlinks: true }, 48)).toBe("pixel")
    expect(brandLogoMode({ images: null, trueColor: false, hyperlinks: false }, 32)).toBe("text")
  })

  it("uses stable solid block samples of the official silhouette", () => {
    expect(whalePixelArt("full")).toEqual([
      "  ▄▄▄▙▄██▌  █▄▖▗▄▄",
      "▗█████████▙▖▀████▀",
      "█▌ ▝▀▀████▛████",
      "▜▙     ▀██▙▄██▛",
      "▝▜█▄  ▄▄▝▜███▘",
      "  ▝▀██████▀▀▀▀",
    ])
    expect(whalePixelArt("compact")).toEqual([
      " ▄▟███▖ █▄▄▄",
      "▟██████▙▞█▛▘",
      "█  ▝▜██▝██",
      "▜▙▖ ▄▝███▘",
      " ▝▜███▟▀▀▘",
    ])
    expect(whalePixelArt("full")).toHaveLength(6)
    expect(whalePixelArt("compact")).toHaveLength(5)
    expect(whalePixelArt("full").every((line) => visibleWidth(line) <= 18)).toBe(true)
    expect(whalePixelArt("compact").every((line) => visibleWidth(line) <= 12)).toBe(true)
    expect(whalePixelArt("full").join("\n")).not.toMatch(/[\u2800-\u28ff]/u)
  })

  it("renders a real inline image sequence without a filename fallback", () => {
    const capabilities = { images: "iterm2" as const, trueColor: true, hyperlinks: true }
    setCapabilities(capabilities)
    const logo = createBrandLogo({
      capabilities,
      assetPath: cachePath,
      columns: 120,
      theme: createUiTheme("terminal"),
    })
    const rendered = logo?.render(12).join("\n") ?? ""
    expect(rendered).toContain("\x1b]1337;File=")
    expect(stripTerminalSequences(rendered)).not.toContain("image/png")
  })
})
