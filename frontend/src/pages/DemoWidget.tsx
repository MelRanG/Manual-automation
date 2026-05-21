import { useEffect, useState } from "react"
import { ArrowLeft, Info, AlertTriangle, X, Camera } from "lucide-react"
import { CUSTOMER, DEFAULT_MESSAGE, REASONS, TOAST, type ReasonKey } from "./DemoWidget.constants"

export interface DemoWidgetProps {
  allowAllReasons: boolean
  onSaveBehavior: "none" | "weather-modal"
}

export function DemoWidget({ allowAllReasons, onSaveBehavior }: DemoWidgetProps) {
  const [toastOpen, setToastOpen] = useState(false)
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [reason, setReason] = useState<ReasonKey | null>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setToastOpen(true), 2000)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl)
    }
  }, [photoUrl])

  // Props are intentionally consumed later (Task 7: onSaveBehavior)
  void onSaveBehavior

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (photoUrl) URL.revokeObjectURL(photoUrl)
    setPhotoUrl(URL.createObjectURL(file))
    // input value 리셋해서 동일 파일 다시 선택해도 onChange 발화
    e.target.value = ""
  }

  function handlePhotoRemove() {
    if (photoUrl) URL.revokeObjectURL(photoUrl)
    setPhotoUrl(null)
    setReason(null)
  }

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

          {/* 사진 카드 */}
          <section className="bg-white rounded-lg border border-[#c4c5d5] p-4">
            <h2 className="text-sm font-semibold text-[#191c1e] mb-2 flex items-center gap-1.5">
              <span aria-hidden>📷</span> 현장 사진
            </h2>
            {photoUrl ? (
              <div className="flex items-center gap-3">
                <img
                  src={photoUrl}
                  alt="현장 사진"
                  className="w-20 h-20 object-cover rounded border border-[#c4c5d5]"
                />
                <button
                  type="button"
                  onClick={handlePhotoRemove}
                  className="text-sm text-[#7a1d1d] underline"
                >
                  사진 제거
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#c4c5d5] rounded p-6 cursor-pointer hover:bg-[#f7f9fb] transition-colors">
                <Camera size={28} className="text-[#757684]" />
                <span className="text-sm text-[#444653]">사진 첨부</span>
                <span className="text-xs text-[#757684]">탭하여 카메라/갤러리</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
              </label>
            )}
          </section>

          {/* 지연사유 카드 (사진 있을 때만) */}
          {photoUrl && (
            <section className="bg-white rounded-lg border border-[#c4c5d5] p-4">
              <h2 className="text-sm font-semibold text-[#191c1e] mb-3 flex items-center gap-1.5">
                <span aria-hidden>📋</span> 지연 사유
              </h2>
              <div className="flex flex-col gap-2">
                {REASONS.map((r) => {
                  const disabled = !r.alwaysEnabled && !allowAllReasons
                  return (
                    <label
                      key={r.key}
                      className={`flex items-center gap-2 text-sm ${
                        disabled
                          ? "opacity-50 line-through text-[#757684] cursor-not-allowed"
                          : "text-[#191c1e] cursor-pointer"
                      }`}
                    >
                      <input
                        type="radio"
                        name="reason"
                        value={r.key}
                        checked={reason === r.key}
                        onChange={() => setReason(r.key)}
                        disabled={disabled}
                        className="text-[#00288e] focus:ring-[#00288e]"
                      />
                      <span>{r.label}</span>
                    </label>
                  )
                })}
              </div>
            </section>
          )}

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
