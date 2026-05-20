import { useState, useRef, useEffect } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import jsPDF from "jspdf"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { api } from "@/lib/api"
import { useApi } from "@/hooks/useApi"

export function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: doc } = useApi(() => api.getDocument(id!), [id])
  const { data: versions } = useApi(() => api.getVersions(id!), [id])

  const [deleteStep, setDeleteStep] = useState<"idle" | "confirm">("idle")
  const [deleting, setDeleting] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.deleteDocument(id!)
      navigate("/documents")
    } finally {
      setDeleting(false)
    }
  }

  const handleExport = async (format: "txt" | "md") => {
    setExportOpen(false)
    const resp = await api.exportDocument(id!, format)
    if (!resp.ok) return
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${doc?.title ?? "document"}.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportPdf = async () => {
    setExportOpen(false)
    if (!doc || !contentRef.current) return
    setExporting(true)
    try {
      const html2canvas = (await import("html2canvas")).default
      const canvas = await html2canvas(contentRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
      })
      const pdf = new jsPDF({ unit: "px", format: "a4" })
      const pdfWidth = pdf.internal.pageSize.getWidth()
      const pdfHeight = pdf.internal.pageSize.getHeight()
      const margin = 32
      const contentWidth = pdfWidth - margin * 2
      const imgHeight = (canvas.height * contentWidth) / canvas.width
      let remainingHeight = imgHeight
      let srcY = 0

      while (remainingHeight > 0) {
        const pageContentHeight = pdfHeight - margin * 2
        const sliceHeight = Math.min(remainingHeight, pageContentHeight)
        const sliceCanvas = document.createElement("canvas")
        sliceCanvas.width = canvas.width
        sliceCanvas.height = (sliceHeight * canvas.width) / contentWidth
        const ctx = sliceCanvas.getContext("2d")!
        ctx.drawImage(canvas, 0, srcY, canvas.width, sliceCanvas.height, 0, 0, canvas.width, sliceCanvas.height)
        pdf.addImage(sliceCanvas.toDataURL("image/png"), "PNG", margin, margin, contentWidth, sliceHeight)
        remainingHeight -= sliceHeight
        srcY += sliceCanvas.height
        if (remainingHeight > 0) pdf.addPage()
      }

      pdf.save(`${doc.title}.pdf`)
    } finally {
      setExporting(false)
    }
  }

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
          {doc.tags && doc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {doc.tags.map(tag => {
                const depth = tag.split("/").length
                const colorClass = depth === 1 ? "bg-[#dde1ff] text-[#00288e]" : depth === 2 ? "bg-[#d5e3fc] text-[#1a56db]" : "bg-[#e8f0fe] text-[#444653]"
                return (
                  <span key={tag} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${colorClass}`}>
                    {tag.split("/").map((part, i) => (
                      <span key={i} className="flex items-center gap-0.5">
                        {i > 0 && <span className="opacity-40 text-[10px]">/</span>}
                        {part}
                      </span>
                    ))}
                  </span>
                )
              })}
            </div>
          )}
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

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* 편집 */}
          <Link
            to={`/documents/${id}/edit`}
            className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors"
          >
            <span className="material-symbols-outlined text-base">edit</span>
            편집
          </Link>

          {/* 삭제 — 2단계 confirm */}
          {deleteStep === "idle" ? (
            <button
              onClick={() => setDeleteStep("confirm")}
              className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#444653] hover:bg-[#fff0f0] hover:border-[#ba1a1a] hover:text-[#ba1a1a] transition-colors"
            >
              <span className="material-symbols-outlined text-base">delete</span>
              삭제
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-2 border border-[#ba1a1a] rounded-lg bg-[#fff0f0]">
              <span className="text-xs text-[#ba1a1a] font-medium">정말 삭제할까요?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1 bg-[#ba1a1a] text-white text-xs rounded-md font-medium hover:bg-[#93000a] transition-colors disabled:opacity-50"
              >
                {deleting ? "삭제 중..." : "삭제"}
              </button>
              <button
                onClick={() => setDeleteStep("idle")}
                className="px-3 py-1 text-xs text-[#444653] hover:text-[#191c1e] transition-colors"
              >
                취소
              </button>
            </div>
          )}

          {/* 내보내기 드롭다운 */}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setExportOpen(o => !o)}
              className="flex items-center gap-2 px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm"
            >
              <span className="material-symbols-outlined text-base">download</span>
              내보내기
              <span className="material-symbols-outlined text-sm">expand_more</span>
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-[#c4c5d5] rounded-lg shadow-lg z-10 overflow-hidden">
                <button
                  onClick={() => handleExport("txt")}
                  className="w-full px-4 py-2.5 text-left text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-base text-[#757684]">description</span>
                  텍스트 (.txt)
                </button>
                <button
                  onClick={() => handleExport("md")}
                  className="w-full px-4 py-2.5 text-left text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-base text-[#757684]">code</span>
                  마크다운 (.md)
                </button>
                <button
                  onClick={handleExportPdf}
                  disabled={exporting}
                  className="w-full px-4 py-2.5 text-left text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-base text-[#757684]">picture_as_pdf</span>
                  {exporting ? "생성 중..." : "PDF (.pdf)"}
                </button>
              </div>
            )}
          </div>
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
                <div ref={contentRef} className="prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {versions[0].content}
                  </ReactMarkdown>
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
              {doc.document_type && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#757684]">문서 유형</span>
                  <span className="text-[#191c1e]">{doc.document_type === "user_manual" ? "사용자 매뉴얼" : doc.document_type === "operation_guide" ? "운영 가이드" : doc.document_type}</span>
                </div>
              )}
              {doc.domain && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#757684]">도메인</span>
                  <span className="text-[#191c1e]">{doc.domain}</span>
                </div>
              )}
              {doc.audience && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#757684]">대상</span>
                  <span className="text-[#191c1e]">{doc.audience === "operator" ? "운영자" : doc.audience === "developer" ? "개발자" : doc.audience}</span>
                </div>
              )}
              {(doc.source_type || doc.source_file_url || doc.jira_issue_key) && (
                <div className="flex justify-between text-xs gap-2">
                  <span className="text-[#757684] shrink-0">출처</span>
                  <span className="text-[#191c1e] text-right break-all">
                    {doc.source_type === "upload" && doc.source_file_url
                      ? doc.source_file_url.split("/").pop()
                      : doc.source_type === "jira_sr"
                      ? `Jira ${doc.jira_issue_key || ""}`
                      : doc.source_type === "playwright"
                      ? "자동 생성 (Playwright)"
                      : doc.source_type === "feedback"
                      ? "피드백 기반"
                      : doc.source_type === "manual"
                      ? "직접 작성"
                      : doc.source_file_url
                      ? doc.source_file_url.split("/").pop()
                      : doc.source_type ?? "-"}
                  </span>
                </div>
              )}
              {doc.source_file_url && (
                <div className="pt-2 border-t border-[#e0e3e5]">
                  <a
                    href={doc.source_file_url}
                    download
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-[#c4c7c5] text-[#444653] hover:bg-[#f3f4f6] transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">download</span>
                    원본 파일 다운로드
                  </a>
                </div>
              )}
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
