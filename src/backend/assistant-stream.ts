import type { DshLiveRecord } from "./live-record.ts"

export interface AssistantStreamSnapshot {
  sessionId: string | null
  turn: number | null
  text: string
  activity: "idle" | "thinking" | "responding"
  committed: boolean
  interruption: "cancelled" | "outcome-unknown" | null
}

export interface AssistantStream {
  begin(sessionId: string): AssistantStreamSnapshot
  apply(record: DshLiveRecord): AssistantStreamSnapshot
  reconcileCommitted(text: string): AssistantStreamSnapshot
  interrupt(kind: "cancelled" | "outcome-unknown"): AssistantStreamSnapshot
  reset(): AssistantStreamSnapshot
}

export function createAssistantStream(): AssistantStream {
  let state: AssistantStreamSnapshot = emptySnapshot()
  let highestSeq = -1
  const blocks = new Map<string, { turn: number; step: number; index: number; text: string }>()

  const snapshot = (): AssistantStreamSnapshot => Object.freeze({ ...state })

  return {
    begin(sessionId) {
      blocks.clear()
      highestSeq = -1
      state = { ...emptySnapshot(), sessionId }
      return snapshot()
    },
    apply(record) {
      if (record.sessionId !== state.sessionId) return snapshot()
      if (record.seq <= highestSeq) return snapshot()
      highestSeq = record.seq
      if (state.turn !== null && record.turn < state.turn) return snapshot()
      if (state.turn === null || record.turn > state.turn) {
        blocks.clear()
        state = {
          ...state,
          turn: record.turn,
          text: "",
          activity: "idle",
          committed: false,
          interruption: null,
        }
      }
      if (state.committed || state.interruption !== null) return snapshot()
      if (record.kind === "turn-start") return snapshot()
      if (record.kind === "activity") {
        state = { ...state, activity: record.activity }
        return snapshot()
      }
      if (record.kind === "text-delta" || record.kind === "text-final") {
        const key = `${record.turn}:${record.step}:${record.index}`
        const previous = blocks.get(key)
        blocks.set(key, {
          turn: record.turn,
          step: record.step,
          index: record.index,
          text: record.kind === "text-final" ? record.text : `${previous?.text ?? ""}${record.text}`,
        })
        state = {
          ...state,
          turn: record.turn,
          text: orderedText(blocks),
          activity: "responding",
          committed: false,
          interruption: null,
        }
      }
      if (record.kind === "turn-end") state = { ...state, activity: "idle" }
      return snapshot()
    },
    reconcileCommitted(text) {
      state = { ...state, text, activity: "idle", committed: true, interruption: null }
      return snapshot()
    },
    interrupt(kind) {
      state = { ...state, activity: "idle", committed: false, interruption: kind }
      return snapshot()
    },
    reset() {
      blocks.clear()
      highestSeq = -1
      state = emptySnapshot()
      return snapshot()
    },
  }
}

function emptySnapshot(): AssistantStreamSnapshot {
  return {
    sessionId: null,
    turn: null,
    text: "",
    activity: "idle",
    committed: false,
    interruption: null,
  }
}

function orderedText(blocks: ReadonlyMap<string, { turn: number; step: number; index: number; text: string }>): string {
  return [...blocks.values()]
    .sort((left, right) => left.turn - right.turn || left.step - right.step || left.index - right.index)
    .map((block) => block.text)
    .join("")
}
