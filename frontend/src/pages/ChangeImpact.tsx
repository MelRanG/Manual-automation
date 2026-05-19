import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { api, type ChangeProposal } from "@/lib/api"
import { useApi } from "@/hooks/useApi"

export function ChangeImpact() {
  const navigate = useNavigate()
  const { data: analyses, loading, refetch } = useApi(() => api.listAnalyses(), [])
  const { data: docData } = useApi(() => api.listDocuments(0, 1000), [])
  const docs = docData?.documents || []
  const docMap = new Map(docs.map(d => [d.id, d.title]))

  const [selectedAnalysis, setSelectedAnalysis] = useState<string | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null)
  const [strategyRec, setStrategyRec] = useState<{ recommended_strategy: string; confidence: number; reasoning: string } | null>(null)
  const [loadingStrategy, setLoadingStrategy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [proposal, setProposal] = useState<ChangeProposal | null>(null)
  const [applying, setApplying] = useState(false)
  const [showDiff, setShowDiff] = useState(false)

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
      refetch()
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
      alert("문서에 적용되었습니다.")
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

      {loading ? (
        <div className="text-center py-12 text-[#757684]">불러오는 중...</div>
      ) : !analyses || analyses.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">account_tree</span>
          <h3 className="mt-4 text-lg font-semibold text-[#191c1e]">대기 중인 항목이 없습니다</h3>
          <p className="text-sm text-[#757684] mt-2">SR을 완료 처리하면 여기에 나타납니다.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {analyses.map(analysis => (
            <div key={analysis.id} className="bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-[#e6e8ea] text-[#444653]">
                      {analysis.source_type}
                    </span>
                    <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                      analysis.status === "pending_document_selection" ? "bg-[#fff3dc] text-[#92600a]"
                      : analysis.status === "pending_review" ? "bg-[#d5e3fc] text-[#00288e]"
                      : "bg-[#e6e8ea] text-[#444653]"
                    }`}>
                      {analysis.status === "pending_document_selection" ? "문서 선택 대기"
                        : analysis.status === "pending_review" ? "수정안 검토 대기"
                        : analysis.status}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-[#191c1e]">{analysis.reasoning}</p>
                </div>
              </div>

              {analysis.status === "pending_document_selection" && (
                <div className="mt-4 border-t border-[#e0e3e5] pt-4">
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

              {analysis.status === "pending_review" && (
                <div className="mt-3 border-t border-[#e0e3e5] pt-3 flex items-center justify-between">
                  <p className="text-sm text-[#444653]">수정안이 생성되었습니다.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
