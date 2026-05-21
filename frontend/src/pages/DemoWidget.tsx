import { useEffect, useState } from "react"
import { ArrowLeft, Info, AlertTriangle, X } from "lucide-react"
import { TOAST } from "./DemoWidget.constants"

export interface DemoWidgetProps {
  allowAllReasons: boolean
  onSaveBehavior: "none" | "weather-modal"
}

export function DemoWidget({ allowAllReasons, onSaveBehavior }: DemoWidgetProps) {
  const [toastOpen, setToastOpen] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setToastOpen(true), 2000)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <div className="min-h-screen bg-[#f7f9fb] flex flex-col items-center font-['Inter',sans-serif] text-[#191c1e]">
      <div className="w-full max-w-md flex flex-col">
        {/* 상단 헤더 */}
        <header className="sticky top-0 z-30 bg-white border-b border-[#c4c5d5] h-14 px-4 flex items-center justify-between">
          <button
            type="button"
            className="text-[#191c1e] p-1 -ml-1"
            aria-label="뒤로"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-semibold">배송 상세</h1>
          <button
            type="button"
            className="text-[#191c1e] p-1 -mr-1"
            aria-label="도움말"
          >
            <Info size={20} />
          </button>
        </header>

        {/* 토스트 */}
        {toastOpen && (
          <div
            role="status"
            className="sticky top-14 z-20 bg-[#fff4d0] border-l-4 border-[#f59e0b] text-[#7a4f00] px-4 py-3 flex items-start gap-2"
          >
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm leading-snug">
              <div className="font-semibold">{TOAST.title}</div>
              <div>{TOAST.body}</div>
            </div>
            <button
              type="button"
              onClick={() => setToastOpen(false)}
              aria-label="알림 닫기"
              className="text-[#7a4f00] p-1 -mr-1 flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* 폼 영역 (다음 task에서 채움) */}
        <div className="p-4 text-sm text-[#444653]">
          (form area placeholder) · allowAllReasons={String(allowAllReasons)} · onSaveBehavior={onSaveBehavior}
        </div>
      </div>
    </div>
  )
}
