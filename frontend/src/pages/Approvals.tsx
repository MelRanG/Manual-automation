import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { api, type ApprovalRequest } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"

type Tab = "feedback" | "playwright"
type ReviewMode = "approve" | "reject" | "edit_and_approve" | "request_review" | null

export function Approvals() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>("feedback")
  const [statusFilter, setStatusFilter] = useState<"all" | "processing" | "completed">(() => {
    const s = searchParams.get("status")
    if (s === "processing" || s === "completed") return s
    return "all"
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewMode, setReviewMode] = useState<ReviewMode>(null)
  const [comment, setComment] = useState("")
  const [editedContent, setEditedContent] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const reviewerId = user?.id ?? "00000000-0000-0000-0000-000000000001"

  const { data: result, refetch } = useApi(
    () => api.listApprovals({ status: statusFilter, skip: (page - 1) * pageSize, limit: pageSize }),
    [statusFilter, page, pageSize]
  )

  const approvals = result?.items ?? []
  const total = result?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)

  const feedbackApprovals = approvals.filter(a => a.proposed_change?.source_type === "feedback")
  const playwrightApprovals = approvals.filter(a => a.proposed_change?.source_type === "playwright")
  const currentList = tab === "feedback" ? feedbackApprovals : playwrightApprovals

  const openReview = (id: string, proposedText: string) => {
    setReviewingId(id)
    setReviewMode(null)
    setComment("")
    setEditedContent(proposedText)
  }

  const closeReview = () => {
    setReviewingId(null)
    setReviewMode(null)
    setComment("")
    setEditedContent("")
  }

  const handleTabChange = (t: Tab) => { setTab(t); setPage(1); closeReview() }
  const handleFilterChange = (f: "all" | "processing" | "completed") => { setStatusFilter(f); setPage(1) }

  const handleSubmit = async (id: string) => {
    if (reviewMode === "request_review" && !comment.trim()) return
    if (reviewMode === "edit_and_approve" && !editedContent.trim()) return
    setSubmitting(true)
    try {
      const action = reviewMode === "approve" ? "approved"
        : reviewMode === "reject" ? "rejected"
        : reviewMode === "edit_and_approve" ? "edit_and_approve"
        : "request_review"
      await api.reviewApproval(id, {
        reviewer_id: reviewerId,
        action,
        comment: comment || undefined,
        edited_content: reviewMode === "edit_and_approve" ? editedContent : undefined,
      })
      closeReview()
      refetch()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#191c1e]">승인 관리</h2>
        <p className="text-sm text-[#444653] mt-1">문서 변경 제안을 검토하고 승인하세요.</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-[#e0e3e5]">
        <button
          onClick={() => handleTabChange("feedback")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "feedback"
              ? "border-[#00288e] text-[#00288e]"
              : "border-transparent text-[#757684] hover:text-[#191c1e]"
          }`}
        >
          <span className="material-symbols-outlined text-base">bug_report</span>
          오류 제보 수정안
          {feedbackApprovals.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-[#ffdbce] text-[#611e00] text-[10px] font-bold rounded-full">
              {feedbackApprovals.length}
            </span>
          )}
        </button>
        <button
          onClick={() => handleTabChange("playwright")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "playwright"
              ? "border-[#00288e] text-[#00288e]"
              : "border-transparent text-[#757684] hover:text-[#191c1e]"
          }`}
        >
          <span className="material-symbols-outlined text-base">smart_toy</span>
          Playwright 매뉴얼
          {playwrightApprovals.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-[#ffdbce] text-[#611e00] text-[10px] font-bold rounded-full">
              {playwrightApprovals.length}
            </span>
          )}
        </button>
      </div>

      {/* 상태 필터 */}
      <div className="flex items-center gap-2 py-2">
        {(["all", "processing", "completed"] as const).map((f) => {
          const labels = { all: "전체", processing: "처리 중", completed: "완료" }
          const isActive = statusFilter === f
          return (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? "bg-[#00288e] text-white"
                  : "bg-white border border-[#c4c5d5] text-[#444653] hover:border-[#00288e]"
              }`}
            >
              {labels[f]}
              {isActive && total > 0 && (
                <span className="ml-1.5 opacity-80">{total}</span>
              )}
            </button>
          )
        })}
        <span className="ml-auto text-xs text-[#757684]">총 {total}건</span>
      </div>

      {currentList.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">task_alt</span>
          <h3 className="mt-4 text-lg font-semibold text-[#191c1e]">
            {statusFilter === "completed" ? "완료된 항목이 없습니다" : "모든 승인이 처리되었습니다"}
          </h3>
          <p className="mt-2 text-sm text-[#757684]">
            {statusFilter === "completed"
              ? "아직 승인 또는 반려된 항목이 없습니다"
              : "현재 대기 중인 승인 요청이 없습니다"}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {currentList.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                tab={tab}
                isReviewing={reviewingId === approval.id}
                reviewMode={reviewingId === approval.id ? reviewMode : null}
                comment={comment}
                editedContent={editedContent}
                submitting={submitting}
                onOpenReview={() => openReview(approval.id, approval.proposed_change?.proposed_text ?? "")}
                onCloseReview={closeReview}
                onSetReviewMode={setReviewMode}
                onSetComment={setComment}
                onSetEditedContent={setEditedContent}
                onSubmit={() => handleSubmit(approval.id)}
              />
            ))}
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#757684]">페이지당</span>
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
                  className="text-xs border border-[#c4c5d5] rounded px-2 py-1 outline-none focus:border-[#00288e]"
                >
                  {[10, 20, 50].map(n => <option key={n} value={n}>{n}개</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2 py-1 text-xs border border-[#c4c5d5] rounded disabled:opacity-40 hover:border-[#00288e] transition-colors"
                >
                  ‹
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                  .reduce<(number | "...")[]>((acc, n, i, arr) => {
                    if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push("...")
                    acc.push(n)
                    return acc
                  }, [])
                  .map((n, i) =>
                    n === "..." ? (
                      <span key={`ellipsis-${i}`} className="px-1 text-xs text-[#9a9bad]">…</span>
                    ) : (
                      <button
                        key={n}
                        onClick={() => setPage(n as number)}
                        className={`w-7 h-7 text-xs rounded transition-colors ${
                          page === n
                            ? "bg-[#00288e] text-white border border-[#00288e]"
                            : "border border-[#c4c5d5] text-[#444653] hover:border-[#00288e]"
                        }`}
                      >
                        {n}
                      </button>
                    )
                  )
                }
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2 py-1 text-xs border border-[#c4c5d5] rounded disabled:opacity-40 hover:border-[#00288e] transition-colors"
                >
                  ›
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface CardProps {
  approval: ApprovalRequest
  tab: Tab
  isReviewing: boolean
  reviewMode: ReviewMode
  comment: string
  editedContent: string
  submitting: boolean
  onOpenReview: () => void
  onCloseReview: () => void
  onSetReviewMode: (m: ReviewMode) => void
  onSetComment: (v: string) => void
  onSetEditedContent: (v: string) => void
  onSubmit: () => void
}

function ApprovalCard({
  approval, tab, isReviewing, reviewMode, comment, editedContent,
  submitting, onOpenReview, onCloseReview, onSetReviewMode, onSetComment,
  onSetEditedContent, onSubmit,
}: CardProps) {
  const change = approval.proposed_change

  const reviewModeLabels: Record<NonNullable<ReviewMode>, string> = {
    approve: "승인",
    reject: "반려",
    edit_and_approve: "편집 후 승인",
    request_review: "추가 확인 요청",
  }

  const playwrightTitle = (() => {
    const prefix = "Playwright auto-generated manual for "
    if (change?.reasoning?.startsWith(prefix)) {
      return change.reasoning.slice(prefix.length, prefix.length + 50)
    }
    return change?.reasoning?.slice(0, 50) ?? "Playwright 매뉴얼"
  })()
  const cardTitle = tab === "playwright" ? playwrightTitle : `리비전 #${approval.proposed_change_id.slice(0, 8)}`

  return (
    <div className={`bg-white border rounded-xl shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
      isReviewing ? "border-[#00288e] ring-1 ring-[#dde1ff]" : "border-[#c4c5d5]"
    }`}>
      <div className="p-6">
        {/* 카드 헤더 */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#ffdbce] flex items-center justify-center shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-lg text-[#611e00]">
                {tab === "feedback" ? "rate_review" : "smart_toy"}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-[#191c1e]">
                  {cardTitle}
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  approval.status === "pending" ? "bg-[#ffdbce] text-[#611e00]"
                  : approval.status === "needs_review" ? "bg-[#d5e3fc] text-[#00288e]"
                  : "bg-[#d5e3fc] text-[#16a34a]"
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  {approval.status === "pending" ? "승인 대기" : approval.status === "needs_review" ? "검토 필요" : approval.status}
                </span>
              </div>
              {tab === "feedback" && change && (
                <p className="text-xs text-[#757684] mt-1 line-clamp-1">{change.reasoning}</p>
              )}
              <p className="text-xs text-[#757684] mt-0.5">
                {new Date(approval.created_at).toLocaleString("ko-KR")}
              </p>
            </div>
          </div>
          {!isReviewing && (approval.status === "pending" || approval.status === "needs_review") && (
            <button onClick={onOpenReview} className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
              <span className="material-symbols-outlined text-base">visibility</span>
              검토
            </button>
          )}
        </div>

        {/* 검토 패널 */}
        {isReviewing && (
          <div className="mt-6 pt-6 border-t border-[#e0e3e5] space-y-4">
            {/* 메타 정보 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-base text-[#d97706]">lightbulb</span>
                  <span className="text-xs font-semibold text-[#444653]">변경 사유</span>
                </div>
                <p className="text-sm text-[#191c1e]">{change?.reasoning ?? "정보 없음"}</p>
              </div>
              {tab === "feedback" && change && (
                <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 flex flex-col items-center justify-center">
                  <span className="text-xs font-semibold text-[#444653] mb-2">AI 신뢰도</span>
                  <span className="text-2xl font-bold text-[#00288e]">
                    {Math.round(change.confidence * 100)}%
                  </span>
                </div>
              )}
            </div>

            {/* Diff 뷰 */}
            {change && (
              <div className="space-y-2">
                <span className="text-xs font-semibold text-[#444653]">
                  {tab === "feedback" ? "변경 내용 (원문 → 제안)" : "생성된 매뉴얼 내용"}
                </span>
                {tab === "feedback" && change.original_text ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#fff5f5] border border-[#fca5a5] rounded-lg p-3 overflow-auto max-h-48">
                      <p className="text-[10px] font-semibold text-[#dc2626] mb-1">원문</p>
                      <pre className="text-xs text-[#191c1e] whitespace-pre-wrap font-mono">{change.original_text}</pre>
                    </div>
                    <div className="bg-[#f0fdf4] border border-[#86efac] rounded-lg p-3 overflow-auto max-h-48">
                      <p className="text-[10px] font-semibold text-[#16a34a] mb-1">제안</p>
                      <pre className="text-xs text-[#191c1e] whitespace-pre-wrap font-mono">{change.proposed_text}</pre>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 overflow-auto max-h-96 prose prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {change.proposed_text}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            {/* 액션 버튼 */}
            {!reviewMode ? (
              <div className="flex flex-wrap gap-3 pt-2">
                <button onClick={() => onSetReviewMode("approve")} className="flex items-center gap-2 px-4 py-2.5 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm">
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  승인
                </button>
                <button onClick={() => onSetReviewMode("edit_and_approve")} className="flex items-center gap-2 px-4 py-2.5 border border-[#00288e] text-[#00288e] rounded-lg text-sm font-medium hover:bg-[#dde1ff] transition-colors">
                  <span className="material-symbols-outlined text-base">edit</span>
                  편집 후 승인
                </button>
                <button onClick={() => onSetReviewMode("reject")} className="flex items-center gap-2 px-4 py-2.5 border border-[#ba1a1a] text-[#ba1a1a] rounded-lg text-sm font-medium hover:bg-[#ffdad6] transition-colors">
                  <span className="material-symbols-outlined text-base">cancel</span>
                  반려
                </button>
                <button onClick={() => onSetReviewMode("request_review")} className="flex items-center gap-2 px-4 py-2.5 border border-[#c4c5d5] text-[#444653] rounded-lg text-sm hover:bg-[#f2f4f6] transition-colors">
                  <span className="material-symbols-outlined text-base">help</span>
                  추가 확인 요청
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    reviewMode === "approve" ? "bg-[#d5e3fc] text-[#00288e]"
                    : reviewMode === "reject" ? "bg-[#ffdad6] text-[#93000a]"
                    : "bg-[#e6e8ea] text-[#444653]"
                  }`}>
                    {reviewMode ? reviewModeLabels[reviewMode] : ""}
                  </span>
                  <button onClick={() => onSetReviewMode(null)} className="text-xs text-[#757684] hover:text-[#191c1e]">← 다른 옵션</button>
                </div>

                {reviewMode === "edit_and_approve" && (
                  <textarea
                    placeholder="수정된 내용을 입력하세요..."
                    value={editedContent}
                    onChange={e => onSetEditedContent(e.target.value)}
                    rows={8}
                    className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none font-mono"
                  />
                )}

                <textarea
                  placeholder={reviewMode === "request_review" ? "확인이 필요한 사항을 작성하세요 (필수)..." : "코멘트 (선택)..."}
                  value={comment}
                  onChange={e => onSetComment(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
                />

                <div className="flex gap-2">
                  <button
                    onClick={onSubmit}
                    disabled={submitting || (reviewMode === "request_review" && !comment.trim()) || (reviewMode === "edit_and_approve" && !editedContent.trim())}
                    className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors"
                  >
                    {submitting ? "처리 중..." : "제출"}
                  </button>
                  <button onClick={onCloseReview} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
