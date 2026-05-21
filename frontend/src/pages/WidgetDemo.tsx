import { useState, useEffect, useMemo, useRef } from "react"
import { Link } from "react-router-dom"
import { useChatSession } from "@/hooks/useChatSession"
import { buildWidgetAdapter } from "@/lib/chatAdapters"
import { ChatPanel } from "@/components/chat/ChatPanel"

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001"

export function WidgetDemo() {
  const [chatOpen, setChatOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loginDropdownOpen, setLoginDropdownOpen] = useState(false)
  const [demoUserId, setDemoUserId] = useState<string | null>(null)

  const adapter = useMemo(() => buildWidgetAdapter(demoUserId), [demoUserId])

  const chat = useChatSession({
    sessionId,
    userId: demoUserId,
    api: adapter,
  })

  // When toggle changes, reset session (different owner — can't mix users).
  // Use a ref to skip the very first render so we don't reset on mount.
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    setSessionId(null)
    chat.resetAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoUserId])

  useEffect(() => {
    if (!chatOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [chatOpen])

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId
    const res = await fetch("/api/widget/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: "demo_asiana",
        anonymous_id: demoUserId ? null : "demo_user",
        user_id: demoUserId,
      }),
    })
    const data = await res.json()
    const id = data.id as string
    setSessionId(id)
    return id
  }

  // Pending send pattern: when first message is queued before a session exists,
  // we trigger ensureSession, then flush the send in an effect once sessionId updates.
  const pendingSendRef = useRef(false)

  const sendWithSession = async () => {
    if (!sessionId) {
      pendingSendRef.current = true
      await ensureSession()
      return  // effect below will fire chat.send with fresh sessionId closure
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
      안녕하세요! DocOps AI 어시스턴트입니다.<br />무엇을 도와드릴까요?
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f9fb] text-[#191c1e] font-['Inter',sans-serif] relative">
      {/* Top NavBar */}
      <nav className="bg-white flex justify-between items-center px-6 w-full h-16 border-b border-[#c4c5d5] shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-8">
          <div className="text-2xl font-bold text-[#00288e] cursor-pointer">DocOps AI</div>
          <div className="hidden md:flex gap-6 h-full items-center text-base">
            <a className="h-full flex items-center text-[#00288e] border-b-2 border-[#00288e] pb-1" href="#">항공권 예매</a>
            <a className="h-full flex items-center text-[#444653] hover:text-[#00288e] transition-colors" href="#">여행 정보</a>
            <a className="h-full flex items-center text-[#444653] hover:text-[#00288e] transition-colors" href="#">Jira 연동</a>
            <a className="h-full flex items-center text-[#444653] hover:text-[#00288e] transition-colors" href="#">설정</a>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden lg:flex items-center bg-[#f2f4f6] rounded-full px-4 py-1 border border-[#c4c5d5]">
            <span className="material-symbols-outlined text-[#757684] text-lg mr-1">search</span>
            <input className="bg-transparent border-none outline-none text-sm w-32 placeholder-[#444653]" placeholder="검색..." type="text" />
          </div>
          <div className="relative">
            <button
              onClick={() => setLoginDropdownOpen(o => !o)}
              className="text-sm text-[#00288e] hover:text-[#1e40af] px-4 py-1 flex items-center gap-1"
            >
              {demoUserId ? "로그인됨" : "로그인"}
              <span className="material-symbols-outlined text-base">expand_more</span>
            </button>
            {loginDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-[#c4c5d5] rounded-lg shadow-lg p-2 w-64 z-50">
                <p className="text-[10px] text-[#757684] px-2 pb-2 border-b border-[#c4c5d5] mb-2">
                  SSO 연동 시뮬레이션 (해커톤 데모)
                </p>
                <button
                  onClick={() => { setDemoUserId(null); setLoginDropdownOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-sm rounded ${demoUserId === null ? "bg-[#f2f4f6] font-semibold" : "hover:bg-[#f2f4f6]"}`}
                >
                  ○ 익명 (게스트)
                </button>
                <button
                  onClick={() => { setDemoUserId(DEMO_USER_ID); setLoginDropdownOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-sm rounded ${demoUserId === DEMO_USER_ID ? "bg-[#f2f4f6] font-semibold" : "hover:bg-[#f2f4f6]"}`}
                >
                  ● 로그인 사용자<br />
                  <span className="text-xs text-[#757684]">demo-user-001</span>
                </button>
              </div>
            )}
          </div>
          <Link
            to="/"
            className="text-xs font-semibold bg-[#00288e] text-white rounded-lg px-4 py-2 hover:bg-[#1e40af] transition-colors shadow-sm"
          >
            대시보드
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative w-full h-[600px] flex items-center justify-center px-6">
        <div
          className="absolute inset-0 w-full h-full bg-cover bg-center"
          style={{
            backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCeYnMD4K_zZk1D3J3ERQcuKz0144q0htHcq1_5uMjbfGnO4EWRmknmc3miEhCFhM2HW5fBHxRz0_465iTNCxvsRhKaps-UAUzTCrHv-Hp-5NiJ0TKUOdsWp2qPi46Yj7wSk2UMAW09Z2p_cJB8_4q_EZcwfn433MYMcQAeqPh-QYRPOPjY89pi9FO03w7Hmx8igo6ZPzzlMWOdHXFCqM0JzSj_NzbiYC8s_x4FTgm1mku4jl9L8lShzTQP5rLMFtkJ0qGqLyOPPw')"
          }}
        >
          <div className="absolute inset-0 bg-[#0d1c2e]/20 mix-blend-multiply" />
        </div>

        {/* Glassmorphism Booking Widget */}
        <div className="relative z-10 w-full max-w-5xl bg-white/85 backdrop-blur-[12px] border border-[#c4c5d5]/30 rounded-xl shadow-lg p-6 flex flex-col gap-4">
          <h1 className="text-[32px] font-bold leading-[1.25] tracking-[-0.02em] text-[#191c1e] mb-3">
            지성이 하늘과 만나는 곳.
          </h1>
          <div className="flex gap-6 border-b border-[#c4c5d5] pb-4">
            <label className="flex items-center gap-1 cursor-pointer">
              <input defaultChecked name="trip_type" type="radio" className="text-[#00288e] focus:ring-[#00288e] border-[#757684]" />
              <span className="text-sm">왕복</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input name="trip_type" type="radio" className="text-[#00288e] focus:ring-[#00288e] border-[#757684]" />
              <span className="text-sm">편도</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input name="trip_type" type="radio" className="text-[#00288e] focus:ring-[#00288e] border-[#757684]" />
              <span className="text-sm">다구간</span>
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-[#444653]">출발지</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#757684]">flight_takeoff</span>
                <input className="w-full pl-10 pr-3 py-2 rounded border border-[#c4c5d5] bg-white focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] text-base" placeholder="출발 도시 또는 공항" type="text" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-[#444653]">도착지</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#757684]">flight_land</span>
                <input className="w-full pl-10 pr-3 py-2 rounded border border-[#c4c5d5] bg-white focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] text-base" placeholder="도착 도시" type="text" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-[#444653]">탑승일</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#757684]">calendar_month</span>
                <input className="w-full pl-10 pr-3 py-2 rounded border border-[#c4c5d5] bg-white focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] text-base" placeholder="가는 날 - 오는 날" type="text" />
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-xs font-semibold text-[#444653]">탑승객/좌석 등급</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#757684]">person</span>
                  <select className="w-full pl-10 pr-3 py-2 rounded border border-[#c4c5d5] bg-white focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] text-base appearance-none">
                    <option>성인 1, 이코노미</option>
                    <option>성인 2, 비즈니스</option>
                  </select>
                </div>
              </div>
              <button className="bg-[#00288e] hover:bg-[#1e40af] text-white font-semibold text-xl rounded-lg px-6 py-2 h-[42px] transition-colors shadow-sm flex items-center justify-center">
                검색
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Bento Grid Section */}
      <section className="px-8 py-8 w-full max-w-7xl mx-auto flex flex-col gap-6">
        <h2 className="text-2xl font-semibold text-[#191c1e]">프리미엄 서비스 둘러보기</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 bg-white rounded-xl border border-[#c4c5d5] overflow-hidden shadow-sm flex flex-col md:flex-row hover:shadow-md transition-shadow">
            <div
              className="w-full md:w-1/2 h-48 md:h-auto bg-cover bg-center"
              style={{
                backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuBdzjQ2bB_Kwb5plaJbwml-TM7IjzU0lZreZdTTHYCmRC2AdC3fYDwgBVE88cR6NI-LG14Xagte9mx7WKHpj8JObsfCY5mM0S6XoSSviv0hQaz85Vly_dtrPjtVK_Px3UFXexpCjVGbBWjMDUSmN2XX7NPiu0DqoaMtumiT0NH6xI-VShC6HSyiCqGPyon7-EkYZA6xJekEFicK0CVFP_EZyN23wz_LsCoXaX2qGVyFS71mwZGHDeps9D41yYZzAoMYS7Dk39pvog')"
              }}
            />
            <div className="p-6 flex flex-col justify-center w-full md:w-1/2 gap-3">
              <div className="flex items-center gap-1 text-[#00288e] text-xs font-semibold uppercase tracking-wide">
                <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>schema</span>
                DocOps AI 연동
              </div>
              <h3 className="text-xl font-semibold text-[#191c1e]">여행 기록과 Jira 동기화</h3>
              <p className="text-sm text-[#444653] line-clamp-3">
                기업 출장 일정을 엔터프라이즈 Jira 워크플로우에 원활하게 통합하세요. AI가 비행 상태를 프로젝트 일정에 자동으로 매핑합니다.
              </p>
              <button className="mt-1 text-[#00288e] text-xs font-semibold flex items-center gap-1 hover:underline w-fit">
                자세히 알아보기 <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-[#c4c5d5] p-6 shadow-sm flex flex-col gap-3 hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-full bg-[#d5e3fc] text-[#00288e] flex items-center justify-center mb-1">
              <span className="material-symbols-outlined text-2xl">airplane_ticket</span>
            </div>
            <h3 className="text-xl font-semibold text-[#191c1e]">예약 관리</h3>
            <p className="text-sm text-[#444653] flex-1">
              다가오는 비행을 조회, 수정 또는 업그레이드하세요. 탑승권을 즉시 확인하세요.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#d8dadc] border-t border-[#c4c5d5] flex flex-col md:flex-row justify-between items-center px-8 py-6 w-full mt-auto">
        <div className="text-xl font-semibold text-[#191c1e] mb-3 md:mb-0">DocOps AI</div>
        <div className="flex flex-wrap justify-center gap-6 text-sm mb-3 md:mb-0">
          <a className="text-[#444653] hover:text-[#00288e] underline" href="#">개인정보처리방침</a>
          <a className="text-[#444653] hover:text-[#00288e] underline" href="#">이용약관</a>
          <a className="text-[#444653] hover:text-[#00288e] underline" href="#">API 레퍼런스</a>
          <a className="text-[#444653] hover:text-[#00288e] underline" href="#">상태</a>
        </div>
        <div className="text-sm text-[#444653] text-center md:text-right">
          © 2024 DocOps AI Platform. All rights reserved.
        </div>
      </footer>

      {/* Floating Chatbot */}
      {chatOpen ? (
        <div className="fixed z-50 inset-0 md:inset-auto md:bottom-8 md:right-8 md:flex md:flex-col md:items-end">
          <div className="w-full bg-white flex flex-col overflow-hidden h-[100dvh] md:w-[400px] md:h-[550px] md:rounded-xl md:shadow-[0_10px_25px_rgba(0,0,0,0.15)] md:border md:border-[#c4c5d5]">
            <div className="bg-[#00288e] text-white p-4 pt-[calc(env(safe-area-inset-top)+1rem)] flex-shrink-0 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                <span className="text-xl font-semibold">DocOps AI 어시스턴트</span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setChatOpen(false)} className="text-white/80 hover:text-white transition-colors p-1">
                  <span className="material-symbols-outlined text-lg">minimize</span>
                </button>
                <button onClick={() => setChatOpen(false)} className="text-white/80 hover:text-white transition-colors p-1">
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <ChatPanel chat={chatWithLazySend} variant="compact" emptyState={emptyState} />
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-8 right-8 z-50 w-14 h-14 rounded-full bg-[#00288e] text-white shadow-lg hover:bg-[#1e40af] transition-all hover:scale-105 flex items-center justify-center"
        >
          <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
        </button>
      )}
    </div>
  )
}
