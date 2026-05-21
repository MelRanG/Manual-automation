import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { api, type ProposedChange, type ProposedChangeBrief } from "@/lib/api"

type ReviewMode = "approve" | "reject" | "edit_and_approve" | "request_review" | null

export interface ApprovalReviewPanelInput {
  id: string
  status: string
  approval_type: string
  comment: string | null
  proposed_change: ProposedChange | ProposedChangeBrief | null
}

interface Props {
  approval: ApprovalReviewPanelInput
  reviewerId: string
  variant: "feedback" | "playwright" | "jira_sr"
  onReviewed: () => void
  showReasoning?: boolean
}

const reviewModeLabels: Record<NonNullable<ReviewMode>, string> = {
  approve: "승인",
  reject: "반려",
  edit_and_approve: "편집 후 승인",
  request_review: "추가 확인 요청",
}

export function ApprovalReviewPanel({
  approval, reviewerId, variant, onReviewed, showReasoning = true,
}: Props) {
  const change = approval.proposed_change
  const [reviewMode, setReviewMode] = useState<ReviewMode>(null)
  const [comment, setComment] = useState("")
  const [editedContent, setEditedContent] = useState(change?.proposed_text ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const hasOriginal = !!(change && "original_text" in change && change.original_text)

  const handleSubmit = async () => {
    if (reviewMode === "request_review" && !comment.trim()) return
    if (reviewMode === "edit_and_approve" && !editedContent.trim()) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      const action = reviewMode === "approve" ? "approved"
        : reviewMode === "reject" ? "rejected"
        : reviewMode === "edit_and_approve" ? "edit_and_approve"
        : "request_review"
      await api.reviewApproval(approval.id, {
        reviewer_id: reviewerId,
        action,
        comment: comment || undefined,
        edited_content: reviewMode === "edit_and_approve" ? editedContent : undefined,
      })
      onReviewed()
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "처리 실패")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pt-2 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {showReasoning && (
          <div className="md:col-span-2 bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-base text-[#d97706]">lightbulb</span>
              <span className="text-xs font-semibold text-[#444653]">변경 사유</span>
            </div>
            <p className="text-sm text-[#191c1e]">{change?.reasoning ?? "정보 없음"}</p>
          </div>
        )}
        {variant === "feedback" && change && (
          <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 flex flex-col items-center justify-center">
            <span className="text-xs font-semibold text-[#444653] mb-2">AI 신뢰도</span>
            <span className="text-2xl font-bold text-[#00288e]">
              {Math.round(change.confidence * 100)}%
            </span>
          </div>
        )}
      </div>

      {change && (
        <div className="space-y-2">
          <span className="text-xs font-semibold text-[#444653]">
            {variant === "feedback" ? "변경 내용 (원문 → 제안)" : "생성된 매뉴얼 내용"}
          </span>
          {variant === "feedback" && hasOriginal ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#fff5f5] border border-[#fca5a5] rounded-lg p-3 overflow-auto max-h-48">
                <p className="text-[10px] font-semibold text-[#dc2626] mb-1">원문</p>
                <pre className="text-xs text-[#191c1e] whitespace-pre-wrap font-mono">
                  {(change as ProposedChange).original_text}
                </pre>
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

      {errorMsg && (
        <div className="text-xs text-[#ba1a1a] bg-[#ffdad6] px-3 py-2 rounded-lg">{errorMsg}</div>
      )}

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
              {reviewModeLabels[reviewMode]}
            </span>
            <button onClick={() => setReviewMode(null)} className="text-xs text-[#757684] hover:text-[#191c1e]">← 다른 옵션</button>
          </div>

          {reviewMode === "edit_and_approve" && (
            <textarea
              placeholder="수정된 내용을 입력하세요..."
              value={editedContent}
              onChange={e => setEditedContent(e.target.value)}
              rows={8}
              className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none font-mono"
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
              onClick={handleSubmit}
              disabled={submitting || (reviewMode === "request_review" && !comment.trim()) || (reviewMode === "edit_and_approve" && !editedContent.trim())}
              className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors"
            >
              {submitting ? "처리 중..." : "제출"}
            </button>
            <button onClick={() => { setReviewMode(null); setComment(""); setErrorMsg(null) }} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
          </div>
        </div>
      )}
    </div>
  )
}
