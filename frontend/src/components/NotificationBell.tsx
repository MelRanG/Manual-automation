import { useState, useRef, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Bell, CheckCheck, Clock } from "lucide-react"
import type { Notification } from "@/lib/api"

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "방금"
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

interface Props {
  notifications: Notification[]
  unreadCount: number
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
  onOpen?: () => void
}

export function NotificationBell({ notifications, unreadCount, onMarkRead, onMarkAllRead, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const handleNotifClick = (n: Notification) => {
    if (!n.is_read) onMarkRead(n.id)
    setOpen(false)
    if (n.link_path) navigate(n.link_path)
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() =>
          setOpen((p) => {
            const next = !p
            if (next) onOpen?.()
            return next
          })
        }
        className="relative p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
        aria-label="알림"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-[#c4c5d5] rounded-xl shadow-xl z-50 overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#e8e9ef]">
            <span className="text-sm font-semibold text-[#191c1e]">
              알림
              {unreadCount > 0 && (
                <span className="ml-2 text-xs bg-[#00288e] text-white px-1.5 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                className="flex items-center gap-1 text-xs text-[#00288e] hover:text-[#001f6e] transition-colors"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                전체 읽음
              </button>
            )}
          </div>

          {/* 알림 목록 */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-[#757684]">
                <Bell className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">알림이 없습니다</p>
              </div>
            ) : (
              notifications.map((n) => {
                return (
                  <button
                    key={n.id}
                    onClick={() => handleNotifClick(n)}
                    className={`w-full text-left px-4 py-3 border-b border-[#f0f1f7] hover:bg-[#f7f9fb] transition-colors ${n.is_read ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.is_read && (
                        <div className="w-2 h-2 rounded-full bg-[#00288e] mt-1.5 shrink-0" />
                      )}
                      <div className={`flex-1 ${n.is_read ? "pl-4" : ""}`}>
                        <p className="text-sm font-medium text-[#191c1e] leading-tight mb-0.5 line-clamp-2">
                          {n.title}
                        </p>
                        <p className="text-xs text-[#757684] line-clamp-2 mb-1">{n.message}</p>
                        <div className="flex items-center gap-1 text-[10px] text-[#757684]">
                          <Clock className="h-3 w-3" />
                          {timeAgo(n.created_at)}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* 전체 보기 풋터 */}
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block text-center px-4 py-2.5 text-xs font-medium text-[#00288e] hover:bg-[#dde1ff] border-t border-[#e8e9ef]"
          >
            전체 알림 보기 →
          </Link>
        </div>
      )}
    </div>
  )
}
