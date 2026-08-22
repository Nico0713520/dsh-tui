import { matchesKey } from "@earendil-works/pi-tui"

export interface ScrollKeyAction {
  readonly kind: "by" | "start" | "end"
  readonly lines: number
}

/** Map terminal input to transcript navigation without taking Home/End from the editor. */
export function resolveScrollKey(data: string, viewportHeight: number): ScrollKeyAction | null {
  const viewport = Math.max(1, viewportHeight)
  if (matchesKey(data, "pageUp")) return { kind: "by", lines: -viewport }
  if (matchesKey(data, "pageDown")) return { kind: "by", lines: viewport }
  if (matchesKey(data, "shift+up")) return { kind: "by", lines: -1 }
  if (matchesKey(data, "shift+down")) return { kind: "by", lines: 1 }
  if (matchesKey(data, "ctrl+home")) return { kind: "start", lines: 0 }
  if (matchesKey(data, "ctrl+end")) return { kind: "end", lines: 0 }
  return null
}
