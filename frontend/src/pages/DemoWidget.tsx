import { useEffect, useState } from "react"
import { ArrowLeft, Info, AlertTriangle, X } from "lucide-react"
import { CUSTOMER, DEFAULT_MESSAGE, TOAST } from "./DemoWidget.constants"

export interface DemoWidgetProps {
  allowAllReasons: boolean
  onSaveBehavior: "none" | "weather-modal"
}

export function DemoWidget({ allowAllReasons, onSaveBehavior }: DemoWidgetProps) {
  const [toastOpen, setToastOpen] = useState(false)
  const [message, setMessage] = useState(DEFAULT_MESSAGE)

  useEffect(() => {
    const id = window.setTimeout(() => setToastOpen(true), 2000)
    return () => window.clearTimeout(id)
  }, [])

  // Props are intentionally consumed later (Task 5: allowAllReasons, Task 7: onSaveBehavior)
  void allowAllReasons
  void onSaveBehavior

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

        {/* 폼 영역 */}
        <main className="flex flex-col gap-4 p-4 pb-32">
          {/* 배송 정보 카드 */}
          <section className="bg-white rounded-lg border border-[#c4c5d5] p-4">
            <h2 className="text-sm font-semibold text-[#191c1e] mb-3 flex items-center gap-1.5">
              <span aria-hidden>📍</span> 배송 정보
            </h2>
            <dl className="grid grid-cols-[88px_1fr] gap-y-2 text-sm">
              <dt className="text-[#757684]">고객 주소</dt>
              <dd className="text-[#191c1e] leading-snug">{CUSTOMER.address}</dd>
              <dt className="text-[#757684]">고객 번호</dt>
              <dd className="text-[#191c1e]">{CUSTOMER.phone}</dd>
              <dt className="text-[#757684]">예상 배송 시간</dt>
              <dd className="text-[#191c1e]">{CUSTOMER.eta}</dd>
            </dl>
          </section>

          {/* 메시지 카드 */}
          <section className="bg-white rounded-lg border border-[#c4c5d5] p-4">
            <h2 className="text-sm font-semibold text-[#191c1e] mb-2 flex items-center gap-1.5">
              <span aria-hidden>💬</span> 고객 전달 메시지
            </h2>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full border border-[#c4c5d5] rounded p-2 text-sm focus:outline-none focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] resize-none"
            />
          </section>
        </main>
      </div>
    </div>
  )
}
