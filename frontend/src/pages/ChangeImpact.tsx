import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { api, type ChangeProposal } from "@/lib/api"
import { useApi } from "@/hooks/useApi"

type TabStatus = "all" | "pending" | "pending_review" | "completed"

const TAB_LABELS: Record<TabStatus, string> = {
  all: "전체",
  pending: "문서 선택 대기",
  pending_review: "수정안 검토 대기",
  completed: "완료",
}

const STATUS_LABEL: Record<string, string> = {
  pending: "문서 선택 대기",
  pending_review: "수정안 검토 대기",
  completed: "완료",
  pending_document_selection: "문서 선택 대기",
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-[#fff3dc] text-[#92600a]",
  pending_review: "bg-[#d5e3fc] text-[#00288e]",
  completed: "bg-[#dcfce7] text-[#15803d]",
  pending_document_selection: "bg-[#fff3dc] text-[#92600a]",
}

const PAGE_SIZE = 10

// analysis.status가 "pending_document_selection"인 경우도 있어서 정규화
function normalizeStatus(s: string): TabStatus {
  if (s === "pending" || s === "pending_document_selection") return "pending"
  if (s === "pending_review") return "pending_review"
  return "completed"
}

export function ChangeImpact() {
  const navigate = useNavigate()
  const { data: analyses, loading, refetch } = useApi(() => api.listAnalyses(), [])
  const { data: docData } = useApi(() => api.listDocuments(0, 1000), [])
  const docs = docData?.documents || []
  const docMap = new Map(docs.map(d => [d.id, d.title]))

  const [activeTab, setActiveTab] = useState<TabStatus>("all")
  const [page, setPage] = useState(1)
  const [openAnalysisId, setOpenAnalysisId] = useState<string | null>(null)

  const [selectedAnalysis, setSelectedAnalysis] = useState<string | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null)
  const [strategyRec, setStrategyRec] = useState<{ recommended_strategy: string; confidence: number; reasoning: string } | null>(null)
  const [loadingStrategy, setLoadingStrategy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [proposal, setProposal] = useState<ChangeProposal | null>(null)
  const [applying, setApplying] = useState(false)
  const [showDiff, setShowDiff] = useState(false)

  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // 탭 변경 시 페이지 초기화
  useEffect(() => { setPage(1) }, [activeTab])

  const filteredAnalyses = (analyses ?? []).filter(a =>
    activeTab === "all" || normalizeStatus(a.status) === activeTab
  )

  const totalPages = Math.max(1, Math.ceil(filteredAnalyses.length / PAGE_SIZE))
  const pagedAnalyses = filteredAnalyses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const tabCount = (tab: TabStatus) =>
    tab === "all" ? (analyses ?? []).length : (analyses ?? []).filter(a => normalizeStatus(a.status) === tab).length

  const scrollToItem = (id: string) => {
    setTimeout(() => {
      itemRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 100)
  }

  // 상태 변경 후 해당 탭으로 이동하고 항목 열기
  const switchToTabAndOpen = (analysisId: string, newStatus: string) => {
    const targetTab = normalizeStatus(newStatus)
    setActiveTab(targetTab)
    setOpenAnalysisId(analysisId)

    // 대상 탭에서 해당 항목이 몇 번째 페이지인지 계산 (refetch 후 기준)
    setTimeout(() => {
      const list = (analyses ?? []).filter(a =>
        targetTab === "all" || normalizeStatus(a.status) === targetTab
      )
      const idx = list.findIndex(a => a.id === analysisId)
      if (idx >= 0) {
        setPage(Math.floor(idx / PAGE_SIZE) + 1)
        scrollToItem(analysisId)
      }
    }, 200)
  }

  const handleSelectDoc = async (analysisId: string, docId: string) => {
    setSelectedAnalysis(analysisId)
    setSelectedDoc(docId)
    setStrategyRec(null)
    setProposal(null)
    setLoadingStrategy(true)
    try {
      const rec = await api.recommendStrategy(analysisId, docId)
      setStrategyRec(rec)
    } catch (e: any) {
      alert("전략 분석 실패: " + e.message)
    } finally {
      setLoadingStrategy(false)
    }
  }

  const handleGenerate = async () => {
    if (!selectedAnalysis || !selectedDoc || !strategyRec) return
    setGenerating(true)
    try {
      const p = await api.generateProposalForDocument(selectedAnalysis, selectedDoc, strategyRec.recommended_strategy)
      setProposal(p)
      await refetch()
      // 수정안 생성 완료 → pending_review 탭으로 이동, 해당 항목 열기
      switchToTabAndOpen(selectedAnalysis, "pending_review")
    } catch (e: any) {
      alert("수정안 생성 실패: " + e.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleApply = async () => {
    if (!selectedAnalysis || !proposal) return
    if (!confirm("수정안을 문서에 적용하면 새 버전이 생성됩니다. 계속할까요?")) return
    setApplying(true)
    try {
      const result = await api.applyProposal(selectedAnalysis, proposal.id)
      await refetch()
      switchToTabAndOpen(selectedAnalysis, "completed")
      navigate(`/documents/${result.document_id}`)
    } catch (e: any) {
      alert("적용 실패: " + e.message)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#191c1e]">문서 변경 대기열</h2>
        <p className="text-sm text-[#444653] mt-1">완료된 SR로 인해 영향받는 문서를 선택하고 수정안을 생성합니다.</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-[#e0e3e5]">
        {(Object.keys(TAB_LABELS) as TabStatus[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap ${
              activeTab === tab
                ? "text-[#00288e] border-b-2 border-[#00288e] -mb-px"
                : "text-[#757684] hover:text-[#444653]"
            }`}
          >
            {TAB_LABELS[tab]}
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[11px] ${
              activeTab === tab ? "bg-[#e8f0fe] text-[#00288e]" : "bg-[#e6e8ea] text-[#757684]"
            }`}>
              {tabCount(tab)}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#757684]">불러오는 중...</div>
      ) : filteredAnalyses.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">account_tree</span>
          <h3 className="mt-4 text-lg font-semibold text-[#191c1e]">
            {activeTab === "all" ? "대기 중인 항목이 없습니다" : `${TAB_LABELS[activeTab]} 항목이 없습니다`}
          </h3>
          <p className="text-sm text-[#757684] mt-2">SR을 완료 처리하면 여기에 나타납니다.</p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {pagedAnalyses.map(analysis => {
              const isOpen = openAnalysisId === analysis.id
              const normalized = normalizeStatus(analysis.status)
              return (
                <div
                  key={analysis.id}
                  ref={el => { itemRefs.current[analysis.id] = el }}
                  className={`bg-white border rounded-xl shadow-sm transition-all ${
                    isOpen ? "border-[#00288e] ring-1 ring-[#00288e]/20" : "border-[#c4c5d5]"
                  }`}
                >
                  {/* 헤더 — 클릭으로 열고 닫기 */}
                  <button
                    className="w-full text-left p-6 flex justify-between items-start"
                    onClick={() => setOpenAnalysisId(isOpen ? null : analysis.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-[#e6e8ea] text-[#444653]">
                          {analysis.source_type}
                        </span>
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_BADGE[analysis.status] ?? "bg-[#e6e8ea] text-[#444653]"}`}>
                          {STATUS_LABEL[analysis.status] ?? analysis.status}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-[#191c1e] truncate pr-4">{analysis.reasoning}</p>
                    </div>
                    <span className="material-symbols-outlined text-[#757684] shrink-0 mt-0.5">
                      {isOpen ? "expand_less" : "expand_more"}
                    </span>
                  </button>

                  {/* 펼쳐진 내용 */}
                  {isOpen && (
                    <div className="px-6 pb-6">
                      {normalized === "pending" && (
                        <div className="border-t border-[#e0e3e5] pt-4">
                          <h4 className="text-sm font-semibold text-[#191c1e] mb-3">반영할 문서 선택</h4>
                          {analysis.related_document_ids && analysis.related_document_ids.length > 0 ? (
                            <div className="flex gap-2 flex-wrap">
                              {analysis.related_document_ids.map(docId => (
                                <button
                                  key={docId}
                                  onClick={() => handleSelectDoc(analysis.id, docId)}
                                  className={`px-3 py-1.5 border rounded-lg text-sm transition-colors ${
                                    selectedDoc === docId && selectedAnalysis === analysis.id
                                      ? "border-[#00288e] bg-[#e8f0fe] text-[#00288e] font-semibold"
                                      : "border-[#c4c5d5] hover:bg-[#f7f9fb] text-[#444653]"
                                  }`}
                                >
                                  {docMap.get(docId) || docId.slice(0, 8) + "…"}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-[#757684]">관련 문서 후보가 없습니다. 문서 관리에서 직접 선택하세요.</p>
                          )}

                          {selectedAnalysis === analysis.id && selectedDoc && (
                            <div className="mt-4 p-4 bg-[#f7f9fb] rounded-lg border border-[#e0e3e5] space-y-3">
                              {loadingStrategy ? (
                                <div className="flex items-center gap-2 text-sm text-[#00288e]">
                                  <span className="material-symbols-outlined animate-spin text-base">refresh</span>
                                  AI가 반영 전략을 분석 중...
                                </div>
                              ) : strategyRec ? (
                                <>
                                  <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[#16a34a]">psychology</span>
                                    <span className="text-sm font-bold text-[#191c1e]">추천 전략: {strategyRec.recommended_strategy}</span>
                                    <span className="text-xs text-[#757684]">(신뢰도 {Math.round(strategyRec.confidence * 100)}%)</span>
                                  </div>
                                  <p className="text-sm text-[#444653]">{strategyRec.reasoning}</p>

                                  {!proposal ? (
                                    <div className="flex justify-end pt-1">
                                      <button
                                        onClick={handleGenerate}
                                        disabled={generating}
                                        className="px-4 py-2 bg-[#00288e] text-white text-sm font-medium rounded-lg hover:bg-[#1e40af] disabled:opacity-50 transition-colors flex items-center gap-2"
                                      >
                                        {generating && <span className="material-symbols-outlined animate-spin text-base">refresh</span>}
                                        {generating ? "수정안 생성 중..." : "수정안 생성"}
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="space-y-3 border-t border-[#e0e3e5] pt-3">
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold text-[#191c1e]">수정안 생성 완료</span>
                                        <button
                                          onClick={() => setShowDiff(!showDiff)}
                                          className="text-xs text-[#00288e] underline"
                                        >
                                          {showDiff ? "미리보기 닫기" : "수정안 미리보기"}
                                        </button>
                                      </div>

                                      {showDiff && (
                                        <div className="bg-white rounded border border-[#e0e3e5] overflow-auto max-h-96">
                                          <pre className="text-xs p-4 whitespace-pre-wrap text-[#444653]">
                                            {proposal.proposed_content}
                                          </pre>
                                        </div>
                                      )}

                                      <div className="flex gap-2 justify-end">
                                        <button
                                          onClick={() => { setProposal(null); setStrategyRec(null) }}
                                          className="px-4 py-2 border border-[#c4c5d5] text-sm text-[#444653] rounded-lg hover:bg-[#f2f4f6] transition-colors"
                                        >
                                          다시 생성
                                        </button>
                                        <button
                                          onClick={handleApply}
                                          disabled={applying}
                                          className="px-4 py-2 bg-[#16a34a] text-white text-sm font-medium rounded-lg hover:bg-[#15803d] disabled:opacity-50 transition-colors flex items-center gap-2"
                                        >
                                          {applying && <span className="material-symbols-outlined animate-spin text-base">refresh</span>}
                                          {applying ? "적용 중..." : "문서에 적용"}
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}

                      {normalized === "pending_review" && (
                        <div className="border-t border-[#e0e3e5] pt-3 flex items-center justify-between">
                          <p className="text-sm text-[#444653]">수정안이 생성되었습니다. 승인 관리에서 검토하세요.</p>
                          <button
                            onClick={() => navigate("/approvals?status=processing")}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00288e] text-white text-xs font-medium rounded-lg hover:bg-[#1e40af] transition-colors"
                          >
                            <span className="material-symbols-outlined text-sm">task</span>
                            승인 관리로 이동
                          </button>
                        </div>
                      )}

                      {normalized === "completed" && (
                        <div className="border-t border-[#e0e3e5] pt-3">
                          <p className="text-sm text-[#16a34a] flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-base">check_circle</span>
                            문서에 적용 완료되었습니다.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg text-[#757684] hover:bg-[#f2f4f6] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <span className="material-symbols-outlined text-lg">chevron_left</span>
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                    page === p ? "bg-[#00288e] text-white" : "text-[#444653] hover:bg-[#f2f4f6]"
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg text-[#757684] hover:bg-[#f2f4f6] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <span className="material-symbols-outlined text-lg">chevron_right</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
