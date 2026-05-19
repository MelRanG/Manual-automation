# Approvals & Feedback 페이지 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오류 제보 수정안과 Playwright 매뉴얼을 Approvals 페이지 탭 2개에서 통합 검토·승인할 수 있도록 백엔드와 프론트엔드를 개선한다.

**Architecture:** `proposed_document_changes` 테이블에 `source_type` 컬럼을 추가하고, Approvals API 응답에 ProposedChange 전체 데이터를 포함시킨다. Playwright 매뉴얼 생성 완료 시 즉시 Document 저장 대신 ProposedChange → ApprovalRequest 흐름으로 전환한다. 프론트엔드 Approvals 페이지는 탭 2개(오류 제보 / Playwright)와 diff 뷰를 표시한다.

**Tech Stack:** FastAPI, SQLAlchemy (async), Alembic, Pydantic v2, React 18, TypeScript, pnpm

---

## 파일 변경 맵

| 파일 | 변경 유형 |
|------|-----------|
| `backend/alembic/versions/<new>.py` | 생성 — source_type 컬럼 마이그레이션 |
| `backend/app/models/feedback.py` | 수정 — ProposedDocumentChange에 source_type 필드 추가 |
| `backend/app/schemas/feedback.py` | 수정 — ProposedChangeResponse에 source_type 추가, FeedbackReportResponse에 document_title 추가 |
| `backend/app/schemas/approval.py` | 수정 — ApprovalRequestResponse에 proposed_change 포함 |
| `backend/app/services/feedback_service.py` | 수정 — FeedbackReport 응답에 document_title 조회 추가, ProposedChange 생성 시 source_type="feedback" 설정 |
| `backend/app/services/approval_service.py` | 수정 — list_pending_approvals에 proposed_change 조인, Playwright 승인 시 Document 신규 생성 로직 |
| `backend/app/services/manual_service.py` | 수정 — Document 즉시 생성 제거, ProposedChange+ApprovalRequest 생성으로 교체 |
| `backend/app/routers/approvals.py` | 수정 — list_pending_approvals에 status 쿼리 파라미터 추가 |
| `backend/tests/test_approvals.py` | 수정 — source_type 검증, proposed_change 포함 응답 검증, Playwright 승인 흐름 테스트 추가 |
| `frontend/src/lib/api.ts` | 수정 — ApprovalRequest에 proposed_change 필드 추가, ProposedChange에 source_type 추가, FeedbackReport에 document_title 추가 |
| `frontend/src/pages/Approvals.tsx` | 수정 — 탭 2개, 실제 데이터 연결, diff 뷰, 편집 모드 미리채움 |
| `frontend/src/pages/Feedback.tsx` | 수정 — 문서 제목 표시, 수정안 생성 배지, Approvals 링크 |

---

## Task 1: DB 마이그레이션 — source_type 컬럼 추가

**Files:**
- Create: `backend/alembic/versions/<auto>.py`
- Modify: `backend/app/models/feedback.py`

- [ ] **Step 1: 모델에 source_type 필드 추가**

`backend/app/models/feedback.py`의 `ProposedDocumentChange` 클래스에 아래 필드를 추가한다 (기존 `confidence` 필드 다음):

```python
source_type: Mapped[str] = mapped_column(String(50), default="feedback")
```

- [ ] **Step 2: Alembic 마이그레이션 생성**

```bash
cd backend && uv run alembic revision --autogenerate -m "add_source_type_to_proposed_changes"
```

생성된 파일(`alembic/versions/<hash>_add_source_type_to_proposed_changes.py`)을 열어 upgrade 함수가 아래처럼 되어 있는지 확인한다:

```python
def upgrade() -> None:
    op.add_column('proposed_document_changes',
        sa.Column('source_type', sa.String(length=50), nullable=True)
    )
    op.execute("UPDATE proposed_document_changes SET source_type = 'feedback' WHERE source_type IS NULL")
    op.alter_column('proposed_document_changes', 'source_type', nullable=False)
```

자동 생성 내용이 위와 다르면 직접 수정한다.

- [ ] **Step 3: 마이그레이션 적용**

```bash
cd backend && uv run alembic upgrade head
```

Expected: `Running upgrade ... -> <hash>, add_source_type_to_proposed_changes`

- [ ] **Step 4: 마이그레이션 검증 테스트 작성**

`backend/tests/test_approvals.py` 맨 아래에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_proposed_change_has_source_type(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Source Type Test Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Original text."})
    doc_id = doc_resp.json()["id"]

    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "This content needs updating",
    })
    assert fb_resp.status_code == 201
    proposed = fb_resp.json()["proposed_change"]
    assert proposed is not None
    assert proposed["source_type"] == "feedback"
```

- [ ] **Step 5: 테스트 실행 확인**

```bash
cd backend && uv run pytest tests/test_approvals.py::test_proposed_change_has_source_type -v
```

Expected: FAIL — `KeyError: 'source_type'` (스키마 아직 미수정)

- [ ] **Step 6: 커밋**

```bash
git add backend/alembic/versions/ backend/app/models/feedback.py backend/tests/test_approvals.py
git commit -m "feat: add source_type column to proposed_document_changes"
```

---

## Task 2: 백엔드 스키마 및 서비스 — source_type, document_title 추가

**Files:**
- Modify: `backend/app/schemas/feedback.py`
- Modify: `backend/app/services/feedback_service.py`

- [ ] **Step 1: ProposedChangeResponse에 source_type 추가**

`backend/app/schemas/feedback.py`의 `ProposedChangeResponse` 클래스에 필드 추가:

```python
class ProposedChangeResponse(BaseModel):
    id: uuid.UUID
    feedback_report_id: uuid.UUID
    document_id: uuid.UUID
    document_version_id: uuid.UUID
    original_text: str
    proposed_text: str
    diff: str
    reasoning: str
    confidence: float
    source_type: str          # 추가
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: FeedbackReportResponse에 document_title 추가**

같은 파일 `FeedbackReportResponse`에 필드 추가:

```python
class FeedbackReportResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    document_id: uuid.UUID | None
    chunk_id: uuid.UUID | None
    chat_message_id: uuid.UUID | None
    feedback_text: str
    status: str
    document_title: str | None = None    # 추가
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 3: feedback_service에서 document_title 조회 추가**

`backend/app/services/feedback_service.py`의 `list_feedback` 함수를 수정한다. 파일 전체를 읽은 후 `list_feedback` 함수를 아래로 교체:

```python
async def list_feedback(
    db: AsyncSession, document_id: uuid.UUID | None = None
) -> list[FeedbackReport]:
    stmt = select(FeedbackReport).order_by(FeedbackReport.created_at.desc())
    if document_id:
        stmt = stmt.where(FeedbackReport.document_id == document_id)
    result = await db.execute(stmt)
    reports = list(result.scalars().all())

    # document_title을 동적 속성으로 설정 (ORM 컬럼 아님)
    doc_ids = {r.document_id for r in reports if r.document_id}
    if doc_ids:
        doc_result = await db.execute(
            select(Document.id, Document.title).where(Document.id.in_(doc_ids))
        )
        title_map = {row.id: row.title for row in doc_result}
        for report in reports:
            report.__dict__["document_title"] = title_map.get(report.document_id)
    else:
        for report in reports:
            report.__dict__["document_title"] = None

    return reports
```

- [ ] **Step 4: generate_correction에서 source_type 설정**

`backend/app/services/feedback_service.py`의 `ProposedDocumentChange(...)` 생성 코드(85번째 줄 근처)에 `source_type="feedback"` 필드 추가:

```python
    proposal = ProposedDocumentChange(
        id=uuid.uuid4(),
        feedback_report_id=feedback.id,
        document_id=feedback.document_id,
        document_version_id=version.id,
        original_text=original_text,
        proposed_text=proposed_text,
        diff=diff or "(no difference detected)",
        reasoning=f"AI correction based on feedback: {feedback.feedback_text[:200]}",
        confidence=0.8,
        source_type="feedback",    # 추가
        status="pending",
    )
```

- [ ] **Step 5: Task 1에서 작성한 테스트 재실행**

```bash
cd backend && uv run pytest tests/test_approvals.py::test_proposed_change_has_source_type -v
```

Expected: PASS

- [ ] **Step 6: 전체 피드백/승인 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py tests/test_approvals.py -v
```

Expected: 모든 테스트 PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/app/schemas/feedback.py backend/app/services/feedback_service.py
git commit -m "feat: add source_type to ProposedChange, document_title to FeedbackReport response"
```

---

## Task 3: Approvals API — ProposedChange 포함 응답, status 필터

**Files:**
- Modify: `backend/app/schemas/approval.py`
- Modify: `backend/app/services/approval_service.py`
- Modify: `backend/app/routers/approvals.py`

- [ ] **Step 1: ApprovalRequestResponse에 proposed_change 포함**

`backend/app/schemas/approval.py` 전체를 아래로 교체:

```python
import uuid
from datetime import datetime

from pydantic import BaseModel

from app.schemas.feedback import ProposedChangeResponse


class ApprovalAction(BaseModel):
    reviewer_id: uuid.UUID
    action: str  # "approved", "rejected", "edit_and_approve", "request_review"
    comment: str | None = None
    edited_content: str | None = None


class ApprovalRequestResponse(BaseModel):
    id: uuid.UUID
    proposed_change_id: uuid.UUID
    proposed_change: ProposedChangeResponse | None = None
    reviewer_id: uuid.UUID | None
    status: str
    comment: str | None
    reviewed_at: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: approval_service — list에서 proposed_change 조인**

`backend/app/services/approval_service.py`의 `list_pending_approvals` 함수를 아래로 교체:

```python
async def list_pending_approvals(
    db: AsyncSession, status: str = "pending"
) -> list[ApprovalRequest]:
    from sqlalchemy.orm import selectinload
    if status == "all":
        stmt = (
            select(ApprovalRequest)
            .options(selectinload(ApprovalRequest.proposed_change))
            .order_by(ApprovalRequest.created_at.asc())
        )
    else:
        statuses = ["pending", "needs_review"] if status == "needs_review" else ["pending"]
        stmt = (
            select(ApprovalRequest)
            .options(selectinload(ApprovalRequest.proposed_change))
            .where(ApprovalRequest.status.in_(statuses))
            .order_by(ApprovalRequest.created_at.asc())
        )
    result = await db.execute(stmt)
    return list(result.scalars().all())
```

그리고 `get_approval` 함수도 proposed_change를 로드하도록 수정:

```python
async def get_approval(db: AsyncSession, approval_id: uuid.UUID) -> ApprovalRequest | None:
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(ApprovalRequest)
        .options(selectinload(ApprovalRequest.proposed_change))
        .where(ApprovalRequest.id == approval_id)
    )
    return result.scalar_one_or_none()
```

- [ ] **Step 3: ProposedDocumentChange 모델에 manual_job_id 추가 및 ApprovalRequest relationship 확인**

`backend/app/models/feedback.py`의 `ProposedDocumentChange`에 `manual_job_id` 필드 추가 (Task 4에서 승인 시 ManualJob 조회에 사용):

```python
manual_job_id: Mapped[uuid.UUID | None] = mapped_column(
    UUID(as_uuid=True), ForeignKey("manual_generation_jobs.id"), nullable=True
)
```

그리고 `ApprovalRequest` 클래스에 relationship이 없으면 추가:

```python
class ApprovalRequest(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "approval_requests"

    proposed_change_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("proposed_document_changes.id"), unique=True
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    status: Mapped[str] = mapped_column(String(50), default="pending")
    comment: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[str | None] = mapped_column(String(50))

    proposed_change: Mapped["ProposedDocumentChange"] = relationship(
        back_populates="approval_request"
    )
```

(이미 있으면 relationship 추가 부분만 건너뜀)

Alembic 마이그레이션 생성 및 적용:

```bash
cd backend && uv run alembic revision --autogenerate -m "add_manual_job_id_to_proposed_changes"
cd backend && uv run alembic upgrade head
```

- [ ] **Step 4: approvals 라우터에 status 쿼리 파라미터 추가**

`backend/app/routers/approvals.py`의 `list_pending_approvals` 엔드포인트를 수정:

```python
@router.get("", response_model=list[ApprovalRequestResponse])
async def list_pending_approvals(
    status: str = "pending",
    db: AsyncSession = Depends(get_db),
):
    return await approval_service.list_pending_approvals(db, status=status)
```

- [ ] **Step 5: 테스트 작성 — proposed_change 포함 응답 검증**

`backend/tests/test_approvals.py`에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_list_approvals_includes_proposed_change(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Include Proposed Change Test",
        "owner_id": test_user["id"],
    }, params={"content": "Some content to correct."})
    doc_id = doc_resp.json()["id"]

    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "This needs correction",
    })
    proposal_id = fb_resp.json()["proposed_change"]["id"]
    await client.post(f"/api/approvals/{proposal_id}")

    list_resp = await client.get("/api/approvals")
    assert list_resp.status_code == 200
    approvals = list_resp.json()
    assert len(approvals) > 0
    # 최신 항목에서 proposed_change 확인
    target = next((a for a in approvals if a["proposed_change_id"] == proposal_id), None)
    assert target is not None
    assert target["proposed_change"] is not None
    assert target["proposed_change"]["source_type"] == "feedback"
    assert "original_text" in target["proposed_change"]
    assert "proposed_text" in target["proposed_change"]
    assert "confidence" in target["proposed_change"]
```

- [ ] **Step 6: 테스트 실행**

```bash
cd backend && uv run pytest tests/test_approvals.py::test_list_approvals_includes_proposed_change -v
```

Expected: PASS

- [ ] **Step 7: 전체 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_approvals.py -v
```

Expected: 모든 테스트 PASS

- [ ] **Step 8: 커밋**

```bash
git add backend/app/schemas/approval.py backend/app/services/approval_service.py backend/app/routers/approvals.py backend/app/models/feedback.py backend/tests/test_approvals.py
git commit -m "feat: approvals API — include proposed_change in response, add status filter"
```

---

## Task 4: Playwright 매뉴얼 → 승인 흐름으로 전환

**Files:**
- Modify: `backend/app/services/manual_service.py`
- Modify: `backend/app/services/approval_service.py`

- [ ] **Step 1: 테스트 작성 — Playwright 승인 흐름**

`backend/tests/test_approvals.py`에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_playwright_manual_approval_flow(client: AsyncClient, test_user: dict):
    # ManualJob 생성 (백그라운드 실행 없이 직접 서비스 호출)
    from app.db import SessionLocal
    from app.services import manual_service

    async with SessionLocal() as db:
        job = await manual_service.create_job(
            db,
            user_id=test_user["id"],
            target_url="https://example.com",
        )
        job_id = job.id
        await manual_service.run_generation(db, job_id)

    # job 상태 확인
    job_resp = await client.get(f"/api/manuals/jobs/{job_id}")
    assert job_resp.status_code == 200
    job_data = job_resp.json()
    # 승인 전이므로 output_document_id가 None
    assert job_data["output_document_id"] is None
    assert job_data["status"] == "completed"

    # Approvals 목록에서 playwright 수정안 확인
    list_resp = await client.get("/api/approvals")
    approvals = list_resp.json()
    playwright_approval = next(
        (a for a in approvals
         if a["proposed_change"] and a["proposed_change"]["source_type"] == "playwright"),
        None
    )
    assert playwright_approval is not None
    approval_id = playwright_approval["id"]

    # 승인
    review_resp = await client.post(f"/api/approvals/{approval_id}/review", json={
        "reviewer_id": test_user["id"],
        "action": "approved",
    })
    assert review_resp.status_code == 200
    assert review_resp.json()["status"] == "approved"

    # 승인 후 job의 output_document_id가 설정됐는지 확인
    job_resp2 = await client.get(f"/api/manuals/jobs/{job_id}")
    assert job_resp2.json()["output_document_id"] is not None
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd backend && uv run pytest tests/test_approvals.py::test_playwright_manual_approval_flow -v
```

Expected: FAIL — `assert job_data["output_document_id"] is None` 실패 (현재는 즉시 저장)

- [ ] **Step 3: manual_service.run_generation 수정**

`backend/app/services/manual_service.py`에서 `run_generation` 함수의 Document 생성 블록을 ProposedChange + ApprovalRequest 생성으로 교체.

파일 상단 import에 추가 필요한 것 확인 후, `run_generation` 내 `# Create document` 주석부터 `job.output_document_id = doc.id` 까지를 아래로 교체:

```python
        # 승인 흐름: ProposedChange + ApprovalRequest 생성
        from app.models.feedback import ProposedDocumentChange, ApprovalRequest

        proposed = ProposedDocumentChange(
            id=uuid.uuid4(),
            feedback_report_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),  # placeholder, FK null 허용 필요
            document_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),          # placeholder
            document_version_id=uuid.UUID("00000000-0000-0000-0000-000000000000"), # placeholder
            original_text="",
            proposed_text=markdown,
            diff="",
            reasoning=f"Playwright auto-generated manual for {job.target_url}",
            confidence=1.0,
            source_type="playwright",
            status="pending",
        )
```

위 코드를 보면 FK 제약이 문제가 된다. 이를 해결하기 위해 ProposedDocumentChange 모델의 nullable 허용이 필요하다.

**대신 아래 접근법을 사용한다:** `feedback_report_id`, `document_id`, `document_version_id`를 nullable로 변경한다.

`backend/app/models/feedback.py`의 `ProposedDocumentChange`를 아래로 수정:

```python
class ProposedDocumentChange(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "proposed_document_changes"

    feedback_report_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("feedback_reports.id"), unique=True, nullable=True
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True
    )
    document_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_versions.id"), nullable=True
    )
    original_text: Mapped[str] = mapped_column(Text)
    proposed_text: Mapped[str] = mapped_column(Text)
    diff: Mapped[str] = mapped_column(Text)
    reasoning: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float)
    source_type: Mapped[str] = mapped_column(String(50), default="feedback")
    status: Mapped[str] = mapped_column(String(50), default="pending")

    feedback_report: Mapped["FeedbackReport | None"] = relationship(
        back_populates="proposed_change"
    )
    approval_request: Mapped["ApprovalRequest | None"] = relationship(
        back_populates="proposed_change"
    )
```

그런 다음 Alembic 마이그레이션 생성:

```bash
cd backend && uv run alembic revision --autogenerate -m "make_proposed_change_fks_nullable"
```

생성된 마이그레이션 적용:

```bash
cd backend && uv run alembic upgrade head
```

- [ ] **Step 4: manual_service.run_generation 최종 교체**

`backend/app/services/manual_service.py`의 `run_generation` 함수에서 Document 즉시 생성 블록을 아래로 교체한다 (파일을 먼저 Read해서 정확한 위치 확인):

```python
        # 승인 흐름: ProposedChange + ApprovalRequest 생성 (Document는 승인 후 생성)
        from app.models.feedback import ProposedDocumentChange, ApprovalRequest as ApprovalReq

        proposed = ProposedDocumentChange(
            id=uuid.uuid4(),
            feedback_report_id=None,
            document_id=None,
            document_version_id=None,
            manual_job_id=job.id,
            original_text="",
            proposed_text=markdown,
            diff="",
            reasoning=f"Playwright auto-generated manual for {job.target_url}",
            confidence=1.0,
            source_type="playwright",
            status="pending",
        )
        db.add(proposed)
        await db.flush()

        approval = ApprovalReq(
            id=uuid.uuid4(),
            proposed_change_id=proposed.id,
            status="pending",
        )
        db.add(approval)

        job.status = "completed"
        job.screenshots = [s for s in screenshots]
        # output_document_id는 승인 후 설정
```

- [ ] **Step 5: approval_service — Playwright 승인 시 Document 생성**

`backend/app/services/approval_service.py`의 `review_approval` 함수에서 `action == "approved"` 블록 내에 source_type 분기 추가.

현재 코드:
```python
    if action == "approved" and change:
        approval.status = "approved"
        change.status = "approved"
        await db.flush()
        await create_new_version(...)
```

아래로 교체:

```python
    if action in ("approved", "edit_and_approve") and change:
        final_content = edited_content if (action == "edit_and_approve" and edited_content) else change.proposed_text
        approval.status = "approved"
        change.status = "approved"
        await db.flush()

        if change.source_type == "playwright":
            # 신규 Document 생성
            from app.models.document import Document, DocumentVersion
            from app.models.manual import ManualGenerationJob
            from sqlalchemy import select as _select

            doc = Document(
                id=uuid.uuid4(),
                title=f"사용자 매뉴얼 - {change.reasoning[:40]}",
                description="Playwright 자동 생성 후 승인된 매뉴얼",
                owner_id=reviewer_id,
                status="active",
                priority="medium",
                trust_score=1.0,
            )
            db.add(doc)
            await db.flush()

            version = DocumentVersion(
                id=uuid.uuid4(),
                document_id=doc.id,
                version_number=1,
                content=final_content,
                created_by=reviewer_id,
                change_summary="Approved Playwright auto-generated manual",
            )
            db.add(version)
            await db.flush()
            doc.current_version_id = version.id

            # ManualJob.output_document_id 업데이트 (manual_job_id로 직접 조회)
            if change.manual_job_id:
                job_result = await db.execute(
                    _select(ManualGenerationJob).where(
                        ManualGenerationJob.id == change.manual_job_id
                    )
                )
                job = job_result.scalar_one_or_none()
                if job:
                    job.output_document_id = doc.id
        else:
            await create_new_version(
                db,
                change.document_id,
                final_content,
                change_summary=f"Applied {'with reviewer edits: ' + (comment or '') if action == 'edit_and_approve' else 'approved correction: '}{change.reasoning[:100]}",
                created_by=reviewer_id,
            )
    elif action == "request_review":
        approval.status = "needs_review"
        if change:
            change.status = "needs_review"
    elif action == "rejected" and change:
        approval.status = "rejected"
        change.status = "rejected"
    else:
        approval.status = action
```

그리고 기존의 별도 `elif action == "edit_and_approve"` 블록을 제거한다 (위 코드에서 통합했음).

- [ ] **Step 6: 테스트 실행**

```bash
cd backend && uv run pytest tests/test_approvals.py::test_playwright_manual_approval_flow -v
```

Expected: PASS

- [ ] **Step 7: 전체 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_approvals.py tests/test_feedback.py -v
```

Expected: 모든 테스트 PASS

- [ ] **Step 8: 커밋**

```bash
git add backend/app/models/feedback.py backend/app/services/manual_service.py backend/app/services/approval_service.py backend/alembic/versions/ backend/tests/test_approvals.py
git commit -m "feat: playwright manual → approval flow, approve creates Document"
```

---

## Task 5: 프론트엔드 API 타입 업데이트

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: ProposedChange에 source_type 추가**

`frontend/src/lib/api.ts`의 `ProposedChange` 인터페이스를 수정:

```typescript
export interface ProposedChange {
  id: string
  feedback_report_id: string | null
  document_id: string | null
  original_text: string
  proposed_text: string
  diff: string
  reasoning: string
  confidence: number
  source_type: "feedback" | "playwright"
  status: string
}
```

- [ ] **Step 2: ApprovalRequest에 proposed_change 추가**

`frontend/src/lib/api.ts`의 `ApprovalRequest` 인터페이스를 수정:

```typescript
export interface ApprovalRequest {
  id: string
  proposed_change_id: string
  proposed_change: ProposedChange | null
  reviewer_id: string | null
  status: string
  comment: string | null
  reviewed_at: string | null
  created_at: string
}
```

- [ ] **Step 3: FeedbackReport에 document_title 추가**

`frontend/src/lib/api.ts`의 `FeedbackReport` 인터페이스를 수정:

```typescript
export interface FeedbackReport {
  id: string
  user_id: string
  document_id: string | null
  feedback_text: string
  status: string
  document_title: string | null
  created_at: string
}
```

- [ ] **Step 4: listApprovals에 status 파라미터 추가**

`api.ts`의 `listApprovals` 함수를 수정:

```typescript
listApprovals: (status = "pending") =>
  request<ApprovalRequest[]>(`/approvals?status=${status}`),
```

- [ ] **Step 5: typecheck 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: 타입 에러 없음 (또는 Approvals.tsx에서 아직 `proposed_change`를 참조하지 않아 에러 없음)

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: update frontend API types — ProposedChange source_type, ApprovalRequest proposed_change"
```

---

## Task 6: Feedback 페이지 개선

**Files:**
- Modify: `frontend/src/pages/Feedback.tsx`

- [ ] **Step 1: 문서 제목 표시 및 배지 추가**

`frontend/src/pages/Feedback.tsx`를 아래로 교체한다 (파일을 먼저 Read 후 교체):

```tsx
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { api, type FeedbackReport, type ProposedChange } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"

export function Feedback() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data: feedback, refetch } = useApi(() => api.listFeedback(), [])
  const [showCreate, setShowCreate] = useState(false)
  const [text, setText] = useState("")
  const [docId, setDocId] = useState("")
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
          <input
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
            placeholder="문서 ID (선택)"
            value={docId}
            onChange={e => setDocId(e.target.value)}
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
                <th className="w-20 px-4 py-3" />
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
```

- [ ] **Step 2: typecheck 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/pages/Feedback.tsx
git commit -m "feat: Feedback 페이지 — 문서 제목 표시, 수정안 생성 배지, Approvals 링크"
```

---

## Task 7: Approvals 페이지 전면 개선

**Files:**
- Modify: `frontend/src/pages/Approvals.tsx`

- [ ] **Step 1: Approvals.tsx 전면 교체**

파일을 Read한 후 아래 내용으로 교체:

```tsx
import { useState } from "react"
import { api, type ApprovalRequest } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"

type Tab = "feedback" | "playwright"
type ReviewMode = "approve" | "reject" | "edit_and_approve" | "request_review" | null

export function Approvals() {
  const { user } = useAuth()
  const { data: approvals, refetch } = useApi(() => api.listApprovals("pending"), [])
  const [tab, setTab] = useState<Tab>("feedback")
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewMode, setReviewMode] = useState<ReviewMode>(null)
  const [comment, setComment] = useState("")
  const [editedContent, setEditedContent] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const reviewerId = user?.id ?? "00000000-0000-0000-0000-000000000001"

  const feedbackApprovals = (approvals ?? []).filter(
    a => a.proposed_change?.source_type === "feedback"
  )
  const playwrightApprovals = (approvals ?? []).filter(
    a => a.proposed_change?.source_type === "playwright"
  )
  const currentList = tab === "feedback" ? feedbackApprovals : playwrightApprovals

  const openReview = (id: string, proposedText: string) => {
    setReviewingId(id)
    setReviewMode(null)
    setComment("")
    setEditedContent(proposedText)
  }

  const closeReview = () => {
    setReviewingId(null)
    setReviewMode(null)
    setComment("")
    setEditedContent("")
  }

  const handleSubmit = async (id: string) => {
    if (reviewMode === "request_review" && !comment.trim()) return
    if (reviewMode === "edit_and_approve" && !editedContent.trim()) return
    setSubmitting(true)
    try {
      const action = reviewMode === "approve" ? "approved"
        : reviewMode === "reject" ? "rejected"
        : reviewMode === "edit_and_approve" ? "edit_and_approve"
        : "request_review"
      await api.reviewApproval(id, {
        reviewer_id: reviewerId,
        action,
        comment: comment || undefined,
        edited_content: reviewMode === "edit_and_approve" ? editedContent : undefined,
      })
      closeReview()
      refetch()
    } finally {
      setSubmitting(false)
    }
  }

  const totalPending = (approvals ?? []).length

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#191c1e]">승인 관리</h2>
        <p className="text-sm text-[#444653] mt-1">문서 변경 제안을 검토하고 승인하세요.</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-[#e0e3e5]">
        <button
          onClick={() => { setTab("feedback"); closeReview() }}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "feedback"
              ? "border-[#00288e] text-[#00288e]"
              : "border-transparent text-[#757684] hover:text-[#191c1e]"
          }`}
        >
          <span className="material-symbols-outlined text-base">bug_report</span>
          오류 제보 수정안
          {feedbackApprovals.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-[#ffdbce] text-[#611e00] text-[10px] font-bold rounded-full">
              {feedbackApprovals.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setTab("playwright"); closeReview() }}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "playwright"
              ? "border-[#00288e] text-[#00288e]"
              : "border-transparent text-[#757684] hover:text-[#191c1e]"
          }`}
        >
          <span className="material-symbols-outlined text-base">smart_toy</span>
          Playwright 매뉴얼
          {playwrightApprovals.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-[#ffdbce] text-[#611e00] text-[10px] font-bold rounded-full">
              {playwrightApprovals.length}
            </span>
          )}
        </button>
      </div>

      {currentList.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">task_alt</span>
          <h3 className="mt-4 text-lg font-semibold text-[#191c1e]">모든 승인이 처리되었습니다</h3>
          <p className="mt-2 text-sm text-[#757684]">현재 대기 중인 승인 요청이 없습니다</p>
        </div>
      ) : (
        <div className="space-y-4">
          {currentList.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              tab={tab}
              isReviewing={reviewingId === approval.id}
              reviewMode={reviewingId === approval.id ? reviewMode : null}
              comment={comment}
              editedContent={editedContent}
              submitting={submitting}
              onOpenReview={() => openReview(approval.id, approval.proposed_change?.proposed_text ?? "")}
              onCloseReview={closeReview}
              onSetReviewMode={setReviewMode}
              onSetComment={setComment}
              onSetEditedContent={setEditedContent}
              onSubmit={() => handleSubmit(approval.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface CardProps {
  approval: ApprovalRequest
  tab: Tab
  isReviewing: boolean
  reviewMode: ReviewMode
  comment: string
  editedContent: string
  submitting: boolean
  onOpenReview: () => void
  onCloseReview: () => void
  onSetReviewMode: (m: ReviewMode) => void
  onSetComment: (v: string) => void
  onSetEditedContent: (v: string) => void
  onSubmit: () => void
}

function ApprovalCard({
  approval, tab, isReviewing, reviewMode, comment, editedContent,
  submitting, onOpenReview, onCloseReview, onSetReviewMode, onSetComment,
  onSetEditedContent, onSubmit,
}: CardProps) {
  const change = approval.proposed_change

  return (
    <div className={`bg-white border rounded-xl shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
      isReviewing ? "border-[#00288e] ring-1 ring-[#dde1ff]" : "border-[#c4c5d5]"
    }`}>
      <div className="p-6">
        {/* 카드 헤더 */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#ffdbce] flex items-center justify-center shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-lg text-[#611e00]">
                {tab === "feedback" ? "rate_review" : "smart_toy"}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-[#191c1e]">
                  {tab === "playwright"
                    ? change?.reasoning?.replace("Playwright auto-generated manual for ", "").slice(0, 50) ?? "Playwright 매뉴얼"
                    : `리비전 #${approval.proposed_change_id.slice(0, 8)}`}
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  approval.status === "pending" ? "bg-[#ffdbce] text-[#611e00]"
                  : approval.status === "needs_review" ? "bg-[#d5e3fc] text-[#00288e]"
                  : "bg-[#d5e3fc] text-[#16a34a]"
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  {approval.status === "pending" ? "승인 대기" : approval.status === "needs_review" ? "검토 필요" : approval.status}
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

        {/* 검토 패널 */}
        {isReviewing && (
          <div className="mt-6 pt-6 border-t border-[#e0e3e5] space-y-4">
            {/* 메타 정보 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-base text-[#d97706]">lightbulb</span>
                  <span className="text-xs font-semibold text-[#444653]">변경 사유</span>
                </div>
                <p className="text-sm text-[#191c1e]">{change?.reasoning ?? "정보 없음"}</p>
              </div>
              {tab === "feedback" && change && (
                <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 flex flex-col items-center justify-center">
                  <span className="text-xs font-semibold text-[#444653] mb-2">AI 신뢰도</span>
                  <span className="text-2xl font-bold text-[#00288e]">
                    {Math.round(change.confidence * 100)}%
                  </span>
                </div>
              )}
            </div>

            {/* Diff 뷰 */}
            {change && (
              <div className="space-y-2">
                <span className="text-xs font-semibold text-[#444653]">
                  {tab === "feedback" ? "변경 내용 (원문 → 제안)" : "생성된 매뉴얼 내용"}
                </span>
                {tab === "feedback" && change.original_text ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#fff5f5] border border-[#fca5a5] rounded-lg p-3 overflow-auto max-h-48">
                      <p className="text-[10px] font-semibold text-[#dc2626] mb-1">원문</p>
                      <pre className="text-xs text-[#191c1e] whitespace-pre-wrap font-mono">{change.original_text}</pre>
                    </div>
                    <div className="bg-[#f0fdf4] border border-[#86efac] rounded-lg p-3 overflow-auto max-h-48">
                      <p className="text-[10px] font-semibold text-[#16a34a] mb-1">제안</p>
                      <pre className="text-xs text-[#191c1e] whitespace-pre-wrap font-mono">{change.proposed_text}</pre>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-3 overflow-auto max-h-64">
                    <pre className="text-xs text-[#191c1e] whitespace-pre-wrap font-mono">{change.proposed_text}</pre>
                  </div>
                )}
              </div>
            )}

            {/* 액션 버튼 */}
            {!reviewMode ? (
              <div className="flex flex-wrap gap-3 pt-2">
                <button onClick={() => onSetReviewMode("approve")} className="flex items-center gap-2 px-4 py-2.5 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm">
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  승인
                </button>
                <button onClick={() => onSetReviewMode("edit_and_approve")} className="flex items-center gap-2 px-4 py-2.5 border border-[#00288e] text-[#00288e] rounded-lg text-sm font-medium hover:bg-[#dde1ff] transition-colors">
                  <span className="material-symbols-outlined text-base">edit</span>
                  편집 후 승인
                </button>
                <button onClick={() => onSetReviewMode("reject")} className="flex items-center gap-2 px-4 py-2.5 border border-[#ba1a1a] text-[#ba1a1a] rounded-lg text-sm font-medium hover:bg-[#ffdad6] transition-colors">
                  <span className="material-symbols-outlined text-base">cancel</span>
                  반려
                </button>
                <button onClick={() => onSetReviewMode("request_review")} className="flex items-center gap-2 px-4 py-2.5 border border-[#c4c5d5] text-[#444653] rounded-lg text-sm hover:bg-[#f2f4f6] transition-colors">
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
                    {reviewMode === "approve" ? "승인" : reviewMode === "reject" ? "반려" : reviewMode === "edit_and_approve" ? "편집 후 승인" : "추가 확인 요청"}
                  </span>
                  <button onClick={() => onSetReviewMode(null)} className="text-xs text-[#757684] hover:text-[#191c1e]">← 다른 옵션</button>
                </div>

                {reviewMode === "edit_and_approve" && (
                  <textarea
                    placeholder="수정된 내용을 입력하세요..."
                    value={editedContent}
                    onChange={e => onSetEditedContent(e.target.value)}
                    rows={8}
                    className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none font-mono"
                  />
                )}

                <textarea
                  placeholder={reviewMode === "request_review" ? "확인이 필요한 사항을 작성하세요 (필수)..." : "코멘트 (선택)..."}
                  value={comment}
                  onChange={e => onSetComment(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
                />

                <div className="flex gap-2">
                  <button
                    onClick={onSubmit}
                    disabled={submitting || (reviewMode === "request_review" && !comment.trim()) || (reviewMode === "edit_and_approve" && !editedContent.trim())}
                    className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors"
                  >
                    {submitting ? "처리 중..." : "제출"}
                  </button>
                  <button onClick={onCloseReview} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: lint 및 typecheck 통과 확인**

```bash
cd frontend && pnpm lint && pnpm typecheck
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/pages/Approvals.tsx
git commit -m "feat: Approvals 페이지 — 탭 2개, diff 뷰, 실제 데이터 연결"
```

---

## Task 8: 최종 검증

- [ ] **Step 1: 백엔드 전체 테스트**

```bash
cd backend && uv run pytest -v
```

Expected: 모든 테스트 PASS (기존 테스트 포함)

- [ ] **Step 2: 프론트엔드 빌드**

```bash
cd frontend && pnpm build
```

Expected: 빌드 성공, 타입 에러 없음

- [ ] **Step 3: 개발 서버 실행 후 브라우저 확인**

```bash
# 터미널 1
cd backend && uv run fastapi dev

# 터미널 2
cd frontend && pnpm dev
```

브라우저에서 `http://localhost:5173` 접속 후 확인 사항:
- `/feedback` — 오류 제보 목록에 문서 제목 표시, "수정안 생성됨" 배지, "승인 관리로 이동" 버튼
- `/approvals` — 탭 2개 표시, 오류 제보 탭에서 카드 검토 버튼 클릭 시 변경 사유(실제 reasoning), 신뢰도(실제 %), diff 뷰 표시
- 편집 후 승인 클릭 시 텍스트에어리어에 제안 내용이 미리 채워지는지 확인

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "chore: 최종 검증 완료"
```
