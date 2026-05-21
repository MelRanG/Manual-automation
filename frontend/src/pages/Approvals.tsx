import { useState } from "react"
import { api, type ApprovalRequest } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"
import { ApprovalReviewPanel } from "@/components/ApprovalReviewPanel"

type Tab = "feedback" | "jira_sr"
type JiraSrFilter = "all" | "doc_review_pending" | "jira_sr_pending" | "done"

export function Approvals() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>("feedback")
  const [jiraSrFilter, setJiraSrFilter] = useState<JiraSrFilter>("all")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  const reviewerId = user?.id ?? "00000000-0000-0000-0000-000000000001"

  // 탭 배지용: 항상 processing 건수만 별도 조회 (statusFilter와 독립)
  const { data: processingData, refetch: refetchCounts } = useApi(
    () => api.listApprovals({ status: "processing", skip: 0, limit: 500 }),
    []
  )
  const processingItems = processingData?.items ?? []
  const feedbackProcessingCount = processingItems.filter(a => a.proposed_change?.source_type === "feedback").length
  const jiraSrProcessingCount = processingItems.filter(
    a => a.proposed_change?.source_type === "jira_sr" || a.approval_type === "doc_review"
  ).length

  const { data: result, refetch: refetchMain } = useApi(
    () => api.listApprovals({ status: "processing", skip: (page - 1) * pageSize, limit: pageSize }),
    [page, pageSize]
  )

  const approvals = result?.items ?? []
  const total = result?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)

  const feedbackApprovals = approvals.filter(a => a.proposed_change?.source_type === "feedback")

  const jiraSrAllApprovals = approvals.filter(
    a => a.proposed_change?.source_type === "jira_sr" || a.approval_type === "doc_review"
  )
  const jiraSrFiltered = (() => {
    if (jiraSrFilter === "all") return jiraSrAllApprovals
    if (jiraSrFilter === "doc_review_pending")
      return jiraSrAllApprovals.filter(a => a.approval_type === "doc_review" && a.status === "pending")
    if (jiraSrFilter === "jira_sr_pending")
      return jiraSrAllApprovals.filter(
        a => a.proposed_change?.source_type === "jira_sr" && (a.status === "pending" || a.status === "needs_review")
      )
    if (jiraSrFilter === "done")
      return jiraSrAllApprovals.filter(a => a.status === "approved" || a.status === "rejected")
    return jiraSrAllApprovals
  })()

  const currentList = tab === "feedback" ? feedbackApprovals : jiraSrFiltered

  const openReview = (id: string) => setReviewingId(id)
  const closeReview = () => setReviewingId(null)

  const refetch = () => { refetchMain(); refetchCounts() }

  const handleTabChange = (t: Tab) => {
    setTab(t)
    setPage(1)
    setReviewingId(null)
    if (t !== "jira_sr") setJiraSrFilter("all")
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
          {feedbackProcessingCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-[#ffdbce] text-[#611e00] text-[10px] font-bold rounded-full">
              {feedbackProcessingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => handleTabChange("jira_sr")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "jira_sr"
              ? "border-[#00288e] text-[#00288e]"
              : "border-transparent text-[#757684] hover:text-[#191c1e]"
          }`}
        >
          <span className="material-symbols-outlined text-base">task</span>
          Jira SR
          {jiraSrProcessingCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-[#ffdbce] text-[#611e00] text-[10px] font-bold rounded-full">
              {jiraSrProcessingCount}
            </span>
          )}
        </button>
      </div>

      {/* Jira SR 필터 배지 */}
      {tab === "jira_sr" && (
        <div className="flex items-center gap-2 py-2">
          {(["all", "doc_review_pending", "jira_sr_pending", "done"] as const).map((f) => {
            const labels: Record<JiraSrFilter, string> = {
              all: "전체",
              doc_review_pending: "문서화 필요 여부",
              jira_sr_pending: "AI 초안 검토",
              done: "완료",
            }
            const isActive = jiraSrFilter === f
            return (
              <button
                key={f}
                onClick={() => { setJiraSrFilter(f); setPage(1) }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-[#00288e] text-white"
                    : "bg-white border border-[#c4c5d5] text-[#444653] hover:border-[#00288e]"
                }`}
              >
                {labels[f]}
              </button>
            )
          })}
          <span className="ml-auto text-xs text-[#757684]">총 {currentList.length}건</span>
        </div>
      )}

      {currentList.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">task_alt</span>
          <h3 className="mt-4 text-lg font-semibold text-[#191c1e]">처리 중인 항목이 없습니다</h3>
          <p className="mt-2 text-sm text-[#757684]">현재 대기 중인 승인 요청이 없습니다</p>
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
                reviewerId={reviewerId}
                onOpenReview={() => openReview(approval.id)}
                onCloseReview={closeReview}
                onRefetch={refetch}
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
  reviewerId: string
  onOpenReview: () => void
  onCloseReview: () => void
  onRefetch: () => void
}

function ApprovalCard({
  approval, tab, isReviewing, reviewerId, onOpenReview, onCloseReview, onRefetch,
}: CardProps) {
  const [docReviewTargetUrl, setDocReviewTargetUrl] = useState("")
  const [localSubmitting, setLocalSubmitting] = useState(false)

  const change = approval.proposed_change

  const cardTitle = approval.proposed_change_id
    ? `리비전 #${approval.proposed_change_id.slice(0, 8)}`
    : approval.sr_draft_id
      ? `SR #${approval.sr_draft_id.slice(0, 8)}`
      : `승인 #${approval.id.slice(0, 8)}`

  return (
    <div className={`bg-white border rounded-xl shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
      isReviewing ? "border-[#00288e] ring-1 ring-[#dde1ff]" : "border-[#c4c5d5]"
    }`}>
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#ffdbce] flex items-center justify-center shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-lg text-[#611e00]">
                {tab === "feedback" ? "rate_review" : "task"}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-[#191c1e]">{cardTitle}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  approval.status === "approved" ? "bg-[#e8f5e9] text-[#2e7d32]"
                  : approval.status === "rejected" ? "bg-[#fce4ec] text-[#c62828]"
                  : approval.status === "needs_review" ? "bg-[#e8f0fe] text-[#1a56db]"
                  : approval.proposed_change?.source_type === "jira_sr" ? "bg-[#e8f0fe] text-[#1a56db]"
                  : approval.approval_type === "doc_review" ? "bg-[#fff3dc] text-[#92600a]"
                  : "bg-[#ffdbce] text-[#611e00]"
                }`}>
                  {(approval.status === "pending" || approval.status === "needs_review") && (
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  )}
                  {approval.status === "approved" ? "문서 수정 완료"
                  : approval.status === "rejected" ? "종료"
                  : approval.status === "needs_review" ? "AI 초안 검토"
                  : approval.proposed_change?.source_type === "jira_sr" ? "AI 초안 검토"
                  : approval.approval_type === "doc_review" ? "문서화 필요 여부"
                  : "승인 대기"}
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

        {isReviewing && (
          <div className="mt-6 pt-6 border-t border-[#e0e3e5]">
            {approval.approval_type === "doc_review" ? (
              approval.status === "pending" ? (
              <div className="space-y-3">
                <p className="text-sm text-[#444653]">이 SR 완료 건에 대해 문서 작성이 필요한가요?</p>
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="사용자 매뉴얼 캡처 URL (매뉴얼 포함 승인 시 필요)"
                    value={docReviewTargetUrl}
                    onChange={e => setDocReviewTargetUrl(e.target.value)}
                    className="text-sm border border-[#e0e3e5] rounded px-3 py-1.5 w-full"
                  />
                  <div className="flex gap-2 flex-wrap">
                    <button
                      disabled={localSubmitting}
                      onClick={async () => {
                        setLocalSubmitting(true)
                        try {
                          await api.reviewDocApproval(approval.id, { reviewer_id: reviewerId, action: "reject" })
                          onCloseReview()
                          onRefetch()
                        } catch (e: unknown) {
                          alert("처리 중 오류: " + (e instanceof Error ? e.message : String(e)))
                        } finally { setLocalSubmitting(false) }
                      }}
                      className="px-3 py-1.5 text-sm rounded border border-[#e0e3e5] text-[#757684] hover:bg-[#f2f4f6]"
                    >
                      거부 (문서 불필요)
                    </button>
                    <button
                      disabled={localSubmitting}
                      onClick={async () => {
                        setLocalSubmitting(true)
                        try {
                          await api.reviewDocApproval(approval.id, { reviewer_id: reviewerId, action: "approve_doc" })
                          onCloseReview()
                          onRefetch()
                        } catch (e: unknown) {
                          alert("처리 중 오류: " + (e instanceof Error ? e.message : String(e)))
                        } finally { setLocalSubmitting(false) }
                      }}
                      className="px-3 py-1.5 text-sm rounded bg-[#00288e] text-white hover:bg-[#001a6b]"
                    >
                      문서 작성 승인
                    </button>
                    <button
                      disabled={localSubmitting || !docReviewTargetUrl.trim()}
                      onClick={async () => {
                        setLocalSubmitting(true)
                        try {
                          await api.reviewDocApproval(approval.id, {
                            reviewer_id: reviewerId,
                            action: "approve_manual",
                            target_url: docReviewTargetUrl,
                          })
                          onCloseReview()
                          onRefetch()
                        } catch (e: unknown) {
                          alert("처리 중 오류: " + (e instanceof Error ? e.message : String(e)))
                        } finally { setLocalSubmitting(false) }
                      }}
                      className="px-3 py-1.5 text-sm rounded bg-[#1a6b3c] text-white hover:bg-[#0d4a28] disabled:opacity-40"
                    >
                      사용자 매뉴얼 포함 승인
                    </button>
                  </div>
                </div>
              </div>
              ) : (
                <p className="text-sm text-[#757684]">이미 처리된 항목입니다.</p>
              )
            ) : (
              <ApprovalReviewPanel
                key={approval.id}
                approval={approval}
                reviewerId={reviewerId}
                variant={tab}
                onReviewed={() => { onCloseReview(); onRefetch() }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
