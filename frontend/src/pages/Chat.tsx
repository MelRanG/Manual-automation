import { useState, useEffect, useMemo } from "react"
import { api, type ChatSession } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"
import { useChatSession } from "@/hooks/useChatSession"
import { buildChatAdapter } from "@/lib/chatAdapters"
import { ChatPanel } from "@/components/chat/ChatPanel"

export function Chat() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [deletingSession, setDeletingSession] = useState<string | null>(null)
  const [isDrafting, setIsDrafting] = useState(false)

  const adapter = useMemo(
    () => buildChatAdapter(user?.id ?? "placeholder"),
    [user?.id]
  )

  const chat = useChatSession({
    sessionId: activeSession,
    userId: user?.id ?? null,
    api: adapter,
    onSessionCreated: (session) => {
      setSessions(prev => [session, ...prev])
      setActiveSession(session.id)
      setIsDrafting(false)
    },
  })

  useEffect(() => {
    if (user?.id) {
      api.listSessions(user.id).then(setSessions).catch(() => {})
    }
  }, [user?.id])

  const startDraft = () => {
    setActiveSession(null)
    setIsDrafting(true)
    chat.resetAll()
  }

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingSession(sessionId)
    try {
      await api.deleteSession(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      if (activeSession === sessionId) {
        setActiveSession(null)
        setIsDrafting(false)
        chat.resetAll()
      }
    } finally {
      setDeletingSession(null)
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

  const renderList = (list: ChatSession[]) =>
    list.map(s => (
      <div
        key={s.id}
        className={`group relative w-full flex items-center rounded-md transition-colors ${
          activeSession === s.id ? "bg-[#f2f4f6]" : "hover:bg-[#f2f4f6]"
        }`}
      >
        <button
          onClick={() => {
            setActiveSession(s.id)
            setIsDrafting(false)
          }}
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

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-12 space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-[#d5e3fc] flex items-center justify-center shadow-sm">
        <span className="material-symbols-outlined text-4xl text-[#00288e]" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
      </div>
      <h2 className="text-xl font-semibold text-[#191c1e] text-center">무엇을 도와드릴까요?</h2>
      <p className="text-sm text-[#444653] text-center max-w-md">
        사내 규정, 재무 데이터, 기술 문서 등 DocOps AI에 등록된 모든 지식을 기반으로 답변해 드립니다.
      </p>
    </div>
  )

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-64 bg-white border-r border-[#c4c5d5] flex flex-col shrink-0">
        <div className="p-4 border-b border-[#c4c5d5] flex justify-between items-center">
          <h2 className="text-xs font-semibold text-[#191c1e]">최근 대화</h2>
          <button onClick={startDraft} className="text-[#444653] hover:text-[#00288e] transition-colors">
            <span className="material-symbols-outlined text-base">edit_square</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {grouped.today.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[10px] font-semibold text-[#757684] uppercase tracking-wider px-2 py-1">오늘</h3>
              {renderList(grouped.today)}
            </div>
          )}
          {grouped.yesterday.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[10px] font-semibold text-[#757684] uppercase tracking-wider px-2 py-1">어제</h3>
              {renderList(grouped.yesterday)}
            </div>
          )}
          {grouped.older.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[10px] font-semibold text-[#757684] uppercase tracking-wider px-2 py-1">이전</h3>
              {renderList(grouped.older)}
            </div>
          )}
        </div>
      </div>

      {!activeSession && !isDrafting ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-[#f7f9fb] py-8">
          {emptyState}
          <button
            onClick={startDraft}
            className="mt-6 bg-[#00288e] text-white text-sm font-semibold rounded-lg px-5 py-2.5 hover:bg-[#1e40af] transition-colors shadow-sm flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-base">add</span>새 대화 시작
          </button>
        </div>
      ) : (
        <ChatPanel chat={chat} variant="full" emptyState={emptyState} />
      )}
    </div>
  )
}
