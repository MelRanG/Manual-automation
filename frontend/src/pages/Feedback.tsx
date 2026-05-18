import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { api, type Document, type FeedbackReport, type ProposedChange } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"

interface DocumentPickerDropdownProps {
  value: string
  title: string
  onChange: (id: string, title: string) => void
  onClear: () => void
}

function DocumentPickerDropdown({ value, title, onChange, onClear }: DocumentPickerDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [documents, setDocuments] = useState<Document[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.listDocuments(0, 100).then(res => setDocuments(res.documents))
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const filtered = documents.filter(d =>
    d.title.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div ref={ref} className="relative">
      {value ? (
        <div className="flex items-center gap-2 px-3 py-2 border border-[#c4c5d5] rounded-lg bg-[#eeeeff]">
          <span className="material-symbols-outlined text-sm text-[#4a4bdc]">description</span>
          <span className="flex-1 text-sm text-[#4a4bdc] font-medium truncate">{title || value}</span>
          <button
            type="button"
            onClick={onClear}
            className="text-[#9a9bad] hover:text-[#1a1b25] transition-colors"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#9a9bad] hover:border-[#00288e] transition-colors"
        >
          관련 문서 선택 (선택사항)
        </button>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-[#4a4bdc] rounded-lg shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-[#e4e5f0]">
            <input
              autoFocus
              className="w-full text-sm outline-none placeholder-[#9a9bad]"
              placeholder="문서 검색..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-[#9a9bad]">검색 결과가 없습니다</li>
            ) : (
              filtered.map(doc => (
                <li
                  key={doc.id}
                  onClick={() => { onChange(doc.id, doc.title); setOpen(false); setQuery("") }}
                  className="px-4 py-3 cursor-pointer hover:bg-[#f0f0ff] border-b border-[#f0f0f5] last:border-0 transition-colors"
                >
                  <p className="text-sm font-semibold text-[#1a1b25]">{doc.title}</p>
                  <p className="text-xs text-[#5a5b6e] mt-0.5 truncate">{doc.description ?? "설명 없음"}</p>
                  <p className="text-[10px] text-[#9a9bad] mt-1">
                    최근 수정 · {new Date(doc.updated_at).toLocaleDateString("ko-KR")}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

export function Feedback() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: feedback, refetch } = useApi(() => api.listFeedback(), [])
  const [showCreate, setShowCreate] = useState(false)
  const [text, setText] = useState("")
  const [docId, setDocId] = useState("")
  const [docTitle, setDocTitle] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [result, setResult] = useState<{ feedback: FeedbackReport; proposed_change: ProposedChange | null } | null>(null)

  const handleSubmit = async () => {
    if (!text.trim() || !user?.id) return
    setSubmitting(true)
    try {
      const res = await api.createFeedback({
        user_id: user.id,
        document_id: docId || undefined,
        feedback_text: text,
      })
      setResult(res)
      setText("")
      setDocId("")
      setDocTitle("")
      refetch()
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("이 오류 제보를 삭제하시겠습니까?")) return
    setDeleting(id)
    try {
      await api.deleteFeedback(id)
      refetch()
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#191c1e]">오류 제보</h2>
          <p className="text-sm text-[#444653] mt-1">오류를 제보하면 AI가 수정안을 자동 생성합니다.</p>
        </div>
        <button
          onClick={() => { setShowCreate(!showCreate); setResult(null) }}
          className="flex items-center gap-2 px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm"
        >
          <span className="material-symbols-outlined text-base">add</span>
          오류 제보
        </button>
      </div>

      {showCreate && (
        <div className="bg-white border border-[#00288e]/30 rounded-xl p-6 shadow-sm space-y-4">
          <DocumentPickerDropdown
            value={docId}
            title={docTitle}
            onChange={(id, title) => { setDocId(id); setDocTitle(title) }}
            onClear={() => { setDocId(""); setDocTitle("") }}
          />
          <textarea
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
            placeholder="발견한 오류나 문제를 설명해주세요..."
            rows={4}
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={submitting || !text.trim()} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors">
              {submitting ? "제출 중..." : "제보 제출"}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
          </div>
        </div>
      )}

      {result?.proposed_change && (
        <div className="bg-[#d5e3fc]/30 border border-[#d5e3fc] rounded-xl p-5 flex items-start gap-3">
          <span className="material-symbols-outlined text-lg text-[#16a34a]">check_circle</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#191c1e]">AI 수정안이 생성되었습니다</p>
            <p className="text-xs text-[#444653] mt-1">승인 관리에서 검토할 수 있습니다.</p>
          </div>
          <button
            onClick={() => navigate("/approvals")}
            className="px-3 py-1.5 text-xs font-medium text-[#00288e] border border-[#00288e]/40 rounded-lg hover:bg-[#dde1ff] transition-colors"
          >
            승인 관리로 이동
          </button>
        </div>
      )}

      {(!feedback || feedback.length === 0) ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">bug_report</span>
          <p className="mt-4 text-sm text-[#757684]">아직 오류 제보가 없습니다</p>
        </div>
      ) : (
        <div className="bg-white border border-[#c4c5d5] rounded-xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e0e3e5] bg-[#f7f9fb]">
                <th className="text-left px-6 py-3 text-xs font-semibold text-[#444653]">내용</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">문서</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">상태</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">날짜</th>
                <th className="w-12 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {feedback.map((fb) => (
                <tr key={fb.id} className="border-b border-[#e0e3e5] last:border-0 hover:bg-[#f7f9fb] transition-colors">
                  <td className="px-6 py-3">
                    <p className="text-sm text-[#191c1e] line-clamp-2">{fb.feedback_text}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#757684]">
                    {fb.document_title ?? (fb.document_id ? fb.document_id.slice(0, 8) + "..." : "-")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      fb.status === "processed" ? "bg-[#d5e3fc] text-[#16a34a]"
                      : fb.status === "pending" ? "bg-[#ffdbce] text-[#611e00]"
                      : "bg-[#e6e8ea] text-[#444653]"
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {fb.status === "processed" ? "수정안 생성됨" : fb.status === "pending" ? "대기중" : fb.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#757684]">
                    {new Date(fb.created_at).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="px-4 py-3 flex items-center gap-1">
                    {fb.status === "processed" && (
                      <button
                        onClick={() => navigate("/approvals")}
                        className="p-1 text-[#00288e] hover:bg-[#dde1ff] transition-colors rounded"
                        title="수정안 보기"
                      >
                        <span className="material-symbols-outlined text-sm">open_in_new</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(fb.id)}
                      disabled={deleting === fb.id}
                      className="p-1 text-[#757684] hover:text-[#ba1a1a] transition-colors disabled:opacity-50 rounded"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
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
