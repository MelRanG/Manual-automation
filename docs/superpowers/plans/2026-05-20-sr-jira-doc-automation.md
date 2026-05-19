# SR → Jira → 문서 자동화 플로우 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 챗봇 SR 생성 플로우 완성(정보 충족 시만 SR 생성), Jira 완료 시 앱 내 승인 큐를 통한 문서 작성 여부 판단, 승인 후 문서 자동 등록 및 사용자 매뉴얼 선택 생성.

**Architecture:** change_request 모드 프롬프트를 개선해 LLM이 정보 충족 여부를 판단하도록 변경. Jira 완료 웹훅 수신 시 `process_completed_sr()` 직접 호출 대신 `ApprovalRequest`(type=doc_review)를 생성해 승인 큐에 올림. 승인 큐에서 사람이 거부/문서승인/매뉴얼포함승인 중 선택하면 그에 맞는 후속 플로우(change impact → 문서 등록, 또는 + Playwright 트리거)가 실행됨.

**Tech Stack:** Python FastAPI, SQLAlchemy (async), Alembic, React + TypeScript, pnpm, Docker Compose

---

## 파일 구조

| 파일 | 변경 유형 | 역할 |
|------|-----------|------|
| `backend/app/services/chat_service.py` | Modify | change_request 프롬프트 개선 — 정보 충족 판단 로직 |
| `backend/app/models/feedback.py` | Modify | `ApprovalRequest`에 `approval_type`, `sr_draft_id` 필드 추가 |
| `backend/app/schemas/approval.py` | Modify | `ApprovalRequestResponse`에 `approval_type`, `sr_draft_id` 노출 |
| `backend/alembic/versions/<hash>_add_doc_review_fields.py` | Create | 마이그레이션 — approval_requests 테이블 컬럼 추가 |
| `backend/app/routers/jira.py` | Modify | 웹훅 처리: `process_completed_sr()` 제거 → ApprovalRequest 생성 |
| `backend/app/services/approval_service.py` | Modify | `review_doc_review_approval()` 함수 추가 |
| `backend/app/routers/approvals.py` | Modify | doc_review 승인 전용 엔드포인트 추가 |
| `frontend/src/lib/api.ts` | Modify | `ApprovalRequest` 타입에 `approval_type`, `sr_draft_id` 추가 + `reviewDocApproval()` 메서드 추가 |
| `frontend/src/pages/Approvals.tsx` | Modify | `doc_review` 탭 추가, 3-버튼 승인 UI |

---

## Task 1: chat_service.py — change_request 프롬프트 개선

**Files:**
- Modify: `backend/app/services/chat_service.py:17-32`

- [ ] **Step 1: RAG_SYSTEM_PROMPT의 change_request 지시 교체**

`backend/app/services/chat_service.py`에서 `RAG_SYSTEM_PROMPT` 상수를 다음으로 교체:

```python
RAG_SYSTEM_PROMPT = """당신은 Manual Automation 문서 관리 시스템의 AI 어시스턴트입니다.
문서 컨텍스트를 기반으로 질문에 답변합니다.

사용자 메시지가 "[변경 요청]"으로 시작하면, 이것은 SR(서비스 요청) 등록 대화입니다.
이 경우 다음 필수 정보가 모두 충족됐는지 판단하세요:
  1. 제목 — 무엇을 변경해야 하는지 명확히 알 수 있는 한 줄 제목
  2. 내용 — 변경 이유, 현재 문제, 원하는 결과 등 구체적인 설명
  3. 우선순위 — high / medium / low 중 하나

[필수 정보가 부족한 경우]
부족한 항목이 무엇인지 친절하게 안내하고, 추가 질문으로만 응답하세요.
절대 sr_proposal 블록을 포함하지 마세요.

[필수 정보가 모두 충족된 경우]
답변 맨 끝에 반드시 아래 SR 제안 블록을 포함하세요:

```sr_proposal
{"is_change_request": true, "title": "간결한 SR 제목", "description": "구체적인 변경 내용 설명", "priority": "medium", "target_document": "관련 문서 제목"}
```

priority: high(긴급)/medium(보통)/low(낮음)

"[변경 요청]"으로 시작하지 않는 일반 질문에는 SR 블록 없이 답변만 하세요.
답변은 반드시 한국어로 작성합니다."""
```

- [ ] **Step 2: Docker로 백엔드 재시작 후 동작 확인**

```bash
docker compose up --build -d backend
```

챗봇에서 change_request 모드로 "버튼 색이 잘못됐어요" 만 입력 → 추가 질문 응답이 오는지 확인.  
"제목: 버튼 색상 오류 수정, 내용: 메인 페이지 저장 버튼이 회색으로 표시되어 클릭 유도가 안 됩니다, 우선순위: medium" 입력 → sr_proposal 블록 생성 및 SR 생성 확인.

- [ ] **Step 3: 커밋**

```bash
git add backend/app/services/chat_service.py
git commit -m "feat: change_request 모드 — 정보 충족 시에만 SR 생성하도록 프롬프트 개선"
```

---

## Task 2: DB 모델 — ApprovalRequest에 doc_review 필드 추가

**Files:**
- Modify: `backend/app/models/feedback.py:65-80`
- Create: `backend/alembic/versions/<hash>_add_doc_review_fields_to_approval_requests.py`

현재 `ApprovalRequest`는 항상 `proposed_change_id`(FK)를 통해 `ProposedDocumentChange`에 연결됨. doc_review 타입은 ProposedDocumentChange 없이 SR에 직접 연결되므로 필드를 추가해야 함.

- [ ] **Step 1: feedback.py 모델 수정**

`backend/app/models/feedback.py`의 `ApprovalRequest` 클래스를 다음으로 수정:

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

    proposed_change: Mapped["ProposedDocumentChange | None"] = relationship(
        back_populates="approval_request"
    )
```

- [ ] **Step 2: Alembic 마이그레이션 생성**

```bash
docker compose exec backend uv run alembic revision --autogenerate -m "add_doc_review_fields_to_approval_requests"
```

생성된 파일(`backend/alembic/versions/<hash>_add_doc_review_fields_to_approval_requests.py`)을 열어 `upgrade()` 함수에 다음이 포함되어 있는지 확인:
- `approval_type` VARCHAR(50) DEFAULT 'document_change' 컬럼 추가
- `sr_draft_id` UUID nullable 컬럼 추가
- `proposed_change_id` NOT NULL → nullable 변경

autogenerate가 nullable 변경을 감지 못할 경우 수동으로 추가:
```python
op.alter_column('approval_requests', 'proposed_change_id', nullable=True)
```

- [ ] **Step 3: 마이그레이션 적용**

```bash
docker compose exec backend uv run alembic upgrade head
```

Expected: 오류 없이 완료.

- [ ] **Step 4: 커밋**

```bash
git add backend/app/models/feedback.py backend/alembic/versions/
git commit -m "feat: ApprovalRequest에 approval_type, sr_draft_id 필드 추가"
```

---

## Task 3: 스키마 — ApprovalRequestResponse에 신규 필드 노출

**Files:**
- Modify: `backend/app/schemas/approval.py`

- [ ] **Step 1: approval.py 스키마 확인 및 수정**

`backend/app/schemas/approval.py`를 열어 `ApprovalRequestResponse` 클래스에 `approval_type`과 `sr_draft_id`를 추가:

```python
class ApprovalRequestResponse(BaseModel):
    id: uuid.UUID
    proposed_change_id: uuid.UUID | None
    approval_type: str
    sr_draft_id: uuid.UUID | None
    proposed_change: ProposedChangeResponse | None
    reviewer_id: uuid.UUID | None
    status: str
    comment: str | None
    reviewed_at: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: api.ts 프론트엔드 타입 업데이트**

`frontend/src/lib/api.ts`의 `ApprovalRequest` 인터페이스 수정:

```typescript
export interface ApprovalRequest {
  id: string;
  proposed_change_id: string | null;
  approval_type: string;
  sr_draft_id: string | null;
  proposed_change: ProposedChange | null;
  reviewer_id: string | null;
  status: string;
  comment: string | null;
  reviewed_at: string | null;
  created_at: string;
}
```

- [ ] **Step 3: 커밋**

```bash
git add backend/app/schemas/approval.py frontend/src/lib/api.ts
git commit -m "feat: ApprovalRequestResponse에 approval_type, sr_draft_id 노출"
```

---

## Task 4: jira.py — 웹훅 처리 변경 (doc_review ApprovalRequest 생성)

**Files:**
- Modify: `backend/app/routers/jira.py:88-113`
- Modify: `backend/app/services/sr_service.py:200-210` (STATUS_MAP 업데이트)

- [ ] **Step 1: STATUS_MAP에 pending_doc_review 추가**

`backend/app/services/sr_service.py`에서 `STATUS_MAP` 수정:

```python
STATUS_MAP = {
    "draft": ["draft"],
    "active": ["submitted", "jira_created", "pending_document_selection", "pending_doc_review"],
    "done": ["done_synced", "done_no_proposal"],
}
```

- [ ] **Step 2: receive_jira_webhook 수정**

`backend/app/routers/jira.py`에서 background_tasks 블록을 ApprovalRequest 생성으로 교체:

```python
# 기존 코드 (제거):
# async def _bg_task(evt: CompletedSREvent):
#     from app.db import SessionLocal
#     async with SessionLocal() as session:
#         await sr_service.process_completed_sr(session, evt)
# background_tasks.add_task(_bg_task, event)
# return {"status": "processing", "sr_id": str(draft.id)}

# 교체할 코드:
from app.models.feedback import ApprovalRequest as ApprovalRequestModel

approval = ApprovalRequestModel(
    id=uuid.uuid4(),
    approval_type="doc_review",
    sr_draft_id=draft.id,
    status="pending",
)
db.add(approval)
draft.status = "pending_doc_review"
await db.commit()
return {"status": "pending_doc_review", "sr_id": str(draft.id), "approval_id": str(approval.id)}
```

전체 함수에서 `BackgroundTasks` import와 파라미터도 제거:

```python
@router.post("/webhook")
async def receive_jira_webhook(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
```

- [ ] **Step 3: Docker 재시작 후 시뮬레이터로 테스트**

```bash
docker compose up --build -d backend
```

ServiceRequests 페이지에서 "완료 처리 (시뮬레이터)" 버튼 클릭 후:
- SR status가 `pending_doc_review`로 변경됐는지 확인
- Approvals 페이지에 `doc_review` 타입 항목이 DB에 생성됐는지 확인 (아직 UI는 없음)

```bash
docker compose exec db psql -U docops -d docops_dev -c "SELECT id, approval_type, sr_draft_id, status FROM approval_requests ORDER BY created_at DESC LIMIT 3;"
```

- [ ] **Step 4: 커밋**

```bash
git add backend/app/routers/jira.py backend/app/services/sr_service.py
git commit -m "feat: Jira 완료 웹훅 수신 시 process_completed_sr 대신 doc_review ApprovalRequest 생성"
```

---

## Task 5: approval_service.py — doc_review 승인 처리 함수 추가

**Files:**
- Modify: `backend/app/services/approval_service.py`
- Modify: `backend/app/routers/approvals.py`

- [ ] **Step 1: review_doc_review_approval 함수 추가**

`backend/app/services/approval_service.py` 맨 아래에 추가:

```python
async def review_doc_review_approval(
    db: AsyncSession,
    approval_id: uuid.UUID,
    reviewer_id: uuid.UUID,
    action: str,
    target_url: str | None = None,
) -> "ApprovalRequest":
    """doc_review 타입 승인 처리.
    action: "reject" | "approve_doc" | "approve_manual"
    """
    from sqlalchemy import select
    from app.models.feedback import ApprovalRequest
    from app.models.sr import SRDraft
    from datetime import datetime, timezone

    valid_actions = ("reject", "approve_doc", "approve_manual")
    if action not in valid_actions:
        raise ValueError(f"action must be one of {valid_actions}")

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

    if action == "reject":
        approval.status = "rejected"
        if draft:
            draft.status = "done_no_proposal"

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

            # 별도 세션에서 비동기 처리
            import asyncio

            async def _run():
                async with SessionLocal() as session:
                    await process_completed_sr(session, event)

            asyncio.create_task(_run())

        if action == "approve_manual" and draft:
            from app.services import manual_service
            from app.db import SessionLocal
            import asyncio

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
        select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
    )
    return refreshed.scalar_one()
```

- [ ] **Step 2: approvals.py 라우터에 엔드포인트 추가**

`backend/app/routers/approvals.py`에 추가:

```python
from app.schemas.approval import DocReviewAction

@router.post("/{approval_id}/doc-review", response_model=ApprovalRequestResponse)
async def review_doc_approval(
    approval_id: uuid.UUID,
    data: DocReviewAction,
    db: AsyncSession = Depends(get_db),
):
    valid_actions = ("reject", "approve_doc", "approve_manual")
    if data.action not in valid_actions:
        raise HTTPException(status_code=400, detail=f"Action must be one of: {valid_actions}")
    try:
        result = await approval_service.review_doc_review_approval(
            db, approval_id, data.reviewer_id, data.action, data.target_url
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result
```

- [ ] **Step 3: DocReviewAction 스키마 추가**

`backend/app/schemas/approval.py`에 추가:

```python
class DocReviewAction(BaseModel):
    reviewer_id: uuid.UUID
    action: str  # "reject" | "approve_doc" | "approve_manual"
    target_url: str | None = None
```

- [ ] **Step 4: api.ts에 reviewDocApproval 메서드 추가**

`frontend/src/lib/api.ts`의 `api` 객체에 추가:

```typescript
reviewDocApproval: (id: string, data: { reviewer_id: string; action: string; target_url?: string }) =>
  request<ApprovalRequest>(`/approvals/${id}/doc-review`, { method: 'POST', body: JSON.stringify(data) }),
```

- [ ] **Step 5: Docker 재시작 후 API 확인**

```bash
docker compose up --build -d backend
```

```bash
# approval_id는 Task 4에서 생성된 것 사용
curl -s -X POST http://localhost:8000/api/approvals/<approval_id>/doc-review \
  -H "Content-Type: application/json" \
  -d '{"reviewer_id": "00000000-0000-0000-0000-000000000001", "action": "reject"}'
```

Expected: `{"status": "rejected", "approval_type": "doc_review", ...}`

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/approval_service.py backend/app/routers/approvals.py backend/app/schemas/approval.py frontend/src/lib/api.ts
git commit -m "feat: doc_review 승인 처리 — 거부/문서승인/매뉴얼포함승인 엔드포인트 추가"
```

---

## Task 6: Approvals.tsx — doc_review 탭 및 승인 UI 추가

**Files:**
- Modify: `frontend/src/pages/Approvals.tsx`

- [ ] **Step 1: Tab 타입에 doc_review 추가**

`Approvals.tsx` 상단 타입 수정:

```typescript
type Tab = "feedback" | "playwright" | "jira_sr" | "doc_review"
```

- [ ] **Step 2: doc_review 건수 카운트 추가**

기존 카운트 변수들 아래에 추가:

```typescript
const docReviewProcessingCount = processingItems.filter(a => a.approval_type === "doc_review").length
```

필터 로직 추가:

```typescript
const docReviewApprovals = approvals.filter(a => a.approval_type === "doc_review")
```

`currentList` 조건 수정:

```typescript
const currentList = tab === "feedback" ? feedbackApprovals
  : tab === "playwright" ? playwrightApprovals
  : tab === "jira_sr" ? jiraSrApprovals
  : docReviewApprovals
```

- [ ] **Step 3: doc_review 탭 버튼 추가**

기존 탭 버튼들(`jira_sr` 탭 버튼) 뒤에 추가:

```tsx
<button
  onClick={() => handleTabChange("doc_review")}
  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
    tab === "doc_review"
      ? "border-[#00288e] text-[#00288e]"
      : "border-transparent text-[#757684] hover:text-[#191c1e]"
  }`}
>
  <span className="material-symbols-outlined text-base">fact_check</span>
  문서 작성 검토
  {docReviewProcessingCount > 0 && (
    <span className="ml-1 px-1.5 py-0.5 bg-[#e8f0fe] text-[#00288e] text-[10px] font-bold rounded-full">
      {docReviewProcessingCount}
    </span>
  )}
</button>
```

- [ ] **Step 4: doc_review 항목 렌더링 컴포넌트 추가**

`Approvals.tsx`에서 현재 탭별 렌더링 로직 직전에 doc_review 전용 상태 추가:

```typescript
const [docReviewTargetUrl, setDocReviewTargetUrl] = useState<Record<string, string>>({})
```

탭이 `doc_review`일 때 목록 렌더링 부분에 다음 카드 UI를 사용:

```tsx
{tab === "doc_review" && (
  <div className="space-y-3">
    {currentList.length === 0 && (
      <div className="text-center py-12 text-[#757684]">검토할 항목이 없습니다.</div>
    )}
    {currentList.map(approval => {
      const isReviewing = reviewingId === approval.id
      return (
        <div key={approval.id} className="bg-white rounded-xl border border-[#e0e3e5] p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-medium text-[#00288e] bg-[#e8f0fe] px-2 py-0.5 rounded">문서 작성 검토</span>
              <p className="mt-1 font-medium text-[#191c1e]">SR: {approval.sr_draft_id ?? "-"}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
              approval.status === "pending" ? "bg-[#fff3e0] text-[#e65100]"
              : approval.status === "approved" ? "bg-[#e8f5e9] text-[#2e7d32]"
              : "bg-[#fce4ec] text-[#c62828]"
            }`}>{approval.status}</span>
          </div>

          {approval.status === "pending" && (
            <>
              {!isReviewing ? (
                <button
                  onClick={() => { setReviewingId(approval.id); setReviewMode(null) }}
                  className="text-sm text-[#00288e] hover:underline"
                >
                  검토하기
                </button>
              ) : (
                <div className="space-y-3 border-t border-[#e0e3e5] pt-3">
                  <p className="text-sm text-[#444653]">이 SR 완료 건에 대해 문서 작성이 필요한가요?</p>
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      placeholder="사용자 매뉴얼 캡처 URL (매뉴얼 포함 승인 시 필요)"
                      value={docReviewTargetUrl[approval.id] ?? ""}
                      onChange={e => setDocReviewTargetUrl(prev => ({ ...prev, [approval.id]: e.target.value }))}
                      className="text-sm border border-[#e0e3e5] rounded px-3 py-1.5 w-full"
                    />
                    <div className="flex gap-2 flex-wrap">
                      <button
                        disabled={submitting}
                        onClick={async () => {
                          setSubmitting(true)
                          try {
                            await api.reviewDocApproval(approval.id, { reviewer_id: reviewerId, action: "reject" })
                            closeReview()
                            refetch()
                          } finally { setSubmitting(false) }
                        }}
                        className="px-3 py-1.5 text-sm rounded border border-[#e0e3e5] text-[#757684] hover:bg-[#f2f4f6]"
                      >
                        거부 (문서 불필요)
                      </button>
                      <button
                        disabled={submitting}
                        onClick={async () => {
                          setSubmitting(true)
                          try {
                            await api.reviewDocApproval(approval.id, { reviewer_id: reviewerId, action: "approve_doc" })
                            closeReview()
                            refetch()
                          } finally { setSubmitting(false) }
                        }}
                        className="px-3 py-1.5 text-sm rounded bg-[#00288e] text-white hover:bg-[#001a6b]"
                      >
                        문서 작성 승인
                      </button>
                      <button
                        disabled={submitting || !docReviewTargetUrl[approval.id]?.trim()}
                        onClick={async () => {
                          setSubmitting(true)
                          try {
                            await api.reviewDocApproval(approval.id, {
                              reviewer_id: reviewerId,
                              action: "approve_manual",
                              target_url: docReviewTargetUrl[approval.id],
                            })
                            closeReview()
                            refetch()
                          } finally { setSubmitting(false) }
                        }}
                        className="px-3 py-1.5 text-sm rounded bg-[#1a6b3c] text-white hover:bg-[#0d4a28] disabled:opacity-40"
                      >
                        사용자 매뉴얼 포함 승인
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )
    })}
  </div>
)}
```

- [ ] **Step 5: Docker로 프론트엔드 빌드 후 브라우저 확인**

```bash
docker compose up --build -d
```

`http://localhost` → 승인 관리 페이지 → "문서 작성 검토" 탭 확인.  
Task 4에서 생성된 doc_review 항목이 목록에 표시되는지 확인.  
"검토하기" 클릭 → 3개 버튼 표시 확인.  
"거부" 클릭 → 항목 status가 rejected로 변경되고 목록에서 사라지는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/pages/Approvals.tsx
git commit -m "feat: 승인 관리에 문서 작성 검토 탭 및 3-버튼 승인 UI 추가"
```

---

## Task 7: 전체 플로우 통합 테스트

- [ ] **Step 1: Docker 전체 실행**

```bash
docker compose up --build -d
```

- [ ] **Step 2: 챗봇 SR 생성 플로우 확인**

1. `http://localhost` → 챗봇 → change_request 모드 선택
2. "버튼이 이상해요" 입력 → 챗봇이 추가 정보 요청하는지 확인
3. 제목/내용/우선순위 모두 입력 → SR 생성 배너 확인
4. ServiceRequests 페이지에서 SR이 생성됐는지 확인

- [ ] **Step 3: Jira 완료 → 승인 큐 플로우 확인**

1. ServiceRequests 페이지 → 생성된 SR → "Jira 등록" 버튼 클릭
2. "완료 처리 (시뮬레이터)" 버튼 클릭
3. 승인 관리 → "문서 작성 검토" 탭에 항목이 생성됐는지 확인

- [ ] **Step 4: 승인 → 문서 등록 플로우 확인**

1. "검토하기" 클릭 → "문서 작성 승인" 클릭
2. ChangeImpact 페이지 또는 Approvals에서 문서 수정안이 생성됐는지 확인
3. 문서가 문서함에 최종 등록됐는지 확인

- [ ] **Step 5: 매뉴얼 포함 승인 플로우 확인**

1. 새 SR로 위 과정 반복
2. 승인 시 URL 입력 후 "사용자 매뉴얼 포함 승인" 클릭
3. ManualGenerator 페이지에서 job이 생성됐는지 확인

- [ ] **Step 6: 최종 커밋**

```bash
git add .
git commit -m "test: SR→Jira→문서 자동화 전체 플로우 통합 확인"
```

---

## 구현 후 제거 예정 항목 (Jira 실제 연동 시)

| 위치 | 내용 |
|------|------|
| `frontend/src/pages/ServiceRequests.tsx` | "완료 처리 (시뮬레이터)" 버튼 |
| `backend/app/routers/sr.py` | `POST /api/sr/drafts/{id}/complete-local` |
| `frontend/src/lib/api.ts` | `completeSRLocal()` |
