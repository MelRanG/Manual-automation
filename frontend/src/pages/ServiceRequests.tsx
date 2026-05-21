import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api, type SRDraft, type Document, type ChangeProposal, type AiDocRecommendation } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"
import { ChangeHistoryTimeline } from "@/components/ChangeHistoryTimeline"

const isRealJiraLink = (sr: SRDraft) =>
  Boolean(
    sr.jira_issue_key &&
    sr.jira_issue_url &&
    !sr.jira_issue_key.startsWith("LOCAL-") &&
    !sr.jira_issue_url.includes("localhost")
  )

type Tab = "all" | "draft" | "active" | "pending_doc_review" | "done"
type SourceFilter = "all" | "direct" | "chatbot"
type ReviewStep = 1 | 2 | 3
type DocMode = "new" | "existing" | null

const TAB_LABELS: Record<Tab, string> = {
  all: "전체",
  draft: "SR요청 대기",
  active: "SR 진행중",
  pending_doc_review: "검토",
  done: "완료",
}

const TAB_STATUSES: Record<Exclude<Tab, "all">, string[]> = {
  draft: ["draft"],
  active: ["submitted", "jira_created", "pending_document_selection"],
  pending_doc_review: ["pending_doc_review"],
  done: ["done_synced", "done_no_proposal", "done"],
}

const statusToTab = (status: string): Tab => {
  for (const [tab, statuses] of Object.entries(TAB_STATUSES)) {
    if (statuses.includes(status)) return tab as Tab
  }
  return "all"
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-[#f2f4f6] text-[#444653]",
  active: "bg-[#d5e3fc] text-[#00288e]",
  pending_doc_review: "bg-[#fff3dc] text-[#92600a]",
  done: "bg-[#dcfce7] text-[#15803d]",
}

export function ServiceRequests() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>("all")
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedSR, setSelectedSR] = useState<SRDraft | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("medium")
  const [targetUrl, setTargetUrl] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Always fetch all items for accurate tab counts and client-side filtering
  const { data: srResult, refetch } = useApi(
    () => api.listSRDrafts({ skip: 0, limit: 500 }),
    []
  )
  const allSRs = srResult?.items ?? []

  const displayItems = allSRs.filter(sr => {
    const tabMatch = tab === "all" || TAB_STATUSES[tab as Exclude<Tab, "all">]?.includes(sr.status)
    const sourceMatch =
      sourceFilter === "all" ||
      (sourceFilter === "direct" ? !sr.created_by_ai : sr.created_by_ai)
    return tabMatch && sourceMatch
  })

  const tabCount = (t: Tab) => t === "all" ? allSRs.length : allSRs.filter(s => TAB_STATUSES[t]?.includes(s.status)).length

  const { data: docsResult } = useApi(() => api.listDocuments(0, 500), [])
  const docs = docsResult?.documents ?? []

  const handleCreate = async () => {
    if (!user?.id) return
    if (!title.trim() || !description.trim()) return
    setSubmitting(true)
    setCreateError(null)
    try {
      const normalizedUrl = targetUrl.trim()
        ? (targetUrl.trim().startsWith("http") ? targetUrl.trim() : `https://${targetUrl.trim()}`)
        : undefined
      await api.createSRDraft({ user_id: user.id, title, description, priority, target_url: normalizedUrl })
      setTitle(""); setDescription(""); setTargetUrl(""); setShowCreate(false)
      refetch()
    } catch {
      setCreateError("SR 생성에 실패했습니다.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full">
      <div className="w-[400px] border-r border-[#e0e3e5] flex flex-col shrink-0">
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#191c1e]">Jira SR</h2>
            <button
              onClick={() => setShowCreate(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00288e] text-white rounded-lg text-xs font-medium hover:bg-[#1e40af] transition-colors"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              신규 SR
            </button>
          </div>

          <div className="flex gap-0.5 border-b border-[#e0e3e5] overflow-x-auto">
            {(["all", "draft", "active", "pending_doc_review", "done"] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedId(null) }}
                className={`px-2.5 py-2 text-xs font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  tab === t ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"
                }`}
              >
                {TAB_LABELS[t]}
                {t !== "all" && tabCount(t) > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${t === "pending_doc_review" ? "bg-[#92600a] text-white" : "bg-[#e0e3e5] text-[#444653]"}`}>
                    {tabCount(t)}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex gap-1.5 mt-2">
            {([["all", "전체"], ["direct", "직접생성"], ["chatbot", "챗봇"]] as [SourceFilter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setSourceFilter(f)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  sourceFilter === f ? "bg-[#00288e] text-white" : "bg-[#f2f4f6] text-[#757684] hover:bg-[#e0e3e5]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {showCreate && (
          <div className="mx-4 mb-3 p-4 border border-[#c4c5d5] rounded-xl bg-white space-y-3 text-sm">
            <input className="w-full px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-sm outline-none focus:border-[#00288e]" placeholder="제목 *" value={title} onChange={e => setTitle(e.target.value)} />
            <textarea className="w-full px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-sm outline-none focus:border-[#00288e] resize-none" rows={3} placeholder="내용 *" value={description} onChange={e => setDescription(e.target.value)} />
            <div className="flex gap-2">
              <select className="flex-1 px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-sm outline-none" value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="low">낮음</option>
                <option value="medium">보통</option>
                <option value="high">높음</option>
              </select>
              <input className="flex-1 px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-sm outline-none focus:border-[#00288e]" placeholder="관련 URL (선택)" value={targetUrl} onChange={e => setTargetUrl(e.target.value)} />
            </div>
            {createError && <p className="text-red-500 text-xs">{createError}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-xs hover:bg-[#f2f4f6]">취소</button>
              <button onClick={handleCreate} disabled={!title.trim() || !description.trim() || submitting} className="px-3 py-1.5 bg-[#00288e] text-white rounded-lg text-xs font-medium hover:bg-[#1e40af] disabled:opacity-50">
                {submitting ? "제출 중..." : "SR 생성"}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-[#f2f4f6]">
          {displayItems.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[#9a9bad]">항목이 없습니다</div>
          ) : (
            displayItems.map(sr => (
              <button
                key={sr.id}
                onClick={() => { setSelectedId(sr.id); setSelectedSR(sr) }}
                className={`w-full text-left px-5 py-4 hover:bg-[#f7f9fb] transition-colors ${selectedId === sr.id ? "bg-[#eef2ff]" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[#191c1e] truncate flex-1">{sr.title}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[statusToTab(sr.status)] ?? "bg-[#f2f4f6] text-[#757684]"}`}>
                    {TAB_LABELS[statusToTab(sr.status)]}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${sr.created_by_ai ? "bg-[#f0f0ff] text-[#4a4bdc]" : "bg-[#f2f4f6] text-[#757684]"}`}>
                    {sr.created_by_ai ? "챗봇" : "직접생성"}
                  </span>
                  <span className="text-[10px] text-[#757684]">요청자: {sr.user_id.slice(0, 8)}</span>
                  {sr.jira_issue_key && (
                    <span className="text-[10px] text-[#757684] font-mono">{sr.jira_issue_key}</span>
                  )}
                  <span className="text-[10px] text-[#9a9bad] ml-auto">{new Date(sr.created_at).toLocaleDateString("ko-KR")}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedSR ? (
          <SRDetail key={selectedSR.id} sr={selectedSR} onRefetch={refetch} docs={docs} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-[#9a9bad]">
            목록에서 항목을 선택하세요
          </div>
        )}
      </div>
    </div>
  )
}

function SRDetail({ sr, onRefetch, docs }: { sr: SRDraft; onRefetch: () => void; docs: Document[] }) {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<"info" | "review" | "history">("info")
  const [submittingId, setSubmittingId] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ title: sr.title, description: sr.description, priority: sr.priority })
  const [saving, setSaving] = useState(false)

  const handleSubmitSR = async () => {
    setSubmittingId(true)
    setSubmitError(null)
    try {
      await api.submitSR(sr.id)
      onRefetch()
    } catch {
      setSubmitError("SR 제출에 실패했습니다.")
    } finally {
      setSubmittingId(false)
    }
  }

  const handleLocalComplete = async () => {
    setSubmittingId(true)
    try {
      await api.completeSRLocal(sr.id)
      onRefetch()
      setActiveSection("review")
    } catch (e) {
      setSubmitError("완료 처리에 실패했습니다: " + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmittingId(false)
    }
  }

  const handleEditSave = async () => {
    if (!editForm.title.trim() || !editForm.description.trim()) return
    setSaving(true)
    try {
      await api.updateSRDraft(sr.id, editForm)
      setEditing(false)
      onRefetch()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-[#191c1e] flex-1">{sr.title}</h3>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_BADGE[statusToTab(sr.status)] ?? "bg-[#f2f4f6] text-[#757684]"}`}>
          {TAB_LABELS[statusToTab(sr.status)]}
        </span>
        <span className={`text-xs px-2 py-1 rounded-full ${sr.created_by_ai ? "bg-[#f0f0ff] text-[#4a4bdc]" : "bg-[#f2f4f6] text-[#757684]"}`}>
          {sr.created_by_ai ? "챗봇" : "직접생성"}
        </span>
      </div>

      <div className="flex gap-1 border-b border-[#e0e3e5] mb-5">
        {([["info", "요청 정보"], ["review", "검토"], ["history", "변경 이력"]] as ["info" | "review" | "history", string][]).map(([s, label]) => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeSection === s ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"}`}>
            {label}
            {s === "review" && sr.status === "pending_doc_review" && (
              <span className="ml-1.5 w-2 h-2 rounded-full bg-[#f59e0b] inline-block" />
            )}
          </button>
        ))}
      </div>

      {activeSection === "info" && (
        <>
          {editing ? (
            <div className="space-y-3 text-sm">
              <input
                className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
                value={editForm.title}
                onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
              />
              <textarea
                className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
                rows={3}
                value={editForm.description}
                onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
              />
              <select
                className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none bg-white"
                value={editForm.priority}
                onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}
              >
                <option value="lowest">최저</option>
                <option value="low">낮음</option>
                <option value="medium">보통</option>
                <option value="high">높음</option>
                <option value="critical">긴급</option>
              </select>
              <div className="flex gap-2">
                <button onClick={handleEditSave} disabled={saving} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors">
                  {saving ? "저장 중..." : "저장"}
                </button>
                <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold text-[#757684] mb-1">내용</p>
                <p className="text-[#191c1e] whitespace-pre-wrap bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5]">{sr.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-[#757684] text-xs">요청자</span><p className="text-[#191c1e] mt-0.5 font-mono text-xs">{sr.user_id.slice(0, 8)}</p></div>
                <div><span className="text-[#757684] text-xs">요청 일시</span><p className="text-[#191c1e] mt-0.5">{new Date(sr.created_at).toLocaleString("ko-KR")}</p></div>
                <div><span className="text-[#757684] text-xs">우선순위</span><p className="text-[#191c1e] mt-0.5 capitalize">{sr.priority}</p></div>
                {sr.jira_issue_key && (
                  <div><span className="text-[#757684] text-xs">Jira 이슈</span>
                    {isRealJiraLink(sr) ? (
                      <a href={sr.jira_issue_url!} target="_blank" rel="noopener noreferrer" className="text-[#00288e] hover:underline block mt-0.5">{sr.jira_issue_key}</a>
                    ) : (
                      <p className="text-[#757684] mt-0.5 text-xs" title="Jira가 연결되지 않아 로컬 시뮬레이션 키입니다">{sr.jira_issue_key} (시뮬레이션)</p>
                    )}
                  </div>
                )}
                {sr.target_url && (
                  <div><span className="text-[#757684] text-xs">대상 URL</span><a href={sr.target_url} target="_blank" rel="noopener noreferrer" className="text-[#00288e] hover:underline block mt-0.5 truncate">{sr.target_url}</a></div>
                )}
              </div>
              <div className="pt-2 flex flex-wrap gap-2">
                {sr.status === "draft" && (
                  <>
                    <button onClick={() => setEditing(true)} className="flex items-center gap-1 px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#444653] hover:bg-[#f2f4f6] transition-colors">
                      <span className="material-symbols-outlined text-base">edit</span>
                      수정
                    </button>
                    <button onClick={handleSubmitSR} disabled={submittingId} className="flex items-center gap-2 px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50">
                      <span className="material-symbols-outlined text-base">send</span>
                      {submittingId ? "제출 중..." : "SR 제출"}
                    </button>
                  </>
                )}
                {["submitted", "jira_created"].includes(sr.status) && (
                  <button
                    onClick={handleLocalComplete}
                    disabled={submittingId}
                    className="flex items-center gap-2 px-3 py-1.5 border border-[#1a56db] text-[#1a56db] rounded-lg text-xs font-semibold hover:bg-[#e8f0fe] disabled:opacity-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    {submittingId ? "처리 중..." : "완료 처리 (시뮬레이터)"}
                  </button>
                )}
                {sr.status === "pending_document_selection" && (
                  <button
                    onClick={() => navigate("/change-impact")}
                    className="flex items-center gap-2 px-3 py-1.5 border border-[#e6a817] text-[#92600a] rounded-lg text-xs font-semibold hover:bg-[#fff3dc] transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    문서 반영 대기 →
                  </button>
                )}
              </div>
              {submitError && <p className="text-red-500 text-xs">{submitError}</p>}
            </div>
          )}
        </>
      )}

      {activeSection === "review" && (
        <SRReview sr={sr} docs={docs} onRefetch={onRefetch} />
      )}

      {activeSection === "history" && (
        <ChangeHistoryTimeline entityType="sr" entityId={sr.id} />
      )}
    </div>
  )
}

function SRReview({ sr, docs, onRefetch }: { sr: SRDraft; docs: Document[]; onRefetch: () => void }) {
  const [step, setStep] = useState<ReviewStep>(1)
  const [docMode, setDocMode] = useState<DocMode>(null)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [docQuery, setDocQuery] = useState("")
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<ChangeProposal | null>(null)
  const [applying, setApplying] = useState(false)
  const [confirmingNone, setConfirmingNone] = useState(false)
  const [savingNone, setSavingNone] = useState(false)
  const [noneError, setNoneError] = useState<string | null>(null)
  const [recommendation, setRecommendation] = useState<AiDocRecommendation | null>(null)
  const [recLoading, setRecLoading] = useState(false)
  const [recError, setRecError] = useState<string | null>(null)

  useEffect(() => {
    if (sr.status !== "pending_doc_review") return
    let ignore = false
    ;(async () => {
      // 1. latest-proposal로 이전 상태 복원
      const latest = await api.getLatestProposal(sr.id).catch(() => null)
      if (ignore) return
      let restoredDocId: string | null = null
      if (latest) {
        setDocMode(latest.doc_mode_hint as DocMode)
        if (latest.proposal?.document_id) {
          setSelectedDocId(latest.proposal.document_id)
          restoredDocId = latest.proposal.document_id
        }
        if (latest.proposal) setProposal(latest.proposal)
        setStep(3)
      }

      // 2. AI 추천 — 캐시 우선
      setRecLoading(true)
      let rec: AiDocRecommendation | null = null
      try {
        rec = await api.getAiDocRecommendation(sr.id)
        if (!rec) rec = await api.postAiDocRecommendation(sr.id)
      } catch (e) {
        if (!ignore) setRecError(e instanceof Error ? e.message : "AI 추천 사용 불가")
      } finally {
        if (!ignore) setRecLoading(false)
      }
      if (ignore) return
      setRecommendation(rec)
      if (
        !restoredDocId &&
        rec?.recommendation === "existing" &&
        rec.suggested_document_id
      ) {
        setSelectedDocId(rec.suggested_document_id)
      }
    })()
    return () => { ignore = true }
  }, [sr.id, sr.status])

  const handleSelectNone = () => {
    setConfirmingNone(true)
  }

  const handleConfirmNone = async () => {
    setSavingNone(true)
    setNoneError(null)
    try {
      await api.updateSRDraft(sr.id, { status: "done_no_proposal" })
      onRefetch()
      setConfirmingNone(false)
    } catch (e) {
      setNoneError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingNone(false)
    }
  }

  if (sr.status !== "pending_doc_review") {
    let message: string
    if (sr.status === "done_no_proposal") {
      message = "이 SR은 문서 수정 없이 종료되었습니다."
    } else if (sr.status === "done_synced" || sr.status === "done") {
      message = "이 SR은 이미 완료되었습니다."
    } else {
      message = "Jira 이슈가 완료된 후 검토 단계가 활성화됩니다."
    }
    return <div className="text-sm text-[#9a9bad] py-4">{message}</div>
  }

  const filteredDocs = docs.filter(d => d.title.toLowerCase().includes(docQuery.toLowerCase()))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {([1, 2, 3] as ReviewStep[]).map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              step > s ? "bg-[#15803d] text-white" : step === s ? "bg-[#00288e] text-white" : "bg-[#e0e3e5] text-[#9a9bad]"
            }`}>{step > s ? "✓" : s}</div>
            {s < 3 && <div className={`h-px w-8 ${step > s ? "bg-[#15803d]" : "bg-[#e0e3e5]"}`} />}
          </div>
        ))}
        <span className="ml-2 text-xs text-[#757684]">
          {step === 1 ? "반영 방식 선택" : step === 2 ? "문서 선택" : "AI 초안 검토"}
        </span>
      </div>

      {step === 1 && (
        <div className="space-y-3">
          {recLoading && (
            <div className="p-3 bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg text-xs text-[#757684]">
              AI 분석 중...
            </div>
          )}
          {!recLoading && recError && (
            <div className="p-3 bg-[#fff7f7] border border-[#fecaca] rounded-lg text-xs text-[#b91c1c] flex items-center justify-between">
              <span>AI 추천 사용 불가. 직접 선택해주세요.</span>
              <button
                onClick={async () => {
                  setRecError(null); setRecLoading(true)
                  try {
                    const r = await api.postAiDocRecommendation(sr.id, true)
                    setRecommendation(r)
                  } catch (e) {
                    setRecError(e instanceof Error ? e.message : "재시도 실패")
                  } finally { setRecLoading(false) }
                }}
                className="text-[#00288e] underline"
              >
                재시도
              </button>
            </div>
          )}
          {!recLoading && !recError && recommendation && (
            <div className="p-3 bg-[#eef2ff] border border-[#c7d2fe] rounded-lg space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[#4a4bdc]">
                  ✨ AI 추천: {recommendation.recommendation === "new" ? "신규 문서 작성"
                    : recommendation.recommendation === "existing" ? "기존 문서 수정"
                    : "문서 수정 없음"}
                </p>
                <button
                  onClick={async () => {
                    setRecLoading(true)
                    try {
                      const r = await api.postAiDocRecommendation(sr.id, true)
                      setRecommendation(r)
                    } catch (e) {
                      setRecError(e instanceof Error ? e.message : "재생성 실패")
                    } finally { setRecLoading(false) }
                  }}
                  className="text-[10px] text-[#4a4bdc] hover:underline"
                >
                  재생성
                </button>
              </div>
              <p className="text-xs text-[#444653] whitespace-pre-wrap">{recommendation.reason}</p>
            </div>
          )}

          <p className="text-sm font-medium text-[#191c1e]">문서 반영 방식을 선택하세요</p>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => { setDocMode("new"); setStep(3) }}
              className={`p-4 border-2 rounded-xl text-left hover:border-[#00288e] transition-colors group relative ${
                recommendation?.recommendation === "new" ? "border-[#4a4bdc]" : "border-[#c4c5d5]"
              }`}
            >
              {recommendation?.recommendation === "new" && (
                <span className="absolute top-2 right-2 text-[9px] font-semibold text-[#4a4bdc]">✨ 추천</span>
              )}
              <p className="text-sm font-semibold text-[#191c1e] group-hover:text-[#00288e]">신규 문서 작성</p>
              <p className="text-xs text-[#757684] mt-1">새 문서를 생성합니다</p>
            </button>
            <button
              onClick={() => { setDocMode("existing"); setStep(2) }}
              className={`p-4 border-2 rounded-xl text-left hover:border-[#00288e] transition-colors group relative ${
                recommendation?.recommendation === "existing" ? "border-[#4a4bdc]" : "border-[#c4c5d5]"
              }`}
            >
              {recommendation?.recommendation === "existing" && (
                <span className="absolute top-2 right-2 text-[9px] font-semibold text-[#4a4bdc]">✨ 추천</span>
              )}
              <p className="text-sm font-semibold text-[#191c1e] group-hover:text-[#00288e]">기존 문서 수정</p>
              <p className="text-xs text-[#757684] mt-1">기존 문서에 반영합니다</p>
            </button>
            <button
              onClick={handleSelectNone}
              className={`p-4 border-2 rounded-xl text-left hover:border-[#92600a] transition-colors group bg-[#fafafa] relative ${
                recommendation?.recommendation === "none" ? "border-[#4a4bdc]" : "border-[#c4c5d5]"
              }`}
            >
              {recommendation?.recommendation === "none" && (
                <span className="absolute top-2 right-2 text-[9px] font-semibold text-[#4a4bdc]">✨ 추천</span>
              )}
              <p className="text-sm font-semibold text-[#191c1e] group-hover:text-[#92600a]">문서 수정 없음</p>
              <p className="text-xs text-[#757684] mt-1">문서 변경 없이 SR을 종료합니다</p>
            </button>
          </div>
        </div>
      )}

      {step === 2 && docMode === "existing" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setStep(1)} className="text-xs text-[#757684] hover:text-[#191c1e]">← 뒤로</button>
            <p className="text-sm font-medium text-[#191c1e]">반영할 문서를 선택하세요</p>
          </div>
          <input
            className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm outline-none focus:border-[#00288e]"
            placeholder="문서 검색..."
            value={docQuery}
            onChange={e => setDocQuery(e.target.value)}
          />
          <div className="max-h-60 overflow-y-auto border border-[#e0e3e5] rounded-lg divide-y divide-[#f2f4f6]">
            {filteredDocs.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-[#9a9bad]">
                문서가 없습니다. 신규 문서 작성을 선택해주세요.
              </div>
            ) : (
              filteredDocs.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => setSelectedDocId(doc.id)}
                  className={`flex items-center gap-3 w-full text-left px-4 py-3 transition-colors ${
                    selectedDocId === doc.id
                      ? "bg-[#eef2ff] border-l-4 border-l-[#00288e]"
                      : "hover:bg-[#f7f9fb] border-l-4 border-l-transparent"
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-base ${
                      selectedDocId === doc.id ? "text-[#00288e]" : "text-[#9a9bad]"
                    }`}
                  >
                    {selectedDocId === doc.id ? "radio_button_checked" : "radio_button_unchecked"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[#191c1e] truncate">{doc.title}</p>
                    {doc.description && (
                      <p className="text-xs text-[#757684] truncate">{doc.description}</p>
                    )}
                  </div>
                  {recommendation?.suggested_document_id === doc.id && (
                    <span className="text-[10px] text-[#4a4bdc] shrink-0">✨ 추천</span>
                  )}
                  {selectedDocId === doc.id && (
                    <span className="text-[10px] font-semibold text-[#00288e] bg-[#e8f0fe] px-2 py-0.5 rounded-full shrink-0">
                      선택됨
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
          <button
            onClick={() => setStep(3)}
            disabled={!selectedDocId}
            className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50"
          >
            다음: AI 초안 생성
          </button>
        </div>
      )}

      {confirmingNone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-5 space-y-4">
            <h4 className="text-base font-semibold text-[#191c1e]">SR 종료 확인</h4>
            <p className="text-sm text-[#444653]">
              이 SR을 문서 수정 없이 종료 처리합니까? 이 동작은 되돌릴 수 없습니다.
            </p>
            {noneError && <p className="text-red-500 text-xs">{noneError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmingNone(false)}
                disabled={savingNone}
                className="px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm hover:bg-[#f2f4f6]"
              >
                취소
              </button>
              <button
                onClick={handleConfirmNone}
                disabled={savingNone}
                className="px-4 py-2 bg-[#92600a] text-white rounded-lg text-sm font-medium hover:bg-[#7a4f08] disabled:opacity-50"
              >
                {savingNone ? "처리 중..." : "종료 처리"}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setStep(docMode === "new" ? 1 : 2)} className="text-xs text-[#757684] hover:text-[#191c1e]">← 뒤로</button>
            <p className="text-sm font-medium text-[#191c1e]">
              {docMode === "new" ? "신규 문서 AI 초안" : `'${docs.find(d => d.id === selectedDocId)?.title}' 수정 초안`}
            </p>
          </div>
          {!proposal ? (
            <div className="text-center py-8">
              <p className="text-sm text-[#757684] mb-4">AI가 SR 내용을 바탕으로 문서 초안을 생성합니다.</p>
              <button
                onClick={async () => {
                  setGenerating(true)
                  setGenerateError(null)
                  try {
                    const analysis = await api.analyzeImpact({
                      source_type: "jira_sr",
                      source_id: sr.id,
                      related_document_ids: selectedDocId ? [selectedDocId] : undefined,
                    })
                    if (selectedDocId) {
                      const cp = await api.generateProposalForDocument(
                        analysis.id, selectedDocId, analysis.recommended_strategy || "update"
                      )
                      setProposal(cp)
                    } else {
                      setProposal({
                        id: analysis.id,
                        impact_analysis_id: analysis.id,
                        document_id: "",
                        original_content: "",
                        proposed_content: analysis.reasoning,
                        diff: "",
                        status: analysis.status,
                        created_at: analysis.created_at,
                      })
                    }
                  } catch (e) {
                    setGenerateError(e instanceof Error ? e.message : "초안 생성 실패")
                  } finally {
                    setGenerating(false)
                  }
                }}
                disabled={generating}
                className="px-5 py-2 bg-[#4a4bdc] text-white rounded-lg text-sm font-medium hover:bg-[#3b3cd0] disabled:opacity-50"
              >
                {generating ? "생성 중..." : "AI 초안 생성"}
              </button>
              {generateError && (
                <div className="mt-3 p-3 bg-[#fff7f7] border border-[#fecaca] rounded-lg text-xs text-[#b91c1c] flex items-center justify-between">
                  <span>{generateError}</span>
                  <button
                    onClick={() => setGenerateError(null)}
                    className="text-[#00288e] underline"
                  >
                    닫기
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {proposal.original_content ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[#757684] mb-2">기존 내용</p>
                    <pre className="text-xs text-[#191c1e] bg-[#fff7f7] p-3 rounded-lg border border-[#fecaca] whitespace-pre-wrap overflow-auto max-h-64">{proposal.original_content}</pre>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#757684] mb-2">AI 수정안</p>
                    <pre className="text-xs text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap overflow-auto max-h-64">{proposal.proposed_content}</pre>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-[#757684] mb-2">AI 수정 제안</p>
                  <pre className="text-xs text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap overflow-auto max-h-64">{proposal.proposed_content}</pre>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setApplying(true)
                    try {
                      await api.updateSRDraft(sr.id, { status: "done_synced" })
                      onRefetch()
                    } finally {
                      setApplying(false)
                    }
                  }}
                  disabled={applying}
                  className="px-4 py-2 bg-[#15803d] text-white rounded-lg text-sm font-medium hover:bg-[#166534] disabled:opacity-50"
                >
                  {applying ? "반영 중..." : "승인"}
                </button>
                <button onClick={() => setProposal(null)} className="px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm hover:bg-[#f2f4f6]">
                  다시 생성
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
