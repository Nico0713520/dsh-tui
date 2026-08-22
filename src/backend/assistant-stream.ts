import type { DshLiveRecord } from "./live-record.ts"

export interface AssistantStreamSnapshot {
  sessionId: string | null
  turn: number | null
  text: string
  activity: "idle" | "thinking" | "responding"
  committed: boolean
  interruption: "cancelled" | "outcome-unknown" | null
  acceptedRecord: boolean
}

export interface AssistantStream {
  begin(sessionId: string): AssistantStreamSnapshot
  preparePrompt(): AssistantStreamSnapshot
  apply(record: DshLiveRecord): AssistantStreamSnapshot
  reconcileCommitted(text: string): AssistantStreamSnapshot
  interrupt(kind: "cancelled" | "outcome-unknown"): AssistantStreamSnapshot
  reset(): AssistantStreamSnapshot
}

export function createAssistantStream(): AssistantStream {
  let state: Omit<AssistantStreamSnapshot, "acceptedRecord"> = emptySnapshot()
  let highestSeq = -1
  let promptTurnFloor: number | null = null
  let promptObservedTurn = false
  let requireTurnStart = false
  const blocks = new Map<string, { turn: number; step: number; index: number; text: string }>()
  const orderedKeys: string[] = []

  const clearBlocks = (): void => {
    blocks.clear()
    orderedKeys.length = 0
  }

  const snapshot = (acceptedRecord = false): AssistantStreamSnapshot => Object.freeze({ ...state, acceptedRecord })

  return {
    begin(sessionId) {
      clearBlocks()
      highestSeq = -1
      promptTurnFloor = null
      promptObservedTurn = false
      requireTurnStart = false
      state = { ...emptySnapshot(), sessionId }
      return snapshot()
    },
    preparePrompt() {
      clearBlocks()
      promptTurnFloor = state.turn === null ? 0 : state.turn + 1
      promptObservedTurn = false
      state = { ...state, text: "", activity: "idle", committed: false, interruption: null }
      return snapshot()
    },
    apply(record) {
      if (record.sessionId !== state.sessionId) return snapshot()
      if (state.interruption !== null) return snapshot()
      if (record.seq <= highestSeq) return snapshot()
      highestSeq = record.seq
      const metadataOnly = record.kind === "tool-start" || record.kind === "tool-end" || record.kind === "usage"
      if (state.committed && !metadataOnly) return snapshot()
      if (promptTurnFloor !== null) {
        if (record.turn < promptTurnFloor) return snapshot()
        if (requireTurnStart && record.kind !== "turn-start") return snapshot()
        promptTurnFloor = null
        promptObservedTurn = true
        requireTurnStart = false
        if (state.committed) state = { ...state, turn: record.turn }
        else {
          clearBlocks()
          state = {
            ...state,
            turn: record.turn,
            text: "",
            activity: "idle",
            committed: false,
            interruption: null,
          }
        }
      }
      if (state.committed) {
        if (state.turn !== null && record.turn !== state.turn) return snapshot()
        if (state.turn === null) state = { ...state, turn: record.turn }
        promptObservedTurn = true
        return snapshot(true)
      }
      if (state.turn !== null && record.turn < state.turn) return snapshot()
      if (state.turn === null || record.turn > state.turn) {
        clearBlocks()
        state = {
          ...state,
          turn: record.turn,
          text: "",
          activity: "idle",
          committed: false,
          interruption: null,
        }
      }
      promptObservedTurn = true
      if (record.kind === "turn-start") return snapshot(true)
      if (record.kind === "activity") {
        state = { ...state, activity: record.activity }
        return snapshot(true)
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
        if (previous === undefined) {
          orderedKeys.push(key)
          orderedKeys.sort((left, right) => compareBlocks(blocks.get(left)!, blocks.get(right)!))
        }
        state = {
          ...state,
          turn: record.turn,
          text: orderedText(blocks, orderedKeys),
          activity: "responding",
          committed: false,
          interruption: null,
        }
      }
      if (record.kind === "turn-end") state = { ...state, activity: "idle" }
      return snapshot(true)
    },
    reconcileCommitted(text) {
      state = { ...state, text, activity: "idle", committed: true, interruption: null }
      return snapshot()
    },
    interrupt(kind) {
      if (!promptObservedTurn) requireTurnStart = true
      promptTurnFloor = null
      state = { ...state, activity: "idle", committed: false, interruption: kind }
      return snapshot()
    },
    reset() {
      clearBlocks()
      highestSeq = -1
      promptTurnFloor = null
      promptObservedTurn = false
      requireTurnStart = false
      state = emptySnapshot()
      return snapshot()
    },
  }
}

function emptySnapshot(): Omit<AssistantStreamSnapshot, "acceptedRecord"> {
  return {
    sessionId: null,
    turn: null,
    text: "",
    activity: "idle",
    committed: false,
    interruption: null,
  }
}

type TextBlock = { turn: number; step: number; index: number; text: string }

function compareBlocks(left: TextBlock, right: TextBlock): number {
  return left.turn - right.turn || left.step - right.step || left.index - right.index
}

function orderedText(blocks: ReadonlyMap<string, TextBlock>, orderedKeys: readonly string[]): string {
  return orderedKeys
    .map((key) => blocks.get(key)!.text)
    .join("")
}
