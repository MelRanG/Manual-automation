import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Users, MessageSquare, RefreshCw, ChevronRight, Trash2 } from "lucide-react"

interface WidgetSession {
  id: string
  site_id: string
  anonymous_id: string
  last_message: string | null
  message_count: number
  created_at: string
}

interface SessionMessage {
  id: string
  role: "user" | "assistant"
  content: string
  created_at: string
}

export function WidgetConversations() {
  const [sessions, setSessions] = useState<WidgetSession[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  const fetchSessions = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/widget/admin/sessions")
      if (res.ok) setSessions(await res.json())
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchSessions() }, [])

  const selectSession = async (id: string) => {
    setSelectedId(id)
    setLoadingMessages(true)
    try {
      const res = await fetch(`/api/widget/sessions/${id}/messages`)
      if (res.ok) setMessages(await res.json())
    } finally {
      setLoadingMessages(false)
    }
  }

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm("이 대화를 삭제하시겠습니까?")) return
    try {
      const res = await fetch(`/api/widget/admin/sessions/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(`status ${res.status}`)
      setSessions(prev => prev.filter(s => s.id !== id))
      if (selectedId === id) {
        setSelectedId(null)
        setMessages([])
      }
    } catch (err) {
      window.alert("삭제에 실패했습니다.")
      console.error(err)
    }
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">위젯 대화</h2>
          <p className="text-muted-foreground mt-1">
            외부 사이트 챗봇을 통한 사용자 대화 내역
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={fetchSessions}>
          <RefreshCw className="h-4 w-4" /> 새로고침
        </Button>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        <div className="w-96 flex flex-col border border-border rounded-lg overflow-hidden">
          <div className="p-3 border-b border-border bg-muted/30">
            <p className="text-sm font-medium text-muted-foreground">
              세션 목록 ({sessions.length})
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">로딩 중...</div>
            ) : sessions.length === 0 ? (
              <div className="p-8 text-center">
                <Users className="h-10 w-10 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">아직 위젯 대화가 없습니다</p>
              </div>
            ) : (
              sessions.map(s => (
                <div
                  key={s.id}
                  className={`group relative border-b border-border hover:bg-accent/50 transition-colors ${
                    selectedId === s.id ? "bg-accent" : ""
                  }`}
                >
                  <button
                    onClick={() => selectSession(s.id)}
                    className="w-full text-left p-3 pr-12"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="secondary" className="text-xs">{s.site_id}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString("ko-KR")}
                      </span>
                    </div>
                    <p className="text-sm text-foreground truncate">
                      {s.last_message || "대화 없음"}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <MessageSquare className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{s.message_count}개 메시지</span>
                      <span className="text-xs text-muted-foreground">· {s.anonymous_id}</span>
                    </div>
                  </button>
                  <button
                    onClick={(e) => deleteSession(s.id, e)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 text-muted-foreground hover:text-destructive transition-opacity rounded"
                    title="삭제"
                    aria-label="삭제"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex-1 border border-border rounded-lg flex flex-col overflow-hidden">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <ChevronRight className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">세션을 선택하면 대화 내용이 표시됩니다</p>
              </div>
            </div>
          ) : loadingMessages ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">로딩 중...</p>
            </div>
          ) : (
            <>
              <div className="p-3 border-b border-border bg-muted/30">
                <p className="text-sm font-medium text-muted-foreground">
                  대화 내역 ({messages.length}개 메시지)
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">메시지가 없습니다</p>
                ) : (
                  messages.map(m => (
                    <Card key={m.id} className={m.role === "user" ? "ml-12" : "mr-12"}>
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={m.role === "user" ? "secondary" : "default"} className="text-xs">
                            {m.role === "user" ? "사용자" : "AI"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(m.created_at).toLocaleTimeString("ko-KR")}
                          </span>
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{m.content}</p>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
