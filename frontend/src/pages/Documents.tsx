import { useState } from "react"
import { Link } from "react-router-dom"
import { api } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"

export function Documents() {
  const { user } = useAuth()
  const { data, loading, refetch } = useApi(() => api.listDocuments(0, 50), [])
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [content, setContent] = useState("")
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)

  const documents = data?.documents || []
  const filtered = documents.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase())
  )

  const handleCreate = async () => {
    if (!title.trim()) return
    setCreating(true)
    try {
      await api.createDocument({ title, description: description || undefined, owner_id: user?.id }, content)
      setTitle("")
      setDescription("")
      setContent("")
      setShowCreate(false)
      refetch()
    } finally {
      setCreating(false)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append("file", file)
    form.append("title", file.name)
    if (user?.id) form.append("owner_id", user.id)
    await api.uploadDocument(form)
    refetch()
  }

  const getScoreDot = (score: number) => {
    if (score >= 0.8) return "bg-[#16a34a]"
    if (score >= 0.5) return "bg-[#d97706]"
    return "bg-[#ba1a1a]"
  }

  const getScoreBg = (score: number) => {
    if (score >= 0.8) return "bg-[#d5e3fc] text-[#00288e]"
    if (score >= 0.5) return "bg-[#e6e8ea] text-[#444653]"
    return "bg-[#ffdad6] text-[#93000a]"
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#191c1e]">문서 관리</h2>
          <p className="text-sm text-[#444653] mt-1">등록된 문서의 버전, 신뢰도, 변경 이력을 관리합니다.</p>
        </div>
        <div className="flex gap-3">
          <label className="cursor-pointer flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
            <input type="file" className="hidden" onChange={handleUpload} accept=".txt,.md,.html,.json" />
            <span className="material-symbols-outlined text-base">upload_file</span>
            업로드
          </label>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm"
          >
            <span className="material-symbols-outlined text-base">add</span>
            새 문서
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm space-y-4">
          <input
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
            placeholder="문서 제목"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <input
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
            placeholder="설명 (선택)"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <textarea
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
            placeholder="문서 내용..."
            rows={6}
            value={content}
            onChange={e => setContent(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={creating || !title.trim()} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors">
              {creating ? "생성 중..." : "문서 생성"}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
          </div>
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#757684] text-lg">search</span>
          <input
            className="w-full pl-10 pr-4 py-2 bg-[#f2f4f6] border border-[#c4c5d5] rounded-full text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
            placeholder="문서명 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-[#757684]">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">description</span>
          <p className="mt-4 text-sm text-[#757684]">문서를 찾을 수 없습니다</p>
        </div>
      ) : (
        <div className="bg-white border border-[#c4c5d5] rounded-xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e0e3e5] bg-[#f7f9fb]">
                <th className="text-left px-6 py-3 text-xs font-semibold text-[#444653]">문서명</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">소유자</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">상태</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">신뢰도 점수</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">최근 수정일</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => (
                <tr
                  key={doc.id}
                  className={`group border-b border-[#e0e3e5] last:border-0 transition-colors hover:bg-[#f7f9fb] ${
                    doc.trust_score < 0.3 ? "bg-[#ffdad6]/10" : ""
                  }`}
                >
                  <td className="px-6 py-3">
                    <Link to={`/documents/${doc.id}`} className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-lg text-[#00288e]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        {doc.priority === "critical" ? "warning" : "description"}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-[#191c1e] group-hover:text-[#00288e] transition-colors">{doc.title}</p>
                        {doc.description && <p className="text-xs text-[#757684] truncate max-w-[250px]">{doc.description}</p>}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#444653]">{doc.owner_id ? doc.owner_id.slice(0, 8) : "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      doc.status === "active" ? "bg-[#d5e3fc] text-[#00288e]"
                      : doc.status === "stale" ? "bg-[#ffdbce] text-[#611e00]"
                      : "bg-[#e6e8ea] text-[#444653]"
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {doc.status === "active" ? "활성" : doc.status === "stale" ? "만료" : doc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${getScoreDot(doc.trust_score)}`} />
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${getScoreBg(doc.trust_score)}`}>
                        {Math.round(doc.trust_score * 100)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#757684]">
                    {new Date(doc.updated_at || doc.created_at).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="px-4 py-3">
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity text-[#757684] hover:text-[#191c1e]">
                      <span className="material-symbols-outlined text-lg">more_vert</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-3 border-t border-[#e0e3e5] bg-[#f7f9fb]">
            <p className="text-xs text-[#757684]">총 {data?.total || 0}개 문서</p>
          </div>
        </div>
      )}
    </div>
  )
}
