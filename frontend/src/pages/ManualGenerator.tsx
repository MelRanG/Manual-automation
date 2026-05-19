import { useState } from "react"
import { api } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"
import { useManualJob } from "@/contexts/ManualJobContext"

export function ManualGenerator() {
  const { user } = useAuth()
  const { runningJob, startJob, clearJob } = useManualJob()

  const [targetUrl, setTargetUrl] = useState("")
  const [loginUrl, setLoginUrl] = useState("")
  const [loginId, setLoginId] = useState("")
  const [loginPw, setLoginPw] = useState("")
  const [steps, setSteps] = useState<string[]>([])
  const [stepInput, setStepInput] = useState("")
  const [errorMsg, setErrorMsg] = useState("")

  const isRunning = !!runningJob

  const normalizeUrl = (url: string) => {
    const v = url.trim()
    if (!v || v.startsWith("http://") || v.startsWith("https://")) return v
    return `https://${v}`
  }

  const addStep = () => {
    const t = stepInput.trim()
    if (t) { setSteps(prev => [...prev, t]); setStepInput("") }
  }

  const handleSubmit = async () => {
    const url = normalizeUrl(targetUrl)
    if (!url) return
    setTargetUrl(url)
    setErrorMsg("")
    try {
      const job = await api.createManualJob({
        user_id: user?.id || "00000000-0000-0000-0000-000000000001",
        target_url: url,
        login_id: loginId || undefined,
        login_pw: loginPw || undefined,
        login_url: normalizeUrl(loginUrl) || undefined,
        scenario_steps: steps.length > 0 ? steps : undefined,
      })
      startJob(job)
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "요청 실패")
    }
  }

  const reset = () => {
    clearJob()
    setTargetUrl("")
    setLoginUrl("")
    setLoginId("")
    setLoginPw("")
    setSteps([])
    setStepInput("")
    setErrorMsg("")
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#191c1e]">사용자 매뉴얼 생성</h2>
        <p className="text-sm text-[#444653] mt-1">
          웹사이트 URL과 클릭 단계를 입력하면 Playwright가 캡처하고 AI가 매뉴얼을 생성합니다.
        </p>
      </div>

      {isRunning ? (
        <div className="bg-white border border-[#c4c5d5] rounded-xl p-10 flex flex-col items-center gap-4 shadow-sm">
          <div className="w-14 h-14 rounded-full bg-[#d5e3fc] flex items-center justify-center animate-pulse">
            <span className="material-symbols-outlined text-3xl text-[#00288e]">screenshot_monitor</span>
          </div>
          <p className="text-sm font-medium text-[#191c1e]">매뉴얼 생성 중...</p>
          <p className="text-xs text-[#757684]">Playwright가 페이지를 캡처하고 있습니다. 잠시 기다려주세요.</p>
          <p className="text-xs text-[#757684]">다른 페이지로 이동해도 생성은 계속 진행됩니다.</p>
          {runningJob && <p className="text-[10px] font-mono text-[#c4c5d5]">{runningJob.id}</p>}
          <button onClick={reset} className="mt-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-xs text-[#757684] hover:bg-[#f2f4f6]">
            취소
          </button>
        </div>
      ) : (
        <div className="bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm space-y-5">
          {errorMsg && (
            <div className="flex items-center gap-2 bg-[#ffdad6] text-[#ba1a1a] text-sm px-4 py-3 rounded-lg">
              <span className="material-symbols-outlined text-base">error</span>
              {errorMsg}
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-[#191c1e]">대상 URL <span className="text-[#ba1a1a]">*</span></label>
            <input
              className="mt-1 w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
              placeholder="https://example.com"
              value={targetUrl}
              onChange={e => setTargetUrl(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium text-[#191c1e]">로그인 URL</label>
              <input
                className="mt-1 w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] outline-none"
                placeholder="https://…/login"
                value={loginUrl}
                onChange={e => setLoginUrl(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#191c1e]">아이디</label>
              <input
                className="mt-1 w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] outline-none"
                placeholder="user@email.com"
                value={loginId}
                onChange={e => setLoginId(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#191c1e]">비밀번호</label>
              <input
                type="password"
                className="mt-1 w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] outline-none"
                placeholder="••••••"
                value={loginPw}
                onChange={e => setLoginPw(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-[#191c1e]">클릭 단계</label>
            <p className="text-xs text-[#757684] mt-0.5 mb-2">
              "뉴스 클릭", "웹툰 클릭" 처럼 입력하세요. 클릭 위치가 스크린샷에 표시됩니다.
            </p>
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] outline-none"
                placeholder="예: 뉴스 클릭"
                value={stepInput}
                onChange={e => setStepInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addStep()}
              />
              <button
                onClick={addStep}
                className="px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors"
              >
                추가
              </button>
            </div>
            {steps.length > 0 && (
              <div className="mt-2 space-y-1">
                {steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-[#f7f9fb] rounded-lg text-sm border border-[#e0e3e5]">
                    <span className="text-xs text-[#757684] font-mono w-5">{i + 1}.</span>
                    <span className="flex-1 text-[#191c1e]">{s}</span>
                    <button onClick={() => setSteps(prev => prev.filter((_, j) => j !== i))} className="text-[#757684] hover:text-[#ba1a1a] transition-colors">
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={handleSubmit}
              disabled={!targetUrl.trim()}
              className="px-5 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors shadow-sm flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-base">play_arrow</span>
              매뉴얼 생성 시작
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
