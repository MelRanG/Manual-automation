import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "@/lib/api"
import type { Document } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"

interface DashboardDoc {
  id: string
  title: string
  trust_score: number
  view_count: number
  updated_at: string | null
}

interface DashboardStats {
  low_trust: DashboardDoc[]
  most_errors: DashboardDoc[]
  pending_approvals: { id: string; proposed_change_id: string; status: string; created_at: string }[]
  most_viewed: DashboardDoc[]
  stale: DashboardDoc[]
  no_owner: DashboardDoc[]
}

export function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState({ docs: 0, manualReview: 0, feedback: 0, sr: 0 })
  const [recentDocs, setRecentDocs] = useState<Document[]>([])
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null)

  useEffect(() => {
    Promise.all([
      api.listDocuments(0, 5),
      api.listManualJobs(user?.id),
      api.listFeedback(),
      api.listSRDrafts(),
      fetch('/api/documents/stats/dashboard').then(r => r.json()),
    ]).then(([docs, manuals, feedback, sr, dashData]) => {
      const manualReview = manuals.filter(
        (j) => j.approval?.status === "pending" || j.approval?.status === "needs_review"
      ).length
      setStats({ docs: docs.total, manualReview, feedback: feedback.length, sr: sr.total })
      setRecentDocs(docs.documents.slice(0, 5))
      setDashboard(dashData)
    }).catch(() => {})
  }, [user?.id])

  const avgTrust = recentDocs.length > 0
    ? Math.round(recentDocs.reduce((sum, d) => sum + d.trust_score, 0) / recentDocs.length * 100)
    : 85

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#191c1e]">대시보드</h2>
          <p className="text-sm text-[#444653] mt-1">문서 생태계 전체 현황을 모니터링합니다.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
          <span className="material-symbols-outlined text-base">download</span>
          리포트 내보내기
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Trust Score */}
        <Link to="/trust" className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[#444653]">전체 문서 신뢰도</span>
            <div className="w-9 h-9 rounded-lg bg-[#dde1ff] flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-[#00288e]">verified</span>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-[#191c1e]">{avgTrust}%</span>
            <span className="text-xs text-[#16a34a] font-medium flex items-center gap-0.5 mb-1">
              <span className="material-symbols-outlined text-sm">trending_up</span>
              +2.4%
            </span>
          </div>
        </Link>

        {/* Manual Review */}
        <Link to="/manuals?tab=review" className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[#444653]">매뉴얼 검토 대기</span>
            <div className="w-9 h-9 rounded-lg bg-[#ffdbce] flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-[#611e00]">fact_check</span>
            </div>
          </div>
          <span className="text-3xl font-bold text-[#191c1e]">{stats.manualReview}</span>
        </Link>

        {/* Errors */}
        <Link to="/feedback" className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[#444653]">오류 제보</span>
            <div className="w-9 h-9 rounded-lg bg-[#ffdad6] flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-[#ba1a1a]">bug_report</span>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-[#191c1e]">{stats.feedback}</span>
          </div>
          <div className="h-1 bg-[#ffdad6] rounded-full mt-3">
            <div className="h-1 bg-[#ba1a1a] rounded-full" style={{ width: `${Math.min(stats.feedback * 10, 100)}%` }} />
          </div>
        </Link>

        {/* Jira SR */}
        <Link to="/sr" className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[#444653]">Jira SR</span>
            <div className="w-9 h-9 rounded-lg bg-[#d5e3fc] flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-[#1a56db]">task</span>
            </div>
          </div>
          <span className="text-3xl font-bold text-[#191c1e]">{stats.sr}</span>
        </Link>
      </div>

      {/* Charts + Errors Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trust Trend Chart */}
        <div className="lg:col-span-2 bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-base font-semibold text-[#191c1e]">신뢰도 추이</h3>
            <select className="text-xs border border-[#c4c5d5] rounded-lg px-3 py-1.5 text-[#444653] bg-white">
              <option>최근 7일</option>
              <option>최근 30일</option>
            </select>
          </div>
          <div className="flex items-end gap-3 h-40">
            {[72, 78, 74, 82, 85, 80, avgTrust].map((val, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full bg-[#dde1ff] rounded-t-md transition-all hover:bg-[#b8c4ff]" style={{ height: `${val}%` }} />
                <span className="text-[10px] text-[#757684]">{["월", "화", "수", "목", "금", "토", "일"][i]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Errors */}
        <div className="bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-semibold text-[#191c1e] mb-4">최근 오류</h3>
          <div className="space-y-3">
            {dashboard?.most_errors?.slice(0, 3).map((doc) => (
              <Link key={doc.id} to={`/documents/${doc.id}`} className="block p-3 border border-[#e0e3e5] rounded-lg hover:bg-[#f7f9fb] transition-colors">
                <div className="flex items-start justify-between">
                  <p className="text-sm text-[#191c1e] font-medium truncate flex-1">{doc.title}</p>
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#ffdad6] text-[#93000a]">치명적</span>
                </div>
              </Link>
            )) || (
              <p className="text-sm text-[#757684]">오류 제보가 없습니다</p>
            )}
          </div>
        </div>
      </div>

      {/* Documents Needing Review Table */}
      <div className="bg-white border border-[#c4c5d5] rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0e3e5]">
          <h3 className="text-base font-semibold text-[#191c1e]">검토 필요 문서</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#e0e3e5] bg-[#f7f9fb]">
              <th className="text-left px-6 py-2.5 text-xs font-semibold text-[#444653]">문서명</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#444653]">상태</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#444653]">신뢰도</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#444653]">수정일</th>
            </tr>
          </thead>
          <tbody>
            {(dashboard?.low_trust || recentDocs.filter(d => d.trust_score < 0.7)).slice(0, 5).map((doc) => (
              <tr key={doc.id} className="border-b border-[#e0e3e5] last:border-0 hover:bg-[#f7f9fb] transition-colors">
                <td className="px-6 py-3">
                  <Link to={`/documents/${doc.id}`} className="text-sm font-medium text-[#191c1e] hover:text-[#00288e]">{doc.title}</Link>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#ffdbce] text-[#611e00]">
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    검토 필요
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-semibold text-[#ba1a1a]">{Math.round(doc.trust_score * 100)}%</span>
                </td>
                <td className="px-4 py-3 text-xs text-[#757684]">
                  {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString("ko-KR") : "-"}
                </td>
              </tr>
            ))}
            {(!dashboard?.low_trust?.length && recentDocs.filter(d => d.trust_score < 0.7).length === 0) && (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-[#757684]">모든 문서가 양호합니다</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
