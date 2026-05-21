import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { api, type ManualJob } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"
import { useManualJob } from "@/contexts/ManualJobContext"
import { ChangeHistoryTimeline } from "@/components/ChangeHistoryTimeline"
import { ApprovalReviewPanel } from "@/components/ApprovalReviewPanel"

type Tab = "all" | "review" | "done"

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-[#fff3dc] text-[#92600a]",
  running: "bg-[#d5e3fc] text-[#00288e]",
  completed: "bg-[#dcfce7] text-[#15803d]",
  failed: "bg-[#ffdad6] text-[#ba1a1a]",
}
const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  running: "생성 중",
  completed: "완료",
  failed: "실패",
}

export function ManualGenerator() {
  const { user } = useAuth()
  const { startJob } = useManualJob()
  const [tab, setTab] = useState<Tab>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [targetUrl, setTargetUrl] = useState("")
  const [loginUrl, setLoginUrl] = useState("")
  const [loginId, setLoginId] = useState("")
  const [loginPw, setLoginPw] = useState("")
  const [steps, setSteps] = useState<string[]>([])
  const [stepInput, setStepInput] = useState("")
  const [errorMsg, setErrorMsg] = useState("")

  const { data: jobs, refetch } = useApi(
    () => api.listManualJobs(user?.id),
    [user?.id]
  )

  const allJobs = jobs ?? []

  const filtered = allJobs.filter(j => {
    if (tab === "all") return true
    if (tab === "review") return j.status === "completed" && !j.output_document_id
    if (tab === "done") return j.status === "completed" && !!j.output_document_id
    return true
  })

  const selected = allJobs.find(j => j.id === selectedId) ?? null
  const reviewCount = allJobs.filter(j => j.status === "completed" && !j.output_document_id).length

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
      setShowForm(false)
      setTargetUrl(""); setLoginUrl(""); setLoginId(""); setLoginPw(""); setSteps([])
      refetch()
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "요청 실패")
    }
  }

  return (
    <div className="flex h-full">
      <div className="w-[380px] border-r border-[#e0e3e5] flex flex-col shrink-0">
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#191c1e]">매뉴얼 생성</h2>
            <button
              onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00288e] text-white rounded-lg text-xs font-medium hover:bg-[#1e40af] transition-colors"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              신규 요청
            </button>
          </div>
          <div className="flex gap-1 border-b border-[#e0e3e5]">
            {([["all", "전체"], ["review", "검토요청"], ["done", "완료"]] as [Tab, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedId(null) }}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  tab === t
                    ? "border-[#00288e] text-[#00288e]"
                    : "border-transparent text-[#757684] hover:text-[#191c1e]"
                }`}
              >
                {label}
                {t === "review" && reviewCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#00288e] text-white text-[10px] font-bold">
                    {reviewCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {showForm && (
          <div className="mx-4 mb-3 p-4 border border-[#c4c5d5] rounded-xl bg-white space-y-3 text-sm">
            {errorMsg && <div className="text-xs text-[#ba1a1a] bg-[#ffdad6] px-3 py-2 rounded-lg">{errorMsg}</div>}
            <div>
              <label className="text-xs font-medium text-[#191c1e]">대상 URL *</label>
              <input className="mt-1 w-full px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-xs outline-none focus:border-[#00288e]" placeholder="https://example.com" value={targetUrl} onChange={e => setTargetUrl(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-medium text-[#191c1e]">로그인 URL</label>
                <input className="mt-1 w-full px-2 py-1.5 border border-[#c4c5d5] rounded-lg text-xs outline-none focus:border-[#00288e]" value={loginUrl} onChange={e => setLoginUrl(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-[#191c1e]">아이디</label>
                <input className="mt-1 w-full px-2 py-1.5 border border-[#c4c5d5] rounded-lg text-xs outline-none focus:border-[#00288e]" value={loginId} onChange={e => setLoginId(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-[#191c1e]">비밀번호</label>
                <input type="password" className="mt-1 w-full px-2 py-1.5 border border-[#c4c5d5] rounded-lg text-xs outline-none focus:border-[#00288e]" value={loginPw} onChange={e => setLoginPw(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#191c1e]">클릭 단계</label>
              <div className="flex gap-1 mt-1">
                <input className="flex-1 px-2 py-1.5 border border-[#c4c5d5] rounded-lg text-xs outline-none focus:border-[#00288e]" placeholder="예: 뉴스 클릭" value={stepInput} onChange={e => setStepInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addStep()} />
                <button onClick={addStep} className="px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-xs hover:bg-[#f2f4f6]">추가</button>
              </div>
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-1 mt-1 text-xs">
                  <span className="text-[#757684] w-4">{i + 1}.</span>
                  <span className="flex-1">{s}</span>
                  <button onClick={() => setSteps(p => p.filter((_, j) => j !== i))} className="text-[#9a9bad] hover:text-[#ba1a1a]">✕</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-xs hover:bg-[#f2f4f6]">취소</button>
              <button onClick={handleSubmit} disabled={!targetUrl.trim()} className="px-3 py-1.5 bg-[#00288e] text-white rounded-lg text-xs font-medium hover:bg-[#1e40af] disabled:opacity-50">생성 시작</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-[#f2f4f6]">
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[#9a9bad]">항목이 없습니다</div>
          ) : (
            filtered.map(job => (
              <button
                key={job.id}
                onClick={() => setSelectedId(job.id)}
                className={`w-full text-left px-5 py-4 hover:bg-[#f7f9fb] transition-colors ${selectedId === job.id ? "bg-[#eef2ff]" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[#191c1e] truncate flex-1">{job.target_url}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[job.status] ?? "bg-[#f2f4f6] text-[#757684]"}`}>
                    {STATUS_LABEL[job.status] ?? job.status}
                  </span>
                </div>
                <p className="text-xs text-[#9a9bad] mt-1">{new Date(job.created_at).toLocaleDateString("ko-KR")}</p>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <ManualDetail job={selected} onRefetch={refetch} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-[#9a9bad]">
            목록에서 항목을 선택하세요
          </div>
        )}
      </div>
    </div>
  )
}

function ManualDetail({ job, onRefetch }: { job: ManualJob; onRefetch: () => void }) {
  const { user } = useAuth()
  const [activeSection, setActiveSection] = useState<"info" | "draft" | "history">("info")

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-[#191c1e] flex-1 truncate">{job.target_url}</h3>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
          job.status === "completed" ? "bg-[#dcfce7] text-[#15803d]" :
          job.status === "running" ? "bg-[#d5e3fc] text-[#00288e]" :
          job.status === "failed" ? "bg-[#ffdad6] text-[#ba1a1a]" :
          "bg-[#fff3dc] text-[#92600a]"
        }`}>{job.status === "completed" ? "완료" : job.status === "running" ? "생성 중" : job.status === "failed" ? "실패" : "대기"}</span>
      </div>

      <div className="flex gap-1 border-b border-[#e0e3e5] mb-5">
        {([["info", "요청 정보"], ["draft", "AI 초안"], ["history", "변경 이력"]] as ["info" | "draft" | "history", string][]).map(([s, label]) => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeSection === s ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"}`}>
            {label}
          </button>
        ))}
      </div>

      {activeSection === "info" && (
        <div className="space-y-3 text-sm">
          <div><span className="text-[#757684] w-24 inline-block">대상 URL</span><a href={job.target_url} target="_blank" rel="noopener noreferrer" className="text-[#00288e] hover:underline">{job.target_url}</a></div>
          <div><span className="text-[#757684] w-24 inline-block">요청 일시</span><span className="text-[#191c1e]">{new Date(job.created_at).toLocaleString("ko-KR")}</span></div>
          {job.screenshots && job.screenshots.length > 0 && (
            <div>
              <span className="text-[#757684] block mb-2">스크린샷 ({job.screenshots.length})</span>
              <div className="space-y-1">
                {job.screenshots.map((s, i) => (
                  <div key={i} className="text-xs text-[#444653]">{i + 1}. {s.description}</div>
                ))}
              </div>
            </div>
          )}
          {job.error_message && (
            <div className="p-3 bg-[#ffdad6] rounded-lg text-xs text-[#ba1a1a]">{job.error_message}</div>
          )}
        </div>
      )}

      {activeSection === "draft" && (() => {
        if (job.status === "pending" || job.status === "running") {
          return (
            <div className="flex items-center gap-3 p-4 bg-[#d5e3fc] rounded-xl text-sm text-[#00288e]">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              매뉴얼 생성 중입니다. 잠시 후 다시 확인해주세요.
            </div>
          )
        }
        if (job.status === "failed") {
          return (
            <div className="p-4 bg-[#ffdad6] rounded-xl text-sm text-[#ba1a1a]">
              매뉴얼 생성에 실패했습니다.
              {job.error_message && <pre className="mt-2 text-xs whitespace-pre-wrap">{job.error_message}</pre>}
            </div>
          )
        }
        const a = job.approval
        const c = job.proposed_change
        if (!a || !c) {
          return <p className="text-sm text-[#9a9bad]">AI 초안 데이터가 없습니다.</p>
        }
        if (a.status === "pending" || a.status === "needs_review") {
          return (
            <ApprovalReviewPanel
              key={a.id}
              approval={{ id: a.id, status: a.status, approval_type: a.approval_type, comment: a.comment, proposed_change: c }}
              reviewerId={user?.id ?? "00000000-0000-0000-0000-000000000001"}
              variant="playwright"
              onReviewed={onRefetch}
            />
          )
        }
        if (a.status === "approved") {
          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-[#dcfce7] rounded-lg">
                <span className="text-sm font-medium text-[#15803d]">승인 완료. 문서가 생성되었습니다.</span>
                {job.output_document_id && (
                  <a
                    href={`/documents/${job.output_document_id}`}
                    className="text-sm text-[#00288e] hover:underline"
                  >
                    문서 관리에서 열기 →
                  </a>
                )}
              </div>
              <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.proposed_text}</ReactMarkdown>
              </div>
            </div>
          )
        }
        if (a.status === "rejected") {
          return (
            <div className="space-y-4">
              <div className="p-3 bg-[#fce4ec] rounded-lg">
                <p className="text-sm font-medium text-[#c62828]">반려됨</p>
                {a.comment && <p className="mt-1 text-xs text-[#444653]">{a.comment}</p>}
              </div>
              <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 prose prose-sm max-w-none opacity-70">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.proposed_text}</ReactMarkdown>
              </div>
            </div>
          )
        }
        return null
      })()}

      {activeSection === "history" && (
        <ChangeHistoryTimeline entityType="manual" entityId={job.id} />
      )}
    </div>
  )
}
