export interface SSEEvent {
  event: string
  data: string
}

export async function* parseSSE(response: Response): AsyncGenerator<SSEEvent> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    let currentEvent = ""
    let currentData = ""

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7)
      } else if (line.startsWith("data: ")) {
        currentData = line.slice(6)
      } else if (line === "" && currentEvent) {
        yield { event: currentEvent, data: currentData }
        currentEvent = ""
        currentData = ""
      }
    }
  }
}
