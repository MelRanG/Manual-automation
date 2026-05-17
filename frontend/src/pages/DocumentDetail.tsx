import { useParams, Link } from "react-router-dom"
import { api } from "@/lib/api"
import { useApi } from "@/hooks/useApi"

export function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: doc } = useApi(() => api.getDocument(id!), [id])
  const { data: versions } = useApi(() => api.getVersions(id!), [id])

  if (!doc) return (
    <div className="p-8 flex items-center justify-center h-full">
      <div className="animate-pulse text-[#757684]">문서를 불러오는 중...</div>
    </div>
  )

  const scorePercent = Math.round(doc.trust_score * 100)
  const scoreColor = scorePercent >= 80 ? "#16a34a" : scorePercent >= 50 ? "#d97706" : "#ba1a1a"
  const circumference = 2 * Math.PI * 36

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-[#444653]">
        <Link to="/documents" className="hover:text-[#00288e] transition-colors">문서 관리</Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="text-[#191c1e] font-medium truncate max-w-[300px]">{doc.title}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[#191c1e] leading-tight">{doc.title}</h1>
          {doc.description && <p className="text-sm text-[#444653] mt-2">{doc.description}</p>}
          <div className="flex items-center gap-4 mt-3">
            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${
              doc.status === "active"
                ? "bg-[#d5e3fc] text-[#00288e]"
                : "bg-[#e0e3e5] text-[#444653]"
            }`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {doc.status === "active" ? "활성" : doc.status}
            </span>
            {doc.owner_id && (
              <span className="text-xs text-[#444653] flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">person</span>
                {doc.owner_id.slice(0, 8)}
              </span>
            )}
            <span className="text-xs text-[#757684]">
              최종 수정: {new Date(doc.updated_at).toLocaleDateString("ko-KR")}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
            <span className="material-symbols-outlined text-base">edit</span>
            편집
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm">
            <span className="material-symbols-outlined text-base">download</span>
            내보내기
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Document Content */}
        <div className="lg:col-span-3">
          <div className="bg-white border border-[#c4c5d5] rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-3 border-b border-[#e0e3e5] bg-[#f7f9fb]">
              <div className="flex items-center gap-2 text-sm text-[#444653]">
                <span className="material-symbols-outlined text-base">article</span>
                문서 본문
              </div>
              <div className="flex items-center gap-2">
                {versions && versions.length > 0 && (
                  <span className="text-xs font-mono bg-[#eceef0] px-2 py-0.5 rounded text-[#444653]">
                    v{versions[0]?.version_number || 1}
                  </span>
                )}
              </div>
            </div>
            <div className="px-8 py-6">
              {versions && versions.length > 0 ? (
                <div className="prose prose-sm max-w-none text-[#191c1e] leading-relaxed">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-[#191c1e] bg-transparent p-0 border-none">
                    {versions[0].content}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-[#757684] italic">문서 내용이 없습니다.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Meta Panel */}
        <div className="space-y-4">
          {/* Trust Score */}
          <div className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-[#444653] mb-4 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">verified</span>
              신뢰도 점수
            </h3>
            <div className="flex items-center justify-center">
              <div className="relative w-24 h-24">
                <svg className="w-24 h-24 -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="36" fill="none" stroke="#e0e3e5" strokeWidth="6" />
                  <circle
                    cx="40" cy="40" r="36" fill="none" stroke={scoreColor} strokeWidth="6"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference - (circumference * scorePercent) / 100}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold" style={{ color: scoreColor }}>{scorePercent}%</span>
                </div>
              </div>
            </div>
            <p className="text-center text-xs text-[#757684] mt-3">
              {scorePercent >= 80 ? "신뢰도 양호" : scorePercent >= 50 ? "검토 권장" : "주의 필요"}
            </p>
          </div>

          {/* Document Info */}
          <div className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-xs font-semibold text-[#444653] flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">info</span>
              문서 정보
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[#757684]">생성일</span>
                <span className="text-[#191c1e]">{new Date(doc.created_at).toLocaleDateString("ko-KR")}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#757684]">버전 수</span>
                <span className="text-[#191c1e]">{versions?.length || 0}개</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#757684]">조회수</span>
                <span className="text-[#191c1e]">{doc.view_count || 0}회</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#757684]">우선순위</span>
                <span className="text-[#191c1e]">{doc.priority || "보통"}</span>
              </div>
            </div>
          </div>

          {/* Version Timeline */}
          {versions && versions.length > 0 && (
            <div className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-[#444653] mb-3 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">history</span>
                버전 히스토리
              </h3>
              <div className="space-y-0">
                {versions.slice(0, 5).map((v, i) => (
                  <div key={v.id} className="flex gap-3 pb-3 last:pb-0">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${i === 0 ? "bg-[#00288e]" : "bg-[#c4c5d5]"}`} />
                      {i < Math.min(versions.length, 5) - 1 && <div className="w-px flex-1 bg-[#c4c5d5] mt-1" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono bg-[#eceef0] px-1.5 py-0.5 rounded text-[#444653]">v{v.version_number}</span>
                        <span className="text-[10px] text-[#757684]">{new Date(v.created_at).toLocaleDateString("ko-KR")}</span>
                      </div>
                      {v.change_summary && <p className="text-xs text-[#444653] mt-1 truncate">{v.change_summary}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
