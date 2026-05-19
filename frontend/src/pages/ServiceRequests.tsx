import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { api, type SRDraft } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"

type Tab = "draft" | "active" | "done"

export function ServiceRequests() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab")
    return (t === "active" || t === "done") ? t : "draft"
  })
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("medium")
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: "", description: "", priority: "medium" })
  const [saving, setSaving] = useState(false)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  const userId = user?.id ?? "00000000-0000-0000-0000-000000000001"

  // 탭 배지용: active 건수 항상 별도 조회
  const { data: activeData, refetch: refetchCount } = useApi(
    () => api.listSRDrafts({ status: "active", skip: 0, limit: 500 }),
    []
  )
  const activeCount = activeData?.total ?? 0

  const { data: result, refetch: refetchMain } = useApi(
    () => api.listSRDrafts({ status: tab, skip: (page - 1) * pageSize, limit: pageSize }),
    [tab, page]
  )

  const items = result?.items ?? []
  const total = result?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)

  const refetch = () => { refetchMain(); refetchCount() }

  const handleTabChange = (t: Tab) => {
    setTab(t)
    setPage(1)
    setEditingId(null)
    setSearchParams({ tab: t })
  }

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) return
    setSubmitting(true)
    try {
      await api.createSRDraft({ user_id: userId, title, description, priority })
      setTitle("")
      setDescription("")
      setShowCreate(false)
      refetch()
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (id: string) => {
    setSubmittingId(id)
    try {
      await api.submitSR(id)
      refetch()
    } finally {
      setSubmittingId(null)
    }
  }

  const handleEditStart = (sr: SRDraft) => {
    setEditingId(sr.id)
    setEditForm({ title: sr.title, description: sr.description, priority: sr.priority })
  }

  const handleEditSave = async () => {
    if (!editingId) return
    if (!editForm.title.trim() || !editForm.description.trim()) return
    setSaving(true)
    try {
      await api.updateSRDraft(editingId, editForm)
      setEditingId(null)
      refetch()
    } finally {
      setSaving(false)
    }
  }

  const getPriorityStyle = (p: string) => {
    if (p === "critical") return "bg-[#ffdad6] text-[#93000a]"
    if (p === "high") return "bg-[#ffdbce] text-[#611e00]"
    return "bg-[#e6e8ea] text-[#444653]"
  }

  const getStatusLabel = (s: string) => {
    if (s === "done_synced") return "완료 동기화됨"
    if (s === "done_no_proposal") return "완료 (문서 없음)"
    if (s === "jira_created") return "Jira 생성됨"
    if (s === "submitted") return "제출됨"
    return "초안"
  }

  const getStatusStyle = (s: string) => {
    if (s === "done_synced") return "bg-[#d5e3fc] text-[#16a34a]"
    if (s === "done_no_proposal") return "bg-[#e6e8ea] text-[#444653]"
    if (s === "jira_created") return "bg-[#e8f0fe] text-[#1a56db]"
    if (s === "submitted") return "bg-[#d5e3fc] text-[#16a34a]"
    return "bg-[#e6e8ea] text-[#444653]"
  }

  const TAB_LABELS: { key: Tab; label: string }[] = [
    { key: "draft", label: "초안" },
    { key: "active", label: "진행중" },
    { key: "done", label: "완료" },
  ]

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#191c1e]">서비스 요청</h2>
          <p className="text-sm text-[#444653] mt-1">Jira SR 초안을 생성하고 관리합니다.</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm"
        >
          <span className="material-symbols-outlined text-base">add</span>
          새 SR
        </button>
      </div>

      {showCreate && (
        <div className="bg-white border border-[#00288e]/30 rounded-xl p-6 shadow-sm space-y-4">
          <input
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
            placeholder="SR 제목"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <textarea
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
            placeholder="상세 설명..."
            rows={3}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <select
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none bg-white"
            value={priority}
            onChange={e => setPriority(e.target.value)}
          >
            <option value="lowest">최저</option>
            <option value="low">낮음</option>
            <option value="medium">보통</option>
            <option value="high">높음</option>
            <option value="critical">긴급</option>
          </select>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={submitting} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors">
              {submitting ? "생성 중..." : "초안 생성"}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
          </div>
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-1 border-b border-[#e6e8ea]">
        {TAB_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? "border-[#00288e] text-[#00288e]"
                : "border-transparent text-[#757684] hover:text-[#191c1e]"
            }`}
          >
            {label}
            {key === "active" && activeCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-[#00288e] text-white">
                {activeCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* SR 목록 */}
      {items.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">confirmation_number</span>
          <p className="mt-4 text-sm text-[#757684]">
            {tab === "draft" ? "작성 중인 SR이 없습니다" : tab === "active" ? "진행 중인 SR이 없습니다" : "완료된 SR이 없습니다"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((sr) => (
            <div key={sr.id} className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
              {editingId === sr.id ? (
                <div className="space-y-3">
                  <input
                    className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
                    value={editForm.title}
                    onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  />
                  <textarea
                    className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
                    rows={3}
                    value={editForm.description}
                    onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  />
                  <select
                    className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none bg-white"
                    value={editForm.priority}
                    onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}
                  >
                    <option value="lowest">최저</option>
                    <option value="low">낮음</option>
                    <option value="medium">보통</option>
                    <option value="high">높음</option>
                    <option value="critical">긴급</option>
                  </select>
                  <div className="flex gap-2">
                    <button onClick={handleEditSave} disabled={saving} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors">
                      {saving ? "저장 중..." : "저장"}
                    </button>
                    <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-[#dde1ff] flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-lg text-[#00288e]">confirmation_number</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[#191c1e]">{sr.title}</p>
                        {sr.created_by_ai && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#dde1ff] text-[#00288e]">
                            <span className="material-symbols-outlined text-[12px]">auto_awesome</span>
                            AI
                          </span>
                        )}
                        {sr.jira_issue_key && sr.jira_issue_url && (
                          <a
                            href={sr.jira_issue_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#e8f0fe] text-[#1a56db] hover:bg-[#c7d7fb] transition-colors"
                            onClick={e => e.stopPropagation()}
                          >
                            <span className="material-symbols-outlined text-[12px]">link</span>
                            {sr.jira_issue_key}
                          </a>
                        )}
                      </div>
                      <p className="text-xs text-[#444653] mt-1 line-clamp-2">{sr.description}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${getPriorityStyle(sr.priority)}`}>
                          {sr.priority === "critical" ? "긴급" : sr.priority === "high" ? "높음" : sr.priority === "medium" ? "보통" : sr.priority === "low" ? "낮음" : "최저"}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStatusStyle(sr.status)}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {getStatusLabel(sr.status)}
                        </span>
                        <span className="text-[11px] text-[#757684]">{new Date(sr.created_at).toLocaleDateString("ko-KR")}</span>
                      </div>
                    </div>
                  </div>
                  {sr.status === "draft" && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleEditStart(sr)} className="flex items-center gap-1 px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#444653] hover:bg-[#f2f4f6] transition-colors">
                        <span className="material-symbols-outlined text-base">edit</span>
                      </button>
                      <button
                        onClick={() => handleSubmit(sr.id)}
                        disabled={submittingId === sr.id}
                        className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] disabled:opacity-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-base">send</span>
                        {submittingId === sr.id ? "제출 중..." : "제출"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-[#757684]">전체 {total}건</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm border border-[#c4c5d5] rounded-lg disabled:opacity-40 hover:bg-[#f2f4f6] transition-colors"
            >
              이전
            </button>
            <span className="text-sm text-[#444653]">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm border border-[#c4c5d5] rounded-lg disabled:opacity-40 hover:bg-[#f2f4f6] transition-colors"
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
