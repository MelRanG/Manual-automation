export interface SSEEvent {
  event: string
  data: string
}

export async function* parseSSE(response: Response): AsyncGenerator<SSEEvent> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = ""
  let currentData = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      buffer += decoder.decode()
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      const cleanLine = line.endsWith("\r") ? line.slice(0, -1) : line
      if (cleanLine.startsWith("event: ")) {
        currentEvent = cleanLine.slice(7)
      } else if (cleanLine.startsWith("data: ")) {
        currentData += currentData ? `\n${cleanLine.slice(6)}` : cleanLine.slice(6)
      } else if (cleanLine === "" && currentEvent) {
        yield { event: currentEvent, data: currentData }
        currentEvent = ""
        currentData = ""
      }
    }
  }

  if (buffer) {
    const cleanLine = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer
    if (cleanLine.startsWith("event: ")) {
      currentEvent = cleanLine.slice(7)
    } else if (cleanLine.startsWith("data: ")) {
      currentData += currentData ? `\n${cleanLine.slice(6)}` : cleanLine.slice(6)
    }
  }
  if (currentEvent) {
    yield { event: currentEvent, data: currentData }
  }
}
