import { useState } from "react"
import { Link } from "react-router-dom"
import { api } from "@/lib/api"
import type { Document } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"
import { TagEditor } from "@/components/TagEditor"

// 최상위 태그 추출
function primaryTag(doc: Document): string {
  if (!doc.tags || doc.tags.length === 0) return "미분류"
  return doc.tags[0].split("/")[0]
}

// 태그 depth별 색상
function tagDepthColor(tag: string) {
  const depth = tag.split("/").length
  if (depth === 1) return "bg-[#dde1ff] text-[#00288e]"
  if (depth === 2) return "bg-[#d5e3fc] text-[#1a56db]"
  return "bg-[#e8f0fe] text-[#444653]"
}

interface UploadFile {
  file: File
  tags: string[]
  suggesting: boolean
}

export function Documents() {
  const { user } = useAuth()
  const { data, loading, refetch } = useApi(() => api.listDocuments(0, 50), [])

  // 새 문서 직접 작성
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [content, setContent] = useState("")
  const [newTags, setNewTags] = useState<string[]>([])
  const [creating, setCreating] = useState(false)

  // 업로드 모달
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)

  // 뷰 모드
  const [viewMode, setViewMode] = useState<"group" | "list">("group")
  const [search, setSearch] = useState("")
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const documents = data?.documents || []
  const filtered = documents.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    (d.tags || []).some(t => t.toLowerCase().includes(search.toLowerCase()))
  )

  // 태그별 그룹핑
  const groups: Record<string, Document[]> = {}
  for (const doc of filtered) {
    const key = primaryTag(doc)
    if (!groups[key]) groups[key] = []
    groups[key].push(doc)
  }
  const sortedGroups = Object.keys(groups).sort((a, b) => {
    if (a === "미분류") return 1
    if (b === "미분류") return -1
    return a.localeCompare(b)
  })

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) { next.delete(key) } else { next.add(key) }
      return next
    })
  }

  // 업로드: 파일 선택 → 모달
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploadFiles(Array.from(files).map(f => ({ file: f, tags: [], suggesting: false })))
    setUploadError(null)
    e.target.value = ""
  }

  const handleSuggestForFile = async (idx: number) => {
    const f = uploadFiles[idx]
    setUploadFiles(prev => prev.map((x, i) => i === idx ? { ...x, suggesting: true } : x))
    try {
      const title = f.file.name.replace(/\.[^.]+$/, "")
      const r = await api.suggestTagsForContent({ title, description: "", content: "" })
      setUploadFiles(prev => prev.map((x, i) => i === idx ? { ...x, tags: r.tags, suggesting: false } : x))
    } catch {
      setUploadFiles(prev => prev.map((x, i) => i === idx ? { ...x, suggesting: false } : x))
    }
  }

  const handleUploadConfirm = async () => {
    setUploading(true)
    setUploadError(null)
    setUploadProgress({ done: 0, total: uploadFiles.length })
    const errors: string[] = []
    try {
      for (let i = 0; i < uploadFiles.length; i++) {
        const { file, tags } = uploadFiles[i]
        const form = new FormData()
        form.append("file", file)
        form.append("title", file.name.replace(/\.[^.]+$/, ""))
        if (user?.id) form.append("owner_id", user.id)
        if (tags.length > 0) form.append("tags", JSON.stringify(tags))
        const res = await fetch("/api/documents/upload", { method: "POST", body: form })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          errors.push(`${file.name}: ${err.detail || res.status}`)
        }
        setUploadProgress({ done: i + 1, total: uploadFiles.length })
      }
      refetch()
      if (errors.length > 0) {
        setUploadError(errors.join(" / "))
      } else {
        setUploadFiles([])
      }
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "업로드 중 오류가 발생했습니다.")
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  const handleCreate = async () => {
    if (!title.trim()) return
    setCreating(true)
    try {
      await api.createDocument({ title, description: description || undefined, owner_id: user?.id, source_type: "manual", tags: newTags.length ? newTags : undefined }, content)
      setTitle(""); setDescription(""); setContent(""); setNewTags([])
      setShowCreate(false)
      refetch()
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteAll = async () => {
    if (!confirm("정말 모든 문서를 삭제하시겠습니까?")) return
    await fetch("/api/documents/all", { method: "DELETE" })
    refetch()
  }

  const getScoreDot = (score: number) => score >= 0.8 ? "bg-[#16a34a]" : score >= 0.5 ? "bg-[#d97706]" : "bg-[#ba1a1a]"
  const getScoreBg = (score: number) => score >= 0.8 ? "bg-[#d5e3fc] text-[#00288e]" : score >= 0.5 ? "bg-[#e6e8ea] text-[#444653]" : "bg-[#ffdad6] text-[#93000a]"

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#191c1e]">문서 관리</h2>
          <p className="text-sm text-[#444653] mt-1">등록된 문서의 버전, 신뢰도, 변경 이력을 관리합니다.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleDeleteAll} className="flex items-center gap-2 px-4 py-2 border border-[#ffdad6] text-[#ba1a1a] rounded-lg text-sm hover:bg-[#ffdad6]/30 transition-colors">
            <span className="material-symbols-outlined text-base">delete_sweep</span>전체 삭제
          </button>
          <label className="cursor-pointer flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
            <input type="file" className="hidden" multiple onChange={handleFileSelect} accept=".txt,.md,.html,.json,.csv,.docx,.xlsx,.xls,.pdf,.pptx,.ppt" />
            <span className="material-symbols-outlined text-base">upload_file</span>업로드
          </label>
          <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-2 px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm">
            <span className="material-symbols-outlined text-base">add</span>새 문서
          </button>
        </div>
      </div>

      {/* 업로드 태그 설정 모달 */}
      {uploadFiles.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0e3e5]">
              <h3 className="font-semibold text-[#191c1e]">파일 업로드 — 태그 설정</h3>
              <button onClick={() => setUploadFiles([])} className="text-[#757684] hover:text-[#191c1e]">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              {uploadFiles.map((uf, idx) => (
                <div key={idx} className="border border-[#e0e3e5] rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#00288e] text-lg">description</span>
                    <span className="text-sm font-medium text-[#191c1e] truncate">{uf.file.name}</span>
                    <span className="ml-auto text-xs text-[#757684]">{(uf.file.size / 1024).toFixed(0)} KB</span>
                  </div>
                  <TagEditor
                    tags={uf.tags}
                    onChange={tags => setUploadFiles(prev => prev.map((x, i) => i === idx ? { ...x, tags } : x))}
                    onSuggest={async () => {
                      await handleSuggestForFile(idx)
                      return uploadFiles[idx]?.tags ?? []
                    }}
                  />
                </div>
              ))}
              {uploadError && (
                <div className="px-4 py-3 bg-[#ffdad6] rounded-lg text-sm text-[#93000a]">{uploadError}</div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-[#e0e3e5] flex items-center justify-between">
              <span className="text-xs text-[#757684]">
                {uploadProgress ? `${uploadProgress.done}/${uploadProgress.total} 처리 중...` : `${uploadFiles.length}개 파일`}
              </span>
              <div className="flex gap-2">
                <button onClick={() => setUploadFiles([])} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
                <button
                  onClick={handleUploadConfirm}
                  disabled={uploading}
                  className="px-5 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {uploading && <span className="material-symbols-outlined text-sm animate-spin">refresh</span>}
                  {uploading ? "업로드 중..." : "업로드 확인"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 새 문서 폼 */}
      {showCreate && (
        <div className="bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm space-y-4">
          <input className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] outline-none" placeholder="문서 제목" value={title} onChange={e => setTitle(e.target.value)} />
          <input className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] outline-none" placeholder="설명 (선택)" value={description} onChange={e => setDescription(e.target.value)} />
          <textarea className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] outline-none resize-none" placeholder="문서 내용..." rows={6} value={content} onChange={e => setContent(e.target.value)} />
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[#191c1e]">태그</label>
            <TagEditor tags={newTags} onChange={setNewTags} onSuggest={() => api.suggestTagsForContent({ title, description, content }).then(r => r.tags)} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={creating || !title.trim()} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors">{creating ? "생성 중..." : "문서 생성"}</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
          </div>
        </div>
      )}

      {/* 검색 + 뷰 토글 */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#757684] text-lg">search</span>
          <input className="w-full pl-10 pr-4 py-2 bg-[#f2f4f6] border border-[#c4c5d5] rounded-full text-sm focus:border-[#00288e] outline-none" placeholder="문서명 또는 태그 검색..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex border border-[#c4c5d5] rounded-lg overflow-hidden">
          <button onClick={() => setViewMode("group")} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${viewMode === "group" ? "bg-[#00288e] text-white" : "text-[#444653] hover:bg-[#f2f4f6]"}`}>
            <span className="material-symbols-outlined text-sm">folder</span>태그별
          </button>
          <button onClick={() => setViewMode("list")} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${viewMode === "list" ? "bg-[#00288e] text-white" : "text-[#444653] hover:bg-[#f2f4f6]"}`}>
            <span className="material-symbols-outlined text-sm">list</span>목록
          </button>
        </div>
      </div>

      {/* 문서 목록 */}
      {loading ? (
        <div className="text-center py-12 text-[#757684]">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">description</span>
          <p className="mt-4 text-sm text-[#757684]">문서를 찾을 수 없습니다</p>
        </div>
      ) : viewMode === "group" ? (
        /* 태그별 그룹 뷰 */
        <div className="space-y-3">
          {sortedGroups.map(groupKey => {
            const docs = groups[groupKey]
            const collapsed = collapsedGroups.has(groupKey)
            return (
              <div key={groupKey} className="bg-white border border-[#c4c5d5] rounded-xl overflow-hidden shadow-sm">
                {/* 그룹 헤더 */}
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-full flex items-center gap-3 px-5 py-3 bg-[#f7f9fb] border-b border-[#e0e3e5] hover:bg-[#eef0ff] transition-colors"
                >
                  <span className="material-symbols-outlined text-base text-[#00288e]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {collapsed ? "folder" : "folder_open"}
                  </span>
                  <span className="font-semibold text-sm text-[#191c1e]">{groupKey}</span>
                  <span className="ml-1 px-2 py-0.5 bg-[#dde1ff] text-[#00288e] rounded-full text-[11px] font-semibold">{docs.length}</span>
                  <span className="ml-auto material-symbols-outlined text-sm text-[#757684]">{collapsed ? "expand_more" : "expand_less"}</span>
                </button>

                {/* 그룹 문서 목록 */}
                {!collapsed && (
                  <div>
                    {docs.map((doc, i) => (
                      <Link
                        key={doc.id}
                        to={`/documents/${doc.id}`}
                        className={`flex items-center gap-4 px-5 py-3 hover:bg-[#f7f9fb] transition-colors group ${i < docs.length - 1 ? "border-b border-[#f2f4f6]" : ""}`}
                      >
                        {/* 들여쓰기 구분선 */}
                        <div className="flex items-center gap-3 pl-5 border-l-2 border-[#dde1ff]">
                          <span className="material-symbols-outlined text-base text-[#757684]" style={{ fontVariationSettings: "'FILL' 1" }}>article</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#191c1e] group-hover:text-[#00288e] truncate transition-colors">{doc.title}</p>
                          {doc.tags && doc.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {doc.tags.map(tag => (
                                <span key={tag} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${tagDepthColor(tag)}`}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${getScoreBg(doc.trust_score)}`}>
                            {Math.round(doc.trust_score * 100)}%
                          </span>
                          <span className="text-xs text-[#757684]">{new Date(doc.updated_at || doc.created_at).toLocaleDateString("ko-KR")}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <p className="text-xs text-[#757684] px-1">총 {data?.total || 0}개 문서</p>
        </div>
      ) : (
        /* 일반 목록 뷰 */
        <div className="bg-white border border-[#c4c5d5] rounded-xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e0e3e5] bg-[#f7f9fb]">
                <th className="text-left px-6 py-3 text-xs font-semibold text-[#444653]">문서명</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">상태</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">신뢰도</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">수정일</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(doc => (
                <tr key={doc.id} className="group border-b border-[#e0e3e5] last:border-0 hover:bg-[#f7f9fb] transition-colors">
                  <td className="px-6 py-3">
                    <Link to={`/documents/${doc.id}`} className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-lg text-[#00288e]" style={{ fontVariationSettings: "'FILL' 1" }}>description</span>
                      <div>
                        <p className="text-sm font-medium text-[#191c1e] group-hover:text-[#00288e] transition-colors">{doc.title}</p>
                        {doc.tags && doc.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {doc.tags.slice(0, 3).map(tag => (
                              <span key={tag} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tagDepthColor(tag)}`}>{tag}</span>
                            ))}
                            {doc.tags.length > 3 && <span className="text-[10px] text-[#757684]">+{doc.tags.length - 3}</span>}
                          </div>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      doc.status === "active" ? "bg-[#d5e3fc] text-[#00288e]"
                      : doc.status === "converting" ? "bg-[#fff3cd] text-[#856404]"
                      : doc.status === "conversion_failed" ? "bg-[#ffdad6] text-[#93000a]"
                      : "bg-[#e6e8ea] text-[#444653]"
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {doc.status === "active" ? "활성"
                        : doc.status === "converting" ? "⏳ 변환 중"
                        : doc.status === "conversion_failed" ? "⚠ 변환 실패"
                        : doc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${getScoreDot(doc.trust_score)}`} />
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${getScoreBg(doc.trust_score)}`}>{Math.round(doc.trust_score * 100)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#757684]">{new Date(doc.updated_at || doc.created_at).toLocaleDateString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-6 py-3 border-t border-[#e0e3e5] bg-[#f7f9fb]">
            <p className="text-xs text-[#757684]">총 {data?.total || 0}개 문서</p>
          </div>
        </div>
      )}
    </div>
  )
}
