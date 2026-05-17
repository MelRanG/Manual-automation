import { useState } from "react"
import { api } from "@/lib/api"
import { useApi } from "@/hooks/useApi"

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001"
type ReviewMode = "approve" | "reject" | "edit_and_approve" | "request_review" | null

export function Approvals() {
  const { data: approvals, refetch } = useApi(() => api.listApprovals(), [])
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewMode, setReviewMode] = useState<ReviewMode>(null)
  const [comment, setComment] = useState("")
  const [editedContent, setEditedContent] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const openReview = (id: string) => {
    setReviewingId(id)
    setReviewMode(null)
    setComment("")
    setEditedContent("")
  }

  const closeReview = () => {
    setReviewingId(null)
    setReviewMode(null)
    setComment("")
    setEditedContent("")
  }

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
        reviewer_id: DEMO_USER_ID,
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

      {(!approvals || approvals.length === 0) ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">task_alt</span>
          <h3 className="mt-4 text-lg font-semibold text-[#191c1e]">모든 승인이 처리되었습니다</h3>
          <p className="mt-2 text-sm text-[#757684]">현재 대기 중인 승인 요청이 없습니다</p>
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((approval) => (
            <div key={approval.id} className={`bg-white border rounded-xl shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
              reviewingId === approval.id ? "border-[#00288e] ring-1 ring-[#dde1ff]" : "border-[#c4c5d5]"
            }`}>
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#ffdbce] flex items-center justify-center shrink-0 mt-0.5">
                      <span className="material-symbols-outlined text-lg text-[#611e00]">rate_review</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[#191c1e]">리비전 #{approval.proposed_change_id.slice(0, 8)}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          approval.status === "pending" ? "bg-[#ffdbce] text-[#611e00]"
                          : approval.status === "needs_review" ? "bg-[#d5e3fc] text-[#00288e]"
                          : "bg-[#d5e3fc] text-[#16a34a]"
                        }`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                          {approval.status === "pending" ? "승인 대기" : approval.status === "needs_review" ? "검토 필요" : approval.status}
                        </span>
                      </div>
                      <p className="text-xs text-[#757684] mt-1">
                        {new Date(approval.created_at).toLocaleString("ko-KR")}
                      </p>
                    </div>
                  </div>
                  {reviewingId !== approval.id && (approval.status === "pending" || approval.status === "needs_review") && (
                    <button onClick={() => openReview(approval.id)} className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
                      <span className="material-symbols-outlined text-base">visibility</span>
                      검토
                    </button>
                  )}
                </div>

                {/* Review Panel */}
                {reviewingId === approval.id && (
                  <div className="mt-6 pt-6 border-t border-[#e0e3e5] space-y-4">
                    {/* AI Analysis Mock */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2 bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="material-symbols-outlined text-base text-[#d97706]">lightbulb</span>
                          <span className="text-xs font-semibold text-[#444653]">변경 사유</span>
                        </div>
                        <p className="text-sm text-[#191c1e]">AI가 문서 내용의 불일치를 감지하여 자동 수정안을 생성했습니다.</p>
                      </div>
                      <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 flex flex-col items-center justify-center">
                        <span className="text-xs font-semibold text-[#444653] mb-2">AI 신뢰도</span>
                        <span className="text-2xl font-bold text-[#00288e]">98%</span>
                      </div>
                    </div>

                    {!reviewMode ? (
                      <div className="flex flex-wrap gap-3 pt-2">
                        <button onClick={() => setReviewMode("approve")} className="flex items-center gap-2 px-4 py-2.5 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm">
                          <span className="material-symbols-outlined text-base">check_circle</span>
                          승인
                        </button>
                        <button onClick={() => setReviewMode("edit_and_approve")} className="flex items-center gap-2 px-4 py-2.5 border border-[#00288e] text-[#00288e] rounded-lg text-sm font-medium hover:bg-[#dde1ff] transition-colors">
                          <span className="material-symbols-outlined text-base">edit</span>
                          편집 후 승인
                        </button>
                        <button onClick={() => setReviewMode("reject")} className="flex items-center gap-2 px-4 py-2.5 border border-[#ba1a1a] text-[#ba1a1a] rounded-lg text-sm font-medium hover:bg-[#ffdad6] transition-colors">
                          <span className="material-symbols-outlined text-base">cancel</span>
                          반려
                        </button>
                        <button onClick={() => setReviewMode("request_review")} className="flex items-center gap-2 px-4 py-2.5 border border-[#c4c5d5] text-[#444653] rounded-lg text-sm hover:bg-[#f2f4f6] transition-colors">
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
                            {reviewMode === "approve" ? "승인" : reviewMode === "reject" ? "반려" : reviewMode === "edit_and_approve" ? "편집 후 승인" : "추가 확인 요청"}
                          </span>
                          <button onClick={() => setReviewMode(null)} className="text-xs text-[#757684] hover:text-[#191c1e]">← 다른 옵션</button>
                        </div>

                        {reviewMode === "edit_and_approve" && (
                          <textarea
                            placeholder="수정된 내용을 입력하세요..."
                            value={editedContent}
                            onChange={e => setEditedContent(e.target.value)}
                            rows={5}
                            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
                          />
                        )}

                        <textarea
                          placeholder={reviewMode === "request_review" ? "확인이 필요한 사항을 작성하세요 (필수)..." : "코멘트 (선택)..."}
                          value={comment}
                          onChange={e => setComment(e.target.value)}
                          rows={2}
                          className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
                        />

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSubmit(approval.id)}
                            disabled={submitting || (reviewMode === "request_review" && !comment.trim()) || (reviewMode === "edit_and_approve" && !editedContent.trim())}
                            className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors"
                          >
                            {submitting ? "처리 중..." : "제출"}
                          </button>
                          <button onClick={closeReview} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
