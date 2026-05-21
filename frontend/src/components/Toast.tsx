import { useEffect, useState } from "react"
import { X, Bell } from "lucide-react"

interface ToastProps {
  title: string
  message: string
  onClose: () => void
  onClick?: () => void
  durationMs?: number
}

export function Toast({ title, message, onClose, onClick, durationMs = 4000 }: ToastProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 10)
    const t2 = setTimeout(() => {
      setVisible(false)
      setTimeout(onClose, 300)
    }, durationMs)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [durationMs, onClose])

  const interactive = !!onClick
  const handleBodyClick = () => {
    if (!interactive) return
    onClick?.()
    setVisible(false)
    setTimeout(onClose, 300)
  }

  return (
    <div
      onClick={handleBodyClick}
      className={`pointer-events-auto w-80 bg-white border border-[#c4c5d5] rounded-xl shadow-lg p-4 transition-all duration-300 ${interactive ? "cursor-pointer hover:shadow-xl" : ""}`}
      style={{
        transform: visible ? "translateX(0)" : "translateX(110%)",
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[#00288e]/10 flex items-center justify-center shrink-0">
          <Bell className="h-4 w-4 text-[#00288e]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#191c1e] leading-tight mb-0.5 truncate">
            {title}
          </p>
          <p className="text-xs text-[#444653] leading-relaxed line-clamp-2">{message}</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setVisible(false)
            setTimeout(onClose, 300)
          }}
          className="p-1 rounded hover:bg-[#f7f9fb] transition-colors text-[#757684] shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

interface ToastItem {
  id: string
  title: string
  message: string
  onClick?: () => void
}

interface ToastContainerProps {
  toasts: ToastItem[]
  onClose: (id: string) => void
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          title={t.title}
          message={t.message}
          onClick={t.onClick}
          onClose={() => onClose(t.id)}
        />
      ))}
    </div>
  )
}
