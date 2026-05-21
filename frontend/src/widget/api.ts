import { parseSSE } from "./sse"

export interface WidgetConfig {
  siteId: string
  apiUrl: string
  userId?: string | null
  primaryColor?: string
  position?: "bottom-right" | "bottom-left"
}

export interface WidgetCitation {
  document_id?: string
  document_title?: string
  quote?: string
}

export interface WidgetWarning {
  document_id: string
  title: string
  reason: string
}

export interface WidgetMessage {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: WidgetCitation[]
  warnings?: WidgetWarning[]
}

export async function createSession(config: WidgetConfig, anonymousId: string) {
  const res = await fetch(`${config.apiUrl}/api/widget/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site_id: config.siteId,
      anonymous_id: anonymousId,
      user_id: config.userId ?? null,
    }),
  })
  return res.json() as Promise<{ id: string; site_id: string; anonymous_id: string }>
}

export async function getMessages(config: WidgetConfig, sessionId: string) {
  const res = await fetch(`${config.apiUrl}/api/widget/sessions/${sessionId}/messages`)
  return res.json() as Promise<WidgetMessage[]>
}

export async function* askStream(config: WidgetConfig, sessionId: string, question: string) {
  const res = await fetch(`${config.apiUrl}/api/widget/sessions/${sessionId}/ask-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw new Error("Stream request failed")

  for await (const event of parseSSE(res)) {
    if (event.event === "token") {
      const { token } = JSON.parse(event.data)
      yield { type: "token" as const, token: token as string }
    } else if (event.event === "citations") {
      const data = JSON.parse(event.data)
      yield {
        type: "citations" as const,
        citations: data.citations as WidgetCitation[],
        warnings: data.warnings as WidgetWarning[],
      }
    } else if (event.event === "done") {
      const data = JSON.parse(event.data)
      yield { type: "done" as const, messageId: data.message_id as string }
    } else if (event.event === "error") {
      const data = JSON.parse(event.data)
      yield { type: "token" as const, token: (data.error as string) || "Stream request failed" }
    }
  }
}
