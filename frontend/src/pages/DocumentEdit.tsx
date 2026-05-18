import { useState, useEffect, useRef } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { api } from "@/lib/api"
import { useApi } from "@/hooks/useApi"

export function DocumentEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: doc } = useApi(() => api.getDocument(id!), [id])
  const { data: versions } = useApi(() => api.getVersions(id!), [id])

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [content, setContent] = useState("")
  const [changeSummary, setChangeSummary] = useState("")
  const contentInitialized = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (doc) {
      setTitle(doc.title)
      setDescription(doc.description ?? "")
    }
  }, [doc])

  useEffect(() => {
    if (versions && versions.length > 0 && !contentInitialized.current) {
      setContent(versions[0].content)
      contentInitialized.current = true
    }
  }, [versions])

  const handleSave = async () => {
    if (!title.trim()) {
      setError("제목을 입력해주세요.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.updateDocument(id!, {
        title: title.trim(),
        description: description.trim() || undefined,
        content,
        change_summary: changeSummary.trim() || undefined,
      })
      navigate(`/documents/${id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setSaving(false)
    }
  }

  if (!doc) return (
    <div className="p-8 flex items-center justify-center h-full">
      <div className="animate-pulse text-[#757684]">문서를 불러오는 중...</div>
    </div>
  )

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-[#444653]">
        <Link to="/documents" className="hover:text-[#00288e] transition-colors">문서 관리</Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <Link to={`/documents/${id}`} className="hover:text-[#00288e] transition-colors truncate max-w-[200px]">
          {doc.title}
        </Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="text-[#191c1e] font-medium">편집</span>
      </nav>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#191c1e]">문서 편집</h1>
      </div>

      <div className="bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm space-y-5">
        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[#191c1e]">제목 <span className="text-[#ba1a1a]">*</span></label>
          <input
            className="w-full px-4 py-2.5 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[#191c1e]">설명</label>
          <input
            className="w-full px-4 py-2.5 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
            placeholder="문서에 대한 설명 (선택)"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        {/* Content */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[#191c1e]">본문</label>
          <textarea
            className="w-full px-4 py-3 border border-[#c4c5d5] rounded-lg text-sm font-mono focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none leading-relaxed"
            rows={20}
            value={content}
            onChange={e => setContent(e.target.value)}
          />
        </div>

        {/* Change Summary */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[#191c1e]">변경 요약</label>
          <input
            className="w-full px-4 py-2.5 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
            placeholder="이번 변경 내용을 간략히 기록 (선택, 버전 이력에 표시됨)"
            value={changeSummary}
            onChange={e => setChangeSummary(e.target.value)}
          />
        </div>

        {error && (
          <p className="text-sm text-[#ba1a1a] bg-[#ffdad6] px-4 py-2.5 rounded-lg">{error}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Link
            to={`/documents/${id}`}
            className="px-5 py-2.5 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors"
          >
            취소
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  )
}
