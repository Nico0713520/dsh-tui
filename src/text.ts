import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui"

const AUTHORIZATION = /(\bauthorization\s*:\s*(?:bearer\s+)?)([^\s,;]+)/giu
const NAMED_SECRET = /(\b(?:DEEPSEEK_API_KEY|OPENAI_API_KEY|api[_-]?key)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu
const API_KEY_TOKEN = /\bsk-[A-Za-z0-9_-]{12,}\b/gu

function removeDisallowedControls(value: string): string {
  return Array.from(value).filter((character) => {
    const code = character.codePointAt(0) ?? 0
    return !((code >= 0 && code <= 8) || (code >= 11 && code <= 31) || (code >= 127 && code <= 159))
  }).join("")
}

/** Remove terminal control sequences while retaining markdown newlines and tabs. */
export function sanitizeTerminalText(value: string): string {
  const plain = removeDisallowedControls(stripTerminalSequences(String(value)))
  return redactSensitiveText(plain)
}

/** Mask credential-shaped text without returning or logging the matched value. */
export function redactSensitiveText(value: string): string {
  return String(value)
    .replace(AUTHORIZATION, "$1[redacted]")
    .replace(NAMED_SECRET, "$1[redacted]")
    .replace(API_KEY_TOKEN, "[redacted]")
}

/** Normalize untrusted text to one visual line and truncate by terminal cells. */
export function singleLine(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  const normalized = sanitizeTerminalText(value).replace(/[\r\n\t]+/g, " ").replace(/ +/g, " ").trim()
  return stripTerminalSequences(truncateToWidth(normalized, maxWidth, "…"))
}

/** Convert any thrown value into safe, bounded terminal text. */
export function safeErrorText(value: unknown, maxWidth = 220): string {
  const message = value instanceof Error ? value.message : String(value)
  return singleLine(message, maxWidth)
}
