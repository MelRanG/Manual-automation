# 문서 편집·삭제·내보내기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/documents/:id` 문서 상세 페이지에서 문서 편집(전용 페이지), 소프트 삭제, txt/md/pdf 내보내기를 동작하게 한다.

**Architecture:** 백엔드에 `PATCH /api/documents/{id}`, `DELETE /api/documents/{id}`, `GET /api/documents/{id}/export` 3개 엔드포인트를 추가하고, 프론트엔드에 `DocumentEdit` 페이지를 신규 생성하며 `DocumentDetail`의 버튼들을 실제 동작하도록 연결한다. PDF 내보내기는 `jsPDF`로 클라이언트에서 처리한다.

**Tech Stack:** Python FastAPI, SQLAlchemy async, pytest, React 19 + TypeScript, jsPDF, Tailwind CSS

---

## 파일 맵

| 작업 | 파일 |
|------|------|
| 수정 | `backend/app/routers/documents.py` |
| 수정 | `backend/app/services/document_service.py` |
| 수정 | `backend/app/schemas/document.py` |
| 수정 | `backend/tests/test_documents.py` |
| 수정 | `backend/app/routers/documents.py` (list 필터) |
| 신규 | `frontend/src/pages/DocumentEdit.tsx` |
| 수정 | `frontend/src/pages/DocumentDetail.tsx` |
| 수정 | `frontend/src/lib/api.ts` |
| 수정 | `frontend/src/App.tsx` |

---

### Task 1: 백엔드 — `PATCH /api/documents/{id}` (문서 수정)

**Files:**
- Modify: `backend/app/schemas/document.py`
- Modify: `backend/app/services/document_service.py`
- Modify: `backend/app/routers/documents.py`
- Test: `backend/tests/test_documents.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_documents.py` 끝에 추가:

```python
@pytest.mark.asyncio
async def test_update_document(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Original Title",
        "owner_id": test_user["id"],
    }, params={"content": "original content"})
    doc_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/documents/{doc_id}", json={
        "title": "Updated Title",
        "content": "updated content",
        "change_summary": "제목 및 내용 변경",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Updated Title"

    versions_resp = await client.get(f"/api/documents/{doc_id}/versions")
    assert len(versions_resp.json()) == 2


@pytest.mark.asyncio
async def test_update_document_not_found(client: AsyncClient):
    resp = await client.patch(
        "/api/documents/00000000-0000-0000-0000-000000000000",
        json={"title": "X"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_document_metadata_only(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Meta Only",
        "owner_id": test_user["id"],
    }, params={"content": "content stays"})
    doc_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/documents/{doc_id}", json={"title": "New Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New Title"

    versions_resp = await client.get(f"/api/documents/{doc_id}/versions")
    assert len(versions_resp.json()) == 1  # content 미변경이면 새 버전 없음
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd backend && uv run pytest tests/test_documents.py::test_update_document tests/test_documents.py::test_update_document_not_found tests/test_documents.py::test_update_document_metadata_only -v
```

Expected: FAIL (404 또는 method not allowed)

- [ ] **Step 3: `DocumentUpdate` 스키마 추가**

`backend/app/schemas/document.py`의 `DocumentCreate` 아래에 추가:

```python
class DocumentUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    content: str | None = None
    change_summary: str | None = None
```

- [ ] **Step 4: `update_document` 서비스 함수 추가**

`backend/app/services/document_service.py`의 `get_document_versions` 함수 위에 추가:

```python
async def update_document(
    db: AsyncSession,
    document_id: uuid.UUID,
    title: str | None = None,
    description: str | None = None,
    content: str | None = None,
    change_summary: str | None = None,
) -> Document:
    doc = await get_document(db, document_id)
    if not doc:
        raise ValueError("Document not found")

    if title is not None:
        doc.title = title
    if description is not None:
        doc.description = description

    if content is not None:
        await create_new_version(db, document_id, content, change_summary=change_summary)
        await db.refresh(doc)
    else:
        await db.commit()
        await db.refresh(doc)

    return doc
```

- [ ] **Step 5: `PATCH` 엔드포인트 추가**

`backend/app/routers/documents.py`의 import에 `DocumentUpdate` 추가:

```python
from app.schemas.document import (
    DocumentCreate,
    DocumentUpdate,
    DocumentResponse,
    DocumentListResponse,
    DocumentVersionResponse,
)
```

그리고 `create_version` 엔드포인트 아래에 추가:

```python
@router.patch("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: uuid.UUID,
    data: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        doc = await document_service.update_document(
            db,
            document_id,
            title=data.title,
            description=data.description,
            content=data.content,
            change_summary=data.change_summary,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_documents.py::test_update_document tests/test_documents.py::test_update_document_not_found tests/test_documents.py::test_update_document_metadata_only -v
```

Expected: 3 passed

- [ ] **Step 7: 커밋**

```bash
git add backend/app/schemas/document.py backend/app/services/document_service.py backend/app/routers/documents.py backend/tests/test_documents.py
git commit -m "feat: PATCH /api/documents/{id} — 문서 수정 엔드포인트 추가"
```

---

### Task 2: 백엔드 — `DELETE /api/documents/{id}` (소프트 삭제) + 목록 필터

**Files:**
- Modify: `backend/app/services/document_service.py`
- Modify: `backend/app/routers/documents.py`
- Test: `backend/tests/test_documents.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_documents.py` 끝에 추가:

```python
@pytest.mark.asyncio
async def test_delete_document(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "To Be Deleted",
        "owner_id": test_user["id"],
    }, params={"content": "content"})
    doc_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/documents/{doc_id}")
    assert resp.status_code == 200
    assert resp.json()["message"] == "archived"

    # 목록에서 사라져야 함
    list_resp = await client.get("/api/documents")
    ids = [d["id"] for d in list_resp.json()["documents"]]
    assert doc_id not in ids


@pytest.mark.asyncio
async def test_delete_document_not_found(client: AsyncClient):
    resp = await client.delete("/api/documents/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd backend && uv run pytest tests/test_documents.py::test_delete_document tests/test_documents.py::test_delete_document_not_found -v
```

Expected: FAIL

- [ ] **Step 3: `archive_document` 서비스 함수 추가**

`backend/app/services/document_service.py`의 `update_document` 아래에 추가:

```python
async def archive_document(db: AsyncSession, document_id: uuid.UUID) -> Document:
    doc = await get_document(db, document_id)
    if not doc:
        raise ValueError("Document not found")
    doc.status = "archived"
    await db.commit()
    await db.refresh(doc)
    return doc
```

- [ ] **Step 4: 목록 쿼리에 archived 필터 추가**

`backend/app/services/document_service.py`의 `list_documents` 함수를 다음으로 교체:

```python
async def list_documents(
    db: AsyncSession, skip: int = 0, limit: int = 20
) -> tuple[list[Document], int]:
    base_filter = Document.status != "archived"

    count_result = await db.execute(select(func.count(Document.id)).where(base_filter))
    total = count_result.scalar_one()

    result = await db.execute(
        select(Document)
        .where(base_filter)
        .order_by(Document.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all()), total
```

- [ ] **Step 5: `DELETE` 엔드포인트 추가**

`backend/app/routers/documents.py`의 `update_document` 엔드포인트 아래에 추가:

```python
@router.delete("/{document_id}")
async def delete_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    try:
        await document_service.archive_document(db, document_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"message": "archived"}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_documents.py::test_delete_document tests/test_documents.py::test_delete_document_not_found tests/test_documents.py::test_list_documents -v
```

Expected: 3 passed

- [ ] **Step 7: 커밋**

```bash
git add backend/app/services/document_service.py backend/app/routers/documents.py backend/tests/test_documents.py
git commit -m "feat: DELETE /api/documents/{id} — 소프트 삭제 및 목록 archived 필터 추가"
```

---

### Task 3: 백엔드 — `GET /api/documents/{id}/export?format=txt|md`

**Files:**
- Modify: `backend/app/routers/documents.py`
- Test: `backend/tests/test_documents.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_documents.py` 끝에 추가:

```python
@pytest.mark.asyncio
async def test_export_document_txt(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Export Me",
        "owner_id": test_user["id"],
    }, params={"content": "export content"})
    doc_id = create_resp.json()["id"]

    resp = await client.get(f"/api/documents/{doc_id}/export?format=txt")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    assert "attachment" in resp.headers["content-disposition"]
    assert resp.text == "export content"


@pytest.mark.asyncio
async def test_export_document_md(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Export MD",
        "owner_id": test_user["id"],
    }, params={"content": "# heading"})
    doc_id = create_resp.json()["id"]

    resp = await client.get(f"/api/documents/{doc_id}/export?format=md")
    assert resp.status_code == 200
    assert "text/markdown" in resp.headers["content-type"]
    assert resp.text == "# heading"


@pytest.mark.asyncio
async def test_export_document_invalid_format(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/documents", json={
        "title": "Export Bad",
        "owner_id": test_user["id"],
    }, params={"content": "x"})
    doc_id = create_resp.json()["id"]

    resp = await client.get(f"/api/documents/{doc_id}/export?format=docx")
    assert resp.status_code == 400
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd backend && uv run pytest tests/test_documents.py::test_export_document_txt tests/test_documents.py::test_export_document_md tests/test_documents.py::test_export_document_invalid_format -v
```

Expected: FAIL

- [ ] **Step 3: export 엔드포인트 추가**

`backend/app/routers/documents.py`의 import에 `Response` 추가:

```python
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
```

그리고 `delete_document` 엔드포인트 아래에 추가:

```python
@router.get("/{document_id}/export")
async def export_document(
    document_id: uuid.UUID,
    format: str = "txt",
    db: AsyncSession = Depends(get_db),
):
    if format not in ("txt", "md"):
        raise HTTPException(status_code=400, detail="format must be txt or md")

    doc = await document_service.get_document(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    versions = await document_service.get_document_versions(db, document_id)
    content = versions[0].content if versions else ""

    safe_title = doc.title.replace("/", "_").replace("\\", "_")
    media_type = "text/plain" if format == "txt" else "text/markdown"

    return Response(
        content=content,
        media_type=f"{media_type}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.{format}"'},
    )
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_documents.py::test_export_document_txt tests/test_documents.py::test_export_document_md tests/test_documents.py::test_export_document_invalid_format -v
```

Expected: 3 passed

- [ ] **Step 5: 전체 문서 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_documents.py -v
```

Expected: all passed

- [ ] **Step 6: 커밋**

```bash
git add backend/app/routers/documents.py backend/tests/test_documents.py
git commit -m "feat: GET /api/documents/{id}/export — txt/md 내보내기 엔드포인트 추가"
```

---

### Task 4: 프론트엔드 — `api.ts`에 함수 3개 추가

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: `api.ts`에 함수 추가**

`frontend/src/lib/api.ts`의 `api` 객체 안, `uploadDocument` 줄 바로 아래에 다음 3개 추가:

```ts
  updateDocument: (id: string, data: { title?: string; description?: string; content?: string; change_summary?: string }) =>
    request<Document>(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDocument: (id: string) =>
    request<{ message: string }>(`/documents/${id}`, { method: 'DELETE' }),
  exportDocument: (id: string, format: 'txt' | 'md') =>
    fetch(`${BASE}/documents/${id}/export?format=${format}`, { headers: getAuthHeaders() }),
```

- [ ] **Step 2: 타입 체크**

```bash
cd frontend && pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: api.ts — updateDocument, deleteDocument, exportDocument 함수 추가"
```

---

### Task 5: 프론트엔드 — `DocumentEdit` 페이지 신규 생성

**Files:**
- Create: `frontend/src/pages/DocumentEdit.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: `DocumentEdit.tsx` 생성**

`frontend/src/pages/DocumentEdit.tsx`를 새로 만든다:

```tsx
import { useState, useEffect } from "react"
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (doc) {
      setTitle(doc.title)
      setDescription(doc.description ?? "")
    }
  }, [doc])

  useEffect(() => {
    if (versions && versions.length > 0) {
      setContent(versions[0].content)
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
```

- [ ] **Step 2: `App.tsx`에 라우트 추가**

`frontend/src/App.tsx`에서 `DocumentDetail` import 아래에 추가:

```tsx
import { DocumentEdit } from "@/pages/DocumentEdit"
```

그리고 Routes 안의 `/documents/:id` 라우트 아래에 추가:

```tsx
<Route path="/documents/:id/edit" element={<DocumentEdit />} />
```

- [ ] **Step 3: 타입 체크**

```bash
cd frontend && pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/DocumentEdit.tsx frontend/src/App.tsx
git commit -m "feat: DocumentEdit 페이지 추가 (/documents/:id/edit)"
```

---

### Task 6: 프론트엔드 — `DocumentDetail` 편집·삭제·내보내기 버튼 연결

**Files:**
- Modify: `frontend/src/pages/DocumentDetail.tsx`

이 태스크에서 `jsPDF` 설치도 진행한다.

- [ ] **Step 1: jsPDF 설치**

```bash
cd frontend && pnpm add jspdf
```

- [ ] **Step 2: `DocumentDetail.tsx` 전체 교체**

`frontend/src/pages/DocumentDetail.tsx`를 다음으로 교체:

```tsx
import { useState, useRef, useEffect } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import jsPDF from "jspdf"
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
  const exportRef = useRef<HTMLDivElement>(null)

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

  const handleExportPdf = () => {
    setExportOpen(false)
    if (!doc || !versions || versions.length === 0) return
    const pdf = new jsPDF()
    const content = versions[0].content
    const pageWidth = pdf.internal.pageSize.getWidth()
    const margin = 20
    const maxWidth = pageWidth - margin * 2

    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(16)
    pdf.text(doc.title, margin, 20)

    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(10)
    let y = 32

    const lines = pdf.splitTextToSize(content, maxWidth) as string[]
    for (const line of lines) {
      if (y > 270) {
        pdf.addPage()
        y = 20
      }
      pdf.text(line, margin, y)
      y += 6
    }

    pdf.save(`${doc.title}.pdf`)
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
                  className="w-full px-4 py-2.5 text-left text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-base text-[#757684]">picture_as_pdf</span>
                  PDF (.pdf)
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
```

- [ ] **Step 3: 타입 체크**

```bash
cd frontend && pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: 린트 체크**

```bash
cd frontend && pnpm lint
```

Expected: no errors

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/pages/DocumentDetail.tsx
git commit -m "feat: DocumentDetail — 편집·삭제·내보내기 버튼 실제 동작 연결"
```

---

### Task 7: 전체 검증

- [ ] **Step 1: 백엔드 전체 테스트**

```bash
cd backend && uv run pytest tests/test_documents.py -v
```

Expected: all passed

- [ ] **Step 2: 프론트엔드 타입 체크 + 린트**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: no errors

- [ ] **Step 3: 커밋 (변경 없으면 스킵)**

```bash
git status
```

변경 파일이 있으면 커밋. 없으면 스킵.
