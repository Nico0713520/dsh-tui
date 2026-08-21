import { readFileSync } from "node:fs"
import {
  Image,
  Text,
  type Component,
  type TerminalCapabilities,
} from "@earendil-works/pi-tui"
import type { UiTheme } from "./theme.ts"

export type BrandLogoMode = "image" | "braille" | "text"

const BRAILLE_FULL = [
  "⢀⣴⣶⣶⣶⣿⡀⢸⣦⣤⣴",
  "⣾⠛⠻⢿⣿⣿⡿⣶⣿⡟⠁",
  "⢿⣆⠀⠀⠙⣿⣷⣿⡿⠁",
  "⠈⠻⢷⣾⣿⣮⡿⠿⠶",
] as const

const BRAILLE_COMPACT = [
  "⣠⣶⣷⣿⣧⣺⣦⣶",
  "⣿⠉⠙⢿⣿⣿⡟",
  "⠙⢷⣴⣮⣿⠿⠅",
] as const

export function brandLogoMode(
  capabilities: TerminalCapabilities,
  columns: number,
): BrandLogoMode {
  if (columns < 34) return "text"
  if (columns < 60) return "braille"
  return capabilities.images === null ? "braille" : "image"
}

export function whaleBraille(width: number): readonly string[] {
  return width >= 11 ? BRAILLE_FULL : BRAILLE_COMPACT
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
  if (mode === "braille") {
    return new Text(options.theme.fg("brand", whaleBraille(full ? 11 : 8).join("\n")))
  }
  try {
    return new Image(
      readBase64(options.assetPath),
      "image/png",
      { fallbackColor: (text) => options.theme.fg("brand", text) },
      { maxWidthCells: full ? 11 : 8, maxHeightCells: full ? 4 : 3 },
      { widthPx: 63, heightPx: 46 },
    )
  } catch {
    return new Text(options.theme.fg("brand", whaleBraille(full ? 11 : 8).join("\n")))
  }
}
