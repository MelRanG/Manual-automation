# Feedback Page Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오류 제보 페이지에서 관리자 검토 내용 항상 표시, 수정 제안 편집 및 반영, 상태칩/삭제버튼 분리, 탭 비활성화, 동일 문서 중복 피드백 충돌 방지를 구현한다.

**Architecture:** 백엔드에 `is_stale` 계산 필드, `DELETE /proposal`, `POST /apply-draft` 엔드포인트를 추가한다. 프론트엔드는 `ChangeHistoryTimeline`에 외부 data prop을 받고, `FeedbackDetail`에서 history를 직접 fetch해 탭 비활성화에 활용한다.

**Tech Stack:** FastAPI, SQLAlchemy (async), Pydantic v2, React + TypeScript, pnpm, uv/pytest

---

## File Map

| 파일 | 변경 |
|------|------|
| `backend/app/schemas/feedback.py` | `ProposedChangeResponse`에 `is_stale` 추가, `ApplyDraftBody` 신규 |
| `backend/app/routers/feedback.py` | `get_proposal` stale 계산, `DELETE /proposal`, `POST /apply-draft` 추가 |
| `backend/tests/test_feedback.py` | 신규 테스트 추가 |
| `frontend/src/lib/api.ts` | `ProposedChange` 타입 + `applyFeedbackDraft`, `deleteFeedbackProposal` 함수 |
| `frontend/src/components/ChangeHistoryTimeline.tsx` | `events`, `loading` optional props 추가 |
| `frontend/src/pages/Feedback.tsx` | 전체 FeedbackDetail 개선 |

---

## Task 1: Backend — 스키마 업데이트

**Files:**
- Modify: `backend/app/schemas/feedback.py`

- [ ] **Step 1: `ProposedChangeResponse`에 `is_stale` 추가, `ApplyDraftBody` 신규 작성**

`backend/app/schemas/feedback.py`에서 `ProposedChangeResponse` 클래스에 필드 추가, 파일 끝에 `ApplyDraftBody` 추가:

```python
# ProposedChangeResponse에 is_stale 추가 (created_at 아래)
class ProposedChangeResponse(BaseModel):
    id: uuid.UUID
    feedback_report_id: uuid.UUID | None
    document_id: uuid.UUID | None
    document_version_id: uuid.UUID | None
    manual_job_id: uuid.UUID | None = None
    original_text: str
    proposed_text: str
    diff: str
    reasoning: str
    confidence: float
    source_type: str
    status: str
    is_stale: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


# 파일 끝에 추가
class ApplyDraftBody(BaseModel):
    action: str  # "apply" | "reject"
    edited_text: str | None = None
    reviewer_id: uuid.UUID
```

- [ ] **Step 2: 타입 체크 통과 확인**

```bash
cd backend && uv run mypy app/schemas/feedback.py
```

Expected: `Success: no issues found`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/feedback.py
git commit -m "feat: add is_stale to ProposedChangeResponse, add ApplyDraftBody"
```

---

## Task 2: Backend — `get_proposal` 엔드포인트 stale 계산

**Files:**
- Modify: `backend/app/routers/feedback.py`
- Modify: `backend/tests/test_feedback.py`

- [ ] **Step 1: 테스트 작성**

`backend/tests/test_feedback.py` 끝에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_get_proposal_is_stale_false_when_version_matches(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Stale Test Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Original content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Fix this",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Fix this",
    })

    resp = await client.get(f"/api/feedback/{feedback_id}/proposal")
    assert resp.status_code == 200
    assert resp.json()["is_stale"] is False
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py::test_get_proposal_is_stale_false_when_version_matches -v
```

Expected: FAIL — `KeyError: 'is_stale'` 또는 assertion error

- [ ] **Step 3: `get_proposal` 엔드포인트에 stale 계산 추가**

`backend/app/routers/feedback.py`에서 `get_proposal` 함수를 아래로 교체:

```python
@router.get("/{feedback_id}/proposal", response_model=ProposedChangeResponse)
async def get_proposal(
    feedback_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    proposal = await feedback_service.get_proposed_change(db, feedback_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="No proposal found")

    is_stale = False
    if proposal.document_version_id and proposal.document_id:
        doc_result = await db.execute(select(Document).where(Document.id == proposal.document_id))
        doc = doc_result.scalar_one_or_none()
        if doc and doc.current_version_id != proposal.document_version_id:
            is_stale = True

    return ProposedChangeResponse.model_validate(proposal, from_attributes=True).model_copy(
        update={"is_stale": is_stale}
    )
```

또한 `backend/app/schemas/feedback.py` import 업데이트 (routers/feedback.py 상단):

```python
from app.schemas.feedback import (
    FeedbackReportCreate,
    FeedbackReportResponse,
    ProposedChangeResponse,
    FeedbackWithProposalResponse,
    RequestDraftBody,
    LinkDocumentBody,
    ApplyDraftBody,
)
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py::test_get_proposal_is_stale_false_when_version_matches -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/feedback.py backend/tests/test_feedback.py
git commit -m "feat: add is_stale computation to get_proposal endpoint"
```

---

## Task 3: Backend — `DELETE /feedback/{id}/proposal` 엔드포인트

**Files:**
- Modify: `backend/app/routers/feedback.py`
- Modify: `backend/tests/test_feedback.py`

- [ ] **Step 1: 테스트 작성**

`backend/tests/test_feedback.py` 끝에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_delete_proposal_resets_feedback_status(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Delete Proposal Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Some content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Needs fixing",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Needs fixing",
    })

    # proposal 존재 확인
    proposal_resp = await client.get(f"/api/feedback/{feedback_id}/proposal")
    assert proposal_resp.status_code == 200

    # 삭제
    del_resp = await client.delete(f"/api/feedback/{feedback_id}/proposal")
    assert del_resp.status_code == 204

    # proposal 사라짐
    after_resp = await client.get(f"/api/feedback/{feedback_id}/proposal")
    assert after_resp.status_code == 404

    # feedback status 리셋
    list_resp = await client.get("/api/feedback")
    target = next(i for i in list_resp.json() if i["id"] == feedback_id)
    assert target["status"] == "pending"
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py::test_delete_proposal_resets_feedback_status -v
```

Expected: FAIL — 404 (엔드포인트 없음)

- [ ] **Step 3: 엔드포인트 구현**

`backend/app/routers/feedback.py` 상단 import에 `ApprovalRequest` 추가:

```python
from app.models.feedback import FeedbackReport, ProposedDocumentChange, ApprovalRequest
```

그리고 `delete_feedback` 엔드포인트 바로 위에 추가:

```python
@router.delete("/{feedback_id}/proposal", status_code=204)
async def delete_proposal(
    feedback_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(FeedbackReport).where(FeedbackReport.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")

    proposal = await feedback_service.get_proposed_change(db, feedback_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="No proposal found")

    await db.execute(delete(ApprovalRequest).where(ApprovalRequest.proposed_change_id == proposal.id))
    await db.execute(delete(ProposedDocumentChange).where(ProposedDocumentChange.id == proposal.id))
    feedback.status = "pending"
    await db.commit()
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py::test_delete_proposal_resets_feedback_status -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/feedback.py backend/tests/test_feedback.py
git commit -m "feat: add DELETE /feedback/{id}/proposal endpoint"
```

---

## Task 4: Backend — `POST /feedback/{id}/apply-draft` 엔드포인트

**Files:**
- Modify: `backend/app/routers/feedback.py`
- Modify: `backend/tests/test_feedback.py`

- [ ] **Step 1: 테스트 3개 작성 (apply, reject, stale 409)**

`backend/tests/test_feedback.py` 끝에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_apply_draft_apply_action(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Apply Draft Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Original text to fix."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Fix this text",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    draft_resp = await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Fix this text",
    })
    assert draft_resp.status_code == 200

    resp = await client.post(f"/api/feedback/{feedback_id}/apply-draft", json={
        "action": "apply",
        "reviewer_id": test_user["id"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["proposed_change"]["status"] == "approved"


@pytest.mark.asyncio(loop_scope="session")
async def test_apply_draft_reject_action(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Reject Draft Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Issue here",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Issue here",
    })

    resp = await client.post(f"/api/feedback/{feedback_id}/apply-draft", json={
        "action": "reject",
        "reviewer_id": test_user["id"],
    })
    assert resp.status_code == 200
    assert resp.json()["proposed_change"]["status"] == "rejected"


@pytest.mark.asyncio(loop_scope="session")
async def test_apply_draft_stale_returns_409(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Stale Apply Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Initial content."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Something wrong",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Something wrong",
    })

    # 문서에 새 버전 생성 → proposal stale
    await client.post(
        f"/api/documents/{doc_id}/versions",
        data={"content": "Updated content by someone else.", "change_summary": "manual edit"},
    )

    resp = await client.post(f"/api/feedback/{feedback_id}/apply-draft", json={
        "action": "apply",
        "reviewer_id": test_user["id"],
    })
    assert resp.status_code == 409
    assert "만료" in resp.json()["detail"]
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py::test_apply_draft_apply_action tests/test_feedback.py::test_apply_draft_reject_action tests/test_feedback.py::test_apply_draft_stale_returns_409 -v
```

Expected: 3개 모두 FAIL — 404 (엔드포인트 없음)

- [ ] **Step 3: 엔드포인트 구현**

`backend/app/routers/feedback.py`에서 `delete_proposal` 엔드포인트 아래에 추가:

```python
@router.post("/{feedback_id}/apply-draft", response_model=FeedbackWithProposalResponse)
async def apply_draft(
    feedback_id: uuid.UUID,
    body: ApplyDraftBody,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(FeedbackReport).where(FeedbackReport.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")

    proposal = await feedback_service.get_proposed_change(db, feedback_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="No proposal found")

    # Stale check
    if proposal.document_version_id and proposal.document_id:
        doc_result = await db.execute(select(Document).where(Document.id == proposal.document_id))
        doc = doc_result.scalar_one_or_none()
        if doc and doc.current_version_id != proposal.document_version_id:
            raise HTTPException(
                status_code=409,
                detail="문서가 수정되어 초안이 만료되었습니다. 초안을 재생성하세요.",
            )

    approval_result = await db.execute(
        select(ApprovalRequest).where(ApprovalRequest.proposed_change_id == proposal.id)
    )
    approval = approval_result.scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=404, detail="No approval request found")

    if body.action == "apply":
        if body.edited_text and body.edited_text.strip() != proposal.proposed_text.strip():
            await approval_service.review_approval(
                db, approval.id, body.reviewer_id, "edit_and_approve",
                edited_content=body.edited_text,
            )
        else:
            await approval_service.review_approval(
                db, approval.id, body.reviewer_id, "approved",
            )
    elif body.action == "reject":
        await approval_service.review_approval(
            db, approval.id, body.reviewer_id, "rejected",
        )
    else:
        raise HTTPException(status_code=400, detail="action must be 'apply' or 'reject'")

    await db.refresh(feedback)
    updated_proposal = await feedback_service.get_proposed_change(db, feedback_id)
    proposal_resp = (
        ProposedChangeResponse.model_validate(updated_proposal, from_attributes=True).model_copy(
            update={"is_stale": False}
        )
        if updated_proposal
        else None
    )

    return FeedbackWithProposalResponse(
        feedback=FeedbackReportResponse.model_validate(feedback, from_attributes=True),
        proposed_change=proposal_resp,
        approval_id=approval.id,
    )
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py::test_apply_draft_apply_action tests/test_feedback.py::test_apply_draft_reject_action tests/test_feedback.py::test_apply_draft_stale_returns_409 -v
```

Expected: 3개 모두 PASS

- [ ] **Step 5: 전체 feedback 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py -v
```

Expected: 전체 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/feedback.py backend/tests/test_feedback.py
git commit -m "feat: add POST /feedback/{id}/apply-draft with stale detection"
```

---

## Task 5: Frontend — `api.ts` 업데이트

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: `ProposedChange` 인터페이스에 `is_stale` 추가**

`frontend/src/lib/api.ts` 225번째 줄의 `ProposedChange` 인터페이스를 교체:

```typescript
export interface ProposedChange { id: string; feedback_report_id: string | null; document_id: string | null; original_text: string; proposed_text: string; diff: string; reasoning: string; confidence: number; source_type: "feedback" | "playwright" | "jira_sr"; status: string; is_stale: boolean }
```

- [ ] **Step 2: `applyFeedbackDraft`, `deleteFeedbackProposal` 함수 추가**

`api.ts`에서 `requestDraft` 함수 바로 아래에 추가:

```typescript
  applyFeedbackDraft: (feedbackId: string, data: { action: "apply" | "reject"; edited_text?: string; reviewer_id: string }) =>
    request<{ feedback: FeedbackReport; proposed_change: ProposedChange | null; approval_id: string | null }>(`/feedback/${feedbackId}/apply-draft`, { method: 'POST', body: JSON.stringify(data) }),
  deleteFeedbackProposal: (feedbackId: string) =>
    fetch(`${BASE_URL}/feedback/${feedbackId}/proposal`, { method: 'DELETE' }),
```

`requestDraft` 함수는 아래와 같이 현재 위치한다 (참고용, 수정 불필요):
```typescript
  requestDraft: (feedbackId: string, reviewedText: string) =>
    request<{ feedback: FeedbackReport; proposed_change: ProposedChange | null }>(`/feedback/${feedbackId}/request-draft`, {
```

- [ ] **Step 3: 타입 체크 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add applyFeedbackDraft, deleteFeedbackProposal to api.ts"
```

---

## Task 6: Frontend — `ChangeHistoryTimeline` events prop 추가

**Files:**
- Modify: `frontend/src/components/ChangeHistoryTimeline.tsx`

- [ ] **Step 1: Props 타입 업데이트 및 external events 지원 구현**

`frontend/src/components/ChangeHistoryTimeline.tsx` 전체 교체:

```tsx
import { useApi } from "@/hooks/useApi"
import { api, type ChangeHistory } from "@/lib/api"

const EVENT_LABELS: Record<string, string> = {
  created: "생성",
  ai_draft: "AI 초안",
  edited: "수정",
  status_changed: "상태 변경",
  approved: "승인",
  applied: "문서 반영",
  rejected: "반려",
}

const EVENT_COLORS: Record<string, string> = {
  created: "bg-[#e8f4fd] text-[#00288e]",
  ai_draft: "bg-[#f0f0ff] text-[#4a4bdc]",
  edited: "bg-[#fff3dc] text-[#92600a]",
  status_changed: "bg-[#f2f4f6] text-[#444653]",
  approved: "bg-[#dcfce7] text-[#15803d]",
  applied: "bg-[#dcfce7] text-[#15803d]",
  rejected: "bg-[#ffdad6] text-[#ba1a1a]",
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

interface Props {
  entityType: "sr" | "feedback" | "manual"
  entityId: string
  events?: ChangeHistory[] | null
  loading?: boolean
}

export function ChangeHistoryTimeline({ entityType, entityId, events: externalEvents, loading: externalLoading }: Props) {
  const useExternal = externalEvents !== undefined
  const { data: fetchedEvents, loading: fetchedLoading, error } = useApi<ChangeHistory[]>(
    () => useExternal ? Promise.resolve(externalEvents ?? []) : api.listHistory(entityType, entityId),
    [entityType, entityId, useExternal]
  )

  const events = useExternal ? (externalEvents ?? []) : (fetchedEvents ?? [])
  const loading = externalLoading !== undefined ? externalLoading : fetchedLoading

  if (loading) {
    return <div className="text-xs text-[#757684] py-4">이력 로딩 중...</div>
  }

  if (!useExternal && error) {
    return <p className="text-sm text-red-500 px-4">이력을 불러오지 못했습니다.</p>
  }

  if (events.length === 0) {
    return <div className="text-xs text-[#757684] py-4">이력이 없습니다.</div>
  }

  return (
    <div className="space-y-0">
      {events.map((ev, i) => (
        <div key={ev.id} className="flex gap-3 relative">
          {i < events.length - 1 && (
            <div className="absolute left-[11px] top-6 bottom-0 w-px bg-[#e0e3e5]" />
          )}
          <div className="mt-1 w-6 h-6 rounded-full bg-[#f2f4f6] border border-[#e0e3e5] flex items-center justify-center shrink-0 z-10">
            <div className="w-2 h-2 rounded-full bg-[#9a9bad]" />
          </div>
          <div className="pb-4 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${EVENT_COLORS[ev.event_type] ?? "bg-[#f2f4f6] text-[#444653]"}`}>
                {EVENT_LABELS[ev.event_type] ?? ev.event_type}
              </span>
              {ev.actor_name && (
                <span className="text-xs text-[#444653] font-medium">{ev.actor_name}</span>
              )}
              <span className="text-[11px] text-[#9a9bad]">{formatDate(ev.created_at)}</span>
            </div>
            {ev.detail && (
              <p className="text-xs text-[#757684] mt-1">{ev.detail}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 타입 체크 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChangeHistoryTimeline.tsx
git commit -m "feat: add external events prop to ChangeHistoryTimeline"
```

---

## Task 7: Frontend — `FeedbackDetail` 상태/핸들러/인증 세팅

**Files:**
- Modify: `frontend/src/pages/Feedback.tsx`

이 태스크는 UI 렌더링 변경 없이 state, handler, hooks만 추가한다.

- [ ] **Step 1: import 업데이트 및 신규 state/handler 추가**

`frontend/src/pages/Feedback.tsx` 상단 import를 아래로 교체:

```tsx
import { useState, useEffect } from "react"
import { api, type FeedbackReport, type ProposedChange, type ChangeHistory } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"
import { ChangeHistoryTimeline } from "@/components/ChangeHistoryTimeline"
```

`FeedbackDetail` 함수 내부, 기존 state 선언 블록 아래에 추가:

```tsx
// 기존 유지
const [activeSection, setActiveSection] = useState<"info" | "draft" | "history">("info")
const [reviewedText, setReviewedText] = useState(item.reviewed_text ?? item.feedback_text)
const [requesting, setRequesting] = useState(false)
const [linkQuery, setLinkQuery] = useState("")
const [linkDocId, setLinkDocId] = useState<string | null>(null)
const [linking, setLinking] = useState(false)
const { data: allDocs } = useApi(() => api.listDocuments(0, 200), [])
const { data: proposal, loading: proposalLoading, refetch: refetchProposal } = useApi<ProposedChange>(
  () => api.getFeedbackProposal(item.id),
  [item.id]
)

// 신규 추가
const { user } = useAuth()
const reviewerId = user?.id ?? "00000000-0000-0000-0000-000000000001"
const [editedText, setEditedText] = useState("")
const [applying, setApplying] = useState(false)
const { data: history, loading: historyLoading } = useApi<ChangeHistory[]>(
  () => api.listHistory("feedback", item.id),
  [item.id]
)

useEffect(() => {
  if (proposal) setEditedText(proposal.proposed_text)
}, [proposal?.id])
```

`handleDelete` 아래에 핸들러 추가:

```tsx
async function handleApplyDraft() {
  if (!proposal) return
  setApplying(true)
  try {
    await api.applyFeedbackDraft(item.id, {
      action: "apply",
      edited_text: editedText !== proposal.proposed_text ? editedText : undefined,
      reviewer_id: reviewerId,
    })
    await refetchProposal()
    onRefetch()
  } finally {
    setApplying(false)
  }
}

async function handleRejectDraft() {
  if (!proposal) return
  setApplying(true)
  try {
    await api.applyFeedbackDraft(item.id, { action: "reject", reviewer_id: reviewerId })
    await refetchProposal()
    onRefetch()
  } finally {
    setApplying(false)
  }
}

async function handleRegenerateDraft() {
  setRequesting(true)
  try {
    await api.deleteFeedbackProposal(item.id)
    await api.requestDraft(item.id, reviewedText)
    await refetchProposal()
    onRefetch()
    setActiveSection("draft")
  } finally {
    setRequesting(false)
  }
}
```

- [ ] **Step 2: 타입 체크 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Feedback.tsx
git commit -m "feat: add auth, history fetch, apply/reject/regenerate handlers to FeedbackDetail"
```

---

## Task 8: Frontend — `FeedbackDetail` 헤더 + 탭 비활성화

**Files:**
- Modify: `frontend/src/pages/Feedback.tsx`

- [ ] **Step 1: 탭 비활성화 로직 + 헤더/삭제버튼 UI 변경**

`FeedbackDetail` 렌더링 블록에서 `return (` 바로 아래 `<div className="p-6 max-w-3xl">` 내부를 아래로 교체:

```tsx
// 기존 헤더 (삭제 버튼 포함) 교체:
<div className="flex items-center gap-3 mb-6">
  <h3 className="text-lg font-bold text-[#191c1e] flex-1">오류 제보 상세</h3>
  <span className={`text-xs font-medium px-2.5 py-1 border-l-2 ${
    item.status === "processed"
      ? "border-[#15803d] bg-[#dcfce7] text-[#15803d]"
      : "border-[#92600a] bg-[#fff3dc] text-[#92600a]"
  }`}>
    {item.status === "processed" ? "완료" : "검토요청"}
  </span>
</div>
```

탭 버튼 블록 교체 (기존 `<div className="flex gap-1 border-b ...">` 부분):

```tsx
{(() => {
  const tabDisabled: Record<"info" | "draft" | "history", boolean> = {
    info: false,
    draft: !proposalLoading && !proposal,
    history: !historyLoading && (!history || history.length === 0),
  }
  return (
    <div className="flex gap-1 border-b border-[#e0e3e5] mb-5">
      {([["info", "요청 정보"], ["draft", "AI 수정 초안"], ["history", "변경 이력"]] as ["info" | "draft" | "history", string][]).map(([s, label]) => (
        <button
          key={s}
          onClick={() => { if (!tabDisabled[s]) setActiveSection(s) }}
          disabled={tabDisabled[s]}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tabDisabled[s]
              ? "border-transparent text-[#9a9bad] cursor-not-allowed opacity-40"
              : activeSection === s
                ? "border-[#00288e] text-[#00288e]"
                : "border-transparent text-[#757684] hover:text-[#191c1e]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
})()}
```

- [ ] **Step 2: 타입 체크 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Feedback.tsx
git commit -m "feat: update header style, add tab disabled logic to FeedbackDetail"
```

---

## Task 9: Frontend — `FeedbackDetail` info 탭 + draft 탭 UI

**Files:**
- Modify: `frontend/src/pages/Feedback.tsx`

- [ ] **Step 1: info 탭 — proposal 있어도 reviewed_text 표시 + 삭제버튼 이동**

`activeSection === "info"` 블록 전체 교체:

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

    {item.document_id && (
      <div className="pt-4 border-t border-[#e0e3e5]">
        <p className="text-xs font-semibold text-[#757684] mb-2">관리자 검토 내용</p>
        {proposal ? (
          <>
            <p className="text-sm text-[#444653] bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5] whitespace-pre-wrap">
              {item.reviewed_text ?? item.feedback_text}
            </p>
            <p className="text-xs text-[#9a9bad] mt-2">
              초안이 생성되었습니다.{" "}
              <button onClick={() => setActiveSection("draft")} className="text-[#00288e] underline">
                AI 수정 초안 보기
              </button>
            </p>
          </>
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

    <div className="pt-4 border-t border-[#e0e3e5]">
      <button
        onClick={handleDelete}
        className="text-xs text-[#dc2626] hover:text-[#991b1b] underline"
      >
        이 피드백 삭제
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 2: draft 탭 — 편집 가능 textarea + 반영/거절 버튼 + stale 배너**

`activeSection === "draft"` 블록 전체 교체:

```tsx
{activeSection === "draft" && (
  <div>
    {proposal ? (
      <div className="space-y-4">
        {proposal.is_stale && (
          <div className="bg-[#fff3dc] border border-[#fcd34d] rounded-lg p-3 flex items-center gap-2">
            <span className="text-sm text-[#92600a]">이 초안은 생성 이후 문서가 변경되었습니다.</span>
            <button
              onClick={handleRegenerateDraft}
              disabled={requesting}
              className="text-xs text-[#00288e] underline shrink-0"
            >
              {requesting ? "재생성 중..." : "초안 재생성"}
            </button>
          </div>
        )}
        <div>
          <p className="text-xs font-semibold text-[#757684] mb-2">AI 수정 근거</p>
          <p className="text-sm text-[#444653] bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5]">{proposal.reasoning}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-[#757684] mb-2">기존 내용</p>
          <pre className="text-xs text-[#444653] bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5] whitespace-pre-wrap overflow-auto max-h-48">{proposal.original_text}</pre>
        </div>
        <div>
          <p className="text-xs font-semibold text-[#757684] mb-2">수정 제안</p>
          <textarea
            value={editedText}
            onChange={e => setEditedText(e.target.value)}
            rows={8}
            className="w-full px-3 py-2 text-xs font-mono border border-[#e0e3e5] rounded-lg focus:outline-none focus:border-[#00288e] resize-none bg-[#f0fdf4]"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-[#757684]">
          <span>신뢰도</span>
          <div className="flex-1 bg-[#e0e3e5] rounded-full h-1.5">
            <div className="bg-[#00288e] h-1.5 rounded-full" style={{ width: `${Math.round(proposal.confidence * 100)}%` }} />
          </div>
          <span>{Math.round(proposal.confidence * 100)}%</span>
        </div>
        {!proposal.is_stale && (
          <div className="flex gap-2 pt-2 border-t border-[#e0e3e5]">
            <button
              onClick={handleApplyDraft}
              disabled={applying}
              className="px-4 py-2 text-sm font-medium bg-[#00288e] text-white rounded-lg disabled:opacity-40 hover:bg-[#001f6b] transition-colors"
            >
              {applying ? "처리 중..." : "문서에 반영"}
            </button>
            <button
              onClick={handleRejectDraft}
              disabled={applying}
              className="px-4 py-2 text-sm font-medium border border-[#dc2626] text-[#dc2626] rounded-lg disabled:opacity-40 hover:bg-[#fef2f2] transition-colors"
            >
              반영 안함
            </button>
          </div>
        )}
      </div>
    ) : (
      <div className="text-sm text-[#9a9bad]">AI 수정 초안이 없습니다.</div>
    )}
  </div>
)}
```

- [ ] **Step 3: history 탭 — ChangeHistoryTimeline에 events prop 전달**

`activeSection === "history"` 블록 교체:

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
    <ChangeHistoryTimeline
      entityType="feedback"
      entityId={item.id}
      events={history}
      loading={historyLoading}
    />
  </div>
)}
```

- [ ] **Step 4: 타입 체크 + lint 통과 확인**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Feedback.tsx
git commit -m "feat: update info/draft/history tabs in FeedbackDetail"
```

---

## Self-Review

**Spec coverage 체크:**

| 스펙 항목 | 구현 태스크 |
|-----------|------------|
| 1. 요청 정보 탭 reviewed_text 항상 표시 | Task 9 Step 1 |
| 2. 수정 제안 편집 + 반영/거절 버튼 | Task 4 (백엔드), Task 5 (api.ts), Task 9 Step 2 |
| 3. 상태 배지 스타일 변경 + 삭제 버튼 이동 | Task 8 Step 1, Task 9 Step 1 |
| 4. 탭 비활성화 (draft, history) | Task 6, Task 7, Task 8 Step 1 |
| 5. Stale 감지 + 409 차단 + 재생성 | Task 1, 2, 3, 4 (백엔드), Task 9 Step 2 |

모든 항목 커버됨.
