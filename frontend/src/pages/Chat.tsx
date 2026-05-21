import { useState, useRef, useEffect } from "react"
import { api, type ChatSession, type ChatMessage, type Citation, type DocumentWarning, type SRDraftCreated } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"

type ChatMode = "question" | "change_request"

export function Chat() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [citations, setCitations] = useState<Citation[]>([])
  const [citationsByMessage, setCitationsByMessage] = useState<Record<string, Citation[]>>({})
  const [warnings, setWarnings] = useState<DocumentWarning[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null)
  const [feedbackText, setFeedbackText] = useState("")
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null)
  const [feedbackNotice, setFeedbackNotice] = useState<Record<string, string>>({})
  const [deletingSession, setDeletingSession] = useState<string | null>(null)
  const [chatMode, setChatMode] = useState<ChatMode>("question")
  const [srCreated, setSrCreated] = useState<{id: string; title: string} | null>(null)
  const [srDraftsByMessage, setSrDraftsByMessage] = useState<Record<string, SRDraftCreated>>({})
  const [srSendingId, setSrSendingId] = useState<string | null>(null)
  const [srSentById, setSrSentById] = useState<Record<string, string>>({})
  const [srSendErrorById, setSrSendErrorById] = useState<Record<string, string>>({})
  const messagesEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (user?.id) {
      api.listSessions(user.id).then(setSessions).catch(() => {})
    }
  }, [user?.id])

  useEffect(() => {
    if (activeSession) {
      api.getMessages(activeSession).then((loaded) => {
        setMessages(loaded)
        const next: Record<string, Citation[]> = {}
        for (const message of loaded) {
          if (message.citations?.length) next[message.id] = message.citations
        }
        setCitationsByMessage(next)
      }).catch(() => {})
    }
  }, [activeSession])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const createSession = async () => {
    if (!user?.id) return
    const session = await api.createSession(user.id)
    setSessions([session, ...sessions])
    setActiveSession(session.id)
    setMessages([])
    setCitations([])
    setCitationsByMessage({})
    setSrDraftsByMessage({})
  }

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingSession(sessionId)
    try {
      await api.deleteSession(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      if (activeSession === sessionId) {
        setActiveSession(null)
        setMessages([])
        setCitations([])
        setCitationsByMessage({})
        setSrDraftsByMessage({})
        setWarnings([])
      }
    } finally {
      setDeletingSession(null)
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || !activeSession) return
    const question = chatMode === "change_request"
      ? `[변경 요청] ${input}`
      : input
    setInput("")
    setLoading(true)
    setSrCreated(null)
    let responseCitations: Citation[] = []

    const userMsg: ChatMessage = { id: "user-" + Date.now(), session_id: activeSession, role: "user", content: input, created_at: new Date().toISOString() }
    const botMsg: ChatMessage = { id: "streaming", session_id: activeSession, role: "assistant", content: "", created_at: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg, botMsg])

    try {
      let content = ""
      let messageId = ""
      for await (const event of api.askQuestionStream(activeSession, question)) {
        if (event.type === "token" && event.token) {
          content += event.token
          setMessages(prev => prev.map(m => m.id === "streaming" ? { ...m, content } : m))
        } else if (event.type === "citations") {
          responseCitations = event.citations || []
          setCitations(responseCitations)
          setWarnings(event.warnings || [])
        } else if (event.type === "done") {
          messageId = event.messageId || ""
          if (messageId && responseCitations.length) {
            setCitationsByMessage(prev => ({ ...prev, [messageId]: responseCitations }))
          }
          if (event.sr_draft) {
            setSrCreated({ id: event.sr_draft.id, title: event.sr_draft.title })
            if (messageId) {
              setSrDraftsByMessage(prev => ({ ...prev, [messageId]: event.sr_draft! }))
            }
          }
        }
      }
      setMessages(prev => prev.map(m => m.id === "streaming" ? { ...m, id: messageId || `assistant-${Date.now()}`, content, citations: responseCitations } : m))
      setSessions(prev => prev.map(s => s.id === activeSession && !s.title ? { ...s, title: input.slice(0, 50) } : s))
    } catch (err) {
      const message = err instanceof Error ? err.message : "오류가 발생했습니다. 다시 시도해주세요."
      setMessages(prev => prev.map(m => m.id === "streaming" ? { ...m, content: message } : m))
    } finally {
      setLoading(false)
    }
  }

  const submitFeedback = async (messageId: string) => {
    if (!feedbackText.trim() || !user?.id) return
    setFeedbackSubmitting(true)
    try {
      const message = messages.find(m => m.id === messageId)
      const messageCitations = message?.citations?.length
        ? message.citations
        : citationsByMessage[messageId] || citations
      const citation = messageCitations.find(c => c.document_id)
      const result = await api.createFeedback({
        user_id: user.id,
        chat_message_id: messageId,
        document_id: citation?.document_id,
        chunk_id: citation?.chunk_id || undefined,
        feedback_text: feedbackText,
      })
      setFeedbackNotice(prev => ({
        ...prev,
        [messageId]: result.proposed_change
          ? "AI 수정안이 생성되어 승인 관리로 전달되었습니다"
          : "오류 제보가 접수되었습니다",
      }))
      setFeedbackSuccess(messageId)
      setFeedbackFor(null)
      setFeedbackText("")
      setTimeout(() => setFeedbackSuccess(null), 3000)
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  const sendSRDraft = async (draft: SRDraftCreated) => {
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
  }

  const groupSessionsByDate = () => {
    const today: ChatSession[] = []
    const yesterday: ChatSession[] = []
    const older: ChatSession[] = []
    const now = new Date()
    for (const s of sessions) {
      const d = new Date(s.created_at)
      const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
      if (diff === 0) today.push(s)
      else if (diff === 1) yesterday.push(s)
      else older.push(s)
    }
    return { today, yesterday, older }
  }

  const grouped = groupSessionsByDate()

  const renderSessionList = (list: ChatSession[]) =>
    list.map(s => (
      <div
        key={s.id}
        className={`group relative w-full flex items-center rounded-md transition-colors ${
          activeSession === s.id ? "bg-[#f2f4f6]" : "hover:bg-[#f2f4f6]"
        }`}
      >
        <button
          onClick={() => { setActiveSession(s.id); setCitations([]); setWarnings([]); setCitationsByMessage({}); setSrDraftsByMessage({}) }}
          className={`flex-1 text-left px-3 py-2 text-sm truncate transition-colors ${
            activeSession === s.id ? "text-[#00288e] font-medium" : "text-[#191c1e]"
          }`}
        >
          {s.title || "새 대화"}
        </button>
        <button
          onClick={(e) => deleteSession(s.id, e)}
          disabled={deletingSession === s.id}
          className="opacity-0 group-hover:opacity-100 shrink-0 p-1 mr-1 text-[#757684] hover:text-[#ba1a1a] transition-all rounded"
        >
          <span className="material-symbols-outlined text-sm">delete</span>
        </button>
      </div>
    ))

  return (
    <div className="flex h-full overflow-hidden">
      {/* Chat History Sidebar */}
      <div className="w-64 bg-white border-r border-[#c4c5d5] flex flex-col shrink-0">
        <div className="p-4 border-b border-[#c4c5d5] flex justify-between items-center">
          <h2 className="text-xs font-semibold text-[#191c1e]">최근 대화</h2>
          <button onClick={createSession} className="text-[#444653] hover:text-[#00288e] transition-colors">
            <span className="material-symbols-outlined text-base">edit_square</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {grouped.today.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[10px] font-semibold text-[#757684] uppercase tracking-wider px-2 py-1">오늘</h3>
              {renderSessionList(grouped.today)}
            </div>
          )}
          {grouped.yesterday.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[10px] font-semibold text-[#757684] uppercase tracking-wider px-2 py-1">어제</h3>
              {renderSessionList(grouped.yesterday)}
            </div>
          )}
          {grouped.older.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[10px] font-semibold text-[#757684] uppercase tracking-wider px-2 py-1">이전</h3>
              {renderSessionList(grouped.older)}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-[#f7f9fb] relative">
        {/* Mode Tabs */}
        {activeSession && (
          <div className="bg-white border-b border-[#c4c5d5] px-6 py-2 flex items-center gap-1">
            <button
              onClick={() => setChatMode("question")}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
                chatMode === "question"
                  ? "bg-[#00288e] text-white shadow-sm"
                  : "text-[#444653] hover:bg-[#f2f4f6]"
              }`}
            >
              <span className="material-symbols-outlined text-base">help</span>
              질문하기
            </button>
            <button
              onClick={() => setChatMode("change_request")}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
                chatMode === "change_request"
                  ? "bg-[#b45309] text-white shadow-sm"
                  : "text-[#444653] hover:bg-[#f2f4f6]"
              }`}
            >
              <span className="material-symbols-outlined text-base">edit_note</span>
              변경 요청하기
            </button>
            {srCreated && (
              <div className="ml-auto flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium px-3 py-1.5 rounded-lg">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                SR 초안 생성됨: {srCreated.title.slice(0, 30)}
              </div>
            )}
          </div>
        )}

        {!activeSession ? (
          <div className="flex-1 flex flex-col items-center justify-center py-8">
            <div className="w-16 h-16 rounded-2xl bg-[#d5e3fc] flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-4xl text-[#00288e]" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
            </div>
            <h2 className="text-xl font-semibold text-[#191c1e] mt-4 text-center">무엇을 도와드릴까요?</h2>
            <p className="text-sm text-[#444653] text-center max-w-md mt-2">
              사내 규정, 재무 데이터, 기술 문서 등 DocOps AI에 등록된 모든 지식을 기반으로 답변해 드립니다.
            </p>
            <button
              onClick={createSession}
              className="mt-6 bg-[#00288e] text-white text-sm font-semibold rounded-lg px-5 py-2.5 hover:bg-[#1e40af] transition-colors shadow-sm flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-base">add</span>
              새 대화 시작
            </button>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center">
              <div className="w-full max-w-4xl space-y-6 pb-8">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <div className="w-16 h-16 rounded-2xl bg-[#d5e3fc] flex items-center justify-center shadow-sm">
                      <span className="material-symbols-outlined text-4xl text-[#00288e]" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                    </div>
                    <h2 className="text-xl font-semibold text-[#191c1e] text-center">무엇을 도와드릴까요?</h2>
                    <p className="text-sm text-[#444653] text-center max-w-md">
                      사내 규정, 재무 데이터, 기술 문서 등 DocOps AI에 등록된 모든 지식을 기반으로 답변해 드립니다.
                    </p>
                  </div>
                )}

                {messages.map((msg) => (
                  <div key={msg.id}>
                    {msg.role === "user" ? (
                      <div className="flex justify-end w-full">
                        <div className="bg-[#1e40af] text-white rounded-2xl rounded-tr-none px-6 py-3 max-w-[85%] shadow-sm">
                          <p className="text-base leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-4 w-full max-w-[95%]">
                        <div className="shrink-0 w-8 h-8 rounded-full bg-[#d5e3fc] flex items-center justify-center border border-[#c4c5d5] mt-1">
                          <span className="material-symbols-outlined text-base text-[#00288e]" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                        </div>
                        <div className="flex-1 space-y-3">
                          <div className="bg-white border border-[#c4c5d5] rounded-2xl rounded-tl-none px-6 py-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                            <div className="text-base leading-relaxed text-[#191c1e] whitespace-pre-wrap">
                              {msg.content || (
                                <span className="text-[#757684] animate-pulse">응답 생성 중...</span>
                              )}
                            </div>

                            {/* Citations inside message */}
                            {(() => {
                              const messageCitations = msg.citations?.length
                                ? msg.citations
                                : citationsByMessage[msg.id] || (msg === messages[messages.length - 1] ? citations : [])
                              if (msg.id === "streaming" || messageCitations.length === 0) return null
                              return (
                                <>
                                  <div className="h-px w-full bg-[#e0e3e5] my-4" />
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-1 text-[#444653]">
                                      <span className="material-symbols-outlined text-sm">menu_book</span>
                                      <span className="text-xs font-semibold">참고 문서 (출처)</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      {messageCitations.map((c, i) => (
                                        <a key={i} href="#" className="flex flex-col gap-1 p-3 bg-[#f7f9fb] rounded-lg border border-[#c4c5d5] hover:border-[#b8c4ff] hover:bg-white hover:shadow-sm transition-all group">
                                          <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-1 overflow-hidden">
                                              <span className="material-symbols-outlined text-base text-[#00288e] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>description</span>
                                              <span className="text-sm text-[#191c1e] font-semibold truncate group-hover:text-[#00288e] transition-colors">{c.document_title || "참고 문서"}</span>
                                            </div>
                                          </div>
                                          {c.quote && (
                                            <div className="text-xs text-[#444653] truncate flex items-center gap-1 mt-1">
                                              <span className="material-symbols-outlined text-[14px]">link</span>
                                              {c.quote}
                                            </div>
                                          )}
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                </>
                              )
                            })()}
                          </div>

                          {srDraftsByMessage[msg.id] && (
                            <div className="border border-[#d7b46a] bg-[#fff8e6] rounded-xl p-4 shadow-sm space-y-3">
                              <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-base text-[#92600a]">assignment</span>
                                    <span className="text-xs font-bold text-[#92600a]">AI가 정리한 SR 초안</span>
                                  </div>
                                  <p className="text-sm font-semibold text-[#191c1e]">{srDraftsByMessage[msg.id].title}</p>
                                </div>
                                <span className="shrink-0 rounded-full bg-white border border-[#e6d3a1] px-2 py-0.5 text-[10px] font-semibold text-[#92600a]">
                                  {srDraftsByMessage[msg.id].priority}
                                </span>
                              </div>
                              <p className="text-xs leading-relaxed text-[#444653] whitespace-pre-wrap line-clamp-4">
                                {srDraftsByMessage[msg.id].description}
                              </p>
                              <div className="flex items-center justify-between gap-3 pt-1">
                                <p className="text-[11px] text-[#757684]">
                                  검토 후 바로 Jira/Webhook으로 전송할 수 있습니다.
                                </p>
                                {srSentById[srDraftsByMessage[msg.id].id] ? (
                                  <span className="text-xs font-semibold text-emerald-700">
                                    {srSentById[srDraftsByMessage[msg.id].id]}
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => sendSRDraft(srDraftsByMessage[msg.id])}
                                    disabled={srSendingId === srDraftsByMessage[msg.id].id}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#00288e] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1e40af] disabled:opacity-50 transition-colors"
                                  >
                                    <span className="material-symbols-outlined text-sm">send</span>
                                    {srSendingId === srDraftsByMessage[msg.id].id ? "전송 중..." : "SR 보내기"}
                                  </button>
                                )}
                              </div>
                              {srSendErrorById[srDraftsByMessage[msg.id].id] && (
                                <p className="text-xs font-medium text-[#ba1a1a]">
                                  {srSendErrorById[srDraftsByMessage[msg.id].id]}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Action buttons */}
                          {msg.id !== "streaming" && msg.content && (
                            <div className="flex items-center gap-4 pl-2">
                              <button className="flex items-center gap-1 text-xs text-[#444653] hover:text-[#00288e] transition-colors">
                                <span className="material-symbols-outlined text-base">content_copy</span>
                                복사
                              </button>
                              <div className="w-px h-4 bg-[#c4c5d5]" />
                              <button className="flex items-center gap-1 text-xs text-[#444653] hover:text-[#00288e] transition-colors">
                                <span className="material-symbols-outlined text-base">thumb_up</span>
                              </button>
                              <button className="flex items-center gap-1 text-xs text-[#444653] hover:text-[#00288e] transition-colors">
                                <span className="material-symbols-outlined text-base">thumb_down</span>
                              </button>
                              <div className="ml-auto">
                                {feedbackSuccess === msg.id ? (
                                  <span className="text-xs text-emerald-600 font-medium">{feedbackNotice[msg.id] || "오류 제보 접수 완료"}</span>
                                ) : feedbackFor === msg.id ? (
                                  <div className="bg-[#ffdad6]/30 border border-[#ffdad6] rounded-lg p-3 space-y-2 max-w-sm">
                                    <p className="text-xs font-medium text-[#93000a]">어떤 내용이 실제와 다른가요?</p>
                                    <textarea
                                      placeholder="실제 내용을 알려주세요..."
                                      rows={2}
                                      value={feedbackText}
                                      onChange={e => setFeedbackText(e.target.value)}
                                      className="w-full text-sm border border-[#c4c5d5] rounded px-3 py-2 focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
                                    />
                                    <div className="flex gap-2">
                                      <button onClick={() => submitFeedback(msg.id)} disabled={feedbackSubmitting || !feedbackText.trim()} className="bg-[#00288e] text-white text-xs font-semibold px-3 py-1.5 rounded hover:bg-[#1e40af] disabled:opacity-50">
                                        {feedbackSubmitting ? "제출 중..." : "제출"}
                                      </button>
                                      <button onClick={() => { setFeedbackFor(null); setFeedbackText("") }} className="text-xs text-[#444653] px-3 py-1.5 rounded hover:bg-[#f2f4f6]">
                                        취소
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button onClick={() => setFeedbackFor(msg.id)} className="flex items-center gap-1 text-xs text-[#757684] hover:text-[#ba1a1a] hover:bg-[#ffdad6] px-3 py-1 rounded transition-all">
                                    <span className="material-symbols-outlined text-base">report</span>
                                    오류 수정 요청
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEnd} />
              </div>
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="border-t border-[#c4c5d5] px-4 py-2 bg-[#ffdbce]/20">
                <div className="flex items-center gap-2 text-[#611e00]">
                  <span className="material-symbols-outlined text-base">warning</span>
                  <span className="text-xs font-medium">
                    주의: 이 답변은 신뢰도가 낮은 문서를 참조합니다 — {warnings.map(w => w.title).join(", ")}
                  </span>
                </div>
              </div>
            )}

            {/* Input Area */}
            <div className="bg-[#f7f9fb]/80 backdrop-blur-md border-t border-[#c4c5d5] p-4 flex justify-center">
              <div className="w-full max-w-4xl relative">
                <div className="bg-white border-2 border-[#c4c5d5] focus-within:border-[#00288e] focus-within:ring-2 focus-within:ring-[#dde1ff] transition-all rounded-xl flex items-end p-1">
                  <button className="p-2 text-[#444653] hover:text-[#00288e] transition-colors shrink-0 rounded-lg hover:bg-[#f2f4f6]">
                    <span className="material-symbols-outlined text-lg">attach_file</span>
                  </button>
                  <textarea
                    className="flex-1 max-h-32 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none text-base text-[#191c1e] py-2 px-2 outline-none"
                    placeholder={chatMode === "change_request" ? "어떤 변경이 필요한지 설명해주세요..." : "문서 내용에 대해 질문해보세요..."}
                    rows={1}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                    disabled={loading}
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                    className="p-2 m-1 bg-[#00288e] text-white rounded-lg hover:bg-[#1e40af] transition-all shrink-0 flex items-center justify-center h-10 w-10 disabled:opacity-50 group"
                  >
                    <span className="material-symbols-outlined text-lg group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                  </button>
                </div>
                <div className="text-center mt-2">
                  <p className="text-[11px] text-[#757684]">AI는 실수를 할 수 있습니다. 중요한 결정 전 항상 제공된 원본 문서를 확인하세요.</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
