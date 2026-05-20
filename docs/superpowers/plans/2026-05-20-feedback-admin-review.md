# 오류 제보 관리자 검토 & 삭제 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오류 제보 페이지에 삭제, 문서 연결, 관리자 텍스트 편집, AI 초안 수동 요청 기능을 추가한다.

**Architecture:** 백엔드는 `FeedbackReport.reviewed_text` 컬럼을 추가하고, `create_feedback`의 AI 자동 호출을 제거한다. `POST /api/feedback/{id}/request-draft`(관리자가 수정한 텍스트로 AI 초안 생성)와 `PATCH /api/feedback/{id}/link-document`(문서 연결) 두 개의 엔드포인트를 추가한다. 프론트엔드 `Feedback.tsx`의 상세 패널에 삭제 버튼, 문서 연결 UI, 관리자 편집 영역을 인라인으로 추가한다.

**Tech Stack:** Python FastAPI, SQLAlchemy, Alembic, React, TypeScript

---

## 변경 파일 요약

| 파일 | 역할 |
|---|---|
| `backend/app/models/feedback.py` | `reviewed_text` 컬럼 추가 |
| `backend/alembic/versions/<hash>_add_reviewed_text_to_feedback_reports.py` | DB 마이그레이션 |
| `backend/app/schemas/feedback.py` | `reviewed_text`, `RequestDraftBody`, `LinkDocumentBody` 추가 |
| `backend/app/services/feedback_service.py` | `generate_correction`에서 `reviewed_text` 우선 사용 |
| `backend/app/routers/feedback.py` | 자동 AI 호출 제거, `request-draft`·`link-document` 엔드포인트 추가 |
| `backend/tests/test_feedback.py` | 기존 테스트 수정 + 신규 테스트 추가 |
| `frontend/src/lib/api.ts` | `requestDraft`, `linkDocument` 함수, `FeedbackReport` 타입 업데이트 |
| `frontend/src/pages/Feedback.tsx` | 삭제 버튼, 문서 연결 UI, 관리자 편집 영역 |

---

### Task 1: DB 모델에 reviewed_text 컬럼 추가 및 마이그레이션

**Files:**
- Modify: `backend/app/models/feedback.py`
- Create: `backend/alembic/versions/<hash>_add_reviewed_text_to_feedback_reports.py`

- [ ] **Step 1: FeedbackReport 모델에 컬럼 추가**

`backend/app/models/feedback.py`의 `feedback_text` 컬럼 바로 아래에 추가:

```python
    feedback_text: Mapped[str] = mapped_column(Text)
    reviewed_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
```

- [ ] **Step 2: 마이그레이션 생성**

```bash
cd backend && uv run alembic revision --autogenerate -m "add_reviewed_text_to_feedback_reports"
```

생성된 파일 확인 — `upgrade()`에 아래 내용이 있어야 함:
```python
op.add_column('feedback_reports', sa.Column('reviewed_text', sa.Text(), nullable=True))
```
없으면 직접 추가.

- [ ] **Step 3: 마이그레이션 실행**

```bash
cd backend && uv run alembic upgrade head
```

Expected: `Running upgrade c7924d7fdba0 -> <new_hash>, add_reviewed_text_to_feedback_reports`

- [ ] **Step 4: 커밋**

```bash
git add backend/app/models/feedback.py backend/alembic/versions/
git commit -m "feat: add reviewed_text column to feedback_reports"
```

---

### Task 2: 스키마 업데이트

**Files:**
- Modify: `backend/app/schemas/feedback.py`

- [ ] **Step 1: FeedbackReportResponse에 reviewed_text 추가**

`feedback_text: str` 아래에 추가:

```python
class FeedbackReportResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    document_id: uuid.UUID | None
    chunk_id: uuid.UUID | None
    chat_message_id: uuid.UUID | None
    feedback_text: str
    reviewed_text: str | None = None
    status: str
    document_title: str | None = None
    proposed_change_status: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: RequestDraftBody, LinkDocumentBody 스키마 추가**

파일 끝에 추가:

```python
class RequestDraftBody(BaseModel):
    reviewed_text: str


class LinkDocumentBody(BaseModel):
    document_id: uuid.UUID
```

- [ ] **Step 3: 커밋**

```bash
git add backend/app/schemas/feedback.py
git commit -m "feat: add reviewed_text, RequestDraftBody, LinkDocumentBody schemas"
```

---

### Task 3: feedback_service — generate_correction에서 reviewed_text 우선 사용

**Files:**
- Modify: `backend/app/services/feedback_service.py`

- [ ] **Step 1: AI 프롬프트 입력 텍스트를 reviewed_text 우선으로 변경**

`generate_correction` 함수 내에서 `llm.generate` 호출 직전, `original_text` 설정 블록 바로 아래를 찾아 수정:

기존:
```python
    llm = get_llm_provider()
    proposed_text = await llm.generate(
        CORRECTION_SYSTEM_PROMPT,
        f"Error report: {feedback.feedback_text}\n\nOriginal text:\n{original_text}",
    )
```

변경:
```python
    report_text = feedback.reviewed_text or feedback.feedback_text

    llm = get_llm_provider()
    proposed_text = await llm.generate(
        CORRECTION_SYSTEM_PROMPT,
        f"Error report: {report_text}\n\nOriginal text:\n{original_text}",
    )
```

또한 `reasoning` 라인도 `reviewed_text` 우선으로:

기존:
```python
        reasoning=f"AI correction based on feedback: {feedback.feedback_text[:200]}",
```

변경:
```python
        reasoning=f"AI correction based on feedback: {report_text[:200]}",
```

- [ ] **Step 2: 커밋**

```bash
git add backend/app/services/feedback_service.py
git commit -m "feat: use reviewed_text over feedback_text in generate_correction"
```

---

### Task 4: 라우터 — create_feedback 자동 호출 제거 + 신규 엔드포인트 추가

**Files:**
- Modify: `backend/app/routers/feedback.py`

- [ ] **Step 1: create_feedback에서 AI 자동 호출 블록 제거**

`create_feedback` 엔드포인트에서 `proposal`, `approval` 생성 블록 전체를 제거하고, 알림만 유지:

```python
@router.post("", response_model=FeedbackWithProposalResponse, status_code=201)
async def create_feedback(
    data: FeedbackReportCreate,
    db: AsyncSession = Depends(get_db),
):
    report = await feedback_service.create_feedback(db, data)

    if data.document_id:
        doc_result = await db.execute(select(Document).where(Document.id == data.document_id))
        doc = doc_result.scalar_one_or_none()
        if doc and doc.owner_id:
            short_text = data.feedback_text[:80] + ("..." if len(data.feedback_text) > 80 else "")
            await create_notification(
                db,
                user_id=doc.owner_id,
                type="feedback_received",
                title=f"'{doc.title}' 문서에 오류가 제보되었습니다",
                message=short_text,
                document_id=data.document_id,
            )

    return FeedbackWithProposalResponse(
        feedback=report,
        proposed_change=None,
        approval_id=None,
    )
```

- [ ] **Step 2: imports에 필요한 스키마 추가**

파일 상단 import 블록에 `RequestDraftBody`, `LinkDocumentBody` 추가:

```python
from app.schemas.feedback import (
    FeedbackReportCreate,
    FeedbackReportResponse,
    ProposedChangeResponse,
    FeedbackWithProposalResponse,
    RequestDraftBody,
    LinkDocumentBody,
)
```

- [ ] **Step 3: request-draft 엔드포인트 추가**

`get_proposal` 엔드포인트 아래에 추가:

```python
@router.post("/{feedback_id}/request-draft", response_model=FeedbackWithProposalResponse)
async def request_draft(
    feedback_id: uuid.UUID,
    body: RequestDraftBody,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(FeedbackReport).where(FeedbackReport.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if not feedback.document_id:
        raise HTTPException(status_code=400, detail="Feedback has no linked document")

    existing = await feedback_service.get_proposed_change(db, feedback_id)
    if existing:
        raise HTTPException(status_code=400, detail="Draft already exists")

    feedback.reviewed_text = body.reviewed_text
    await db.commit()
    await db.refresh(feedback)

    proposal = await feedback_service.generate_correction(db, feedback_id)
    approval = None
    if proposal:
        approval = await approval_service.create_approval_request(db, proposal.id)

    return FeedbackWithProposalResponse(
        feedback=feedback,
        proposed_change=proposal,
        approval_id=approval.id if approval else None,
    )
```

- [ ] **Step 4: link-document 엔드포인트 추가**

`request_draft` 아래에 추가:

```python
@router.patch("/{feedback_id}/link-document", response_model=FeedbackReportResponse)
async def link_document(
    feedback_id: uuid.UUID,
    body: LinkDocumentBody,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(FeedbackReport).where(FeedbackReport.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if feedback.document_id:
        raise HTTPException(status_code=400, detail="Feedback already has a linked document")

    doc_result = await db.execute(select(Document).where(Document.id == body.document_id))
    doc = doc_result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    feedback.document_id = body.document_id
    await db.commit()
    await db.refresh(feedback)

    return FeedbackReportResponse.model_validate(
        feedback, from_attributes=True
    ).model_copy(update={"document_title": doc.title})
```

- [ ] **Step 5: 커밋**

```bash
git add backend/app/routers/feedback.py
git commit -m "feat: remove auto AI call, add request-draft and link-document endpoints"
```

---

### Task 5: 테스트 수정 및 신규 테스트 추가

**Files:**
- Modify: `backend/tests/test_feedback.py`

- [ ] **Step 1: 기존 테스트 4개 수정**

`test_create_feedback_with_proposal` — 이제 create 시 proposal이 자동 생성되지 않으므로 수정:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_create_feedback_no_auto_proposal(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Policy Doc",
        "owner_id": test_user["id"],
    }, params={"content": "The company was founded in 2019. We have 100 employees."})
    doc_id = doc_resp.json()["id"]

    resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "The founding year is wrong, it should be 2020",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["feedback"]["status"] == "pending"
    assert data["proposed_change"] is None
```

`test_get_proposal` — request-draft 먼저 호출하도록 수정:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_get_proposal(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Another Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Some content with errors."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Fix the spelling errors",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    draft_resp = await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Fix the spelling errors",
    })
    assert draft_resp.status_code == 200

    resp = await client.get(f"/api/feedback/{feedback_id}/proposal")
    assert resp.status_code == 200
    assert resp.json()["document_id"] == doc_id
```

`test_feedback_list_has_proposed_change_status` — request-draft 먼저 호출하도록 수정:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_list_has_proposed_change_status(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Status Field Test Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Some content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "This needs fixing",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "This needs fixing",
    })

    list_resp = await client.get("/api/feedback")
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert all("proposed_change_status" in item for item in items)

    target = next((i for i in items if i["document_id"] == doc_id), None)
    assert target is not None
    assert target["proposed_change_status"] == "pending"
```

- [ ] **Step 2: 신규 테스트 3개 추가**

파일 끝에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_request_draft_uses_reviewed_text(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Draft Test Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Original content here."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Original feedback",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    resp = await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Admin reviewed: the content needs update",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["proposed_change"] is not None
    assert data["feedback"]["reviewed_text"] == "Admin reviewed: the content needs update"


@pytest.mark.asyncio(loop_scope="session")
async def test_request_draft_duplicate_returns_400(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Duplicate Draft Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Some feedback",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "first request",
    })
    resp = await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "second request",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio(loop_scope="session")
async def test_link_document(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Link Target Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "feedback_text": "No document attached",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]
    assert feedback_resp.json()["feedback"]["document_id"] is None

    resp = await client.patch(f"/api/feedback/{feedback_id}/link-document", json={
        "document_id": doc_id,
    })
    assert resp.status_code == 200
    assert resp.json()["document_id"] == doc_id
    assert resp.json()["document_title"] == "Link Target Doc"

    # 이미 연결된 상태에서 재시도 → 400
    resp2 = await client.patch(f"/api/feedback/{feedback_id}/link-document", json={
        "document_id": doc_id,
    })
    assert resp2.status_code == 400
```

- [ ] **Step 3: 테스트 실행**

```bash
cd backend && uv run pytest tests/test_feedback.py -v
```

Expected: 모든 테스트 PASS

- [ ] **Step 4: 커밋**

```bash
git add backend/tests/test_feedback.py
git commit -m "test: update feedback tests for manual draft flow, add request-draft and link-document tests"
```

---

### Task 6: 프론트엔드 api.ts 업데이트

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: FeedbackReport 타입에 reviewed_text 추가**

기존:
```typescript
export interface FeedbackReport { id: string; user_id: string; document_id: string | null; feedback_text: string; status: string; document_title: string | null; proposed_change_status: string | null; created_at: string }
```

변경:
```typescript
export interface FeedbackReport { id: string; user_id: string; document_id: string | null; feedback_text: string; reviewed_text: string | null; status: string; document_title: string | null; proposed_change_status: string | null; created_at: string }
```

- [ ] **Step 2: requestDraft, linkDocument API 함수 추가**

`getFeedbackProposal` 아래에 추가:

```typescript
  requestDraft: (feedbackId: string, reviewedText: string) =>
    request<{ feedback: FeedbackReport; proposed_change: ProposedChange | null }>(`/feedback/${feedbackId}/request-draft`, {
      method: 'POST', body: JSON.stringify({ reviewed_text: reviewedText }),
    }),
  linkDocument: (feedbackId: string, documentId: string) =>
    request<FeedbackReport>(`/feedback/${feedbackId}/link-document`, {
      method: 'PATCH', body: JSON.stringify({ document_id: documentId }),
    }),
```

- [ ] **Step 3: 타입 체크**

```bash
cd frontend && pnpm typecheck
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add requestDraft, linkDocument to api.ts"
```

---

### Task 7: 프론트엔드 Feedback.tsx — 삭제 버튼, 문서 연결 UI, 관리자 편집 영역

**Files:**
- Modify: `frontend/src/pages/Feedback.tsx`

- [ ] **Step 1: FeedbackDetail props 타입 및 삭제 버튼 추가**

`FeedbackDetail` 컴포넌트 signature와 헤더를 아래로 교체:

```tsx
function FeedbackDetail({ item, onRefetch, onDelete }: {
  item: FeedbackReport
  onRefetch: () => void
  onDelete: () => void
}) {
  const [activeSection, setActiveSection] = useState<"info" | "draft" | "history">("info")
  const [reviewedText, setReviewedText] = useState(item.reviewed_text ?? item.feedback_text)
  const [requesting, setRequesting] = useState(false)
  const [linkQuery, setLinkQuery] = useState("")
  const [linkDocId, setLinkDocId] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const { data: allDocs } = useApi(() => api.listDocuments(0, 200), [])
  const { data: proposal, refetch: refetchProposal } = useApi<ProposedChange>(
    () => api.getFeedbackProposal(item.id),
    [item.id]
  )

  // item이 바뀌면 textarea 초기화
  useEffect(() => {
    setReviewedText(item.reviewed_text ?? item.feedback_text)
  }, [item.id, item.reviewed_text, item.feedback_text])

  async function handleDelete() {
    if (!confirm("이 피드백을 삭제하시겠습니까?")) return
    await api.deleteFeedback(item.id)
    onDelete()
  }

  async function handleRequestDraft() {
    setRequesting(true)
    try {
      await api.requestDraft(item.id, reviewedText)
      await refetchProposal()
      onRefetch()
      setActiveSection("draft")
    } finally {
      setRequesting(false)
    }
  }

  async function handleLinkDocument() {
    if (!linkDocId) return
    setLinking(true)
    try {
      await api.linkDocument(item.id, linkDocId)
      onRefetch()
    } finally {
      setLinking(false)
    }
  }

  const filteredDocs = (allDocs?.documents ?? []).filter(d =>
    d.title.toLowerCase().includes(linkQuery.toLowerCase())
  )
```

- [ ] **Step 2: useEffect import 추가**

파일 상단:
```tsx
import { useState, useEffect } from "react"
```

- [ ] **Step 3: 헤더에 삭제 버튼 추가**

기존 헤더:
```tsx
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-[#191c1e] flex-1">오류 제보 상세</h3>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
          item.status === "processed" ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#fff3dc] text-[#92600a]"
        }`}>{item.status === "processed" ? "완료" : "검토요청"}</span>
      </div>
```

변경:
```tsx
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-[#191c1e] flex-1">오류 제보 상세</h3>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
          item.status === "processed" ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#fff3dc] text-[#92600a]"
        }`}>{item.status === "processed" ? "완료" : "검토요청"}</span>
        <button
          onClick={handleDelete}
          className="text-xs font-medium text-[#dc2626] hover:text-[#991b1b] px-3 py-1.5 rounded-lg border border-[#fca5a5] hover:border-[#f87171] transition-colors"
        >
          삭제
        </button>
      </div>
```

- [ ] **Step 4: "요청 정보" 섹션 하단에 문서 연결 UI + 관리자 편집 영역 추가**

기존 `activeSection === "info"` 블록의 닫는 `</div>` 직전에 추가:

```tsx
      {activeSection === "info" && (
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-[#757684] mb-1">제보 내용</p>
            <p className="text-[#191c1e] whitespace-pre-wrap bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5]">{item.feedback_text}</p>
          </div>
          {item.document_title && (
            <div><span className="text-[#757684] w-24 inline-block text-xs">관련 문서</span><span className="text-[#191c1e]">{item.document_title}</span></div>
          )}
          <div><span className="text-[#757684] w-24 inline-block text-xs">제보 일시</span><span className="text-[#191c1e]">{new Date(item.created_at).toLocaleString("ko-KR")}</span></div>

          {/* 문서 연결 UI — document_id 없을 때 */}
          {!item.document_id && (
            <div className="pt-4 border-t border-[#e0e3e5]">
              <p className="text-xs font-semibold text-[#757684] mb-2">관련 문서 연결</p>
              <p className="text-xs text-[#9a9bad] mb-3">연결된 문서가 없습니다. 문서를 연결하면 AI 초안을 요청할 수 있습니다.</p>
              <input
                type="text"
                placeholder="문서 검색..."
                value={linkQuery}
                onChange={e => { setLinkQuery(e.target.value); setLinkDocId(null) }}
                className="w-full px-3 py-2 text-sm border border-[#e0e3e5] rounded-lg focus:outline-none focus:border-[#00288e] mb-2"
              />
              {linkQuery && filteredDocs.length > 0 && (
                <ul className="border border-[#e0e3e5] rounded-lg overflow-hidden mb-2 max-h-40 overflow-y-auto">
                  {filteredDocs.slice(0, 10).map(d => (
                    <li key={d.id}>
                      <button
                        onClick={() => { setLinkDocId(d.id); setLinkQuery(d.title) }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-[#f7f9fb] transition-colors ${linkDocId === d.id ? "bg-[#eef2ff] text-[#00288e]" : "text-[#191c1e]"}`}
                      >
                        {d.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={handleLinkDocument}
                disabled={!linkDocId || linking}
                className="px-4 py-2 text-sm font-medium bg-[#00288e] text-white rounded-lg disabled:opacity-40 hover:bg-[#001f6b] transition-colors"
              >
                {linking ? "연결 중..." : "문서 연결"}
              </button>
            </div>
          )}

          {/* 관리자 편집 영역 — document_id 있을 때 */}
          {item.document_id && (
            <div className="pt-4 border-t border-[#e0e3e5]">
              <p className="text-xs font-semibold text-[#757684] mb-2">관리자 검토 내용</p>
              {proposal ? (
                <p className="text-xs text-[#9a9bad] bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5]">
                  초안이 생성되었습니다.{" "}
                  <button onClick={() => setActiveSection("draft")} className="text-[#00288e] underline">
                    AI 수정 초안 보기
                  </button>
                </p>
              ) : (
                <>
                  <textarea
                    value={reviewedText}
                    onChange={e => setReviewedText(e.target.value)}
                    rows={5}
                    className="w-full px-3 py-2 text-sm border border-[#e0e3e5] rounded-lg focus:outline-none focus:border-[#00288e] resize-none"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={handleRequestDraft}
                      disabled={requesting || !reviewedText.trim()}
                      className="px-4 py-2 text-sm font-medium bg-[#00288e] text-white rounded-lg disabled:opacity-40 hover:bg-[#001f6b] transition-colors"
                    >
                      {requesting ? "초안 생성 중..." : "AI 초안 요청 →"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 5: Feedback 컴포넌트에서 onDelete 콜백 전달**

`Feedback` 컴포넌트 내 `FeedbackDetail` 렌더링 부분 수정:

기존:
```tsx
        {selected ? (
          <FeedbackDetail item={selected} onRefetch={refetch} />
```

변경:
```tsx
        {selected ? (
          <FeedbackDetail
            item={selected}
            onRefetch={refetch}
            onDelete={() => { setSelectedId(null); refetch() }}
          />
```

- [ ] **Step 6: 타입 체크 및 lint**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 에러 없음

- [ ] **Step 7: 변경 이력 탭에 원본/수정본 비교 추가**

`activeSection === "history"` 블록을 아래로 교체:

```tsx
      {activeSection === "history" && (
        <div className="space-y-4">
          {item.reviewed_text && item.reviewed_text !== item.feedback_text && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-[#757684] mb-2">원본 제보 내용</p>
              <p className="text-sm text-[#444653] bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5] whitespace-pre-wrap">{item.feedback_text}</p>
              <p className="text-xs font-semibold text-[#757684] mt-3 mb-2">관리자 수정 내용</p>
              <p className="text-sm text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap">{item.reviewed_text}</p>
            </div>
          )}
          <ChangeHistoryTimeline entityType="feedback" entityId={item.id} />
        </div>
      )}
```

- [ ] **Step 8: 타입 체크 및 lint**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 에러 없음

- [ ] **Step 9: 커밋**

```bash
git add frontend/src/pages/Feedback.tsx
git commit -m "feat: add delete, document link, admin review UI, and history comparison to feedback page"
```
