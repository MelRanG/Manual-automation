import { useState, useEffect, useCallback, useRef } from "react"
import type {
  ChatMessage, Citation, DocumentWarning, SRDraftCreated, ChatSession,
} from "@/lib/api"
import type { ChatApiAdapter } from "@/lib/chatAdapters"

export type ChatMode = "question" | "change_request"

export interface UseChatSessionArgs {
  sessionId: string | null
  /** Reserved for future use (audit logging, per-user notice keys). Currently unused inside the hook. */
  userId: string | null
  /** Must be a stable reference (wrap in useMemo). The hook reloads messages when `api` identity changes. */
  api: ChatApiAdapter
  /** Called after lazy-create. Parent must reflect this in sidebar + activeSession. */
  onSessionCreated?: (session: ChatSession) => void
}

export interface ChatSessionState {
  messages: ChatMessage[]
  modesByMessage: Record<string, ChatMode>
  citations: Citation[]
  citationsByMessage: Record<string, Citation[]>
  warnings: DocumentWarning[]
  loading: boolean
  input: string
  setInput: (v: string) => void
  send: () => Promise<void>

  chatMode: ChatMode
  setChatMode: (m: ChatMode) => void

  srDraftsByMessage: Record<string, SRDraftCreated>
  srSentById: Record<string, string>
  srSendingId: string | null
  srSendErrorById: Record<string, string>
  sendSR: (draft: SRDraftCreated) => Promise<void>

  feedbackFor: string | null
  feedbackText: string
  feedbackSubmitting: boolean
  feedbackSuccess: string | null
  feedbackNotice: Record<string, string>
  openFeedback: (msgId: string) => void
  cancelFeedback: () => void
  setFeedbackText: (v: string) => void
  submitFeedback: (msgId: string) => Promise<void>

  canSubmitSR: boolean
  canSubmitFeedback: boolean

  resetAll: () => void
}

export function useChatSession({ sessionId, api, onSessionCreated }: UseChatSessionArgs): ChatSessionState {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [citations, setCitations] = useState<Citation[]>([])
  const [citationsByMessage, setCitationsByMessage] = useState<Record<string, Citation[]>>({})
  const [warnings, setWarnings] = useState<DocumentWarning[]>([])
  const [loading, setLoading] = useState(false)
  const [input, setInput] = useState("")
  const [chatMode, setChatMode] = useState<ChatMode>("question")
  const [modesByMessage, setModesByMessage] = useState<Record<string, ChatMode>>({})
  const [srDraftsByMessage, setSrDraftsByMessage] = useState<Record<string, SRDraftCreated>>({})
  const [srSendingId, setSrSendingId] = useState<string | null>(null)
  const [srSentById, setSrSentById] = useState<Record<string, string>>({})
  const [srSendErrorById, setSrSendErrorById] = useState<Record<string, string>>({})

  const [feedbackFor, setFeedbackFor] = useState<string | null>(null)
  const [feedbackText, setFeedbackText] = useState("")
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null)
  const [feedbackNotice, setFeedbackNotice] = useState<Record<string, string>>({})

  // Guards the history-load effect from clobbering an in-flight send.
  // WidgetDemo creates a session and sends in the same tick, so the load
  // effect and send() race; without this, getMessages([]) overwrites the
  // [user, streaming] placeholders and SSE tokens have nothing to update.
  const inFlightRef = useRef(false)
  // Synchronous guard for lazy session creation. React state updates are
  // async, so isCreating state alone cannot prevent two rapid clicks from
  // both passing the guard and calling ensureSession() twice.
  const isCreatingRef = useRef(false)
  const sendSRRef = useRef<(draft: SRDraftCreated) => Promise<void>>(async () => {})

  const canSubmitSR = typeof api.submitSR === "function"
  const canSubmitFeedback = typeof api.submitFeedback === "function"

  const resetAll = useCallback(() => {
    setMessages([])
    setModesByMessage({})
    setCitations([])
    setCitationsByMessage({})
    setWarnings([])
    setSrDraftsByMessage({})
    setSrSendingId(null)
    setSrSentById({})
    setSrSendErrorById({})
    setFeedbackFor(null)
    setFeedbackText("")
    setFeedbackSuccess(null)
    setFeedbackNotice({})
  }, [])

  useEffect(() => {
    if (!sessionId) {
      resetAll()
      return
    }
    let cancelled = false
    api.getMessages(sessionId).then((loaded) => {
      if (cancelled || inFlightRef.current) return
      setMessages(loaded)
      const next: Record<string, Citation[]> = {}
      for (const m of loaded) {
        if (m.citations?.length) next[m.id] = m.citations
      }
      setCitationsByMessage(next)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [sessionId, api, resetAll])

  const send = useCallback(async () => {
    if (!input.trim() || isCreatingRef.current) return
    let activeSessionId = sessionId
    if (!activeSessionId) {
      if (!api.ensureSession) return
      isCreatingRef.current = true
      try {
        const created = await api.ensureSession()
        activeSessionId = created.id
        onSessionCreated?.(created)
      } catch {
        return
      } finally {
        isCreatingRef.current = false
      }
    }
    inFlightRef.current = true
    const question = chatMode === "change_request" ? `[변경 요청] ${input}` : input
    const userInput = input
    setInput("")
    setLoading(true)
    let responseCitations: Citation[] = []

    const userMsg: ChatMessage = {
      id: "user-" + Date.now(),
      session_id: activeSessionId,
      role: "user",
      content: userInput,
      created_at: new Date().toISOString(),
    }
    const botMsg: ChatMessage = {
      id: "streaming",
      session_id: activeSessionId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg, botMsg])

    try {
      let content = ""
      let messageId = ""
      let srDraft: SRDraftCreated | undefined
      for await (const event of api.askStream(activeSessionId, question)) {
        if (event.type === "token" && event.token) {
          content += event.token
          setMessages(prev => prev.map(m => m.id === "streaming" ? { ...m, content } : m))
        } else if (event.type === "citations") {
          responseCitations = event.citations || []
          setCitations(responseCitations)
          setWarnings(event.warnings || [])
        } else if (event.type === "done") {
          messageId = event.messageId || ""
          srDraft = event.sr_draft
          if (messageId) {
            setModesByMessage(prev => ({ ...prev, [messageId]: chatMode }))
          }
          if (messageId && responseCitations.length) {
            setCitationsByMessage(prev => ({ ...prev, [messageId]: responseCitations }))
          }
          if (srDraft && messageId) {
            const draftToStore = srDraft
            setSrDraftsByMessage(prev => ({ ...prev, [messageId]: draftToStore }))
          }
        }
      }
      setMessages(prev => prev.map(m =>
        m.id === "streaming" ? { ...m, id: messageId, content, citations: responseCitations } : m
      ))
      if (srDraft && chatMode === "change_request" && api.submitSR) {
        const autoDraft = srDraft
        // 사용자 클릭 없이 즉시 Jira 전송 — 데모 변경요청 흐름.
        void sendSRRef.current(autoDraft)
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === "streaming" ? { ...m, content: "오류가 발생했습니다. 다시 시도해주세요." } : m
      ))
    } finally {
      setLoading(false)
      inFlightRef.current = false
    }
  }, [input, sessionId, chatMode, api, onSessionCreated])

  const sendSR = useCallback(async (draft: SRDraftCreated) => {
    if (!api.submitSR) return
    setSrSendingId(draft.id)
    setSrSendErrorById(prev => ({ ...prev, [draft.id]: "" }))
    try {
      const result = await api.submitSR(draft.id)
      setSrSentById(prev => ({
        ...prev,
        [draft.id]: result.jira_issue_key
          ? `SR 전송 완료 (${result.jira_issue_key})`
          : "SR 전송 완료",
      }))
    } catch (err) {
      setSrSendErrorById(prev => ({
        ...prev,
        [draft.id]: err instanceof Error ? err.message : "SR 전송에 실패했습니다",
      }))
    } finally {
      setSrSendingId(null)
    }
  }, [api])

  useEffect(() => {
    sendSRRef.current = sendSR
  }, [sendSR])

  const openFeedback = useCallback((msgId: string) => setFeedbackFor(msgId), [])
  const cancelFeedback = useCallback(() => {
    setFeedbackFor(null)
    setFeedbackText("")
  }, [])

  const submitFeedback = useCallback(async (msgId: string) => {
    if (!api.submitFeedback || !feedbackText.trim()) return
    setFeedbackSubmitting(true)
    try {
      const msg = messages.find(m => m.id === msgId)
      const msgCitations = msg?.citations?.length
        ? msg.citations
        : citationsByMessage[msgId] || citations
      const citation = msgCitations.find(c => c.document_id)
      const result = await api.submitFeedback({
        chat_message_id: msgId,
        document_id: citation?.document_id,
        chunk_id: citation?.chunk_id || undefined,
        feedback_text: feedbackText,
      })
      setFeedbackNotice(prev => ({
        ...prev,
        [msgId]: result.proposed_change
          ? "AI 수정안이 생성되어 승인 관리로 전달되었습니다"
          : "오류 제보가 접수되었습니다",
      }))
      setFeedbackSuccess(msgId)
      setFeedbackFor(null)
      setFeedbackText("")
      setTimeout(() => setFeedbackSuccess(null), 3000)
    } finally {
      setFeedbackSubmitting(false)
    }
  }, [api, feedbackText, messages, citationsByMessage, citations])

  return {
    messages, modesByMessage, citations, citationsByMessage, warnings, loading,
    input, setInput, send,
    chatMode, setChatMode,
    srDraftsByMessage, srSentById, srSendingId, srSendErrorById, sendSR,
    feedbackFor, feedbackText, feedbackSubmitting, feedbackSuccess, feedbackNotice,
    openFeedback, cancelFeedback, setFeedbackText, submitFeedback,
    canSubmitSR, canSubmitFeedback,
    resetAll,
  }
}
