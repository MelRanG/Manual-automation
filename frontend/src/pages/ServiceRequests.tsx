import { useState } from "react"
import { api } from "@/lib/api"
import { useApi } from "@/hooks/useApi"

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001"

export function ServiceRequests() {
  const { data: drafts, refetch } = useApi(() => api.listSRDrafts(), [])
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("medium")
  const [submitting, setSubmitting] = useState(false)

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) return
    setSubmitting(true)
    try {
      await api.createSRDraft({ user_id: DEMO_USER_ID, title, description, priority })
      setTitle("")
      setDescription("")
      setShowCreate(false)
      refetch()
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (id: string) => {
    await api.submitSR(id)
    refetch()
  }

  const getPriorityStyle = (p: string) => {
    if (p === "critical") return "bg-[#ffdad6] text-[#93000a]"
    if (p === "high") return "bg-[#ffdbce] text-[#611e00]"
    return "bg-[#e6e8ea] text-[#444653]"
  }

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

      {(!drafts || drafts.length === 0) ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">confirmation_number</span>
          <p className="mt-4 text-sm text-[#757684]">아직 서비스 요청이 없습니다</p>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((sr) => (
            <div key={sr.id} className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className="w-10 h-10 rounded-lg bg-[#dde1ff] flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-lg text-[#00288e]">confirmation_number</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[#191c1e]">{sr.title}</p>
                      {sr.created_by_ai && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#dde1ff] text-[#00288e]">
                          <span className="material-symbols-outlined text-[12px]">auto_awesome</span>
                          AI
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#444653] mt-1 line-clamp-2">{sr.description}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${getPriorityStyle(sr.priority)}`}>
                        {sr.priority === "critical" ? "긴급" : sr.priority === "high" ? "높음" : sr.priority === "medium" ? "보통" : "낮음"}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        sr.status === "submitted" ? "bg-[#d5e3fc] text-[#16a34a]" : "bg-[#e6e8ea] text-[#444653]"
                      }`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {sr.status === "submitted" ? "제출됨" : "초안"}
                      </span>
                      <span className="text-[11px] text-[#757684]">{new Date(sr.created_at).toLocaleDateString("ko-KR")}</span>
                    </div>
                  </div>
                </div>
                {sr.status === "draft" && (
                  <button onClick={() => handleSubmit(sr.id)} className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
                    <span className="material-symbols-outlined text-base">send</span>
                    제출
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
