# Jira SR done 검토 흐름 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jira webhook done 처리 시 (1) AI 추천 prefetch, (2) 검토 결정 전 자동 완료탭 이동 차단, (3) 검토 후 검토 내역 표시, (4) AI 초안 reviewer 편집 후 승인, (5) "완료 처리 (시뮬레이터)" 버튼 제거.

**Architecture:** 백엔드는 `approval_requests` 테이블에 `action`, `edited_content` 컬럼을 추가하고 `review_doc_review_approval` 에서 `edit_and_approve` 액션을 지원한다. Jira webhook 핸들러에서 `asyncio.create_task` 로 AI 추천을 백그라운드 prefetch 한다. `update_sr_draft` 의 status transition map 에서 `pending_doc_review → done_*` 를 제거해 review action 경로만 허용한다. 프론트엔드는 `SRReview` 의 step 3 우측 패널을 textarea(auto-grow) 로 교체하고 "수정 후 승인" 버튼을 추가하며, 완료 SR 에는 신규 `ReviewHistoryView` 컴포넌트를 렌더한다.

**Tech Stack:** Python FastAPI + SQLAlchemy + Alembic, React + Vite (TypeScript), pytest, ruff, mypy, pnpm

---

## 변경 파일

### 백엔드
- Add: `backend/alembic/versions/<auto>_add_action_and_edited_content_to_approval_requests.py`
- Modify: `backend/app/models/feedback.py` — ApprovalRequest 컬럼 추가
- Modify: `backend/app/schemas/approval.py` — DocReviewAction 확장, ApprovalRequestResponse 에 action·edited_content 추가
- Modify: `backend/app/schemas/sr.py` — SRReviewHistoryResponse 추가, SRDraftResponse 에 pending_doc_review_approval_id 추가
- Modify: `backend/app/services/sr_service.py` — `prefetch_recommendation` 함수, `ALLOWED_STATUS_TRANSITIONS` 수정, `build_sr_response` 확장
- Modify: `backend/app/services/approval_service.py` — `review_doc_review_approval` 에 `edit_and_approve` 지원
- Modify: `backend/app/routers/jira.py` — webhook 에서 prefetch task 스케줄
- Modify: `backend/app/routers/sr.py` — `GET /drafts/{id}/review-history` 추가
- Modify: `backend/tests/test_jira.py` — prefetch 검증
- Add: `backend/tests/test_review_doc_review_approval.py`
- Add: `backend/tests/test_sr_transition_guard.py`
- Add: `backend/tests/test_review_history.py`

### 프론트엔드
- Modify: `frontend/src/lib/api.ts` — `reviewDocApproval` 확장, `getSRReviewHistory` 추가, `completeSRLocal` 제거, 인터페이스 보강
- Modify: `frontend/src/pages/ServiceRequests.tsx` — 시뮬레이터 버튼 제거, SRReview step 3 textarea/버튼 교체, ReviewHistoryView 추가, `handleConfirmNone` 변경

---

### Task 1: 마이그레이션 — approval_requests 컬럼 추가

**Files:**
- Add: `backend/alembic/versions/<auto>_add_action_and_edited_content_to_approval_requests.py`

`approval_requests` 테이블에 `action` (어떤 결정인지 라벨링), `edited_content` (수정 후 승인 시 본문) 컬럼 추가.

- [ ] **Step 1: 새 alembic revision 생성**

```bash
cd backend && uv run alembic revision -m "add_action_and_edited_content_to_approval_requests"
```

생성된 파일 경로 확인 (마지막 줄 출력).

- [ ] **Step 2: 마이그레이션 본문 작성**

생성된 파일 내용을 다음으로 교체 (revision/down_revision 값은 자동 생성된 그대로 유지):

```python
"""add_action_and_edited_content_to_approval_requests

Revision ID: <auto>
Revises: <auto>
Create Date: <auto>

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '<auto>'
down_revision: Union[str, Sequence[str], None] = '<auto>'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('approval_requests', sa.Column('action', sa.String(length=50), nullable=True))
    op.add_column('approval_requests', sa.Column('edited_content', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('approval_requests', 'edited_content')
    op.drop_column('approval_requests', 'action')
```

- [ ] **Step 3: 마이그레이션 적용 및 검증**

```bash
cd backend && uv run alembic upgrade head
```

Expected: `INFO  [alembic.runtime.migration] Running upgrade ... -> <revision>, add_action_and_edited_content_to_approval_requests`

- [ ] **Step 4: 커밋**

```bash
git add backend/alembic/versions/
git commit -m "feat(db): add action and edited_content to approval_requests"
```

---

### Task 2: ApprovalRequest 모델 컬럼 추가

**Files:**
- Modify: `backend/app/models/feedback.py:71-90`

SQLAlchemy ORM 매핑에 새 컬럼 노출.

- [ ] **Step 1: 모델 수정**

`backend/app/models/feedback.py` 의 `ApprovalRequest` 클래스에 다음 컬럼 추가 (line 86 `reviewed_at` 다음에 삽입):

```python
    action: Mapped[str | None] = mapped_column(String(50), nullable=True)
    edited_content: Mapped[str | None] = mapped_column(Text, nullable=True)
```

전체 클래스가 다음과 같아야 함:

```python
class ApprovalRequest(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "approval_requests"

    proposed_change_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("proposed_document_changes.id"), unique=True, nullable=True
    )
    approval_type: Mapped[str] = mapped_column(String(50), default="document_change")
    sr_draft_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sr_drafts.id"), nullable=True
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    status: Mapped[str] = mapped_column(String(50), default="pending")
    comment: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[str | None] = mapped_column(String(50))
    action: Mapped[str | None] = mapped_column(String(50), nullable=True)
    edited_content: Mapped[str | None] = mapped_column(Text, nullable=True)

    proposed_change: Mapped["ProposedDocumentChange | None"] = relationship(
        back_populates="approval_request"
    )
```

- [ ] **Step 2: mypy 검증**

```bash
cd backend && uv run mypy app/models/feedback.py
```

Expected: `Success: no issues found`

- [ ] **Step 3: 커밋**

```bash
git add backend/app/models/feedback.py
git commit -m "feat(models): add action and edited_content to ApprovalRequest"
```

---

### Task 3: Status transition guard — pending_doc_review → done_* 제거

**Files:**
- Modify: `backend/app/services/sr_service.py:190-198`
- Add: `backend/tests/test_sr_transition_guard.py`

`update_sr_draft` API 호출로는 `pending_doc_review → done_synced/done_no_proposal` 전이를 못하게 막는다. 내부 함수(`review_doc_review_approval`)는 ORM 직접 변경이므로 영향 없음.

- [ ] **Step 1: 실패 테스트 작성**

Create `backend/tests/test_sr_transition_guard.py`:

```python
import uuid
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.db import SessionLocal
from app.models.sr import SRDraft
from app.models.user import User


async def _make_user_and_sr(status: str) -> tuple[uuid.UUID, uuid.UUID]:
    async with SessionLocal() as session:
        user = User(id=uuid.uuid4(), name="t", email=f"{uuid.uuid4()}@t.com", role="admin")
        session.add(user)
        draft = SRDraft(
            id=uuid.uuid4(),
            user_id=user.id,
            title="t",
            description="d",
            priority="medium",
            status=status,
        )
        session.add(draft)
        await session.commit()
        return user.id, draft.id


@pytest.mark.asyncio
async def test_patch_pending_doc_review_to_done_synced_rejected():
    _, sr_id = await _make_user_and_sr("pending_doc_review")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.patch(f"/api/sr/drafts/{sr_id}", json={"status": "done_synced"})
        assert res.status_code == 400
        assert "Invalid status transition" in res.json()["detail"]


@pytest.mark.asyncio
async def test_patch_pending_doc_review_to_done_no_proposal_rejected():
    _, sr_id = await _make_user_and_sr("pending_doc_review")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.patch(f"/api/sr/drafts/{sr_id}", json={"status": "done_no_proposal"})
        assert res.status_code == 400


@pytest.mark.asyncio
async def test_patch_pending_doc_review_self_allowed():
    _, sr_id = await _make_user_and_sr("pending_doc_review")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.patch(f"/api/sr/drafts/{sr_id}", json={"status": "pending_doc_review"})
        assert res.status_code == 200
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd backend && uv run pytest tests/test_sr_transition_guard.py -v
```

Expected: 첫 두 케이스는 현재 200 으로 통과해버리므로 FAIL. 세 번째는 PASS.

- [ ] **Step 3: ALLOWED_STATUS_TRANSITIONS 수정**

`backend/app/services/sr_service.py:190-198` 의 `ALLOWED_STATUS_TRANSITIONS` 에서 `pending_doc_review` 의 허용 set 을 self only 로 축소:

```python
ALLOWED_STATUS_TRANSITIONS = {
    "draft": {"draft", "submitted"},
    "submitted": {"submitted", "jira_created"},
    "jira_created": {"jira_created", "pending_doc_review"},
    "pending_doc_review": {"pending_doc_review"},
    "pending_document_selection": {"pending_document_selection", "pending_doc_review"},
    "done_synced": {"done_synced"},
    "done_no_proposal": {"done_no_proposal"},
}
```

(즉 `done_synced`, `done_no_proposal` 항목 제거)

`router_doc_review_approval` 등 내부에서는 SQLAlchemy ORM 으로 `draft.status = ...` 직접 변경하므로 영향 없음.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd backend && uv run pytest tests/test_sr_transition_guard.py -v
```

Expected: 3 passed.

- [ ] **Step 5: 기존 SR 테스트 영향 확인**

```bash
cd backend && uv run pytest tests/test_sr.py -v
```

Expected: 모두 PASS. 만약 어떤 테스트가 `PATCH /drafts/{id}` 로 done_synced/done_no_proposal 을 보내고 있다면 그것은 새 가드로 막혀야 하는 케이스이므로, 해당 테스트를 review_doc_review_approval 호출로 교체. 변경 사항이 있으면 추가 step 으로 처리.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/sr_service.py backend/tests/test_sr_transition_guard.py
git commit -m "feat(sr): block pending_doc_review→done transitions via PATCH"
```

---

### Task 4: review_doc_review_approval — edit_and_approve 지원

**Files:**
- Modify: `backend/app/schemas/approval.py:17-20`
- Modify: `backend/app/services/approval_service.py:235-323`
- Modify: `backend/app/routers/approvals.py:79-93`
- Add: `backend/tests/test_review_doc_review_approval.py`

DocReviewAction 에 `edit_and_approve`, `edited_content`, `comment` 추가. 서비스에서 분기 처리. approval.action 저장.

- [ ] **Step 1: 스키마 확장**

`backend/app/schemas/approval.py` 의 `DocReviewAction` 을 다음으로 교체:

```python
class DocReviewAction(BaseModel):
    reviewer_id: uuid.UUID
    action: Literal["reject", "approve_doc", "approve_manual", "edit_and_approve"]
    target_url: str | None = None
    edited_content: str | None = None
    comment: str | None = None
```

같은 파일의 `ApprovalRequestResponse` 에 `action`, `edited_content` 필드 추가 (line 33 `created_at` 앞에):

```python
class ApprovalRequestResponse(BaseModel):
    id: uuid.UUID
    proposed_change_id: uuid.UUID | None
    approval_type: str
    sr_draft_id: uuid.UUID | None
    proposed_change: ProposedChangeResponse | None = None
    reviewer_id: uuid.UUID | None
    status: str
    comment: str | None
    reviewed_at: str | None
    action: str | None = None
    edited_content: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: 실패 테스트 작성**

Create `backend/tests/test_review_doc_review_approval.py`:

```python
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.main import app
from app.db import SessionLocal
from app.models.user import User
from app.models.sr import SRDraft
from app.models.feedback import ApprovalRequest, ProposedDocumentChange
from app.models.document import Document


async def _seed_edit_case() -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    """Returns (user_id, sr_id, approval_id, proposed_change_id)."""
    async with SessionLocal() as session:
        user = User(id=uuid.uuid4(), name="r", email=f"{uuid.uuid4()}@t.com", role="admin")
        session.add(user)
        doc = Document(id=uuid.uuid4(), title="doc", content="원본 본문", owner_id=user.id)
        session.add(doc)
        sr = SRDraft(
            id=uuid.uuid4(), user_id=user.id, title="t", description="d",
            priority="medium", status="pending_doc_review", jira_issue_key="J-1",
        )
        session.add(sr)
        change = ProposedDocumentChange(
            id=uuid.uuid4(),
            document_id=doc.id,
            feedback_report_id=None,
            source_type="jira_sr",
            original_text="원본 본문",
            proposed_text="AI 제안 본문",
            diff="--- a\n+++ b\n",
            status="pending",
        )
        session.add(change)
        approval = ApprovalRequest(
            id=uuid.uuid4(),
            approval_type="doc_review",
            sr_draft_id=sr.id,
            proposed_change_id=change.id,
            status="pending",
        )
        session.add(approval)
        await session.commit()
        return user.id, sr.id, approval.id, change.id


@pytest.mark.asyncio
async def test_edit_and_approve_overwrites_proposed_text_and_marks_action():
    user_id, sr_id, approval_id, change_id = await _seed_edit_case()
    edited = "사람이 다듬은 최종 본문"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/approvals/{approval_id}/doc-review",
            json={
                "reviewer_id": str(user_id),
                "action": "edit_and_approve",
                "edited_content": edited,
                "comment": "오타 수정",
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "approved"
        assert body["action"] == "edit_and_approve"
        assert body["edited_content"] == edited
        assert body["comment"] == "오타 수정"

    async with SessionLocal() as session:
        change = (await session.execute(
            select(ProposedDocumentChange).where(ProposedDocumentChange.id == change_id)
        )).scalar_one()
        assert change.proposed_text == edited
        sr = (await session.execute(select(SRDraft).where(SRDraft.id == sr_id))).scalar_one()
        assert sr.status == "done_synced"


@pytest.mark.asyncio
async def test_edit_and_approve_missing_edited_content_rejected():
    user_id, _, approval_id, _ = await _seed_edit_case()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/approvals/{approval_id}/doc-review",
            json={"reviewer_id": str(user_id), "action": "edit_and_approve"},
        )
        assert res.status_code == 400
        assert "edited_content" in res.json()["detail"]


@pytest.mark.asyncio
async def test_approve_doc_records_action():
    user_id, sr_id, approval_id, _ = await _seed_edit_case()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/approvals/{approval_id}/doc-review",
            json={"reviewer_id": str(user_id), "action": "approve_doc"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["action"] == "approve_doc"
        assert body["status"] == "approved"


@pytest.mark.asyncio
async def test_reject_records_action_and_comment():
    user_id, sr_id, approval_id, _ = await _seed_edit_case()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/approvals/{approval_id}/doc-review",
            json={"reviewer_id": str(user_id), "action": "reject", "comment": "변경 없음"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["action"] == "reject"
        assert body["status"] == "rejected"
        assert body["comment"] == "변경 없음"

    async with SessionLocal() as session:
        sr = (await session.execute(select(SRDraft).where(SRDraft.id == sr_id))).scalar_one()
        assert sr.status == "done_no_proposal"
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
cd backend && uv run pytest tests/test_review_doc_review_approval.py -v
```

Expected: 4 fail (현재 `edit_and_approve` 지원 X, action 컬럼 미저장).

- [ ] **Step 4: 라우터 — comment/edited_content 전달**

`backend/app/routers/approvals.py` 의 `review_doc_approval` 함수를 다음으로 교체:

```python
@router.post("/{approval_id}/doc-review", response_model=ApprovalRequestResponse)
async def review_doc_approval(
    approval_id: uuid.UUID,
    data: DocReviewAction,
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await approval_service.review_doc_review_approval(
            db,
            approval_id,
            data.reviewer_id,
            data.action,
            target_url=data.target_url,
            edited_content=data.edited_content,
            comment=data.comment,
        )
    except ValueError as e:
        detail = str(e)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return result
```

- [ ] **Step 5: 서비스 — edit_and_approve 분기 + action/comment 저장**

`backend/app/services/approval_service.py:235-323` 의 `review_doc_review_approval` 을 다음으로 교체 (시그니처 + 본문):

```python
async def review_doc_review_approval(
    db: AsyncSession,
    approval_id: uuid.UUID,
    reviewer_id: uuid.UUID,
    action: str,
    target_url: str | None = None,
    edited_content: str | None = None,
    comment: str | None = None,
) -> ApprovalRequest:
    """doc_review 타입 승인 처리.
    action: "reject" | "approve_doc" | "approve_manual" | "edit_and_approve"
    """
    from app.models.sr import SRDraft

    valid_actions = ("reject", "approve_doc", "approve_manual", "edit_and_approve")
    if action not in valid_actions:
        raise ValueError(f"action must be one of {valid_actions}")

    if action == "edit_and_approve" and not edited_content:
        raise ValueError("edited_content required for edit_and_approve")

    result = await db.execute(
        select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise ValueError("Approval not found")
    if approval.approval_type != "doc_review":
        raise ValueError("This approval is not a doc_review type")
    if approval.status != "pending":
        raise ValueError("Approval already reviewed")

    sr_result = await db.execute(
        select(SRDraft).where(SRDraft.id == approval.sr_draft_id)
    )
    draft = sr_result.scalar_one_or_none()

    approval.reviewer_id = reviewer_id
    approval.reviewed_at = datetime.now(timezone.utc).isoformat()
    approval.action = action
    approval.comment = comment
    approval.edited_content = edited_content if action == "edit_and_approve" else None

    if action == "reject":
        approval.status = "rejected"
        if draft:
            draft.status = "done_no_proposal"

    elif action == "edit_and_approve":
        if approval.proposed_change_id:
            change_result = await db.execute(
                select(ProposedDocumentChange).where(
                    ProposedDocumentChange.id == approval.proposed_change_id
                )
            )
            change = change_result.scalar_one_or_none()
            if change:
                change.proposed_text = edited_content
        approval.status = "approved"
        if draft:
            draft.status = "done_synced"

    elif action in ("approve_doc", "approve_manual"):
        approval.status = "approved"
        await db.flush()

        if draft:
            from app.schemas.sr import CompletedSREvent
            from app.services.sr_service import process_completed_sr
            from app.db import SessionLocal

            event = CompletedSREvent(
                source="approval",
                external_issue_key=draft.jira_issue_key,
                status="Done",
                title=draft.title,
                description=draft.description,
            )

            async def _run():
                async with SessionLocal() as session:
                    await process_completed_sr(session, event)

            asyncio.create_task(_run())

            draft.status = "done_synced"

        if action == "approve_manual" and draft:
            from app.services import manual_service
            from app.db import SessionLocal

            url = target_url or draft.target_url
            if url:
                async def _run_manual():
                    async with SessionLocal() as session:
                        job = await manual_service.create_job(
                            session,
                            user_id=reviewer_id,
                            target_url=url,
                            source_sr_id=draft.id,
                        )
                        await manual_service.run_generation(session, job.id)

                asyncio.create_task(_run_manual())

    await db.commit()

    refreshed = await db.execute(
        select(ApprovalRequest)
        .options(selectinload(ApprovalRequest.proposed_change))
        .where(ApprovalRequest.id == approval_id)
    )
    return refreshed.scalar_one()
```

주의: 기존 코드는 `approve_doc/approve_manual` 분기에서 `draft.status` 를 직접 변경하지 않고 `process_completed_sr` 백그라운드 작업에 위임했다. 이번 수정에서는 즉시 `draft.status = "done_synced"` 도 설정하여 응답 시점에서 완료탭 이동을 보장한다. `process_completed_sr` 내부 로직은 그대로 두되 race 가 우려되면 후속 정리 대상.

또한 `ProposedDocumentChange` 가 import 되어 있어야 함. 파일 상단의 import 에 다음 라인이 없으면 추가:

```python
from app.models.feedback import ApprovalRequest, ProposedDocumentChange
```

- [ ] **Step 6: 테스트 실행 — 통과 확인**

```bash
cd backend && uv run pytest tests/test_review_doc_review_approval.py -v
```

Expected: 4 passed.

- [ ] **Step 7: 기존 approval 테스트 영향 확인**

```bash
cd backend && uv run pytest tests/ -k approval -v
```

Expected: 모두 PASS. 만약 기존 doc-review 테스트가 응답에 action 필드 없음을 기대하면 schema 변경으로 응답이 늘어났을 뿐 호환 OK.

- [ ] **Step 8: 커밋**

```bash
git add backend/app/schemas/approval.py backend/app/routers/approvals.py backend/app/services/approval_service.py backend/tests/test_review_doc_review_approval.py
git commit -m "feat(approvals): support edit_and_approve for doc_review"
```

---

### Task 5: SRDraftResponse 에 pending_doc_review_approval_id 추가

**Files:**
- Modify: `backend/app/schemas/sr.py:17-32`
- Modify: `backend/app/services/sr_service.py:343-361`

프론트엔드가 review action 을 호출할 때 approval_id 가 필요. SR 응답에 같이 실어 보낸다.

- [ ] **Step 1: 스키마 필드 추가**

`backend/app/schemas/sr.py:17-32` 의 `SRDraftResponse` 에 필드 추가:

```python
class SRDraftResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    description: str
    priority: str
    related_document_ids: list[uuid.UUID] | None
    status: str
    created_by_ai: bool
    jira_issue_key: str | None = None
    jira_issue_url: str | None = None
    target_url: str | None = None
    ai_doc_recommendation: dict[str, Any] | None = None
    pending_doc_review_approval_id: uuid.UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: build_sr_response 확장**

`backend/app/services/sr_service.py:343-361` 의 `build_sr_response`, `build_sr_responses` 를 다음으로 교체:

```python
async def build_sr_response(db: AsyncSession, draft: SRDraft) -> SRDraftResponse:
    """Convert an SRDraft ORM instance to a response with a freshly computed jira_issue_url and approval id."""
    from app.services import jira_service
    from app.models.feedback import ApprovalRequest

    config = await jira_service.get_active_config(db)
    response = SRDraftResponse.model_validate(draft)
    response.jira_issue_url = jira_service.build_jira_issue_url(draft.jira_issue_key, config)

    if draft.status == "pending_doc_review":
        approval_result = await db.execute(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.sr_draft_id == draft.id,
                ApprovalRequest.approval_type == "doc_review",
                ApprovalRequest.status == "pending",
            )
            .order_by(ApprovalRequest.created_at.desc())
            .limit(1)
        )
        approval = approval_result.scalar_one_or_none()
        if approval:
            response.pending_doc_review_approval_id = approval.id

    return response


async def build_sr_responses(db: AsyncSession, drafts: list[SRDraft]) -> list[SRDraftResponse]:
    """Same as build_sr_response but fetches config once for a batch."""
    from app.services import jira_service
    from app.models.feedback import ApprovalRequest

    config = await jira_service.get_active_config(db)

    pending_ids = [d.id for d in drafts if d.status == "pending_doc_review"]
    approval_map: dict[uuid.UUID, uuid.UUID] = {}
    if pending_ids:
        approval_result = await db.execute(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.sr_draft_id.in_(pending_ids),
                ApprovalRequest.approval_type == "doc_review",
                ApprovalRequest.status == "pending",
            )
            .order_by(ApprovalRequest.created_at.desc())
        )
        for ar in approval_result.scalars().all():
            approval_map.setdefault(ar.sr_draft_id, ar.id)

    out: list[SRDraftResponse] = []
    for draft in drafts:
        response = SRDraftResponse.model_validate(draft)
        response.jira_issue_url = jira_service.build_jira_issue_url(draft.jira_issue_key, config)
        response.pending_doc_review_approval_id = approval_map.get(draft.id)
        out.append(response)
    return out
```

- [ ] **Step 3: 타입 체크**

```bash
cd backend && uv run mypy app/services/sr_service.py
```

Expected: `Success`.

- [ ] **Step 4: 빠른 검증 — list 엔드포인트 호출 후 pending_doc_review SR 가 approval_id 를 포함하는지 확인하는 통합 테스트**

기존 `backend/tests/test_sr.py` 의 webhook 후속 검증 케이스에 어서션 추가하거나, 새로 1건 추가. 빠르게는 다음으로 충분:

`backend/tests/test_sr.py` 끝에 추가:

```python
@pytest.mark.asyncio
async def test_pending_doc_review_response_includes_approval_id():
    # 기존 helper 또는 직접 시드
    import uuid
    from app.db import SessionLocal
    from app.models.user import User
    from app.models.sr import SRDraft
    from app.models.feedback import ApprovalRequest

    async with SessionLocal() as session:
        user = User(id=uuid.uuid4(), name="t", email=f"{uuid.uuid4()}@t.com", role="admin")
        session.add(user)
        draft = SRDraft(
            id=uuid.uuid4(), user_id=user.id, title="t", description="d",
            priority="medium", status="pending_doc_review", jira_issue_key="J-X",
        )
        session.add(draft)
        approval = ApprovalRequest(
            id=uuid.uuid4(),
            approval_type="doc_review",
            sr_draft_id=draft.id,
            status="pending",
        )
        session.add(approval)
        await session.commit()
        sr_id = draft.id
        approval_id = approval.id

    from httpx import ASGITransport, AsyncClient
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/sr/drafts")
        assert res.status_code == 200
        items = res.json()["items"]
        match = next(i for i in items if i["id"] == str(sr_id))
        assert match["pending_doc_review_approval_id"] == str(approval_id)
```

- [ ] **Step 5: 테스트 실행**

```bash
cd backend && uv run pytest tests/test_sr.py::test_pending_doc_review_response_includes_approval_id -v
```

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/schemas/sr.py backend/app/services/sr_service.py backend/tests/test_sr.py
git commit -m "feat(sr): expose pending_doc_review_approval_id in SR response"
```

---

### Task 6: prefetch_recommendation 함수

**Files:**
- Modify: `backend/app/services/sr_service.py` (파일 끝에 함수 추가)

- [ ] **Step 1: 함수 추가**

`backend/app/services/sr_service.py` 끝에 다음 추가:

```python
async def prefetch_recommendation(sr_id: uuid.UUID) -> None:
    """webhook 백그라운드용. 실패해도 진입 시 fallback 이 처리.

    별도 세션을 열어 LLM 호출 시간 동안 메인 요청 트랜잭션을 점유하지 않는다.
    """
    from app.db import SessionLocal
    from app.services import ai_recommendation_service

    async with SessionLocal() as session:
        result = await session.execute(select(SRDraft).where(SRDraft.id == sr_id))
        draft = result.scalar_one_or_none()
        if not draft:
            logger.warning(f"prefetch recommendation: SR not found sr={sr_id}")
            return
        if draft.ai_doc_recommendation:
            return
        try:
            await ai_recommendation_service.recommend_doc_strategy(session, draft)
        except Exception as e:
            logger.warning(f"prefetch recommendation 실패 sr={sr_id}: {e}")
```

파일 상단 `logger` 가 정의되어 있는지 확인 (`logger = logging.getLogger(__name__)`). 없으면 추가.

- [ ] **Step 2: ai_recommendation_service.recommend_doc_strategy 시그니처 확인**

```bash
cd backend && grep -n "def recommend_doc_strategy" app/services/ai_recommendation_service.py
```

Expected: `async def recommend_doc_strategy(db, draft):` 형태. 시그니처가 다르면 호출 부분 보정.

- [ ] **Step 3: 빠른 import 검증**

```bash
cd backend && uv run python -c "from app.services.sr_service import prefetch_recommendation; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: 커밋**

```bash
git add backend/app/services/sr_service.py
git commit -m "feat(sr): add prefetch_recommendation background helper"
```

---

### Task 7: Webhook 핸들러 — prefetch task 스케줄

**Files:**
- Modify: `backend/app/routers/jira.py:101-191`
- Modify: `backend/tests/test_jira.py`

- [ ] **Step 1: 실패 테스트 작성 — prefetch 호출 검증**

`backend/tests/test_jira.py` 끝에 추가:

```python
@pytest.mark.asyncio
async def test_webhook_done_schedules_prefetch_recommendation(monkeypatch):
    import uuid
    from app.db import SessionLocal
    from app.models.user import User
    from app.models.sr import SRDraft
    from app.models.jira import JiraConfig

    calls: list[uuid.UUID] = []

    async def fake_prefetch(sr_id):
        calls.append(sr_id)

    monkeypatch.setattr("app.routers.jira.prefetch_recommendation", fake_prefetch)

    async with SessionLocal() as session:
        user = User(id=uuid.uuid4(), name="t", email=f"{uuid.uuid4()}@t.com", role="admin")
        session.add(user)
        cfg = JiraConfig(
            id=uuid.uuid4(), site_url="https://x.atlassian.net",
            base_url="https://api.atlassian.com/ex/jira/x",
            user_email="t@t.com", api_token="x", project_key="P",
            is_active=True, trigger_status_names=["Done"],
        )
        session.add(cfg)
        sr = SRDraft(
            id=uuid.uuid4(), user_id=user.id, title="t", description="d",
            priority="medium", status="jira_created", jira_issue_key="P-1",
        )
        session.add(sr)
        await session.commit()
        sr_id = sr.id

    payload = {
        "webhookEvent": "jira:issue_updated",
        "issue": {
            "key": "P-1",
            "fields": {"status": {"name": "Done", "statusCategory": {"key": "done"}}},
        },
    }
    from httpx import ASGITransport, AsyncClient
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/api/jira/webhook", json=payload)
        assert res.status_code == 200, res.text

    # asyncio.create_task 가 즉시 실행되지 않을 수 있어 한 틱 양보
    import asyncio
    await asyncio.sleep(0.05)
    assert sr_id in calls
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd backend && uv run pytest tests/test_jira.py::test_webhook_done_schedules_prefetch_recommendation -v
```

Expected: FAIL (현재 jira.py 가 prefetch 호출 안 함).

- [ ] **Step 3: 웹훅 핸들러 수정**

`backend/app/routers/jira.py:101-191` 의 `receive_jira_webhook` 함수에서 다음 추가:

상단 import 에 추가:

```python
import asyncio
from app.services.sr_service import prefetch_recommendation
```

함수 본문에서 `draft.status = "pending_doc_review"` 다음 `await db.commit()` 직후 (line 154-155 사이) task 스케줄:

```python
    draft.status = "pending_doc_review"
    await db.commit()

    asyncio.create_task(prefetch_recommendation(draft.id))
```

기존 `try: ... admins = ...` 블록 위에 위치하도록 한다. 알림/응답 로직은 그대로 유지.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd backend && uv run pytest tests/test_jira.py::test_webhook_done_schedules_prefetch_recommendation -v
```

Expected: PASS.

- [ ] **Step 5: 전체 jira 테스트 실행**

```bash
cd backend && uv run pytest tests/test_jira.py -v
```

Expected: 모두 PASS.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/routers/jira.py backend/tests/test_jira.py
git commit -m "feat(jira): schedule recommendation prefetch on done webhook"
```

---

### Task 8: GET /drafts/{id}/review-history 엔드포인트

**Files:**
- Modify: `backend/app/schemas/sr.py` (스키마 추가)
- Modify: `backend/app/routers/sr.py` (엔드포인트 추가)
- Add: `backend/tests/test_review_history.py`

- [ ] **Step 1: 스키마 추가**

`backend/app/schemas/sr.py` 끝에 다음 추가:

```python
class ReviewHistoryProposal(BaseModel):
    proposed_content: str | None = None
    original_content: str | None = None
    diff: str | None = None


class SRReviewHistoryResponse(BaseModel):
    status: str  # done_synced | done_no_proposal | in_review
    message: str | None = None
    ai_recommendation: dict[str, Any] | None = None
    selected_doc_mode: str | None = None  # "new" | "existing" | "none"
    selected_document_id: uuid.UUID | None = None
    selected_document_title: str | None = None
    final_proposal: ReviewHistoryProposal | None = None
    reviewer_id: uuid.UUID | None = None
    reviewer_name: str | None = None
    reviewed_at: str | None = None
    action: str | None = None  # "approve_doc" | "approve_manual" | "edit_and_approve" | "reject"
    comment: str | None = None
    edited_content: str | None = None
```

- [ ] **Step 2: 실패 테스트 작성**

Create `backend/tests/test_review_history.py`:

```python
import uuid
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.db import SessionLocal
from app.models.user import User
from app.models.sr import SRDraft, ChangeImpactAnalysis
from app.models.feedback import ApprovalRequest, ProposedDocumentChange
from app.models.document import Document


async def _seed(action: str, status: str, with_proposal: bool = True):
    async with SessionLocal() as session:
        user = User(id=uuid.uuid4(), name="검토자A", email=f"{uuid.uuid4()}@t.com", role="admin")
        session.add(user)
        doc = Document(id=uuid.uuid4(), title="대상 문서", content="원본 본문", owner_id=user.id)
        session.add(doc)
        sr = SRDraft(
            id=uuid.uuid4(), user_id=user.id, title="t", description="d",
            priority="medium", status=status, jira_issue_key="J-1",
            ai_doc_recommendation={"recommendation": "existing", "reason": "이미 있는 문서 갱신", "suggested_document_id": str(doc.id), "model": "x", "created_at": "2026-01-01T00:00:00Z"},
        )
        session.add(sr)
        change_id = None
        if with_proposal:
            analysis = ChangeImpactAnalysis(
                id=uuid.uuid4(),
                source_type="jira_sr",
                source_id=sr.id,
                related_document_ids=[str(doc.id)],
                recommended_strategy="update",
                reasoning="r",
                confidence=0.9,
                status="approved",
            )
            session.add(analysis)
            change = ProposedDocumentChange(
                id=uuid.uuid4(),
                document_id=doc.id,
                impact_analysis_id=analysis.id,
                feedback_report_id=None,
                source_type="jira_sr",
                original_text="원본 본문",
                proposed_text="최종 적용 본문",
                diff="--- a\n+++ b\n",
                status="approved",
            )
            session.add(change)
            change_id = change.id

        approval = ApprovalRequest(
            id=uuid.uuid4(),
            approval_type="doc_review",
            sr_draft_id=sr.id,
            proposed_change_id=change_id,
            status="approved" if action != "reject" else "rejected",
            action=action,
            comment="검토 코멘트",
            edited_content="최종 적용 본문" if action == "edit_and_approve" else None,
            reviewer_id=user.id,
            reviewed_at="2026-01-02T00:00:00Z",
        )
        session.add(approval)
        await session.commit()
        return sr.id, doc.id, user.id


@pytest.mark.asyncio
async def test_review_history_pending_returns_in_review():
    sr_id, _, _ = await _seed(action="approve_doc", status="pending_doc_review", with_proposal=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/sr/drafts/{sr_id}/review-history")
        assert res.status_code == 200
        assert res.json()["status"] == "in_review"


@pytest.mark.asyncio
async def test_review_history_edit_and_approve_full_payload():
    sr_id, doc_id, user_id = await _seed(action="edit_and_approve", status="done_synced")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/sr/drafts/{sr_id}/review-history")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "done_synced"
        assert body["action"] == "edit_and_approve"
        assert body["comment"] == "검토 코멘트"
        assert body["edited_content"] == "최종 적용 본문"
        assert body["reviewer_id"] == str(user_id)
        assert body["reviewer_name"] == "검토자A"
        assert body["selected_doc_mode"] == "existing"
        assert body["selected_document_id"] == str(doc_id)
        assert body["selected_document_title"] == "대상 문서"
        assert body["final_proposal"]["proposed_content"] == "최종 적용 본문"
        assert body["final_proposal"]["original_content"] == "원본 본문"
        assert body["ai_recommendation"]["recommendation"] == "existing"


@pytest.mark.asyncio
async def test_review_history_reject_no_proposal():
    sr_id, _, _ = await _seed(action="reject", status="done_no_proposal", with_proposal=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/sr/drafts/{sr_id}/review-history")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "done_no_proposal"
        assert body["action"] == "reject"
        assert body["comment"] == "검토 코멘트"
        assert body["final_proposal"] is None
        assert body["selected_doc_mode"] == "none"


@pytest.mark.asyncio
async def test_review_history_not_found():
    fake = uuid.uuid4()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/sr/drafts/{fake}/review-history")
        assert res.status_code == 404
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
cd backend && uv run pytest tests/test_review_history.py -v
```

Expected: 모두 FAIL (엔드포인트 없음 → 404 만 우연히 통과할 수 있으나 나머지 FAIL).

- [ ] **Step 4: 엔드포인트 구현**

`backend/app/routers/sr.py` 끝에 추가 (필요 import 도 추가). 파일 상단 import 블록에 다음이 없으면 추가:

```python
from app.models.feedback import ApprovalRequest, ProposedDocumentChange
from app.models.document import Document
from app.models.user import User
from app.schemas.sr import SRReviewHistoryResponse, ReviewHistoryProposal
```

파일 끝에 라우터 추가:

```python
@router.get(
    "/drafts/{sr_id}/review-history",
    response_model=SRReviewHistoryResponse | None,
)
async def get_review_history(sr_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    draft_result = await db.execute(select(SRDraft).where(SRDraft.id == sr_id))
    draft = draft_result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="SR draft not found")

    if draft.status == "pending_doc_review":
        return SRReviewHistoryResponse(status="in_review", message="검토 진행 중")

    approval_result = await db.execute(
        select(ApprovalRequest)
        .where(
            ApprovalRequest.sr_draft_id == sr_id,
            ApprovalRequest.approval_type == "doc_review",
        )
        .order_by(ApprovalRequest.created_at.desc())
        .limit(1)
    )
    approval = approval_result.scalar_one_or_none()

    proposal = None
    if approval and approval.proposed_change_id:
        change_result = await db.execute(
            select(ProposedDocumentChange).where(
                ProposedDocumentChange.id == approval.proposed_change_id
            )
        )
        proposal = change_result.scalar_one_or_none()

    if not proposal:
        analysis_result = await db.execute(
            select(ChangeImpactAnalysis)
            .where(
                ChangeImpactAnalysis.source_type == "jira_sr",
                ChangeImpactAnalysis.source_id == sr_id,
            )
            .order_by(ChangeImpactAnalysis.created_at.desc())
            .limit(1)
        )
        analysis = analysis_result.scalar_one_or_none()
        if analysis:
            change_result = await db.execute(
                select(ProposedDocumentChange)
                .where(ProposedDocumentChange.impact_analysis_id == analysis.id)
                .order_by(ProposedDocumentChange.created_at.desc())
                .limit(1)
            )
            proposal = change_result.scalar_one_or_none()

    selected_doc_mode = "none"
    selected_document_id = None
    selected_document_title = None
    if proposal:
        if proposal.document_id:
            selected_doc_mode = "existing"
            selected_document_id = proposal.document_id
            doc_result = await db.execute(
                select(Document).where(Document.id == proposal.document_id)
            )
            doc = doc_result.scalar_one_or_none()
            if doc:
                selected_document_title = doc.title
        else:
            selected_doc_mode = "new"

    reviewer_name = None
    if approval and approval.reviewer_id:
        user_result = await db.execute(
            select(User).where(User.id == approval.reviewer_id)
        )
        user = user_result.scalar_one_or_none()
        if user:
            reviewer_name = user.name

    final_proposal = None
    if proposal and approval and approval.action != "reject":
        final_proposal = ReviewHistoryProposal(
            proposed_content=proposal.proposed_text,
            original_content=proposal.original_text,
            diff=proposal.diff,
        )

    return SRReviewHistoryResponse(
        status=draft.status,
        ai_recommendation=draft.ai_doc_recommendation,
        selected_doc_mode=selected_doc_mode,
        selected_document_id=selected_document_id,
        selected_document_title=selected_document_title,
        final_proposal=final_proposal,
        reviewer_id=approval.reviewer_id if approval else None,
        reviewer_name=reviewer_name,
        reviewed_at=approval.reviewed_at if approval else None,
        action=approval.action if approval else None,
        comment=approval.comment if approval else None,
        edited_content=approval.edited_content if approval else None,
    )
```

`ChangeImpactAnalysis` import 가 파일 상단에 없으면 추가 (`from app.models.sr import SRDraft, ChangeImpactAnalysis`).

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
cd backend && uv run pytest tests/test_review_history.py -v
```

Expected: 4 passed.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/schemas/sr.py backend/app/routers/sr.py backend/tests/test_review_history.py
git commit -m "feat(sr): add review-history endpoint"
```

---

### Task 9: 백엔드 lint/typecheck/전체 테스트

**Files:** (변경 없음, 검증만)

- [ ] **Step 1: ruff**

```bash
cd backend && uv run ruff check
```

Expected: `All checks passed!` (또는 무지적). 지적이 있으면 해당 라인 수정.

- [ ] **Step 2: mypy**

```bash
cd backend && uv run mypy .
```

Expected: `Success: no issues found`. 오류 있으면 해당 파일 수정.

- [ ] **Step 3: 전체 pytest**

```bash
cd backend && uv run pytest -q
```

Expected: 모두 PASS. 실패 케이스가 있다면 원인 파악 후 수정. 본 plan 의 변경 사항이 기존 기능을 깨지 않았어야 함.

- [ ] **Step 4: 커밋 (필요 시)**

수정이 있으면:

```bash
git add -u
git commit -m "chore(backend): satisfy lint/typecheck after SR review flow changes"
```

수정이 없으면 skip.

---

### Task 10: 프론트엔드 api.ts — reviewDocApproval 확장, getSRReviewHistory, completeSRLocal 제거

**Files:**
- Modify: `frontend/src/lib/api.ts:158, 182-183, 207-217, 301`

- [ ] **Step 1: reviewDocApproval 확장**

`frontend/src/lib/api.ts:158` 의 `reviewDocApproval` 함수 라인을 다음으로 교체:

```typescript
  reviewDocApproval: (id: string, data: { reviewer_id: string; action: "reject" | "approve_doc" | "approve_manual" | "edit_and_approve"; target_url?: string; edited_content?: string; comment?: string }) =>
    request<ApprovalRequest>(`/approvals/${id}/doc-review`, { method: 'POST', body: JSON.stringify(data) }),
```

- [ ] **Step 2: completeSRLocal 제거**

`frontend/src/lib/api.ts:182-183` 다음 두 라인 삭제:

```typescript
  completeSRLocal: (id: string) =>
    request<{ status: string; message: string }>(`/sr/drafts/${id}/complete-local`, { method: 'POST' }),
```

- [ ] **Step 3: getSRReviewHistory 추가 + 타입 정의**

`frontend/src/lib/api.ts:217` (getLatestProposal 정의 직후) 에 다음 추가:

```typescript
  getSRReviewHistory: async (srId: string): Promise<SRReviewHistory | null> => {
    const res = await fetch(`${BASE}/sr/drafts/${srId}/review-history`, {
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    })
    if (res.status === 404) return null
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  },
```

같은 파일에서 `ApprovalRequest` 인터페이스 (`frontend/src/lib/api.ts:301`) 에 `action`, `edited_content` 추가:

```typescript
export interface ApprovalRequest { id: string; proposed_change_id: string | null; sr_draft_id: string | null; proposed_change: ProposedChange | null; reviewer_id: string | null; status: string; approval_type: string; comment: string | null; reviewed_at: string | null; action: string | null; edited_content: string | null; created_at: string }
```

SR 타입(`SRDraft` 인터페이스) 에도 `pending_doc_review_approval_id` 필드를 추가. 인터페이스를 찾아 해당 라인을 다음과 같이 보강:

```typescript
// (기존 SRDraft 인터페이스에 다음 한 줄 추가)
  pending_doc_review_approval_id: string | null
```

- [ ] **Step 4: SRReviewHistory 타입 추가**

같은 `api.ts` 파일에 다음 타입 추가 (인터페이스 영역 부근):

```typescript
export type ReviewHistoryAction = "approve_doc" | "approve_manual" | "edit_and_approve" | "reject"

export interface SRReviewHistory {
  status: string  // "done_synced" | "done_no_proposal" | "in_review"
  message?: string | null
  ai_recommendation: { recommendation: string; reason: string; suggested_document_id?: string | null; model?: string; created_at?: string } | null
  selected_doc_mode: "new" | "existing" | "none" | null
  selected_document_id: string | null
  selected_document_title: string | null
  final_proposal: { proposed_content: string | null; original_content: string | null; diff: string | null } | null
  reviewer_id: string | null
  reviewer_name: string | null
  reviewed_at: string | null
  action: ReviewHistoryAction | null
  comment: string | null
  edited_content: string | null
}
```

- [ ] **Step 5: typecheck**

```bash
cd frontend && pnpm typecheck
```

Expected: 에러 없음. 만약 `SRDraft` 인터페이스에 `pending_doc_review_approval_id` 추가로 인해 다른 파일에서 객체 리터럴 누락 에러가 나면 그 호출부에 `pending_doc_review_approval_id: null` 추가.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(api): extend reviewDocApproval, add review-history, drop simulator"
```

---

### Task 11: ServiceRequests — 시뮬레이터 버튼 제거

**Files:**
- Modify: `frontend/src/pages/ServiceRequests.tsx:258-269, 376-385`

- [ ] **Step 1: handleLocalComplete 삭제**

`frontend/src/pages/ServiceRequests.tsx:258-269` 의 다음 블록을 통째로 삭제:

```typescript
  const handleLocalComplete = async () => {
    setSubmittingId(true)
    try {
      await api.completeSRLocal(sr.id)
      onRefetch()
      setActiveSection("review")
    } catch (e) {
      setSubmitError("완료 처리에 실패했습니다: " + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmittingId(false)
    }
  }
```

- [ ] **Step 2: 시뮬레이터 버튼 삭제**

같은 파일 line 376-385 의 다음 블록을 통째로 삭제:

```tsx
                {["submitted", "jira_created"].includes(sr.status) && (
                  <button
                    onClick={handleLocalComplete}
                    disabled={submittingId}
                    className="flex items-center gap-2 px-3 py-1.5 border border-[#1a56db] text-[#1a56db] rounded-lg text-xs font-semibold hover:bg-[#e8f0fe] disabled:opacity-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    {submittingId ? "처리 중..." : "완료 처리 (시뮬레이터)"}
                  </button>
                )}
```

- [ ] **Step 3: typecheck**

```bash
cd frontend && pnpm typecheck
```

Expected: 에러 없음. `submittingId` 가 다른 곳에서도 사용되므로 state 자체는 삭제하지 않음.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/ServiceRequests.tsx
git commit -m "refactor(sr): remove '완료 처리 (시뮬레이터)' button from SR detail"
```

---

### Task 12: SRReview step 3 — textarea 편집 + 수정 후 승인

**Files:**
- Modify: `frontend/src/pages/ServiceRequests.tsx:413-810` (SRReview 컴포넌트 전반)

reviewer 가 step 3 우측 패널에서 AI 초안을 직접 편집하고 "수정 후 승인" 으로 적용. 기존 `updateSRDraft({status: "done_synced"})` 호출 제거.

- [ ] **Step 1: SRReview state 추가**

`SRReview` 함수(`ServiceRequests.tsx:413`) 의 state 선언부(line 414-427)에 다음 추가:

```typescript
  const [editedContent, setEditedContent] = useState<string>("")
  const editTaRef = useRef<HTMLTextAreaElement>(null)
```

상단 import 에 `useRef` 가 없으면 React import 라인을 다음과 같이 보강:

```typescript
import { useEffect, useRef, useState } from "react"
```

- [ ] **Step 2: proposal 변경 시 editedContent 초기화 + auto-grow**

`SRReview` 안에 다음 effect 추가 (기존 useEffect 들 다음):

```typescript
  useEffect(() => {
    if (proposal) setEditedContent(proposal.proposed_content)
  }, [proposal])

  useEffect(() => {
    const el = editTaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [editedContent])
```

- [ ] **Step 3: handleConfirmNone 변경 (updateSRDraft 제거)**

`ServiceRequests.tsx:475-487` 의 `handleConfirmNone` 함수를 다음으로 교체. 컴포넌트 props 로 `reviewerId` 가 전달되어야 하므로, `SRReview` 컴포넌트 시그니처도 함께 수정.

먼저 `SRReview` 함수 시그니처 (`ServiceRequests.tsx:413`):

```typescript
function SRReview({ sr, docs, onRefetch, reviewerId }: { sr: SRDraft; docs: Document[]; onRefetch: () => void; reviewerId: string }) {
```

그리고 `handleConfirmNone`:

```typescript
  const handleConfirmNone = async () => {
    if (!sr.pending_doc_review_approval_id) {
      setNoneError("승인 ID를 찾을 수 없습니다. 페이지를 새로고침하세요.")
      return
    }
    setSavingNone(true)
    setNoneError(null)
    try {
      await api.reviewDocApproval(sr.pending_doc_review_approval_id, {
        reviewer_id: reviewerId,
        action: "reject",
        comment: "문서 변경 불필요",
      })
      onRefetch()
      setConfirmingNone(false)
    } catch (e) {
      setNoneError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingNone(false)
    }
  }
```

- [ ] **Step 4: SRReview 호출부에 reviewerId 전달**

같은 파일의 `<SRReview ... />` 호출부(line 403 부근)를 다음으로 교체:

```tsx
      {activeSection === "review" && (
        <SRReview sr={sr} docs={docs} onRefetch={onRefetch} reviewerId={reviewerId} />
      )}
```

`SRDetail` (또는 부모) 컴포넌트가 `reviewerId` 를 받지 않으면 부모도 동일하게 prop 으로 받게 보강. 가장 가까운 부모는 `ServiceRequests` 루트. `ServiceRequests` 컴포넌트 상단에서 다음을 추가/사용:

```typescript
import { useAuth } from "@/contexts/AuthContext"
// ...
const { user } = useAuth()
const reviewerId = user?.id ?? "00000000-0000-0000-0000-000000000001"
```

그리고 `SRDetail` 호출에 `reviewerId={reviewerId}` 전달, `SRDetail` 시그니처도 `reviewerId: string` 추가.

(이미 `Approvals.tsx` 동일 패턴이 있으므로 그것을 참고.)

- [ ] **Step 5: step 3 textarea 교체 — handleApprove 함수**

`ServiceRequests.tsx:705-808` 의 step 3 블록 (`{step === 3 && (...)}`)을 다음으로 교체:

```tsx
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setStep(docMode === "new" ? 1 : 2)} className="text-xs text-[#757684] hover:text-[#191c1e]">← 뒤로</button>
            <p className="text-sm font-medium text-[#191c1e]">
              {docMode === "new" ? "신규 문서 AI 초안" : `'${docs.find(d => d.id === selectedDocId)?.title}' 수정 초안`}
            </p>
          </div>
          {!proposal ? (
            <div className="text-center py-8">
              <p className="text-sm text-[#757684] mb-4">AI가 SR 내용을 바탕으로 문서 초안을 생성합니다.</p>
              <button
                onClick={async () => {
                  setGenerating(true)
                  setGenerateError(null)
                  try {
                    const analysis = await api.analyzeImpact({
                      source_type: "jira_sr",
                      source_id: sr.id,
                      related_document_ids: selectedDocId ? [selectedDocId] : undefined,
                    })
                    if (selectedDocId) {
                      const cp = await api.generateProposalForDocument(
                        analysis.id, selectedDocId, analysis.recommended_strategy || "update"
                      )
                      setProposal(cp)
                    } else {
                      setProposal({
                        id: analysis.id,
                        impact_analysis_id: analysis.id,
                        document_id: "",
                        original_content: "",
                        proposed_content: analysis.reasoning,
                        diff: "",
                        status: analysis.status,
                        created_at: analysis.created_at,
                      })
                    }
                  } catch (e) {
                    setGenerateError(e instanceof Error ? e.message : "초안 생성 실패")
                  } finally {
                    setGenerating(false)
                  }
                }}
                disabled={generating}
                className="px-5 py-2 bg-[#4a4bdc] text-white rounded-lg text-sm font-medium hover:bg-[#3b3cd0] disabled:opacity-50"
              >
                {generating ? "생성 중..." : "AI 초안 생성"}
              </button>
              {generateError && (
                <div className="mt-3 p-3 bg-[#fff7f7] border border-[#fecaca] rounded-lg text-xs text-[#b91c1c] flex items-center justify-between">
                  <span>{generateError}</span>
                  <button onClick={() => setGenerateError(null)} className="text-[#00288e] underline">닫기</button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {proposal.original_content ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[#757684] mb-2">기존 내용</p>
                    <pre className="text-xs text-[#191c1e] bg-[#fff7f7] p-3 rounded-lg border border-[#fecaca] whitespace-pre-wrap overflow-auto max-h-96">{proposal.original_content}</pre>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#757684] mb-2">AI 수정안 (편집 가능)</p>
                    <textarea
                      ref={editTaRef}
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      className="text-xs text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap w-full font-mono resize-none overflow-hidden min-h-[12rem]"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-[#757684] mb-2">AI 수정 제안 (편집 가능)</p>
                  <textarea
                    ref={editTaRef}
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="text-xs text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap w-full font-mono resize-none overflow-hidden min-h-[12rem]"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!sr.pending_doc_review_approval_id) {
                      setGenerateError("승인 ID를 찾을 수 없습니다. 페이지를 새로고침하세요.")
                      return
                    }
                    setApplying(true)
                    try {
                      await api.reviewDocApproval(sr.pending_doc_review_approval_id, {
                        reviewer_id: reviewerId,
                        action: "approve_doc",
                      })
                      onRefetch()
                    } catch (e) {
                      setGenerateError(e instanceof Error ? e.message : "승인 실패")
                    } finally {
                      setApplying(false)
                    }
                  }}
                  disabled={applying}
                  className="px-4 py-2 bg-[#15803d] text-white rounded-lg text-sm font-medium hover:bg-[#166534] disabled:opacity-50"
                >
                  {applying ? "반영 중..." : "승인"}
                </button>
                <button
                  onClick={async () => {
                    if (!sr.pending_doc_review_approval_id) {
                      setGenerateError("승인 ID를 찾을 수 없습니다. 페이지를 새로고침하세요.")
                      return
                    }
                    if (editedContent === proposal.proposed_content) {
                      setGenerateError("수정된 내용이 없습니다. '승인'을 사용하세요.")
                      return
                    }
                    setApplying(true)
                    try {
                      await api.reviewDocApproval(sr.pending_doc_review_approval_id, {
                        reviewer_id: reviewerId,
                        action: "edit_and_approve",
                        edited_content: editedContent,
                      })
                      onRefetch()
                    } catch (e) {
                      setGenerateError(e instanceof Error ? e.message : "수정 후 승인 실패")
                    } finally {
                      setApplying(false)
                    }
                  }}
                  disabled={applying || editedContent === proposal.proposed_content}
                  className="px-4 py-2 bg-[#4a4bdc] text-white rounded-lg text-sm font-medium hover:bg-[#3b3cd0] disabled:opacity-50"
                >
                  수정 후 승인
                </button>
                <button onClick={() => setProposal(null)} className="px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm hover:bg-[#f2f4f6]">
                  다시 생성
                </button>
              </div>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 6: typecheck**

```bash
cd frontend && pnpm typecheck
```

Expected: 에러 없음.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/pages/ServiceRequests.tsx
git commit -m "feat(sr-review): editable AI draft + edit-and-approve action"
```

---

### Task 13: ReviewHistoryView 컴포넌트 + 완료 SR 통합

**Files:**
- Modify: `frontend/src/pages/ServiceRequests.tsx:489-499`

완료 SR 의 검토 탭 렌더링을 `ReviewHistoryView` 로 교체.

- [ ] **Step 1: ReviewHistoryView 컴포넌트 추가**

`frontend/src/pages/ServiceRequests.tsx` 파일 끝(또는 `SRReview` 함수 직후) 에 추가:

```tsx
const ACTION_LABEL: Record<ReviewHistoryAction, string> = {
  approve_doc: "승인",
  approve_manual: "매뉴얼 생성 승인",
  edit_and_approve: "수정 후 승인",
  reject: "문서 변경 없음",
}

const ACTION_BADGE: Record<ReviewHistoryAction, string> = {
  approve_doc: "bg-[#dcfce7] text-[#15803d]",
  approve_manual: "bg-[#dcfce7] text-[#15803d]",
  edit_and_approve: "bg-[#e8f0fe] text-[#1a56db]",
  reject: "bg-[#fce4ec] text-[#c62828]",
}

const MODE_LABEL: Record<string, string> = {
  new: "신규 문서",
  existing: "기존 문서 수정",
  none: "문서 변경 없음",
}

function ReviewHistoryView({ srId }: { srId: string }) {
  const [history, setHistory] = useState<SRReviewHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    setLoading(true)
    api.getSRReviewHistory(srId)
      .then(h => { if (!ignore) setHistory(h) })
      .catch(e => { if (!ignore) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [srId])

  if (loading) return <div className="text-sm text-[#9a9bad] py-4">검토 내역 로딩 중...</div>
  if (error) return <div className="text-sm text-[#b91c1c] py-4">검토 내역 로딩 실패: {error}</div>
  if (!history) return <div className="text-sm text-[#9a9bad] py-4">검토 내역이 없습니다.</div>
  if (history.status === "in_review") return <div className="text-sm text-[#9a9bad] py-4">검토 진행 중입니다.</div>

  const action = history.action

  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-center gap-3">
        {action && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ACTION_BADGE[action]}`}>
            {ACTION_LABEL[action]}
          </span>
        )}
        <span className="text-xs text-[#757684]">
          {history.reviewer_name ?? "익명"} · {history.reviewed_at ? new Date(history.reviewed_at).toLocaleString("ko-KR") : "—"}
        </span>
      </div>

      {history.ai_recommendation && (
        <section>
          <p className="text-xs font-semibold text-[#757684] mb-1">AI 추천</p>
          <p className="text-[#191c1e] bg-[#eef2ff] border border-[#c7d2fe] rounded-lg p-3">
            <span className="font-semibold">{history.ai_recommendation.recommendation}</span>
            <span className="mx-1 text-[#757684]">·</span>
            <span>{history.ai_recommendation.reason}</span>
          </p>
        </section>
      )}

      <section>
        <p className="text-xs font-semibold text-[#757684] mb-1">선택 결과</p>
        <p className="text-[#191c1e]">
          {history.selected_doc_mode ? MODE_LABEL[history.selected_doc_mode] ?? history.selected_doc_mode : "—"}
          {history.selected_document_title && (
            <span className="ml-2 text-[#757684]">· {history.selected_document_title}</span>
          )}
        </p>
      </section>

      {history.final_proposal && history.final_proposal.proposed_content && (
        <section>
          <p className="text-xs font-semibold text-[#757684] mb-1">적용된 본문</p>
          {history.final_proposal.original_content ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-[#757684] mb-1">기존</p>
                <pre className="text-xs text-[#191c1e] bg-[#fff7f7] p-3 rounded-lg border border-[#fecaca] whitespace-pre-wrap overflow-auto max-h-96">{history.final_proposal.original_content}</pre>
              </div>
              <div>
                <p className="text-[10px] text-[#757684] mb-1">최종</p>
                <pre className="text-xs text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap overflow-auto max-h-96">{history.final_proposal.proposed_content}</pre>
              </div>
            </div>
          ) : (
            <pre className="text-xs text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap overflow-auto max-h-96">{history.final_proposal.proposed_content}</pre>
          )}
        </section>
      )}

      {history.comment && (
        <section>
          <p className="text-xs font-semibold text-[#757684] mb-1">검토 코멘트</p>
          <p className="text-[#191c1e] bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-3 whitespace-pre-wrap">{history.comment}</p>
        </section>
      )}
    </div>
  )
}
```

상단 import 에 `SRReviewHistory`, `ReviewHistoryAction` 가 같은 파일에서 가져와지지 않으면 `api` 모듈에서 import 추가:

```typescript
import type { SRReviewHistory, ReviewHistoryAction } from "@/lib/api"
```

또는 기존 import 줄에 함께 합쳐 넣음.

- [ ] **Step 2: SRReview 의 완료 분기 교체**

`frontend/src/pages/ServiceRequests.tsx:489-499` (`if (sr.status !== "pending_doc_review") { ... }`) 블록을 다음으로 교체:

```typescript
  if (sr.status !== "pending_doc_review") {
    return <ReviewHistoryView srId={sr.id} />
  }
```

- [ ] **Step 3: typecheck**

```bash
cd frontend && pnpm typecheck
```

Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/ServiceRequests.tsx
git commit -m "feat(sr): show review history for completed SR"
```

---

### Task 14: 프론트엔드 lint 및 빌드 검증

**Files:** (변경 없음)

- [ ] **Step 1: typecheck**

```bash
cd frontend && pnpm typecheck
```

Expected: 에러 없음.

- [ ] **Step 2: lint**

```bash
cd frontend && pnpm lint
```

Expected: 에러 없음. 경고는 수정 권장.

- [ ] **Step 3: build (옵션)**

```bash
cd frontend && pnpm build
```

Expected: build 성공.

- [ ] **Step 4: 발견 이슈 수정 후 커밋 (필요 시)**

```bash
git add -u
git commit -m "chore(frontend): satisfy lint/typecheck after SR review changes"
```

수정이 없으면 skip.

---

### Task 15: 수동 검증 (브라우저)

**Files:** (변경 없음)

- [ ] **Step 1: 백엔드/프론트 dev 서버 실행**

별도 터미널 2개:

```bash
cd backend && uv run fastapi dev
```

```bash
cd frontend && pnpm dev
```

`http://localhost:5173` 접속.

- [ ] **Step 2: 시드 SR 1건 — pending_doc_review 진입 시뮬레이션**

기존 시드된 SR (또는 신규 SR 작성 후 submit) 의 jira_issue_key 를 알아둔다.

```bash
curl -X POST http://localhost:8000/api/jira/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "webhookEvent": "jira:issue_updated",
    "issue": {
      "key": "<JIRA_ISSUE_KEY>",
      "fields": {"status": {"name": "Done", "statusCategory": {"key": "done"}}}
    }
  }'
```

응답: `{"status": "pending_doc_review", ...}`

- [ ] **Step 3: 검토 탭에서 즉시 표시 확인**

브라우저에서 `/sr?tab=pending_doc_review` 접속 → 해당 SR 카드 클릭 → "검토" 탭 자동 진입 (또는 클릭).

확인:
- step 1 에 AI 추천이 곧바로 표시 (prefetch 효과). 만약 prefetch 가 늦으면 잠시 후 표시.
- "AI 초안 생성" 버튼 클릭 → step 3 진입 후 textarea 표시.

- [ ] **Step 4: textarea auto-grow 확인**

textarea 에 Enter 를 여러 번 입력 → 창이 내용에 맞춰 자동으로 늘어남.

- [ ] **Step 5: 수정 후 승인 확인**

textarea 에 임의 텍스트 추가 → "수정 후 승인" 버튼이 활성화됨 → 클릭 → 완료탭 이동.

`/documents/<선택한 문서>` 페이지에 변경된 본문 적용 확인.

- [ ] **Step 6: 검토 내역 확인**

완료탭 → 방금 SR 클릭 → "검토" 탭 → ReviewHistoryView 가 다음을 표시:
- 배지 "수정 후 승인"
- 검토자 / 검토일시
- AI 추천 (new/existing/none + 이유)
- 선택 결과 (모드 + 문서 제목)
- 적용된 본문 (좌측 기존 / 우측 최종 — 수정한 내용 일치)
- (코멘트 입력했다면) 코멘트

- [ ] **Step 7: reject 흐름 확인**

새 SR → webhook done → 검토 탭 → step 1 에서 "문서 변경 없음" 흐름 → "확정" 클릭 → 완료탭 이동 → 검토 내역에 "문서 변경 없음" 배지 + 코멘트 표시, 본문 영역 없음.

- [ ] **Step 8: 자동 transition 차단 확인**

`/sr` 페이지에서 pending_doc_review 상태의 SR 에 대해 브라우저 devtools 콘솔에서:

```javascript
fetch('/api/sr/drafts/<SR_ID>', {
  method: 'PATCH',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({status: 'done_synced'})
}).then(r => r.json()).then(console.log)
```

Expected: `{"detail": "Invalid status transition: pending_doc_review → done_synced"}` 와 400 응답.

- [ ] **Step 9: 시뮬레이터 버튼 부재 확인**

submitted/jira_created 상태의 SR 상세 → "완료 처리 (시뮬레이터)" 버튼이 보이지 않아야 함.

- [ ] **Step 10: 결과 캡쳐 후 커밋 (변경 사항 없음, 검증만)**

수동 검증으로 누락된 케이스가 발견되면 해당 Task 로 돌아가 수정. 누락 없으면 다음 단계.

---

### Task 16: 회귀 점검 + 최종 정리

**Files:** (변경 없음)

- [ ] **Step 1: 백엔드 전체 테스트**

```bash
cd backend && uv run pytest -q
```

Expected: 모두 PASS.

- [ ] **Step 2: 백엔드 lint/typecheck**

```bash
cd backend && uv run ruff check && uv run mypy .
```

Expected: 깨끗.

- [ ] **Step 3: 프론트엔드 lint/typecheck**

```bash
cd frontend && pnpm lint && pnpm typecheck
```

Expected: 깨끗.

- [ ] **Step 4: Approvals.tsx Jira SR 탭 카운트 회귀 확인**

브라우저에서 `/approvals` → Jira SR 탭 → 4필터 배지 (전체/문서화 필요 여부/AI 초안 검토/완료) 카운트가 이전과 동일하게 표시되는지 확인.

- [ ] **Step 5: 누락 발견 시 커밋, 없으면 종료**

수정이 있으면:

```bash
git add -u
git commit -m "chore: address regressions after SR review flow changes"
```

없으면 plan 완료.

---

## Self-review 결과

- **Spec 커버리지:** 모든 spec 요구사항이 Task 1~16 으로 매핑됨.
  - "AI 추천 사전 생성" → Task 6, 7
  - "자동 transition 차단" → Task 3
  - "검토 내역 표시" → Task 8 (백엔드), Task 13 (프론트엔드)
  - "AI 초안 수정 후 승인" → Task 1, 2, 4, 5 (백엔드), Task 12 (프론트엔드)
  - "시뮬레이터 버튼 제거" → Task 10, 11
- **Placeholder scan:** 마이그레이션 revision/down_revision 의 `<auto>` 는 alembic 자동 생성 값 그대로 두라는 명시이므로 placeholder 아님. 그 외 TBD/TODO 없음.
- **Type 일관성:** `pending_doc_review_approval_id` (backend snake_case ↔ frontend snake_case 그대로 사용). `ReviewHistoryAction` 라벨 4종이 백엔드 valid_actions 와 일치 (approve_doc, approve_manual, edit_and_approve, reject).
