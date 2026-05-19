import { useState, useRef, useEffect } from "react"
import { Link } from "react-router-dom"
import { parseSSE } from "@/lib/sse"

interface Message {
  role: "user" | "assistant"
  content: string
  citations?: { title: string; id: string }[]
}

type WidgetMode = "question" | "change_request"

export function WidgetDemo() {
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [widgetMode, setWidgetMode] = useState<WidgetMode>("question")
  const [srCreated, setSrCreated] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streaming])

  async function ensureSession() {
    if (sessionId) return sessionId
    const res = await fetch("/api/widget/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site_id: "demo_asiana", anonymous_id: "demo_user" }),
    })
    const data = await res.json()
    const id = data.id || data.session_id
    setSessionId(id)
    return id
  }

  async function sendMessage() {
    if (!input.trim() || streaming) return
    const userInput = input.trim()
    const question = widgetMode === "change_request" ? `[변경 요청] ${userInput}` : userInput
    setInput("")
    setSrCreated(null)
    setMessages(prev => [...prev, { role: "user", content: userInput }])
    setStreaming(true)

    try {
      const sid = await ensureSession()
      const res = await fetch(`/api/widget/sessions/${sid}/ask-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      })

      let assistantContent = ""
      let citations: { title: string; id: string }[] = []

      setMessages(prev => [...prev, { role: "assistant", content: "" }])

      for await (const event of parseSSE(res)) {
        if (event.event === "token") {
          const parsed = JSON.parse(event.data)
          assistantContent += parsed.token || ""
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: "assistant", content: assistantContent, citations }
            return updated
          })
        } else if (event.event === "citations") {
          citations = JSON.parse(event.data).citations || []
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: "assistant", content: assistantContent, citations }
            return updated
          })
        } else if (event.event === "done") {
          const doneData = JSON.parse(event.data)
          if (doneData.sr_draft) {
            setSrCreated(doneData.sr_draft.title)
          }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        if (updated[updated.length - 1]?.role === "assistant" && !updated[updated.length - 1].content) {
          updated[updated.length - 1] = { role: "assistant", content: "죄송합니다. 응답을 생성하는 중 오류가 발생했습니다." }
        }
        return updated
      })
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f9fb] text-[#191c1e] font-['Inter',sans-serif] relative">
      {/* Top NavBar */}
      <nav className="bg-white flex justify-between items-center px-6 w-full h-16 border-b border-[#c4c5d5] shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-8">
          <div className="text-2xl font-bold text-[#00288e] cursor-pointer">Manual Automation</div>
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
          <button className="text-sm text-[#00288e] hover:text-[#1e40af] px-4 py-1">로그인</button>
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
                Manual Automation 연동
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
        <div className="text-xl font-semibold text-[#191c1e] mb-3 md:mb-0">Manual Automation</div>
        <div className="flex flex-wrap justify-center gap-6 text-sm mb-3 md:mb-0">
          <a className="text-[#444653] hover:text-[#00288e] underline" href="#">개인정보처리방침</a>
          <a className="text-[#444653] hover:text-[#00288e] underline" href="#">이용약관</a>
          <a className="text-[#444653] hover:text-[#00288e] underline" href="#">API 레퍼런스</a>
          <a className="text-[#444653] hover:text-[#00288e] underline" href="#">상태</a>
        </div>
        <div className="text-sm text-[#444653] text-center md:text-right">
          © 2024 Manual Automation Platform. All rights reserved.
        </div>
      </footer>

      {/* Floating Chatbot */}
      {chatOpen ? (
        <div className="fixed bottom-8 right-8 z-50 flex flex-col items-end">
          <div className="w-[400px] h-[550px] bg-white rounded-xl shadow-[0_10px_25px_rgba(0,0,0,0.15)] border border-[#c4c5d5] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-[#00288e] text-white p-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                <span className="text-xl font-semibold">Manual Automation 어시스턴트</span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setChatOpen(false)}
                  className="text-white/80 hover:text-white transition-colors p-1"
                >
                  <span className="material-symbols-outlined text-lg">minimize</span>
                </button>
                <button
                  onClick={() => setChatOpen(false)}
                  className="text-white/80 hover:text-white transition-colors p-1"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>
            </div>

            {/* Mode Tabs */}
            <div className="flex items-center gap-1 px-3 py-2 bg-[#f2f4f6] border-b border-[#c4c5d5]">
              <button
                onClick={() => setWidgetMode("question")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
                  widgetMode === "question"
                    ? "bg-[#00288e] text-white shadow-sm"
                    : "text-[#444653] hover:bg-white"
                }`}
              >
                <span className="material-symbols-outlined text-sm">help</span>
                질문하기
              </button>
              <button
                onClick={() => setWidgetMode("change_request")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
                  widgetMode === "change_request"
                    ? "bg-[#b45309] text-white shadow-sm"
                    : "text-[#444653] hover:bg-white"
                }`}
              >
                <span className="material-symbols-outlined text-sm">edit_note</span>
                변경 요청
              </button>
              {srCreated && (
                <div className="ml-auto text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                  SR 생성됨
                </div>
              )}
            </div>

            {/* Chat Area */}
            <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-4 bg-[#f7f9fb]">
              {messages.length === 0 && (
                <div className="text-center text-sm text-[#444653] mt-8">
                  <span className="material-symbols-outlined text-4xl text-[#00288e] mb-2 block" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                  안녕하세요! Manual Automation 어시스턴트입니다.<br />
                  무엇을 도와드릴까요?
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-full bg-[#1e40af] text-white flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                    </div>
                  )}
                  <div className={`flex flex-col gap-2 max-w-[85%] ${msg.role === "user" ? "items-end" : ""}`}>
                    <div
                      className={
                        msg.role === "user"
                          ? "bg-[#00288e] text-white rounded-lg rounded-tr-none p-3 text-sm shadow-sm"
                          : "bg-white border border-[#c4c5d5] rounded-lg rounded-tl-none p-3 text-sm text-[#191c1e] shadow-sm"
                      }
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      {msg.citations && msg.citations.length > 0 && (
                        <p className="text-xs text-[#444653] mt-2 pt-2 border-t border-dashed border-[#c4c5d5] flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">menu_book</span>
                          출처: {msg.citations.map(c => c.title).join(", ")}
                        </p>
                      )}
                    </div>
                    {msg.role === "assistant" && msg.content && (
                      <button className="bg-[#ffdad6] text-[#93000a] border border-[#ffdad6]/50 hover:bg-[#ffdad6]/80 py-1 px-3 rounded text-xs font-semibold flex items-center gap-1 transition-colors w-fit">
                        <span className="material-symbols-outlined text-[14px]">report</span>
                        오류 신고
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {streaming && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#1e40af] text-white flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                  </div>
                  <div className="bg-white border border-[#c4c5d5] rounded-lg p-3 text-sm text-[#444653]">
                    <span className="animate-pulse">응답 생성 중...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-3 bg-white border-t border-[#c4c5d5] flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <input
                  className="flex-1 bg-[#f2f4f6] border-none rounded-full px-4 py-2 text-sm focus:ring-1 focus:ring-[#00288e] outline-none text-[#191c1e]"
                  placeholder={widgetMode === "change_request" ? "변경 요청 내용을 입력하세요..." : "질문을 입력하세요..."}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendMessage()}
                  disabled={streaming}
                />
                <button
                  onClick={sendMessage}
                  disabled={streaming || !input.trim()}
                  className="w-10 h-10 rounded-full bg-[#00288e] text-white flex items-center justify-center hover:bg-[#1e40af] transition-colors shrink-0 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                </button>
              </div>
              <Link
                to="/"
                className="w-full bg-transparent text-[#00288e] hover:bg-[#f2f4f6] py-1 rounded text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">open_in_new</span>
                Manual Automation 대시보드로 이동
              </Link>
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
