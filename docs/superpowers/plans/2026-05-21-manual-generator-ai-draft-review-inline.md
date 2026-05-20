# 매뉴얼 생성 AI 초안 인라인 검토 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ManualGenerator의 "AI 초안" 탭에서 생성된 매뉴얼 초안을 직접 확인 / 승인 / 편집 후 승인 / 반려 / 추가 확인 요청 할 수 있게 한다. 같은 검토 UI를 /approval 페이지의 feedback/jira_sr 탭과 공유하기 위해 ApprovalReviewPanel 컴포넌트로 추출하고, /approval의 Playwright 탭은 제거한다.

**Architecture:** 백엔드는 `GET /api/manuals/jobs` / `GET /api/manuals/jobs/{id}` 응답에 `proposed_change` / `approval`을 임베드한다 (신규 endpoint 없음, selectinload 사용). 프론트는 `ApprovalReviewPanel`을 신규 추출해 Approvals.tsx와 ManualGenerator.tsx가 공유한다. ManualGenerator의 AI 초안 탭은 job 상태에 따라 5분기로 렌더링한다.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2.0 (async) / Pydantic v2 / Alembic, React + Vite + TypeScript, pytest-asyncio + httpx AsyncClient.

**Spec:** `docs/superpowers/specs/2026-05-21-manual-generator-ai-draft-review-inline-design.md`

---

## File Structure

**Backend:**
- Modify `backend/app/models/feedback.py` — `ProposedDocumentChange`에 `manual_job` relationship 추가
- Modify `backend/app/models/manual.py` — `ManualGenerationJob`에 `proposed_change` relationship + `approval` @property 추가
- Modify `backend/app/schemas/manual.py` — `ProposedChangeBrief`/`ApprovalBrief` 추가, `ManualJobResponse` 확장
- Modify `backend/app/services/manual_service.py` — `list_jobs` / `get_job`에 selectinload 추가
- Create `backend/tests/test_manual_jobs_embed.py` — 임베드 응답 회귀 테스트

**Frontend:**
- Modify `frontend/src/lib/api.ts` — `ProposedChangeBrief` / `ApprovalBrief` 타입 추가, `ManualJob` 확장
- Create `frontend/src/components/ApprovalReviewPanel.tsx` — 4액션 검토 패널 (Approvals에서 추출)
- Modify `frontend/src/pages/Approvals.tsx` — Playwright 탭 제거 + 패널 사용
- Modify `frontend/src/pages/ManualGenerator.tsx` — AI 초안 탭 5분기 + 사이드바 필터/카운트/배지 정확화

---

## Task 1: SQLAlchemy Relationships

**Files:**
- Modify: `backend/app/models/feedback.py`
- Modify: `backend/app/models/manual.py`

- [ ] **Step 1: Add `manual_job` relationship to `ProposedDocumentChange`**

Open `backend/app/models/feedback.py`. Inside class `ProposedDocumentChange`, after `approval_request: Mapped[...]` block, append:

```python
    manual_job: Mapped["ManualGenerationJob | None"] = relationship(
        "ManualGenerationJob",
        back_populates="proposed_change",
        foreign_keys=[manual_job_id],
    )
```

- [ ] **Step 2: Add `proposed_change` relationship + `approval` property to `ManualGenerationJob`**

Open `backend/app/models/manual.py`. Replace the full class body with:

```python
import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class ManualGenerationJob(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "manual_generation_jobs"

    source_sr_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sr_drafts.id")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    target_url: Mapped[str] = mapped_column(String(2000))
    login_id: Mapped[str | None] = mapped_column(String(500))
    login_pw: Mapped[str | None] = mapped_column(String(500))
    login_url: Mapped[str | None] = mapped_column(String(2000))
    scenario_steps: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    output_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id")
    )
    screenshots: Mapped[dict | None] = mapped_column(JSONB)
    error_message: Mapped[str | None] = mapped_column(Text)

    proposed_change: Mapped["ProposedDocumentChange | None"] = relationship(  # noqa: F821
        "ProposedDocumentChange",
        back_populates="manual_job",
        uselist=False,
        order_by="ProposedDocumentChange.created_at.desc()",
    )

    @property
    def approval(self):
        """`proposed_change.approval_request` 편의 노출 (Pydantic from_attributes에서 사용)."""
        pc = self.proposed_change
        if pc is None:
            return None
        return pc.approval_request
```

- [ ] **Step 3: Verify model import / no circular import**

Run:
```bash
cd /Users/muni/Documents/GitHub/Manual-automation/backend && uv run python -c "from app.models.manual import ManualGenerationJob; from app.models.feedback import ProposedDocumentChange; print(ManualGenerationJob.__mapper__.relationships.keys(), ProposedDocumentChange.__mapper__.relationships.keys())"
```

Expected output includes `proposed_change` for ManualGenerationJob and `manual_job` for ProposedDocumentChange. No ImportError.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/feedback.py backend/app/models/manual.py
git commit -m "feat(backend): add 1:1 relationship between ManualGenerationJob and ProposedDocumentChange"
```

---

## Task 2: Pydantic Brief Schemas

**Files:**
- Modify: `backend/app/schemas/manual.py`

- [ ] **Step 1: Add Brief schemas + extend ManualJobResponse**

Replace `backend/app/schemas/manual.py` with:

```python
import uuid
from datetime import datetime

from pydantic import BaseModel


class ManualJobCreate(BaseModel):
    user_id: uuid.UUID
    target_url: str
    login_id: str | None = None
    login_pw: str | None = None
    login_url: str | None = None
    scenario_steps: list[str] | None = None
    source_sr_id: uuid.UUID | None = None


class ProposedChangeBrief(BaseModel):
    id: uuid.UUID
    proposed_text: str
    reasoning: str
    confidence: float
    source_type: str
    status: str

    model_config = {"from_attributes": True}


class ApprovalBrief(BaseModel):
    id: uuid.UUID
    status: str
    approval_type: str
    comment: str | None
    reviewer_id: uuid.UUID | None
    reviewed_at: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ManualJobResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    target_url: str
    login_url: str | None
    status: str
    output_document_id: uuid.UUID | None
    screenshots: list[dict] | None
    error_message: str | None
    created_at: datetime
    proposed_change: ProposedChangeBrief | None = None
    approval: ApprovalBrief | None = None

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Verify schema imports**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/backend && uv run python -c "from app.schemas.manual import ManualJobResponse, ProposedChangeBrief, ApprovalBrief; print(ManualJobResponse.model_fields.keys())"
```

Expected: contains `proposed_change` and `approval` field names.

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/manual.py
git commit -m "feat(backend): embed proposed_change and approval in ManualJobResponse"
```

---

## Task 3: Eager-load relationships in manual_service

**Files:**
- Modify: `backend/app/services/manual_service.py:334-345`

- [ ] **Step 1: Add selectinload to list_jobs and get_job**

Open `backend/app/services/manual_service.py`. Replace lines 334–345 (functions `list_jobs` and `get_job`) with:

```python
async def list_jobs(db: AsyncSession, user_id: uuid.UUID | None = None) -> list[ManualGenerationJob]:
    from sqlalchemy import select as sa_select
    from sqlalchemy.orm import selectinload
    from app.models.feedback import ProposedDocumentChange

    stmt = (
        sa_select(ManualGenerationJob)
        .options(
            selectinload(ManualGenerationJob.proposed_change)
            .selectinload(ProposedDocumentChange.approval_request)
        )
        .order_by(ManualGenerationJob.created_at.desc())
    )
    if user_id:
        stmt = stmt.where(ManualGenerationJob.user_id == user_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_job(db: AsyncSession, job_id: uuid.UUID) -> ManualGenerationJob | None:
    from sqlalchemy.orm import selectinload
    from app.models.feedback import ProposedDocumentChange

    stmt = (
        select(ManualGenerationJob)
        .options(
            selectinload(ManualGenerationJob.proposed_change)
            .selectinload(ProposedDocumentChange.approval_request)
        )
        .where(ManualGenerationJob.id == job_id)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
```

- [ ] **Step 2: Smoke-run the backend**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/backend && uv run python -c "
import asyncio
from app.db import SessionLocal
from app.services import manual_service

async def main():
    async with SessionLocal() as db:
        jobs = await manual_service.list_jobs(db)
        for j in jobs[:3]:
            print(j.id, '->', getattr(j.proposed_change, 'id', None), '->', getattr(j.approval, 'id', None) if j.approval else None)

asyncio.run(main())
"
```

Expected: prints up to 3 job ids with their attached `proposed_change.id` (or `None`) and `approval.id` (or `None`). No errors.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/manual_service.py
git commit -m "feat(backend): eager-load proposed_change and approval in manual_service"
```

---

## Task 4: Backend test — embedded approval

**Files:**
- Create: `backend/tests/test_manual_jobs_embed.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_manual_jobs_embed.py` with:

```python
import asyncio
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feedback import ApprovalRequest, ProposedDocumentChange
from app.models.manual import ManualGenerationJob


@pytest.mark.asyncio(loop_scope="session")
async def test_manual_jobs_response_embeds_approval(
    client: AsyncClient, test_user: dict, db_session: AsyncSession
):
    # 1) ManualGenerationJob 직접 insert (background generation 우회)
    job_id = uuid.uuid4()
    db_session.add(
        ManualGenerationJob(
            id=job_id,
            user_id=uuid.UUID(test_user["id"]),
            target_url="https://example.com/embed-test",
            status="completed",
        )
    )
    # 2) 연결된 ProposedDocumentChange + ApprovalRequest insert
    change_id = uuid.uuid4()
    db_session.add(
        ProposedDocumentChange(
            id=change_id,
            manual_job_id=job_id,
            original_text="",
            proposed_text="# 임베드 테스트 매뉴얼",
            diff="# 임베드 테스트 매뉴얼",
            reasoning="Playwright auto-generated manual for https://example.com/embed-test",
            confidence=1.0,
            source_type="playwright",
            status="pending",
        )
    )
    approval_id = uuid.uuid4()
    db_session.add(
        ApprovalRequest(
            id=approval_id,
            proposed_change_id=change_id,
            status="pending",
        )
    )
    await db_session.commit()

    # 3) API 응답 확인
    resp = await client.get(f"/api/manuals/jobs/{job_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["proposed_change"] is not None
    assert body["proposed_change"]["id"] == str(change_id)
    assert body["proposed_change"]["proposed_text"] == "# 임베드 테스트 매뉴얼"
    assert body["proposed_change"]["source_type"] == "playwright"
    assert body["approval"] is not None
    assert body["approval"]["id"] == str(approval_id)
    assert body["approval"]["status"] == "pending"


@pytest.mark.asyncio(loop_scope="session")
async def test_manual_jobs_response_no_approval(
    client: AsyncClient, test_user: dict, db_session: AsyncSession
):
    # change/approval 없는 running 상태 job
    job_id = uuid.uuid4()
    db_session.add(
        ManualGenerationJob(
            id=job_id,
            user_id=uuid.UUID(test_user["id"]),
            target_url="https://example.com/no-embed",
            status="running",
        )
    )
    await db_session.commit()

    resp = await client.get(f"/api/manuals/jobs/{job_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["proposed_change"] is None
    assert body["approval"] is None


@pytest.mark.asyncio(loop_scope="session")
async def test_list_manual_jobs_includes_embed(
    client: AsyncClient, test_user: dict, db_session: AsyncSession
):
    job_id = uuid.uuid4()
    db_session.add(
        ManualGenerationJob(
            id=job_id,
            user_id=uuid.UUID(test_user["id"]),
            target_url="https://example.com/list-embed",
            status="completed",
        )
    )
    change_id = uuid.uuid4()
    db_session.add(
        ProposedDocumentChange(
            id=change_id,
            manual_job_id=job_id,
            original_text="",
            proposed_text="list embed",
            diff="list embed",
            reasoning="list embed reason",
            confidence=1.0,
            source_type="playwright",
            status="pending",
        )
    )
    db_session.add(
        ApprovalRequest(
            id=uuid.uuid4(),
            proposed_change_id=change_id,
            status="pending",
        )
    )
    await db_session.commit()

    resp = await client.get(f"/api/manuals/jobs?user_id={test_user['id']}")
    assert resp.status_code == 200
    items = resp.json()
    target = next((j for j in items if j["id"] == str(job_id)), None)
    assert target is not None
    assert target["proposed_change"] is not None
    assert target["approval"] is not None
    assert target["approval"]["status"] == "pending"
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/backend && uv run pytest tests/test_manual_jobs_embed.py -v
```

Expected: 3 PASSED.

If FAIL with `AttributeError: type object 'ManualGenerationJob' has no attribute 'proposed_change'`, Task 1 was not applied — re-check.

- [ ] **Step 3: Run full backend test suite for regression**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/backend && uv run pytest -q
```

Expected: all tests pass (no new failures).

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_manual_jobs_embed.py
git commit -m "test(backend): verify ManualJobResponse embeds proposed_change and approval"
```

---

## Task 5: Frontend types

**Files:**
- Modify: `frontend/src/lib/api.ts:238-246`

- [ ] **Step 1: Add Brief types + extend ManualJob**

Open `frontend/src/lib/api.ts`. Find the line containing `export interface ManualJob` (around line 246). Replace the existing block of three interfaces (`ProposedChange`, `ApprovalRequest`, `ApprovalListResponse`) at lines 238-240, and the `ManualJob` interface at line 246, with:

```ts
export interface ProposedChange { id: string; feedback_report_id: string | null; document_id: string | null; original_text: string; proposed_text: string; diff: string; reasoning: string; confidence: number; source_type: "feedback" | "playwright" | "jira_sr"; status: string; is_stale: boolean }
export interface ApprovalRequest { id: string; proposed_change_id: string | null; sr_draft_id: string | null; proposed_change: ProposedChange | null; reviewer_id: string | null; status: string; approval_type: string; comment: string | null; reviewed_at: string | null; created_at: string }
export interface ApprovalListResponse { items: ApprovalRequest[]; total: number }

export interface ProposedChangeBrief {
  id: string
  proposed_text: string
  reasoning: string
  confidence: number
  source_type: "feedback" | "playwright" | "jira_sr"
  status: string
}

export interface ApprovalBrief {
  id: string
  status: string
  approval_type: string
  comment: string | null
  reviewer_id: string | null
  reviewed_at: string | null
  created_at: string
}

export interface ManualJob {
  id: string
  user_id: string
  target_url: string
  login_url: string | null
  status: string
  output_document_id: string | null
  screenshots: { step: number; filename: string | null; url: string; description: string }[] | null
  error_message: string | null
  created_at: string
  proposed_change: ProposedChangeBrief | null
  approval: ApprovalBrief | null
}
```

(The existing `ProposedChange` / `ApprovalRequest` / `ApprovalListResponse` interfaces are unchanged; only `ManualJob` is extended and two `Brief` interfaces are added.)

- [ ] **Step 2: Type-check**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/frontend && pnpm typecheck
```

Expected: no type errors in `api.ts`. Existing files that use `ManualJob` should still compile (new fields are nullable and additive).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): extend ManualJob with proposed_change and approval"
```

---

## Task 6: Create `ApprovalReviewPanel` component

**Files:**
- Create: `frontend/src/components/ApprovalReviewPanel.tsx`

- [ ] **Step 1: Write the panel component**

Create `frontend/src/components/ApprovalReviewPanel.tsx`:

```tsx
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { api, type ProposedChange, type ProposedChangeBrief } from "@/lib/api"

type ReviewMode = "approve" | "reject" | "edit_and_approve" | "request_review" | null

export interface ApprovalReviewPanelInput {
  id: string
  status: string
  approval_type: string
  comment: string | null
  proposed_change: ProposedChange | ProposedChangeBrief | null
}

interface Props {
  approval: ApprovalReviewPanelInput
  reviewerId: string
  variant: "feedback" | "playwright" | "jira_sr"
  onReviewed: () => void
  showReasoning?: boolean
}

const reviewModeLabels: Record<NonNullable<ReviewMode>, string> = {
  approve: "승인",
  reject: "반려",
  edit_and_approve: "편집 후 승인",
  request_review: "추가 확인 요청",
}

export function ApprovalReviewPanel({
  approval, reviewerId, variant, onReviewed, showReasoning = true,
}: Props) {
  const change = approval.proposed_change
  const [reviewMode, setReviewMode] = useState<ReviewMode>(null)
  const [comment, setComment] = useState("")
  const [editedContent, setEditedContent] = useState(change?.proposed_text ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const hasOriginal = !!(change && "original_text" in change && change.original_text)

  const handleSubmit = async () => {
    if (reviewMode === "request_review" && !comment.trim()) return
    if (reviewMode === "edit_and_approve" && !editedContent.trim()) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      const action = reviewMode === "approve" ? "approved"
        : reviewMode === "reject" ? "rejected"
        : reviewMode === "edit_and_approve" ? "edit_and_approve"
        : "request_review"
      await api.reviewApproval(approval.id, {
        reviewer_id: reviewerId,
        action,
        comment: comment || undefined,
        edited_content: reviewMode === "edit_and_approve" ? editedContent : undefined,
      })
      onReviewed()
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "처리 실패")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pt-2 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {showReasoning && (
          <div className="md:col-span-2 bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-base text-[#d97706]">lightbulb</span>
              <span className="text-xs font-semibold text-[#444653]">변경 사유</span>
            </div>
            <p className="text-sm text-[#191c1e]">{change?.reasoning ?? "정보 없음"}</p>
          </div>
        )}
        {variant === "feedback" && change && (
          <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 flex flex-col items-center justify-center">
            <span className="text-xs font-semibold text-[#444653] mb-2">AI 신뢰도</span>
            <span className="text-2xl font-bold text-[#00288e]">
              {Math.round(change.confidence * 100)}%
            </span>
          </div>
        )}
      </div>

      {change && (
        <div className="space-y-2">
          <span className="text-xs font-semibold text-[#444653]">
            {variant === "feedback" ? "변경 내용 (원문 → 제안)" : "생성된 매뉴얼 내용"}
          </span>
          {variant === "feedback" && hasOriginal ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#fff5f5] border border-[#fca5a5] rounded-lg p-3 overflow-auto max-h-48">
                <p className="text-[10px] font-semibold text-[#dc2626] mb-1">원문</p>
                <pre className="text-xs text-[#191c1e] whitespace-pre-wrap font-mono">
                  {(change as ProposedChange).original_text}
                </pre>
              </div>
              <div className="bg-[#f0fdf4] border border-[#86efac] rounded-lg p-3 overflow-auto max-h-48">
                <p className="text-[10px] font-semibold text-[#16a34a] mb-1">제안</p>
                <pre className="text-xs text-[#191c1e] whitespace-pre-wrap font-mono">{change.proposed_text}</pre>
              </div>
            </div>
          ) : (
            <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 overflow-auto max-h-96 prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {change.proposed_text}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {errorMsg && (
        <div className="text-xs text-[#ba1a1a] bg-[#ffdad6] px-3 py-2 rounded-lg">{errorMsg}</div>
      )}

      {!reviewMode ? (
        <div className="flex flex-wrap gap-3 pt-2">
          <button onClick={() => setReviewMode("approve")} className="flex items-center gap-2 px-4 py-2.5 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm">
            <span className="material-symbols-outlined text-base">check_circle</span>
            승인
          </button>
          <button onClick={() => setReviewMode("edit_and_approve")} className="flex items-center gap-2 px-4 py-2.5 border border-[#00288e] text-[#00288e] rounded-lg text-sm font-medium hover:bg-[#dde1ff] transition-colors">
            <span className="material-symbols-outlined text-base">edit</span>
            편집 후 승인
          </button>
          <button onClick={() => setReviewMode("reject")} className="flex items-center gap-2 px-4 py-2.5 border border-[#ba1a1a] text-[#ba1a1a] rounded-lg text-sm font-medium hover:bg-[#ffdad6] transition-colors">
            <span className="material-symbols-outlined text-base">cancel</span>
            반려
          </button>
          <button onClick={() => setReviewMode("request_review")} className="flex items-center gap-2 px-4 py-2.5 border border-[#c4c5d5] text-[#444653] rounded-lg text-sm hover:bg-[#f2f4f6] transition-colors">
            <span className="material-symbols-outlined text-base">help</span>
            추가 확인 요청
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              reviewMode === "approve" ? "bg-[#d5e3fc] text-[#00288e]"
              : reviewMode === "reject" ? "bg-[#ffdad6] text-[#93000a]"
              : "bg-[#e6e8ea] text-[#444653]"
            }`}>
              {reviewModeLabels[reviewMode]}
            </span>
            <button onClick={() => setReviewMode(null)} className="text-xs text-[#757684] hover:text-[#191c1e]">← 다른 옵션</button>
          </div>

          {reviewMode === "edit_and_approve" && (
            <textarea
              placeholder="수정된 내용을 입력하세요..."
              value={editedContent}
              onChange={e => setEditedContent(e.target.value)}
              rows={8}
              className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none font-mono"
            />
          )}

          <textarea
            placeholder={reviewMode === "request_review" ? "확인이 필요한 사항을 작성하세요 (필수)..." : "코멘트 (선택)..."}
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={2}
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
          />

          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={submitting || (reviewMode === "request_review" && !comment.trim()) || (reviewMode === "edit_and_approve" && !editedContent.trim())}
              className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors"
            >
              {submitting ? "처리 중..." : "제출"}
            </button>
            <button onClick={() => { setReviewMode(null); setComment(""); setErrorMsg(null) }} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/frontend && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ApprovalReviewPanel.tsx
git commit -m "feat(frontend): add ApprovalReviewPanel shared component"
```

---

## Task 7: Refactor Approvals.tsx — use panel + remove Playwright tab

**Files:**
- Modify: `frontend/src/pages/Approvals.tsx` (entire file replacement scope is significant; partial edits described below)

- [ ] **Step 1: Update Tab type + remove playwright-specific state/derivations**

Open `frontend/src/pages/Approvals.tsx`. Apply these edits:

1. Replace `type Tab = "feedback" | "playwright" | "jira_sr"` (line 8) with:
   ```ts
   type Tab = "feedback" | "jira_sr"
   ```

2. Remove `ReviewMode` type definition (line 10) — `ApprovalReviewPanel` owns this now.

3. In the `Approvals` component body, remove these state declarations (lines 18-22):
   ```ts
   const [reviewingId, setReviewingId] = useState<string | null>(null)
   const [reviewMode, setReviewMode] = useState<ReviewMode>(null)
   const [comment, setComment] = useState("")
   const [editedContent, setEditedContent] = useState("")
   const [submitting, setSubmitting] = useState(false)
   ```
   and replace with just:
   ```ts
   const [reviewingId, setReviewingId] = useState<string | null>(null)
   ```

4. Remove `playwrightProcessingCount` (line 33) and `playwrightApprovals` (line 48). Update `currentList` (lines 66-68) to:
   ```ts
   const currentList = tab === "feedback" ? feedbackApprovals : jiraSrFiltered
   ```

5. Replace `openReview` and `closeReview` functions (lines 70-82) with:
   ```ts
   const openReview = (id: string) => setReviewingId(id)
   const closeReview = () => setReviewingId(null)
   ```

6. Delete the entire `handleSubmit` function (lines 93-113).

7. In `handleTabChange` (lines 86-91), remove the `closeReview()` line — keep `setTab(t); setPage(1); if (t !== "jira_sr") setJiraSrFilter("all")`.

- [ ] **Step 2: Remove Playwright tab button from JSX**

Inside the `{/* 탭 */}` block (around lines 122-172), delete the entire `<button onClick={() => handleTabChange("playwright")} ...>` block (lines 140-155 — the button labelled "Playwright 매뉴얼").

- [ ] **Step 3: Update ApprovalCard call site to pass panel-required props**

In the `currentList.map((approval) => (<ApprovalCard ... />))` block, replace the existing `<ApprovalCard ... />` props with:

```tsx
<ApprovalCard
  key={approval.id}
  approval={approval}
  tab={tab}
  isReviewing={reviewingId === approval.id}
  reviewerId={reviewerId}
  onOpenReview={() => openReview(approval.id)}
  onCloseReview={closeReview}
  onRefetch={refetch}
/>
```

- [ ] **Step 4: Add ApprovalReviewPanel import at top of file**

At the top of `Approvals.tsx`, add to the imports block:

```ts
import { ApprovalReviewPanel } from "@/components/ApprovalReviewPanel"
```

- [ ] **Step 5: Update ApprovalCard component signature + body**

Replace the `interface CardProps` and the entire `ApprovalCard` function (lines 296 to end of file) with:

```tsx
interface CardProps {
  approval: ApprovalRequest
  tab: Tab
  isReviewing: boolean
  reviewerId: string
  onOpenReview: () => void
  onCloseReview: () => void
  onRefetch: () => void
}

function ApprovalCard({
  approval, tab, isReviewing, reviewerId, onOpenReview, onCloseReview, onRefetch,
}: CardProps) {
  const [docReviewTargetUrl, setDocReviewTargetUrl] = useState("")
  const [localSubmitting, setLocalSubmitting] = useState(false)

  const change = approval.proposed_change

  const cardTitle = approval.proposed_change_id
    ? `리비전 #${approval.proposed_change_id.slice(0, 8)}`
    : approval.sr_draft_id
      ? `SR #${approval.sr_draft_id.slice(0, 8)}`
      : `승인 #${approval.id.slice(0, 8)}`

  return (
    <div className={`bg-white border rounded-xl shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
      isReviewing ? "border-[#00288e] ring-1 ring-[#dde1ff]" : "border-[#c4c5d5]"
    }`}>
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#ffdbce] flex items-center justify-center shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-lg text-[#611e00]">
                {tab === "feedback" ? "rate_review" : "task"}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-[#191c1e]">{cardTitle}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  approval.status === "approved" ? "bg-[#e8f5e9] text-[#2e7d32]"
                  : approval.status === "rejected" ? "bg-[#fce4ec] text-[#c62828]"
                  : approval.status === "needs_review" ? "bg-[#e8f0fe] text-[#1a56db]"
                  : approval.proposed_change?.source_type === "jira_sr" ? "bg-[#e8f0fe] text-[#1a56db]"
                  : approval.approval_type === "doc_review" ? "bg-[#fff3dc] text-[#92600a]"
                  : "bg-[#ffdbce] text-[#611e00]"
                }`}>
                  {(approval.status === "pending" || approval.status === "needs_review") && (
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  )}
                  {approval.status === "approved" ? "문서 수정 완료"
                  : approval.status === "rejected" ? "종료"
                  : approval.status === "needs_review" ? "AI 초안 검토"
                  : approval.proposed_change?.source_type === "jira_sr" ? "AI 초안 검토"
                  : approval.approval_type === "doc_review" ? "문서화 필요 여부"
                  : "승인 대기"}
                </span>
              </div>
              {tab === "feedback" && change && (
                <p className="text-xs text-[#757684] mt-1 line-clamp-1">{change.reasoning}</p>
              )}
              <p className="text-xs text-[#757684] mt-0.5">
                {new Date(approval.created_at).toLocaleString("ko-KR")}
              </p>
            </div>
          </div>
          {!isReviewing && (approval.status === "pending" || approval.status === "needs_review") && (
            <button onClick={onOpenReview} className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
              <span className="material-symbols-outlined text-base">visibility</span>
              검토
            </button>
          )}
        </div>

        {isReviewing && (
          <div className="mt-6 pt-6 border-t border-[#e0e3e5]">
            {approval.approval_type === "doc_review" && approval.status === "pending" ? (
              <div className="space-y-3">
                <p className="text-sm text-[#444653]">이 SR 완료 건에 대해 문서 작성이 필요한가요?</p>
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="사용자 매뉴얼 캡처 URL (매뉴얼 포함 승인 시 필요)"
                    value={docReviewTargetUrl}
                    onChange={e => setDocReviewTargetUrl(e.target.value)}
                    className="text-sm border border-[#e0e3e5] rounded px-3 py-1.5 w-full"
                  />
                  <div className="flex gap-2 flex-wrap">
                    <button
                      disabled={localSubmitting}
                      onClick={async () => {
                        setLocalSubmitting(true)
                        try {
                          await api.reviewDocApproval(approval.id, { reviewer_id: reviewerId, action: "reject" })
                          onCloseReview()
                          onRefetch()
                        } catch (e: unknown) {
                          alert("처리 중 오류: " + (e instanceof Error ? e.message : String(e)))
                        } finally { setLocalSubmitting(false) }
                      }}
                      className="px-3 py-1.5 text-sm rounded border border-[#e0e3e5] text-[#757684] hover:bg-[#f2f4f6]"
                    >
                      거부 (문서 불필요)
                    </button>
                    <button
                      disabled={localSubmitting}
                      onClick={async () => {
                        setLocalSubmitting(true)
                        try {
                          await api.reviewDocApproval(approval.id, { reviewer_id: reviewerId, action: "approve_doc" })
                          onCloseReview()
                          onRefetch()
                        } catch (e: unknown) {
                          alert("처리 중 오류: " + (e instanceof Error ? e.message : String(e)))
                        } finally { setLocalSubmitting(false) }
                      }}
                      className="px-3 py-1.5 text-sm rounded bg-[#00288e] text-white hover:bg-[#001a6b]"
                    >
                      문서 작성 승인
                    </button>
                    <button
                      disabled={localSubmitting || !docReviewTargetUrl.trim()}
                      onClick={async () => {
                        setLocalSubmitting(true)
                        try {
                          await api.reviewDocApproval(approval.id, {
                            reviewer_id: reviewerId,
                            action: "approve_manual",
                            target_url: docReviewTargetUrl,
                          })
                          onCloseReview()
                          onRefetch()
                        } catch (e: unknown) {
                          alert("처리 중 오류: " + (e instanceof Error ? e.message : String(e)))
                        } finally { setLocalSubmitting(false) }
                      }}
                      className="px-3 py-1.5 text-sm rounded bg-[#1a6b3c] text-white hover:bg-[#0d4a28] disabled:opacity-40"
                    >
                      사용자 매뉴얼 포함 승인
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <ApprovalReviewPanel
                key={approval.id}
                approval={approval}
                reviewerId={reviewerId}
                variant={tab}
                onReviewed={() => { onCloseReview(); onRefetch() }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Remove unused `ReactMarkdown` / `remarkGfm` imports**

At the top of `Approvals.tsx`, the two imports `import ReactMarkdown from "react-markdown"` and `import remarkGfm from "remark-gfm"` are no longer used in this file (the panel owns markdown rendering for non-doc_review cases). Delete them. (The doc_review block above does not use markdown; it uses plain inputs.)

- [ ] **Step 7: Type-check + lint**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/frontend && pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 8: Smoke-run dev server**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/frontend && pnpm dev
```

Open http://localhost:5173/approvals in a browser. Expected:
- Two tabs only: "오류 제보 수정안" / "Jira SR" (no "Playwright 매뉴얼")
- Clicking "검토" on a feedback or jira_sr item still opens the review panel with 4 actions

Press `Ctrl+C` to stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/Approvals.tsx
git commit -m "refactor(frontend): use ApprovalReviewPanel and remove Playwright tab from Approvals"
```

---

## Task 8: ManualGenerator AI 초안 탭 5분기

**Files:**
- Modify: `frontend/src/pages/ManualGenerator.tsx`

- [ ] **Step 1: Add imports**

At the top of `frontend/src/pages/ManualGenerator.tsx`, add to the existing import lines:

```tsx
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ApprovalReviewPanel } from "@/components/ApprovalReviewPanel"
```

- [ ] **Step 2: Make `onRefetch` actually flow**

In the `ManualGenerator` component's return statement, the `<ManualDetail job={selected} onRefetch={refetch} />` already passes refetch. In the `ManualDetail` function signature (line 202), change:
```tsx
function ManualDetail({ job }: { job: ManualJob; onRefetch?: () => void }) {
```
to:
```tsx
function ManualDetail({ job, onRefetch }: { job: ManualJob; onRefetch: () => void }) {
  const { user } = useAuth()
```

And import `useAuth` at top: `import { useAuth } from "@/contexts/AuthContext"` — already imported (verify).

- [ ] **Step 3: Replace the entire `activeSection === "draft"` block**

Find the existing `{activeSection === "draft" && (...)}` block (lines 246-261) in `ManualDetail`. Replace it with:

```tsx
{activeSection === "draft" && (() => {
  if (job.status === "pending" || job.status === "running") {
    return (
      <div className="flex items-center gap-3 p-4 bg-[#d5e3fc] rounded-xl text-sm text-[#00288e]">
        <span className="material-symbols-outlined animate-spin">progress_activity</span>
        매뉴얼 생성 중입니다. 잠시 후 다시 확인해주세요.
      </div>
    )
  }
  if (job.status === "failed") {
    return (
      <div className="p-4 bg-[#ffdad6] rounded-xl text-sm text-[#ba1a1a]">
        매뉴얼 생성에 실패했습니다.
        {job.error_message && <pre className="mt-2 text-xs whitespace-pre-wrap">{job.error_message}</pre>}
      </div>
    )
  }
  const a = job.approval
  const c = job.proposed_change
  if (!a || !c) {
    return <p className="text-sm text-[#9a9bad]">AI 초안 데이터가 없습니다.</p>
  }
  if (a.status === "pending" || a.status === "needs_review") {
    return (
      <ApprovalReviewPanel
        key={a.id}
        approval={{ id: a.id, status: a.status, approval_type: a.approval_type, comment: a.comment, proposed_change: c }}
        reviewerId={user?.id ?? "00000000-0000-0000-0000-000000000001"}
        variant="playwright"
        onReviewed={onRefetch}
      />
    )
  }
  if (a.status === "approved") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between p-3 bg-[#dcfce7] rounded-lg">
          <span className="text-sm font-medium text-[#15803d]">승인 완료. 문서가 생성되었습니다.</span>
          {job.output_document_id && (
            <a
              href={`/documents/${job.output_document_id}`}
              className="text-sm text-[#00288e] hover:underline"
            >
              문서 관리에서 열기 →
            </a>
          )}
        </div>
        <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.proposed_text}</ReactMarkdown>
        </div>
      </div>
    )
  }
  if (a.status === "rejected") {
    return (
      <div className="space-y-4">
        <div className="p-3 bg-[#fce4ec] rounded-lg">
          <p className="text-sm font-medium text-[#c62828]">반려됨</p>
          {a.comment && <p className="mt-1 text-xs text-[#444653]">{a.comment}</p>}
        </div>
        <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 prose prose-sm max-w-none opacity-70">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.proposed_text}</ReactMarkdown>
        </div>
      </div>
    )
  }
  return null
})()}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/frontend && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ManualGenerator.tsx
git commit -m "feat(frontend): inline AI draft review in ManualGenerator with 5-branch render"
```

---

## Task 9: Sidebar filter / count / badge precision

**Files:**
- Modify: `frontend/src/pages/ManualGenerator.tsx`

- [ ] **Step 1: Add helper predicates + replace filter / count**

Inside `ManualGenerator` component (around line 38–53), replace:

```ts
const allJobs = jobs ?? []

const filtered = allJobs.filter(j => {
  if (tab === "all") return true
  if (tab === "review") return j.status === "completed" && !j.output_document_id
  if (tab === "done") return j.status === "completed" && !!j.output_document_id
  return true
})

const selected = allJobs.find(j => j.id === selectedId) ?? null
const reviewCount = allJobs.filter(j => j.status === "completed" && !j.output_document_id).length
```

with:

```ts
const allJobs = jobs ?? []

const isPendingReview = (j: ManualJob) =>
  j.approval?.status === "pending" || j.approval?.status === "needs_review"
const isClosed = (j: ManualJob) =>
  j.approval?.status === "approved" || j.approval?.status === "rejected"

const filtered = allJobs.filter(j => {
  if (tab === "all") return true
  if (tab === "review") return isPendingReview(j)
  if (tab === "done") return isClosed(j)
  return true
})

const selected = allJobs.find(j => j.id === selectedId) ?? null
const reviewCount = allJobs.filter(isPendingReview).length
```

- [ ] **Step 2: Replace `STATUS_BADGE` / `STATUS_LABEL` usage with approval-aware helper**

Delete the existing `STATUS_BADGE` and `STATUS_LABEL` constants (lines 10–21). Add at the top of the file (below imports, above the component):

```ts
function jobBadgeLabel(j: ManualJob): { label: string; cls: string } {
  if (j.status === "running" || j.status === "pending") {
    return { label: "생성 중", cls: "bg-[#d5e3fc] text-[#00288e]" }
  }
  if (j.status === "failed") {
    return { label: "실패", cls: "bg-[#ffdad6] text-[#ba1a1a]" }
  }
  const a = j.approval?.status
  if (a === "pending") return { label: "검토 대기", cls: "bg-[#fff3dc] text-[#92600a]" }
  if (a === "needs_review") return { label: "추가 확인", cls: "bg-[#e8f0fe] text-[#1a56db]" }
  if (a === "approved") return { label: "승인 완료", cls: "bg-[#dcfce7] text-[#15803d]" }
  if (a === "rejected") return { label: "반려", cls: "bg-[#fce4ec] text-[#c62828]" }
  return { label: j.status, cls: "bg-[#f2f4f6] text-[#757684]" }
}
```

- [ ] **Step 3: Update sidebar list badge usage**

In the sidebar list `.map(job => ...)` (around lines 170-184), find:
```tsx
<span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[job.status] ?? "bg-[#f2f4f6] text-[#757684]"}`}>
  {STATUS_LABEL[job.status] ?? job.status}
</span>
```

Replace with:
```tsx
{(() => {
  const b = jobBadgeLabel(job)
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${b.cls}`}>
      {b.label}
    </span>
  )
})()}
```

- [ ] **Step 4: Update detail header badge**

In `ManualDetail` near the top (around lines 207-215), find:
```tsx
<span className={`text-xs font-semibold px-2 py-1 rounded-full ${
  job.status === "completed" ? "bg-[#dcfce7] text-[#15803d]" :
  job.status === "running" ? "bg-[#d5e3fc] text-[#00288e]" :
  job.status === "failed" ? "bg-[#ffdad6] text-[#ba1a1a]" :
  "bg-[#fff3dc] text-[#92600a]"
}`}>{job.status === "completed" ? "완료" : job.status === "running" ? "생성 중" : job.status === "failed" ? "실패" : "대기"}</span>
```

Replace with:
```tsx
{(() => {
  const b = jobBadgeLabel(job)
  return (
    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${b.cls}`}>
      {b.label}
    </span>
  )
})()}
```

- [ ] **Step 5: Type-check + lint**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/frontend && pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ManualGenerator.tsx
git commit -m "feat(frontend): precise sidebar filter/count/badge based on approval status"
```

---

## Task 10: End-to-end verification

**Files:** none (manual + automated verification)

- [ ] **Step 1: Run backend tests**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/backend && uv run pytest -q
```

Expected: all tests pass.

- [ ] **Step 2: Frontend build + lint**

```bash
cd /Users/muni/Documents/GitHub/Manual-automation/frontend && pnpm typecheck && pnpm lint && pnpm build
```

Expected: clean build, no errors.

- [ ] **Step 3: Manual flow check**

Start both servers (in separate terminals):
```bash
cd backend && uv run fastapi dev
cd frontend && pnpm dev
```

In browser:
1. Open http://localhost:5173/, log in, navigate to "매뉴얼 생성"
2. Click "신규 요청", enter a target URL like `https://example.com`, submit
3. Wait for status to flip from "생성 중" → "검토 대기" (sidebar reviewCount badge appears)
4. Select the item → AI 초안 탭 → confirm panel auto-shows with markdown body + 4 buttons
5. Click "편집 후 승인" → edit text → 제출 → wait for refetch → confirm badge changes to "승인 완료" + body is now rendered + "문서 관리에서 열기" link visible
6. Create another job → click "반려" with a comment → confirm badge "반려" + comment visible + body read-only
7. Navigate to /approvals → confirm only 2 tabs (오류 제보 수정안 / Jira SR), no Playwright tab

- [ ] **Step 4: Final commit (if any cleanup needed)**

If no further changes, skip. Otherwise:
```bash
git add -A
git commit -m "chore: minor cleanup after e2e verification"
```

---

## Rollback Notes

- DB schema unchanged (no Alembic migration). All changes are model relationships + Python code + frontend code.
- Revert in reverse order: Tasks 9 → 8 → 7 → 6 → 5 → 4 → 3 → 2 → 1.
- Playwright source_type ProposedChange/Approval records are still created by `manual_service.run_generation`; they just become invisible in `/approvals` but visible in ManualGenerator. Reverting Task 7 restores the Playwright tab.
