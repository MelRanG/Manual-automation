import { useState, useEffect } from "react"
import { api, type FeedbackReport, type ProposedChange, type ChangeHistory } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"
import { ChangeHistoryTimeline } from "@/components/ChangeHistoryTimeline"

type Tab = "all" | "review" | "done"

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-[#fff3dc] text-[#92600a]",
  processed: "bg-[#dcfce7] text-[#15803d]",
}
const STATUS_LABEL: Record<string, string> = {
  pending: "검토요청",
  processed: "완료",
}

export function Feedback() {
  const [tab, setTab] = useState<Tab>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: allItems, loading, refetch } = useApi(
    () => api.listFeedbackByStatus(),
    []
  )

  const items = allItems ?? []

  const filtered = items.filter(f => {
    if (tab === "all") return true
    if (tab === "review") return f.status === "pending"
    if (tab === "done") return f.status === "processed"
    return true
  })

  const selected = items.find(f => f.id === selectedId) ?? null
  const reviewCount = items.filter(f => f.status === "pending").length

  return (
    <div className="flex h-full">
      <div className="w-[380px] border-r border-[#e0e3e5] flex flex-col shrink-0">
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-base font-bold text-[#191c1e] mb-3">오류 제보</h2>
          <div className="flex gap-1 border-b border-[#e0e3e5]">
            {([["all", "전체"], ["review", "검토요청"], ["done", "완료"]] as [Tab, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedId(null) }}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  tab === t ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"
                }`}
              >
                {label}
                {t === "review" && reviewCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#00288e] text-white text-[10px] font-bold">{reviewCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#f2f4f6]">
          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-[#9a9bad]">로딩 중...</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[#9a9bad]">항목이 없습니다</div>
          ) : (
            filtered.map(item => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`w-full text-left px-5 py-4 hover:bg-[#f7f9fb] transition-colors ${selectedId === item.id ? "bg-[#eef2ff]" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[#191c1e] truncate flex-1 leading-snug">
                    {item.feedback_text.slice(0, 60)}{item.feedback_text.length > 60 ? "…" : ""}
                  </p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[item.status] ?? "bg-[#f2f4f6] text-[#757684]"}`}>
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </div>
                {item.document_title && (
                  <p className="text-xs text-[#9a9bad] mt-1 truncate">{item.document_title}</p>
                )}
                <p className="text-xs text-[#9a9bad] mt-0.5">{new Date(item.created_at).toLocaleDateString("ko-KR")}</p>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <FeedbackDetail
            key={selected.id}
            item={selected}
            onRefetch={refetch}
            onDelete={() => { setSelectedId(null); refetch() }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-[#9a9bad]">
            목록에서 항목을 선택하세요
          </div>
        )}
      </div>
    </div>
  )
}

function FeedbackDetail({ item, onRefetch, onDelete }: {
  item: FeedbackReport
  onRefetch: () => void
  onDelete: () => void
}) {
  const [activeSection, setActiveSection] = useState<"info" | "draft" | "history">("info")
  const [reviewedText, setReviewedText] = useState(item.reviewed_text ?? item.feedback_text)
  const [requesting, setRequesting] = useState(false)
  const [linkQuery, setLinkQuery] = useState("")
  const [linkDocId, setLinkDocId] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const { data: allDocs } = useApi(() => api.listDocuments(0, 200), [])
  const { data: proposal, loading: proposalLoading, refetch: refetchProposal } = useApi<ProposedChange>(
    () => api.getFeedbackProposal(item.id),
    [item.id]
  )

  const { user } = useAuth()
  const reviewerId = user?.id ?? "00000000-0000-0000-0000-000000000001"
  const [editedText, setEditedText] = useState("")
  const [applying, setApplying] = useState(false)
  const { data: history, loading: historyLoading } = useApi<ChangeHistory[]>(
    () => api.listHistory("feedback", item.id),
    [item.id]
  )


  useEffect(() => {
    if (proposal) setEditedText(proposal.proposed_text)
  }, [proposal?.id])

  async function handleDelete() {
    if (!confirm("이 피드백을 삭제하시겠습니까?")) return
    const res = await api.deleteFeedback(item.id)
    if (res.ok || res.status === 204) {
      onDelete()
    }
  }

  async function handleApplyDraft() {
    if (!proposal) return
    setApplying(true)
    try {
      await api.applyFeedbackDraft(item.id, {
        action: "apply",
        edited_text: editedText !== proposal.proposed_text ? editedText : undefined,
        reviewer_id: reviewerId,
      })
      await refetchProposal()
      onRefetch()
    } finally {
      setApplying(false)
    }
  }

  async function handleRejectDraft() {
    if (!proposal) return
    setApplying(true)
    try {
      await api.applyFeedbackDraft(item.id, { action: "reject", reviewer_id: reviewerId })
      await refetchProposal()
      onRefetch()
    } finally {
      setApplying(false)
    }
  }

  async function handleRegenerateDraft() {
    setRequesting(true)
    try {
      await api.deleteFeedbackProposal(item.id)
      await api.requestDraft(item.id, reviewedText)
      await refetchProposal()
      onRefetch()
      setActiveSection("draft")
    } finally {
      setRequesting(false)
    }
  }


  async function handleRequestDraft() {
    setRequesting(true)
    try {
      await api.requestDraft(item.id, reviewedText)
      await refetchProposal()
      onRefetch()
      setActiveSection("draft")
    } finally {
      setRequesting(false)
    }
  }

  async function handleLinkDocument() {
    if (!linkDocId) return
    setLinking(true)
    try {
      await api.linkDocument(item.id, linkDocId)
      setLinkQuery("")
      setLinkDocId(null)
      onRefetch()
    } finally {
      setLinking(false)
    }
  }

  const filteredDocs = (allDocs?.documents ?? []).filter(d =>
    d.title.toLowerCase().includes(linkQuery.toLowerCase())
  )

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-[#191c1e] flex-1">오류 제보 상세</h3>
        <span className={`text-xs font-medium px-2.5 py-1 border-l-2 ${
          item.status === "processed"
            ? "border-[#15803d] bg-[#dcfce7] text-[#15803d]"
            : "border-[#92600a] bg-[#fff3dc] text-[#92600a]"
        }`}>
          {item.status === "processed" ? "완료" : "검토요청"}
        </span>
      </div>

      {(() => {
        const tabDisabled: Record<"info" | "draft" | "history", boolean> = {
          info: false,
          draft: !proposalLoading && !proposal,
          history: !historyLoading && (!history || history.length === 0),
        }
        return (
          <div className="flex gap-1 border-b border-[#e0e3e5] mb-5">
            {([["info", "요청 정보"], ["draft", "AI 수정 초안"], ["history", "변경 이력"]] as ["info" | "draft" | "history", string][]).map(([s, label]) => (
              <button
                key={s}
                onClick={() => { if (!tabDisabled[s]) setActiveSection(s) }}
                disabled={tabDisabled[s]}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tabDisabled[s]
                    ? "border-transparent text-[#9a9bad] cursor-not-allowed opacity-40"
                    : activeSection === s
                      ? "border-[#00288e] text-[#00288e]"
                      : "border-transparent text-[#757684] hover:text-[#191c1e]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )
      })()}

      {activeSection === "info" && (
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-[#757684] mb-1">제보 내용</p>
            <p className="text-[#191c1e] whitespace-pre-wrap bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5]">{item.feedback_text}</p>
          </div>
          {item.document_title && (
            <div><span className="text-[#757684] w-24 inline-block text-xs">관련 문서</span><span className="text-[#191c1e]">{item.document_title}</span></div>
          )}
          <div><span className="text-[#757684] w-24 inline-block text-xs">제보 일시</span><span className="text-[#191c1e]">{new Date(item.created_at).toLocaleString("ko-KR")}</span></div>

          {!item.document_id && (
            <div className="pt-4 border-t border-[#e0e3e5]">
              <p className="text-xs font-semibold text-[#757684] mb-2">관련 문서 연결</p>
              <p className="text-xs text-[#9a9bad] mb-3">연결된 문서가 없습니다. 문서를 연결하면 AI 초안을 요청할 수 있습니다.</p>
              <input
                type="text"
                placeholder="문서 검색..."
                value={linkQuery}
                onChange={e => { setLinkQuery(e.target.value); setLinkDocId(null) }}
                className="w-full px-3 py-2 text-sm border border-[#e0e3e5] rounded-lg focus:outline-none focus:border-[#00288e] mb-2"
              />
              {linkQuery && filteredDocs.length > 0 && (
                <ul className="border border-[#e0e3e5] rounded-lg overflow-hidden mb-2 max-h-40 overflow-y-auto">
                  {filteredDocs.slice(0, 10).map(d => (
                    <li key={d.id}>
                      <button
                        onClick={() => { setLinkDocId(d.id); setLinkQuery(d.title) }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-[#f7f9fb] transition-colors ${linkDocId === d.id ? "bg-[#eef2ff] text-[#00288e]" : "text-[#191c1e]"}`}
                      >
                        {d.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={handleLinkDocument}
                disabled={!linkDocId || linking}
                className="px-4 py-2 text-sm font-medium bg-[#00288e] text-white rounded-lg disabled:opacity-40 hover:bg-[#001f6b] transition-colors"
              >
                {linking ? "연결 중..." : "문서 연결"}
              </button>
            </div>
          )}

          {item.document_id && (
            <div className="pt-4 border-t border-[#e0e3e5]">
              <p className="text-xs font-semibold text-[#757684] mb-2">관리자 검토 내용</p>
              {proposal ? (
                <>
                  <p className="text-sm text-[#444653] bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5] whitespace-pre-wrap">
                    {item.reviewed_text ?? item.feedback_text}
                  </p>
                  <p className="text-xs text-[#9a9bad] mt-2">
                    초안이 생성되었습니다.{" "}
                    <button onClick={() => setActiveSection("draft")} className="text-[#00288e] underline">
                      AI 수정 초안 보기
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <textarea
                    value={reviewedText}
                    onChange={e => setReviewedText(e.target.value)}
                    rows={5}
                    className="w-full px-3 py-2 text-sm border border-[#e0e3e5] rounded-lg focus:outline-none focus:border-[#00288e] resize-none"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={handleRequestDraft}
                      disabled={requesting || !reviewedText.trim()}
                      className="px-4 py-2 text-sm font-medium bg-[#00288e] text-white rounded-lg disabled:opacity-40 hover:bg-[#001f6b] transition-colors"
                    >
                      {requesting ? "초안 생성 중..." : "AI 초안 요청 →"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="pt-4 border-t border-[#e0e3e5]">
            <button
              onClick={handleDelete}
              className="text-xs text-[#dc2626] hover:text-[#991b1b] underline"
            >
              이 피드백 삭제
            </button>
          </div>
        </div>
      )}

      {activeSection === "draft" && (
        <div>
          {proposal ? (
            <div className="space-y-4">
              {proposal.is_stale && (
                <div className="bg-[#fff3dc] border border-[#fcd34d] rounded-lg p-3 flex items-center gap-2">
                  <span className="text-sm text-[#92600a]">이 초안은 생성 이후 문서가 변경되었습니다.</span>
                  <button
                    onClick={handleRegenerateDraft}
                    disabled={requesting}
                    className="text-xs text-[#00288e] underline shrink-0"
                  >
                    {requesting ? "재생성 중..." : "초안 재생성"}
                  </button>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-[#757684] mb-2">AI 수정 근거</p>
                <p className="text-sm text-[#444653] bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5]">{proposal.reasoning}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#757684] mb-2">기존 내용</p>
                <pre className="text-xs text-[#444653] bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5] whitespace-pre-wrap overflow-auto max-h-48">{proposal.original_text}</pre>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#757684] mb-2">수정 제안</p>
                <textarea
                  value={editedText}
                  onChange={e => setEditedText(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 text-xs font-mono border border-[#e0e3e5] rounded-lg focus:outline-none focus:border-[#00288e] resize-none bg-[#f0fdf4]"
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-[#757684]">
                <span>신뢰도</span>
                <div className="flex-1 bg-[#e0e3e5] rounded-full h-1.5">
                  <div className="bg-[#00288e] h-1.5 rounded-full" style={{ width: `${Math.round(proposal.confidence * 100)}%` }} />
                </div>
                <span>{Math.round(proposal.confidence * 100)}%</span>
              </div>
              {!proposal.is_stale && (
                <div className="flex gap-2 pt-2 border-t border-[#e0e3e5]">
                  <button
                    onClick={handleApplyDraft}
                    disabled={applying}
                    className="px-4 py-2 text-sm font-medium bg-[#00288e] text-white rounded-lg disabled:opacity-40 hover:bg-[#001f6b] transition-colors"
                  >
                    {applying ? "처리 중..." : "문서에 반영"}
                  </button>
                  <button
                    onClick={handleRejectDraft}
                    disabled={applying}
                    className="px-4 py-2 text-sm font-medium border border-[#dc2626] text-[#dc2626] rounded-lg disabled:opacity-40 hover:bg-[#fef2f2] transition-colors"
                  >
                    반영 안함
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-[#9a9bad]">AI 수정 초안이 없습니다.</div>
          )}
        </div>
      )}

      {activeSection === "history" && (
        <div className="space-y-4">
          {item.reviewed_text && item.reviewed_text !== item.feedback_text && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-[#757684] mb-2">원본 제보 내용</p>
              <p className="text-sm text-[#444653] bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5] whitespace-pre-wrap">{item.feedback_text}</p>
              <p className="text-xs font-semibold text-[#757684] mt-3 mb-2">관리자 수정 내용</p>
              <p className="text-sm text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap">{item.reviewed_text}</p>
            </div>
          )}
          <ChangeHistoryTimeline
            entityType="feedback"
            entityId={item.id}
            events={history}
            loading={historyLoading}
          />
        </div>
      )}
    </div>
  )
}
