import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Info, AlertTriangle, X, Camera, CloudRain } from "lucide-react"
import { useChatSession } from "@/hooks/useChatSession"
import { buildWidgetAdapter } from "@/lib/chatAdapters"
import { ChatPanel } from "@/components/chat/ChatPanel"
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
  const [reasonEtcText, setReasonEtcText] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const adapter = useMemo(() => buildWidgetAdapter(null), [])
  const chat = useChatSession({ sessionId, userId: null, api: adapter })

  const pendingSendRef = useRef(false)

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId
    const res = await fetch("/api/widget/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: "demo_courier",
        anonymous_id: "demo_courier_user",
        user_id: null,
      }),
    })
    const data = await res.json()
    const id = data.id as string
    setSessionId(id)
    return id
  }

  const sendWithSession = async () => {
    if (!sessionId) {
      pendingSendRef.current = true
      await ensureSession()
      return
    }
    chat.send()
  }

  useEffect(() => {
    if (sessionId && pendingSendRef.current) {
      pendingSendRef.current = false
      chat.send()
    }
    // chat.send is intentionally in deps so we always have the latest closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, chat.send])

  const chatWithLazySend = { ...chat, send: sendWithSession }

  const emptyState = (
    <div className="text-center text-sm text-[#444653] mt-8">
      <span
        className="material-symbols-outlined text-4xl text-[#00288e] mb-2 block"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        smart_toy
      </span>
      안녕하세요! 배송 도우미입니다.<br />무엇을 도와드릴까요?
    </div>
  )

  useEffect(() => {
    if (!chatOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [chatOpen])

  useEffect(() => {
    const id = window.setTimeout(() => setToastOpen(true), 2000)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl)
    }
  }, [photoUrl])

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

  function handleSave() {
    if (onSaveBehavior === "weather-modal") {
      setModalOpen(true)
    }
    // "none": 의도적으로 아무 동작 없음
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
                    <div key={r.key} className="flex flex-col gap-2">
                      <label
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
                      {r.key === "etc" && reason === "etc" && (
                        <input
                          type="text"
                          value={reasonEtcText}
                          onChange={(e) => setReasonEtcText(e.target.value)}
                          placeholder="사유를 입력하세요"
                          className="ml-6 w-[calc(100%-1.5rem)] border border-[#c4c5d5] rounded px-2 py-1 text-sm focus:outline-none focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e]"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
              {reason === "etc" && (
                <div className="mt-3 bg-[#fff4d0] border-l-4 border-[#f59e0b] text-[#7a4f00] text-xs p-3 rounded flex items-start gap-2">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>사유를 소명하지 않으면 정시 배송률 하락으로 페널티를 받을 수 있습니다</span>
                </div>
              )}
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

        {/* 하단 sticky 저장 버튼 */}
        <div className="sticky bottom-0 z-40 bg-white border-t border-[#c4c5d5] p-4 pr-20">
          <button
            type="button"
            onClick={handleSave}
            className="w-full bg-[#00288e] hover:bg-[#1e40af] text-white font-semibold py-3 rounded-lg transition-colors"
          >
            저장
          </button>
        </div>
      </div>

      {/* Weather Modal (after only) */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setModalOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <CloudRain size={60} className="text-[#00288e]" />
            </div>
            <p className="text-lg font-semibold text-[#191c1e] text-center leading-snug">
              현재 기상악화 상태입니다.<br />
              조심히 운행하세요
            </p>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="mt-6 w-full bg-[#00288e] hover:bg-[#1e40af] text-white font-semibold py-3 rounded-lg transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* Floating Chatbot */}
      {chatOpen ? (
        <div className="fixed z-50 inset-0 md:inset-auto md:bottom-8 md:right-8 md:flex md:flex-col md:items-end">
          <div className="w-full bg-white flex flex-col overflow-hidden h-[100dvh] md:w-[400px] md:h-[550px] md:rounded-xl md:shadow-[0_10px_25px_rgba(0,0,0,0.15)] md:border md:border-[#c4c5d5]">
            <div className="bg-[#00288e] text-white p-4 pt-[calc(env(safe-area-inset-top)+1rem)] flex-shrink-0 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span
                  className="material-symbols-outlined"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  smart_toy
                </span>
                <span className="text-xl font-semibold">DocOps AI 어시스턴트</span>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setChatOpen(false)}
                  className="text-white/80 hover:text-white transition-colors p-1"
                  aria-label="닫기"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ChatPanel chat={chatWithLazySend} variant="compact" emptyState={emptyState} />
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="fixed bottom-8 right-8 z-50 w-14 h-14 rounded-full bg-[#00288e] text-white shadow-lg hover:bg-[#1e40af] transition-all hover:scale-105 flex items-center justify-center"
          aria-label="챗봇 열기"
        >
          <span
            className="material-symbols-outlined text-2xl"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            smart_toy
          </span>
        </button>
      )}
    </div>
  )
}
