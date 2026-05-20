import { useState } from "react"
import { api, type SRDraft, type Document, type ChangeProposal } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"
import { ChangeHistoryTimeline } from "@/components/ChangeHistoryTimeline"

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
  const [showCreate, setShowCreate] = useState(false)

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("medium")
  const [targetUrl, setTargetUrl] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const userId = user?.id ?? "00000000-0000-0000-0000-000000000001"

  const { data: result, refetch } = useApi(
    () => api.listSRDrafts({ status: tab === "all" ? undefined : tab, skip: 0, limit: 500 }),
    [tab]
  )

  const allItems = result?.items ?? []

  const filtered = allItems.filter(sr => {
    if (sourceFilter === "direct") return !sr.created_by_ai
    if (sourceFilter === "chatbot") return sr.created_by_ai
    return true
  })

  const selected = allItems.find(s => s.id === selectedId) ?? null

  const tabCount = (t: Tab) => {
    if (t === "all") return allItems.length
    return allItems.filter(s => s.status === t).length
  }

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) return
    setSubmitting(true)
    try {
      const normalizedUrl = targetUrl.trim()
        ? (targetUrl.trim().startsWith("http") ? targetUrl.trim() : `https://${targetUrl.trim()}`)
        : undefined
      await api.createSRDraft({ user_id: userId, title, description, priority, target_url: normalizedUrl })
      setTitle(""); setDescription(""); setTargetUrl(""); setShowCreate(false)
      refetch()
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
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-xs hover:bg-[#f2f4f6]">취소</button>
              <button onClick={handleCreate} disabled={!title.trim() || !description.trim() || submitting} className="px-3 py-1.5 bg-[#00288e] text-white rounded-lg text-xs font-medium hover:bg-[#1e40af] disabled:opacity-50">
                {submitting ? "제출 중..." : "SR 생성"}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-[#f2f4f6]">
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[#9a9bad]">항목이 없습니다</div>
          ) : (
            filtered.map(sr => (
              <button
                key={sr.id}
                onClick={() => setSelectedId(sr.id)}
                className={`w-full text-left px-5 py-4 hover:bg-[#f7f9fb] transition-colors ${selectedId === sr.id ? "bg-[#eef2ff]" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[#191c1e] truncate flex-1">{sr.title}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[sr.status] ?? "bg-[#f2f4f6] text-[#757684]"}`}>
                    {TAB_LABELS[sr.status as Tab] ?? sr.status}
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
        {selected ? (
          <SRDetail sr={selected} onRefetch={refetch} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-[#9a9bad]">
            목록에서 항목을 선택하세요
          </div>
        )}
      </div>
    </div>
  )
}

function SRDetail({ sr, onRefetch }: { sr: SRDraft; onRefetch: () => void }) {
  const [activeSection, setActiveSection] = useState<"info" | "review" | "history">("info")
  const [submittingId, setSubmittingId] = useState(false)

  const { data: docData } = useApi(() => api.listDocuments(0, 500), [])
  const docs = docData?.documents ?? []

  const handleSubmitSR = async () => {
    setSubmittingId(true)
    try {
      await api.submitSR(sr.id)
      onRefetch()
    } finally {
      setSubmittingId(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-[#191c1e] flex-1">{sr.title}</h3>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_BADGE[sr.status] ?? "bg-[#f2f4f6] text-[#757684]"}`}>
          {TAB_LABELS[sr.status as Tab] ?? sr.status}
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
                {sr.jira_issue_url ? (
                  <a href={sr.jira_issue_url} target="_blank" rel="noopener noreferrer" className="text-[#00288e] hover:underline block mt-0.5">{sr.jira_issue_key}</a>
                ) : (
                  <p className="text-[#191c1e] mt-0.5">{sr.jira_issue_key}</p>
                )}
              </div>
            )}
            {sr.target_url && (
              <div><span className="text-[#757684] text-xs">대상 URL</span><a href={sr.target_url} target="_blank" rel="noopener noreferrer" className="text-[#00288e] hover:underline block mt-0.5 truncate">{sr.target_url}</a></div>
            )}
          </div>
          {sr.status === "draft" && (
            <div className="pt-2">
              <button onClick={handleSubmitSR} disabled={submittingId} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50">
                {submittingId ? "제출 중..." : "SR 제출"}
              </button>
            </div>
          )}
        </div>
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
  const [proposal, setProposal] = useState<ChangeProposal | null>(null)
  const [applying, setApplying] = useState(false)

  if (sr.status !== "pending_doc_review") {
    return (
      <div className="text-sm text-[#9a9bad] py-4">
        {sr.status === "done"
          ? "이 SR은 이미 완료되었습니다."
          : "Jira 이슈가 완료된 후 검토 단계가 활성화됩니다."}
      </div>
    )
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
          <p className="text-sm font-medium text-[#191c1e]">문서 반영 방식을 선택하세요</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setDocMode("new"); setStep(3) }}
              className="p-4 border-2 border-[#c4c5d5] rounded-xl text-left hover:border-[#00288e] transition-colors group"
            >
              <p className="text-sm font-semibold text-[#191c1e] group-hover:text-[#00288e]">신규 문서 작성</p>
              <p className="text-xs text-[#757684] mt-1">새 문서를 생성합니다</p>
            </button>
            <button
              onClick={() => { setDocMode("existing"); setStep(2) }}
              className="p-4 border-2 border-[#c4c5d5] rounded-xl text-left hover:border-[#00288e] transition-colors group"
            >
              <p className="text-sm font-semibold text-[#191c1e] group-hover:text-[#00288e]">기존 문서 수정</p>
              <p className="text-xs text-[#757684] mt-1">기존 문서에 반영합니다</p>
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
            {filteredDocs.map(doc => (
              <button
                key={doc.id}
                onClick={() => setSelectedDocId(doc.id)}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-[#f7f9fb] transition-colors ${selectedDocId === doc.id ? "bg-[#eef2ff]" : ""}`}
              >
                <p className="font-medium text-[#191c1e]">{doc.title}</p>
                {doc.description && <p className="text-xs text-[#757684] mt-0.5 truncate">{doc.description}</p>}
              </button>
            ))}
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
                  try {
                    const analysis = await api.analyzeImpact({
                      source_type: "jira_sr",
                      source_id: sr.id,
                      related_document_ids: selectedDocId ? [selectedDocId] : undefined,
                    })
                    if (selectedDocId) {
                      const cp = await api.generateProposalForDocument(analysis.id, selectedDocId, analysis.recommended_strategy || "update")
                      setProposal(cp)
                    } else {
                      // 신규 문서: proposal 없이 reasoning만 표시
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
                  } catch {
                    // 에러 시 UI에서 재시도 가능
                  } finally {
                    setGenerating(false)
                  }
                }}
                disabled={generating}
                className="px-5 py-2 bg-[#4a4bdc] text-white rounded-lg text-sm font-medium hover:bg-[#3b3cd0] disabled:opacity-50"
              >
                {generating ? "생성 중..." : "AI 초안 생성"}
              </button>
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
                      await api.updateSRDraft(sr.id, { status: "done" })
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
