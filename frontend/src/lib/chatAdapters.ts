import { api, type ChatMessage, type StreamEvent } from "@/lib/api"
import { parseSSE } from "@/lib/sse"

export type { StreamEvent } from "@/lib/api"

export interface FeedbackPayload {
  document_id?: string
  chunk_id?: string
  chat_message_id?: string
  feedback_text: string
}

export interface FeedbackResult {
  feedback: { id: string; status: string }
  proposed_change: { id: string } | null
}

export interface ChatApiAdapter {
  getMessages(sessionId: string): Promise<ChatMessage[]>
  askStream(sessionId: string, question: string): AsyncIterable<StreamEvent>
  submitSR?(draftId: string): Promise<{ jira_issue_key?: string }>
  submitFeedback?(payload: FeedbackPayload): Promise<FeedbackResult>
}

export function buildChatAdapter(userId: string): ChatApiAdapter {
  return {
    getMessages: (id) => api.getMessages(id),
    askStream: (id, q) => api.askQuestionStream(id, q),
    submitSR: (draftId) => api.submitSR(draftId),
    submitFeedback: (payload) =>
      api.createFeedback({ ...payload, user_id: userId }) as Promise<FeedbackResult>,
  }
}

async function* widgetAskStream(sessionId: string, question: string): AsyncGenerator<StreamEvent> {
  const res = await fetch(`/api/widget/sessions/${sessionId}/ask-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw new Error("widget stream failed")

  for await (const event of parseSSE(res)) {
    if (event.event === "token") {
      const { token } = JSON.parse(event.data)
      yield { type: "token", token }
    } else if (event.event === "citations") {
      const data = JSON.parse(event.data)
      yield { type: "citations", citations: data.citations, warnings: data.warnings }
    } else if (event.event === "done") {
      const data = JSON.parse(event.data)
      yield { type: "done", messageId: data.message_id, sr_draft: data.sr_draft }
    }
  }
}

async function widgetGetMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(`/api/widget/sessions/${sessionId}/messages`)
  if (!res.ok) throw new Error("widget get messages failed")
  return res.json()
}

export function buildWidgetAdapter(userId: string | null): ChatApiAdapter {
  const base: ChatApiAdapter = {
    getMessages: widgetGetMessages,
    askStream: widgetAskStream,
  }
  if (!userId) return base
  return {
    ...base,
    submitSR: (draftId) => api.submitSR(draftId),
    submitFeedback: (payload) =>
      api.createFeedback({ ...payload, user_id: userId }) as Promise<FeedbackResult>,
  }
}
