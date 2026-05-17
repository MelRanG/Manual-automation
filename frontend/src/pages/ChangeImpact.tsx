import { api } from "@/lib/api"
import { useApi } from "@/hooks/useApi"

export function ChangeImpact() {
  const { data: analyses, loading } = useApi(() => api.listAnalyses(), [])

  const getStrategyStyle = (s: string) => {
    if (s === "update_all") return "bg-[#ffdad6] text-[#93000a]"
    if (s === "selective_update") return "bg-[#ffdbce] text-[#611e00]"
    return "bg-[#d5e3fc] text-[#00288e]"
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#191c1e]">변경 영향 분석</h2>
        <p className="text-sm text-[#444653] mt-1">변경사항이 문서 전반에 미치는 영향을 추적합니다.</p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#757684]">불러오는 중...</div>
      ) : !analyses || analyses.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">account_tree</span>
          <h3 className="mt-4 text-lg font-semibold text-[#191c1e]">아직 영향 분석이 없습니다</h3>
          <p className="mt-2 text-sm text-[#757684]">문서가 업데이트되면 자동으로 생성됩니다</p>
        </div>
      ) : (
        <div className="bg-white border border-[#c4c5d5] rounded-xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e0e3e5] bg-[#f7f9fb]">
                <th className="text-left px-6 py-3 text-xs font-semibold text-[#444653]">소스</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">권장 전략</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">사유</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">신뢰도</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">날짜</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((analysis) => (
                <tr key={analysis.id} className="border-b border-[#e0e3e5] last:border-0 hover:bg-[#f7f9fb] transition-colors">
                  <td className="px-6 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-[#e6e8ea] text-[#444653]">
                      {analysis.source_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStrategyStyle(analysis.recommended_strategy)}`}>
                      {analysis.recommended_strategy === "update_all" ? "전체 업데이트"
                        : analysis.recommended_strategy === "selective_update" ? "선택 업데이트"
                        : "변경 없음"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-[#191c1e] line-clamp-2 max-w-[300px]">{analysis.reasoning}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-semibold text-[#191c1e]">{Math.round(analysis.confidence * 100)}%</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#757684]">
                    {new Date(analysis.created_at).toLocaleDateString("ko-KR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
