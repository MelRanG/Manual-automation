import { useEffect, useMemo, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { Bell, Clock, CheckCheck } from "lucide-react"
import { api, type Notification } from "@/lib/api"

type TypeFilter = "all" | "manual" | "feedback" | "jira_sr" | "other"

const PAGE_SIZE = 20

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: "전체",
  manual: "매뉴얼",
  feedback: "오류 제보",
  jira_sr: "Jira SR",
  other: "기타",
}

function classify(t: string): Exclude<TypeFilter, "all"> {
  if (t.startsWith("manual")) return "manual"
  if (t.startsWith("feedback") || t === "conversion_failed" || t === "document_converted") return "feedback"
  if (t.startsWith("jira")) return "jira_sr"
  return "other"
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "방금"
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

export function Notifications() {
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [counts, setCounts] = useState<Record<TypeFilter, number>>({
    all: 0, manual: 0, feedback: 0, jira_sr: 0, other: 0,
  })

  const load = useCallback(async () => {
    const data = await api.listNotifications({
      unread_only: unreadOnly,
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    })
    setItems(data.items)
    setTotal(data.total)
  }, [unreadOnly, page])

  const loadCounts = useCallback(async () => {
    const all = await api.listNotifications({ limit: 500 })
    const next: Record<TypeFilter, number> = { all: 0, manual: 0, feedback: 0, jira_sr: 0, other: 0 }
    next.all = all.total
    for (const n of all.items) {
      const k = classify(n.type)
      next[k] += 1
    }
    setCounts(next)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadCounts() }, [loadCounts])

  const filtered = useMemo(() => {
    if (typeFilter === "all") return items
    return items.filter(n => classify(n.type) === typeFilter)
  }, [items, typeFilter])

  const handleClick = async (n: Notification) => {
    if (!n.is_read) {
      await api.markNotificationRead(n.id)
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    }
    if (n.link_path) navigate(n.link_path)
  }

  const markAll = async () => {
    await api.markAllNotificationsRead()
    setItems(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex h-full">
      {/* Left filter sidebar */}
      <aside className="w-[220px] border-r border-[#e0e3e5] shrink-0 p-5 space-y-1">
        <h3 className="text-xs font-semibold text-[#444653] uppercase tracking-wider mb-3">종류</h3>
        {(Object.keys(TYPE_LABELS) as TypeFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setTypeFilter(f)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
              typeFilter === f
                ? "bg-[#dde1ff] text-[#00288e] font-medium"
                : "text-[#444653] hover:bg-[#f7f9fb]"
            }`}
          >
            <span>{TYPE_LABELS[f]}</span>
            <span className="text-xs text-[#757684]">{counts[f]}</span>
          </button>
        ))}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-5 border-b border-[#e0e3e5]">
          <div>
            <h2 className="text-2xl font-bold text-[#191c1e]">알림</h2>
            <p className="text-sm text-[#444653] mt-1">전체 알림을 종류별로 검토합니다.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-[#f2f4f6] rounded-lg p-0.5">
              <button
                onClick={() => { setUnreadOnly(false); setPage(0) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  !unreadOnly ? "bg-white text-[#191c1e] shadow-sm" : "text-[#757684]"
                }`}
              >전체</button>
              <button
                onClick={() => { setUnreadOnly(true); setPage(0) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  unreadOnly ? "bg-white text-[#191c1e] shadow-sm" : "text-[#757684]"
                }`}
              >미읽음</button>
            </div>
            <button
              onClick={markAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#00288e] hover:bg-[#dde1ff] rounded-lg transition-colors"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              전체 읽음
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[#757684]">
              <Bell className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">알림이 없습니다</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left bg-white border rounded-xl p-4 transition-shadow hover:shadow-md ${
                    n.is_read ? "border-[#e0e3e5] opacity-70" : "border-[#c4c5d5]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {!n.is_read && <div className="w-2 h-2 rounded-full bg-[#00288e] mt-2 shrink-0" />}
                    <div className={`flex-1 min-w-0 ${n.is_read ? "pl-5" : ""}`}>
                      <p className="text-sm font-semibold text-[#191c1e] truncate">{n.title}</p>
                      <p className="text-xs text-[#444653] mt-0.5 line-clamp-2">{n.message}</p>
                      <div className="flex items-center gap-1 mt-2 text-[10px] text-[#757684]">
                        <Clock className="h-3 w-3" />
                        {timeAgo(n.created_at)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-8 py-3 border-t border-[#e0e3e5]">
            <span className="text-xs text-[#757684]">총 {total}건</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 text-xs border border-[#c4c5d5] rounded disabled:opacity-40"
              >‹</button>
              <span className="text-xs text-[#444653] px-2">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => p + 1 < totalPages ? p + 1 : p)}
                disabled={page + 1 >= totalPages}
                className="px-2 py-1 text-xs border border-[#c4c5d5] rounded disabled:opacity-40"
              >›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
