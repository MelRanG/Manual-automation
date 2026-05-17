import { Link } from "react-router-dom"
import { api } from "@/lib/api"
import { useApi } from "@/hooks/useApi"

export function TrustScores() {
  const { data: scores, loading } = useApi(() => api.listTrustScores(), [])

  const avgScore = scores && scores.length > 0
    ? Math.round(scores.reduce((sum, d) => sum + d.trust_score, 0) / scores.length * 100)
    : 0

  const circumference = 2 * Math.PI * 42
  const scoreColor = avgScore >= 80 ? "#16a34a" : avgScore >= 50 ? "#d97706" : "#ba1a1a"

  const getScoreDot = (score: number) => {
    if (score >= 0.8) return "bg-[#16a34a]"
    if (score >= 0.5) return "bg-[#d97706]"
    return "bg-[#ba1a1a]"
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-[#191c1e]">신뢰도 점수</h2>
        <p className="text-sm text-[#444653] mt-1">문서 경과일, 피드백, 리뷰 기반 신뢰도를 추적합니다.</p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#757684]">불러오는 중...</div>
      ) : !scores || scores.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">verified</span>
          <p className="mt-4 text-sm text-[#757684]">아직 점수를 계산할 문서가 없습니다</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Average Score */}
            <div className="bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm flex flex-col items-center justify-center">
              <div className="relative w-28 h-28">
                <svg className="w-28 h-28 -rotate-90" viewBox="0 0 96 96">
                  <circle cx="48" cy="48" r="42" fill="none" stroke="#e0e3e5" strokeWidth="8" />
                  <circle
                    cx="48" cy="48" r="42" fill="none" stroke={scoreColor} strokeWidth="8"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference - (circumference * avgScore) / 100}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-bold" style={{ color: scoreColor }}>{avgScore}%</span>
                </div>
              </div>
              <p className="text-sm font-semibold text-[#191c1e] mt-3">전체 평균 신뢰도</p>
              <p className="text-xs text-[#757684] mt-1">{scores.length}개 문서 기준</p>
            </div>

            {/* High Trust */}
            <div className="bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-[#d5e3fc] flex items-center justify-center">
                  <span className="material-symbols-outlined text-base text-[#16a34a]">check_circle</span>
                </div>
                <span className="text-sm font-semibold text-[#191c1e]">양호</span>
              </div>
              <p className="text-3xl font-bold text-[#16a34a]">{scores.filter(d => d.trust_score >= 0.8).length}</p>
              <p className="text-xs text-[#757684] mt-1">80% 이상</p>
            </div>

            {/* Low Trust */}
            <div className="bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-[#ffdad6] flex items-center justify-center">
                  <span className="material-symbols-outlined text-base text-[#ba1a1a]">warning</span>
                </div>
                <span className="text-sm font-semibold text-[#191c1e]">주의 필요</span>
              </div>
              <p className="text-3xl font-bold text-[#ba1a1a]">{scores.filter(d => d.trust_score < 0.5).length}</p>
              <p className="text-xs text-[#757684] mt-1">50% 미만</p>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border border-[#c4c5d5] rounded-xl overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e0e3e5] bg-[#f7f9fb]">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-[#444653]">문서명</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">신뢰도</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">프로그래스</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">상태</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((doc) => {
                  const pct = Math.round(doc.trust_score * 100)
                  return (
                    <tr key={doc.id} className={`border-b border-[#e0e3e5] last:border-0 hover:bg-[#f7f9fb] transition-colors ${doc.trust_score < 0.5 ? "bg-[#ffdad6]/10" : ""}`}>
                      <td className="px-6 py-3">
                        <Link to={`/documents/${doc.id}`} className="text-sm font-medium text-[#191c1e] hover:text-[#00288e]">
                          {doc.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${getScoreDot(doc.trust_score)}`} />
                          <span className="text-sm font-semibold text-[#191c1e]">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="w-32 h-2 bg-[#e0e3e5] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              pct >= 80 ? "bg-[#16a34a]" : pct >= 50 ? "bg-[#d97706]" : "bg-[#ba1a1a]"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          pct >= 80 ? "bg-[#d5e3fc] text-[#00288e]"
                          : pct >= 50 ? "bg-[#ffdbce] text-[#611e00]"
                          : "bg-[#ffdad6] text-[#93000a]"
                        }`}>
                          {pct >= 80 ? "양호" : pct >= 50 ? "경고" : "위험"}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
