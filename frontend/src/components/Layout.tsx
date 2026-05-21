import { useState, useEffect } from "react"
import { Link, useLocation, Outlet, useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  FileText,
  MessageSquare,
  LayoutDashboard,
  Ticket,
  Webhook,
  BookOpen,
  Globe,
  Users,
  Plus,
  LifeBuoy,
  Search,
  Settings,
  LogOut,
} from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { useNotifications } from "@/hooks/useNotifications"
import { useManualJob } from "@/contexts/ManualJobContext"
import { NotificationBell } from "@/components/NotificationBell"
import { ToastContainer } from "@/components/Toast"

type NavItem = { to: string; icon: React.ElementType; label: string }
type NavSection = { heading: string | null; items: NavItem[] }

const navSections: NavSection[] = [
  {
    heading: null,
    items: [
      { to: "/", icon: LayoutDashboard, label: "대시보드" },
    ],
  },
  {
    heading: "문서",
    items: [
      { to: "/documents", icon: FileText, label: "문서 관리" },
    ],
  },
  {
    heading: "문서 현행화",
    items: [
      { to: "/manuals", icon: BookOpen, label: "매뉴얼 생성" },
      { to: "/feedback", icon: LifeBuoy, label: "오류 제보" },
      { to: "/sr", icon: Ticket, label: "Jira SR" },
    ],
  },
  {
    heading: "고객 채널",
    items: [
      { to: "/chat", icon: MessageSquare, label: "Q&A 챗봇" },
      { to: "/widget-conversations", icon: Users, label: "위젯 대화" },
      { to: "/widget-demo", icon: Globe, label: "위젯 데모" },
    ],
  },
  {
    heading: "운영",
    items: [
      { to: "/webhook-logs", icon: Webhook, label: "웹훅 로그" },
    ],
  },
]

interface ToastItem { id: string; title: string; message: string; onClick?: () => void }

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { notifications, unreadCount, newNotification, markRead, markAllRead, clearNew, reload } =
    useNotifications(user?.id)
  const { runningJob, clearJob } = useManualJob()
  const [toasts, setToasts] = useState<ToastItem[]>([])

  // 새 알림이 오면 토스트 표시
  useEffect(() => {
    if (!newNotification) return
    const notif = newNotification
    const handleClick = () => {
      void markRead(notif.id)
      if (notif.link_path) navigate(notif.link_path)
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToasts((prev) => [
      ...prev,
      { id: notif.id + Date.now(), title: notif.title, message: notif.message, onClick: handleClick },
    ])
    clearNew()
  }, [newNotification, clearNew, markRead, navigate])

  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id))

  const handleLogout = () => {
    logout()
    navigate("/login")
  }

  const initials = user?.name
    ? user.name.slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() ?? "U"

  return (
    <div className="flex h-[100dvh] bg-background">
      <aside className="w-[240px] border-r border-border bg-card flex flex-col shrink-0">
        <div className="p-5 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground tracking-tight leading-tight">
                DocOps AI
              </h1>
              <p className="text-[11px] text-muted-foreground leading-tight">Enterprise Tier</p>
            </div>
          </div>
        </div>

        <div className="px-4 mb-4">
          <Link
            to="/documents"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Document
          </Link>
        </div>

        <nav className="flex-1 px-3 overflow-y-auto space-y-4">
          {navSections.map((section, i) => (
            <div key={i}>
              {section.heading && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {section.heading}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = location.pathname === item.to ||
                    (item.to !== "/" && location.pathname.startsWith(item.to))
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                        active
                          ? "bg-accent text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <item.icon className="h-[18px] w-[18px]" />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 pb-4 space-y-0.5 border-t border-border pt-3 mt-2">
          <a href="#" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <LifeBuoy className="h-[18px] w-[18px]" />
            Support
          </a>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LogOut className="h-[18px] w-[18px]" />
            로그아웃
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-muted rounded-full px-3 py-1.5 border border-border">
              <Search className="h-4 w-4 text-muted-foreground mr-2" />
              <input
                type="text"
                placeholder="Search documents, AI chat..."
                className="bg-transparent border-none outline-none text-sm w-56 placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={markRead}
              onMarkAllRead={markAllRead}
              onOpen={() => void reload()}
            />
            <button className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
              <Settings className="h-[18px] w-[18px]" />
            </button>
            <div
              className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center cursor-pointer"
              title={user?.email}
            >
              <span className="text-xs font-semibold text-primary">{initials}</span>
            </div>
          </div>
        </header>
        {runningJob && (
          <div className="shrink-0 bg-[#00288e] text-white px-6 py-2 flex items-center gap-3 text-sm">
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin shrink-0" />
            <span className="flex-1">
              <span className="font-medium">매뉴얼 생성 중</span>
              <span className="text-white/70 ml-2">{runningJob.targetUrl}</span>
            </span>
            <Link to="/manuals" className="text-white/80 hover:text-white underline text-xs">
              상태 보기
            </Link>
            <button onClick={clearJob} className="text-white/60 hover:text-white ml-2" title="알림 숨기기">
              ✕
            </button>
          </div>
        )}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  )
}
