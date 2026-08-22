export interface AcpMethodMap {
  initialize: {
    params: {
      protocolVersion: 1
      clientCapabilities: Record<string, never>
      clientInfo: { name: string; version: string }
    }
    result: unknown
  }
  "session/new": {
    params: { cwd: string; mcpServers: readonly unknown[] }
    result: { sessionId: string }
  }
  "session/prompt": {
    params: { sessionId: string; prompt: readonly { type: "text"; text: string }[] }
    result: { stopReason: string }
  }
}

export type AcpMethod = keyof AcpMethodMap
export type AcpParams<M extends AcpMethod> = AcpMethodMap[M]["params"]
export type AcpResult<M extends AcpMethod> = AcpMethodMap[M]["result"]

export interface AcpNotificationMap {
  "session/cancel": { sessionId: string; reason: string }
}

export type AcpNotificationMethod = keyof AcpNotificationMap
export type AcpNotificationParams<M extends AcpNotificationMethod> = AcpNotificationMap[M]

interface RecordValue {
  [key: string]: unknown
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null
}

/** Validate the result at the JSON boundary before typed application code sees it. */
export function parseAcpResult<M extends AcpMethod>(method: M, value: unknown): AcpResult<M> {
  if (method === "session/new") {
    if (!isRecord(value) || typeof value.sessionId !== "string" || !value.sessionId) {
      throw new Error("ACP session/new returned no sessionId")
    }
    return { sessionId: value.sessionId } as AcpResult<M>
  }
  if (method === "session/prompt") {
    if (!isRecord(value) || typeof value.stopReason !== "string" || !value.stopReason) {
      throw new Error("ACP session/prompt returned no stopReason")
    }
    return { stopReason: value.stopReason } as AcpResult<M>
  }
  return value as AcpResult<M>
}
