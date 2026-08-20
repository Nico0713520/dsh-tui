interface SecretPromptOutput {
  write(text: string): unknown
}

/** Read one secret from the controlling terminal without echoing it. */
export async function readSecretFromTty(
  prompt: string,
  output: SecretPromptOutput = process.stderr,
): Promise<string> {
  const input = process.stdin
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("A terminal is required to enter the DeepSeek API key; run dsh-tui auth login in a terminal")
  }

  const wasRaw = input.isRaw
  output.write(prompt)

  return new Promise<string>((resolve, reject) => {
    let value = ""
    let settled = false

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      input.off("data", onData)
      input.setRawMode(wasRaw)
      if (!wasRaw) input.pause()
      output.write("\n")
      if (error) reject(error)
      else resolve(value)
    }

    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === "\r" || character === "\n") {
          finish()
          return
        }
        if (character === "\u0003") {
          finish(new Error("DeepSeek API key entry cancelled"))
          return
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1)
          continue
        }
        if (character >= " " && character !== "\u007f") value += character
      }
    }

    input.setRawMode(true)
    input.resume()
    input.on("data", onData)
  })
}
