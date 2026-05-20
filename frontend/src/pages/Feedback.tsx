import { useState } from "react"
import { api, type FeedbackReport, type ProposedChange } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
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
          <FeedbackDetail item={selected} onRefetch={refetch} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-[#9a9bad]">
            목록에서 항목을 선택하세요
          </div>
        )}
      </div>
    </div>
  )
}

function FeedbackDetail({ item, onRefetch: _onRefetch }: { item: FeedbackReport; onRefetch: () => void }) {
  const [activeSection, setActiveSection] = useState<"info" | "draft" | "history">("info")
  const { data: proposal } = useApi<ProposedChange>(
    () => api.getFeedbackProposal(item.id),
    [item.id]
  )

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-[#191c1e] flex-1">오류 제보 상세</h3>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
          item.status === "processed" ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#fff3dc] text-[#92600a]"
        }`}>{item.status === "processed" ? "완료" : "검토요청"}</span>
      </div>

      <div className="flex gap-1 border-b border-[#e0e3e5] mb-5">
        {([["info", "요청 정보"], ["draft", "AI 수정 초안"], ["history", "변경 이력"]] as ["info" | "draft" | "history", string][]).map(([s, label]) => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeSection === s ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"}`}>
            {label}
          </button>
        ))}
      </div>

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
        </div>
      )}

      {activeSection === "draft" && (
        <div>
          {proposal ? (
            <div className="space-y-4">
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
                <pre className="text-xs text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap overflow-auto max-h-48">{proposal.proposed_text}</pre>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#757684]">
                <span>신뢰도</span>
                <div className="flex-1 bg-[#e0e3e5] rounded-full h-1.5">
                  <div className="bg-[#00288e] h-1.5 rounded-full" style={{ width: `${Math.round(proposal.confidence * 100)}%` }} />
                </div>
                <span>{Math.round(proposal.confidence * 100)}%</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[#9a9bad]">AI 수정 초안이 없습니다.</div>
          )}
        </div>
      )}

      {activeSection === "history" && (
        <ChangeHistoryTimeline entityType="feedback" entityId={item.id} />
      )}
    </div>
  )
}
