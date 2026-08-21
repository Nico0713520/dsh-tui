import { readFileSync } from "node:fs"
import {
  Image,
  Text,
  type Component,
  type TerminalCapabilities,
} from "@earendil-works/pi-tui"
import type { UiTheme } from "./theme.ts"

export type BrandLogoMode = "image" | "pixel" | "text"
export type WhalePixelTier = "full" | "compact"

const WHALE_PIXELS: Record<WhalePixelTier, readonly string[]> = {
  full: [
    "  ▄▄▄▙▄██▌  █▄▖▗▄▄",
    "▗█████████▙▖▀████▀",
    "█▌ ▝▀▀████▛████",
    "▜▙     ▀██▙▄██▛",
    "▝▜█▄  ▄▄▝▜███▘",
    "  ▝▀██████▀▀▀▀",
  ],
  compact: [
    " ▄▟███▖ █▄▄▄",
    "▟██████▙▞█▛▘",
    "█  ▝▜██▝██",
    "▜▙▖ ▄▝███▘",
    " ▝▜███▟▀▀▘",
  ],
}

export function brandLogoMode(
  capabilities: TerminalCapabilities,
  columns: number,
): BrandLogoMode {
  if (columns < 34) return "text"
  if (columns < 60) return "pixel"
  return capabilities.images === null ? "pixel" : "image"
}

export function whalePixelArt(tier: WhalePixelTier): readonly string[] {
  return WHALE_PIXELS[tier]
}

function readBase64(assetPath: string | URL): string {
  return readFileSync(assetPath, "utf8").replace(/\s+/g, "")
}

export function createBrandLogo(options: {
  capabilities: TerminalCapabilities
  assetPath: string | URL
  columns: number
  theme: UiTheme
}): Component | null {
  const mode = brandLogoMode(options.capabilities, options.columns)
  if (mode === "text") return null
  const full = options.columns >= 96
  const tier: WhalePixelTier = full ? "full" : "compact"
  if (mode === "pixel") {
    return new Text(options.theme.fg("brand", whalePixelArt(tier).join("\n")), 0, 0)
  }
  try {
    return new Image(
      readBase64(options.assetPath),
      "image/png",
      { fallbackColor: (text) => options.theme.fg("brand", text) },
      { maxWidthCells: full ? 18 : 12, maxHeightCells: full ? 6 : 5 },
      { widthPx: 63, heightPx: 46 },
    )
  } catch {
    return new Text(options.theme.fg("brand", whalePixelArt(tier).join("\n")), 0, 0)
  }
}
