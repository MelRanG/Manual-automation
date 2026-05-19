# Approvals 필터/페이지네이션 + Feedback 이동 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approvals 페이지에 상태 필터(전체/처리중/완료) + 페이지네이션을 추가하고, Feedback 페이지의 이동 아이콘이 수정안 상태에 따라 올바른 필터로 이동하도록 개선한다.

**Architecture:** 백엔드 `GET /api/approvals`에 `skip`/`limit` 파라미터와 `processing`/`completed` 상태 그룹을 추가하고 응답을 `{ items, total }` 형태로 래핑한다. `GET /api/feedback` 응답에 `proposed_change_status` 필드를 추가한다. 프론트엔드는 URL 쿼리 파라미터(`?status=processing|completed`)로 초기 필터를 설정한다.

**Tech Stack:** FastAPI, SQLAlchemy async, Pydantic v2, React 18, TypeScript, Tailwind CSS v4, react-router-dom

---

## 파일 구조

| 파일 | 변경 |
|------|------|
| `backend/app/schemas/approval.py` | `ApprovalListResponse` 스키마 추가 |
| `backend/app/services/approval_service.py` | `list_pending_approvals`에 skip/limit/상태그룹 지원 |
| `backend/app/routers/approvals.py` | `GET /approvals` 파라미터 및 응답 타입 변경 |
| `backend/app/schemas/feedback.py` | `FeedbackReportResponse`에 `proposed_change_status` 추가 |
| `backend/app/services/feedback_service.py` | `list_feedback`에서 `ProposedDocumentChange` 조인 |
| `backend/tests/test_approvals.py` | 새 파라미터/응답 형식 테스트 추가 |
| `backend/tests/test_feedback.py` | `proposed_change_status` 필드 테스트 추가 |
| `frontend/src/lib/api.ts` | 타입 및 `listApprovals` 시그니처 업데이트 |
| `frontend/src/pages/Approvals.tsx` | 상태 필터 pill + 페이지네이션 UI |
| `frontend/src/pages/Feedback.tsx` | 이동 아이콘 동작 변경 |

---

### Task 1: 백엔드 — Approvals 페이지네이션 + 상태 그룹 필터

**Files:**
- Modify: `backend/app/schemas/approval.py`
- Modify: `backend/app/services/approval_service.py`
- Modify: `backend/app/routers/approvals.py`
- Test: `backend/tests/test_approvals.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_approvals.py` 파일 끝에 다음 테스트를 추가한다:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_list_approvals_pagination(client: AsyncClient, test_user: dict):
    # 응답이 { items, total } 형태인지 확인
    resp = await client.get("/api/approvals?status=all&skip=0&limit=5")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert isinstance(data["items"], list)
    assert isinstance(data["total"], int)
    assert len(data["items"]) <= 5


@pytest.mark.asyncio(loop_scope="session")
async def test_list_approvals_status_processing(client: AsyncClient, test_user: dict):
    # processing = pending + needs_review
    resp = await client.get("/api/approvals?status=processing")
    assert resp.status_code == 200
    data = resp.json()
    for item in data["items"]:
        assert item["status"] in ("pending", "needs_review")


@pytest.mark.asyncio(loop_scope="session")
async def test_list_approvals_status_completed(client: AsyncClient, test_user: dict):
    # completed = approved + rejected
    # 먼저 승인된 항목이 있어야 함: 기존 test_full_approval_workflow가 approved 항목을 만듦
    resp = await client.get("/api/approvals?status=completed")
    assert resp.status_code == 200
    data = resp.json()
    for item in data["items"]:
        assert item["status"] in ("approved", "rejected")
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && uv run pytest tests/test_approvals.py::test_list_approvals_pagination tests/test_approvals.py::test_list_approvals_status_processing tests/test_approvals.py::test_list_approvals_status_completed -v
```

Expected: FAIL (응답이 list 형태라 `"items"` 키 없음)

- [ ] **Step 3: `backend/app/schemas/approval.py`에 `ApprovalListResponse` 추가**

파일 끝에 추가:

```python
class ApprovalListResponse(BaseModel):
    items: list[ApprovalRequestResponse]
    total: int
```

- [ ] **Step 4: `backend/app/services/approval_service.py`의 `list_pending_approvals` 교체**

기존 함수를 아래로 교체:

```python
async def list_pending_approvals(
    db: AsyncSession, status: str = "pending", skip: int = 0, limit: int = 20
) -> tuple[list[ApprovalRequest], int]:
    from sqlalchemy import func

    status_map = {
        "processing": ["pending", "needs_review"],
        "completed": ["approved", "rejected"],
        "all": None,
        "pending": ["pending"],
        "needs_review": ["pending", "needs_review"],
    }
    statuses = status_map.get(status, ["pending"])

    base = select(ApprovalRequest)
    if statuses is not None:
        base = base.where(ApprovalRequest.status.in_(statuses))

    count_stmt = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        base
        .options(selectinload(ApprovalRequest.proposed_change))
        .order_by(ApprovalRequest.created_at.asc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all()), total
```

- [ ] **Step 5: `backend/app/routers/approvals.py`의 `list_pending_approvals` 엔드포인트 수정**

import에 `ApprovalListResponse` 추가 및 엔드포인트 수정:

```python
from app.schemas.approval import ApprovalAction, ApprovalRequestResponse, ApprovalListResponse
```

```python
@router.get("", response_model=ApprovalListResponse)
async def list_pending_approvals(
    status: str = "pending",
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    items, total = await approval_service.list_pending_approvals(db, status=status, skip=skip, limit=limit)
    return ApprovalListResponse(items=items, total=total)
```

- [ ] **Step 6: 기존 테스트가 응답 형식 변경에 맞는지 확인 후 수정**

`test_approvals.py`에서 `list_resp.json()`을 리스트로 쓰는 기존 테스트들을 찾아 `.json()["items"]`로 수정:

`test_full_approval_workflow` 내:
```python
list_resp = await client.get("/api/approvals")
assert list_resp.status_code == 200
assert any(a["id"] == approval_id for a in list_resp.json()["items"])
```

`test_list_approvals_includes_proposed_change` 내:
```python
list_resp = await client.get("/api/approvals")
assert list_resp.status_code == 200
approvals = list_resp.json()["items"]
assert len(approvals) > 0
target = next((a for a in approvals if a["proposed_change_id"] == proposal_id), None)
assert target is not None
```

`test_playwright_manual_approval_flow` 내:
```python
list_resp = await client.get("/api/approvals")
approvals = list_resp.json()["items"]
playwright_approval = next(
    (a for a in approvals
     if a["proposed_change"] and a["proposed_change"]["source_type"] == "playwright"),
    None
)
```

- [ ] **Step 7: 모든 approval 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_approvals.py -v
```

Expected: 모두 PASS

- [ ] **Step 8: 커밋**

```bash
git add backend/app/schemas/approval.py backend/app/services/approval_service.py backend/app/routers/approvals.py backend/tests/test_approvals.py
git commit -m "feat: Approvals API — 페이지네이션 + processing/completed 상태 그룹 지원"
```

---

### Task 2: 백엔드 — FeedbackReport에 proposed_change_status 추가

**Files:**
- Modify: `backend/app/schemas/feedback.py`
- Modify: `backend/app/services/feedback_service.py`
- Test: `backend/tests/test_feedback.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_feedback.py` 파일 끝에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_list_has_proposed_change_status(client: AsyncClient, test_user: dict):
    # 문서 생성 후 피드백 제출 (수정안 자동 생성됨)
    doc_resp = await client.post("/api/documents", json={
        "title": "Status Field Test Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Some content."})
    doc_id = doc_resp.json()["id"]

    await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "This needs fixing",
    })

    list_resp = await client.get("/api/feedback")
    assert list_resp.status_code == 200
    items = list_resp.json()
    # proposed_change_status 필드가 있어야 함
    assert all("proposed_change_status" in item for item in items)

    # 방금 만든 항목은 proposed_change_status가 "pending"이어야 함
    target = next((i for i in items if i["document_id"] == doc_id), None)
    assert target is not None
    assert target["proposed_change_status"] == "pending"


@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_without_document_has_null_proposed_change_status(client: AsyncClient, test_user: dict):
    await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "feedback_text": "No document attached",
    })

    list_resp = await client.get("/api/feedback")
    items = list_resp.json()
    no_doc = next((i for i in items if i["document_id"] is None), None)
    assert no_doc is not None
    assert no_doc["proposed_change_status"] is None
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py::test_feedback_list_has_proposed_change_status tests/test_feedback.py::test_feedback_without_document_has_null_proposed_change_status -v
```

Expected: FAIL (`proposed_change_status` 키 없음)

- [ ] **Step 3: `backend/app/schemas/feedback.py`의 `FeedbackReportResponse`에 필드 추가**

```python
class FeedbackReportResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    document_id: uuid.UUID | None
    chunk_id: uuid.UUID | None
    chat_message_id: uuid.UUID | None
    feedback_text: str
    status: str
    document_title: str | None = None
    proposed_change_status: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: `backend/app/services/feedback_service.py`의 `list_feedback` 수정**

`ProposedDocumentChange`를 조인해서 status를 가져온다. 기존 `list_feedback` 함수를 아래로 교체:

```python
async def list_feedback(
    db: AsyncSession, document_id: uuid.UUID | None = None
) -> list["FeedbackReportResponse"]:
    from app.schemas.feedback import FeedbackReportResponse

    stmt = select(FeedbackReport).order_by(FeedbackReport.created_at.desc())
    if document_id:
        stmt = stmt.where(FeedbackReport.document_id == document_id)
    result = await db.execute(stmt)
    reports = list(result.scalars().all())

    doc_ids = {r.document_id for r in reports if r.document_id}
    title_map: dict = {}
    if doc_ids:
        doc_result = await db.execute(
            select(Document.id, Document.title).where(Document.id.in_(doc_ids))
        )
        title_map = {row.id: row.title for row in doc_result}

    report_ids = [r.id for r in reports]
    change_map: dict = {}
    if report_ids:
        change_result = await db.execute(
            select(
                ProposedDocumentChange.feedback_report_id,
                ProposedDocumentChange.status,
            ).where(ProposedDocumentChange.feedback_report_id.in_(report_ids))
        )
        change_map = {row.feedback_report_id: row.status for row in change_result}

    return [
        FeedbackReportResponse.model_validate(r, from_attributes=True).model_copy(
            update={
                "document_title": title_map.get(r.document_id),
                "proposed_change_status": change_map.get(r.id),
            }
        )
        for r in reports
    ]
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py -v
```

Expected: 모두 PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/app/schemas/feedback.py backend/app/services/feedback_service.py backend/tests/test_feedback.py
git commit -m "feat: FeedbackReport 응답에 proposed_change_status 필드 추가"
```

---

### Task 3: 프론트엔드 — api.ts 타입 및 listApprovals 업데이트

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: `FeedbackReport` 인터페이스에 `proposed_change_status` 추가**

`frontend/src/lib/api.ts`의 `FeedbackReport` 인터페이스(현재 167번 줄):

```ts
export interface FeedbackReport { id: string; user_id: string; document_id: string | null; feedback_text: string; status: string; document_title: string | null; proposed_change_status: string | null; created_at: string }
```

- [ ] **Step 2: `ApprovalListResponse` 인터페이스 추가**

`ApprovalRequest` 인터페이스 바로 아래에 추가:

```ts
export interface ApprovalListResponse { items: ApprovalRequest[]; total: number }
```

- [ ] **Step 3: `listApprovals` 시그니처 변경**

기존:
```ts
listApprovals: (status = "pending") => request<ApprovalRequest[]>(`/approvals?status=${status}`),
```

변경 후:
```ts
listApprovals: (params: { status?: string; skip?: number; limit?: number } = {}) => {
  const { status = "pending", skip = 0, limit = 20 } = params
  return request<ApprovalListResponse>(`/approvals?status=${status}&skip=${skip}&limit=${limit}`)
},
```

- [ ] **Step 4: 타입 체크 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음 (Approvals.tsx가 아직 구형 시그니처를 쓰므로 타입 에러 발생 가능 — Task 4에서 수정)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: api.ts — ApprovalListResponse 타입 추가, listApprovals 시그니처 업데이트"
```

---

### Task 4: 프론트엔드 — Approvals.tsx 상태 필터 + 페이지네이션

**Files:**
- Modify: `frontend/src/pages/Approvals.tsx`

- [ ] **Step 1: import 추가 및 상태 변수 추가**

파일 상단 import를 다음으로 교체:

```tsx
import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { api, type ApprovalRequest } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"
```

`Approvals` 컴포넌트 상단 state 부분을 다음으로 교체:

```tsx
export function Approvals() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>("feedback")
  const [statusFilter, setStatusFilter] = useState<"all" | "processing" | "completed">(() => {
    const s = searchParams.get("status")
    if (s === "processing" || s === "completed") return s
    return "all"
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewMode, setReviewMode] = useState<ReviewMode>(null)
  const [comment, setComment] = useState("")
  const [editedContent, setEditedContent] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const reviewerId = user?.id ?? "00000000-0000-0000-0000-000000000001"

  const { data: result, refetch } = useApi(
    () => api.listApprovals({ status: statusFilter, skip: (page - 1) * pageSize, limit: pageSize }),
    [statusFilter, page, pageSize]
  )

  const approvals = result?.items ?? []
  const total = result?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)
```

- [ ] **Step 2: 소스 탭 필터링 및 상태 필터 카운트 계산 수정**

기존 `feedbackApprovals`/`playwrightApprovals` 계산 및 `currentList` 유지:

```tsx
  const feedbackApprovals = approvals.filter(a => a.proposed_change?.source_type === "feedback")
  const playwrightApprovals = approvals.filter(a => a.proposed_change?.source_type === "playwright")
  const currentList = tab === "feedback" ? feedbackApprovals : playwrightApprovals
```

- [ ] **Step 3: 탭 변경/필터 변경 시 page 리셋 핸들러 추가**

기존 `openReview`, `closeReview` 함수 위에 추가:

```tsx
  const handleTabChange = (t: Tab) => { setTab(t); setPage(1); closeReview() }
  const handleFilterChange = (f: "all" | "processing" | "completed") => { setStatusFilter(f); setPage(1) }
```

기존 탭 버튼의 `onClick={() => { setTab("feedback"); closeReview() }}`를 `onClick={() => handleTabChange("feedback")}`로, playwright 탭도 동일하게 변경.

- [ ] **Step 4: 소스 탭 아래에 상태 필터 pill 바 추가**

탭 `</div>` 바로 아래, `{currentList.length === 0 ?` 바로 위에 삽입:

```tsx
      {/* 상태 필터 */}
      <div className="flex items-center gap-2 py-2">
        {(["all", "processing", "completed"] as const).map((f) => {
          const labels = { all: "전체", processing: "처리 중", completed: "완료" }
          const isActive = statusFilter === f
          return (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? "bg-[#00288e] text-white"
                  : "bg-white border border-[#c4c5d5] text-[#444653] hover:border-[#00288e]"
              }`}
            >
              {labels[f]}
              {isActive && total > 0 && (
                <span className="ml-1.5 opacity-80">{total}</span>
              )}
            </button>
          )
        })}
        <span className="ml-auto text-xs text-[#757684]">총 {total}건</span>
      </div>
```

- [ ] **Step 5: 목록 하단에 페이지네이션 추가**

`currentList.length === 0` 분기의 `else` 블록 (`<div className="space-y-4">...</div>`) 안, 카드 목록 `</div>` 바로 아래에 추가:

```tsx
          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#757684]">페이지당</span>
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
                  className="text-xs border border-[#c4c5d5] rounded px-2 py-1 outline-none focus:border-[#00288e]"
                >
                  {[10, 20, 50].map(n => <option key={n} value={n}>{n}개</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2 py-1 text-xs border border-[#c4c5d5] rounded disabled:opacity-40 hover:border-[#00288e] transition-colors"
                >
                  ‹
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                  .reduce<(number | "...")[]>((acc, n, i, arr) => {
                    if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push("...")
                    acc.push(n)
                    return acc
                  }, [])
                  .map((n, i) =>
                    n === "..." ? (
                      <span key={`ellipsis-${i}`} className="px-1 text-xs text-[#9a9bad]">…</span>
                    ) : (
                      <button
                        key={n}
                        onClick={() => setPage(n as number)}
                        className={`w-7 h-7 text-xs rounded transition-colors ${
                          page === n
                            ? "bg-[#00288e] text-white border border-[#00288e]"
                            : "border border-[#c4c5d5] text-[#444653] hover:border-[#00288e]"
                        }`}
                      >
                        {n}
                      </button>
                    )
                  )
                }
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2 py-1 text-xs border border-[#c4c5d5] rounded disabled:opacity-40 hover:border-[#00288e] transition-colors"
                >
                  ›
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 6: 빈 상태 메시지를 필터별로 다르게 표시**

```tsx
      {currentList.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">task_alt</span>
          <h3 className="mt-4 text-lg font-semibold text-[#191c1e]">
            {statusFilter === "completed" ? "완료된 항목이 없습니다" : "모든 승인이 처리되었습니다"}
          </h3>
          <p className="mt-2 text-sm text-[#757684]">
            {statusFilter === "completed"
              ? "아직 승인 또는 반려된 항목이 없습니다"
              : "현재 대기 중인 승인 요청이 없습니다"}
          </p>
        </div>
```

- [ ] **Step 7: 타입 체크 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/pages/Approvals.tsx
git commit -m "feat: Approvals — 상태 필터 pill + 페이지네이션 추가"
```

---

### Task 5: 프론트엔드 — Feedback.tsx 이동 아이콘 동작 변경

**Files:**
- Modify: `frontend/src/pages/Feedback.tsx`

- [ ] **Step 1: 이동 아이콘 navigate 호출 수정**

`Feedback.tsx`의 이동 아이콘 버튼 (현재 `navigate("/approvals")` 두 곳):

**1) 목록 테이블 내 이동 아이콘 (줄 ~237):**

기존:
```tsx
{fb.status === "processed" && (
  <button
    onClick={() => navigate("/approvals")}
    className="p-1 text-[#00288e] hover:bg-[#dde1ff] transition-colors rounded"
    title="수정안 보기"
  >
    <span className="material-symbols-outlined text-sm">open_in_new</span>
  </button>
)}
```

변경 후:
```tsx
{fb.status === "processed" && (
  <button
    onClick={() => {
      const dest = (fb.proposed_change_status === "approved" || fb.proposed_change_status === "rejected")
        ? "/approvals?status=completed"
        : "/approvals?status=processing"
      navigate(dest)
    }}
    className="p-1 text-[#00288e] hover:bg-[#dde1ff] transition-colors rounded"
    title="수정안 보기"
  >
    <span className="material-symbols-outlined text-sm">open_in_new</span>
  </button>
)}
```

**2) 수정안 생성 배너 내 이동 버튼 (줄 ~187):**

기존:
```tsx
onClick={() => navigate("/approvals")}
```

변경 후:
```tsx
onClick={() => navigate("/approvals?status=processing")}
```

(방금 생성된 수정안이므로 항상 processing 상태)

- [ ] **Step 2: 타입 체크 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/pages/Feedback.tsx
git commit -m "feat: Feedback — 이동 아이콘이 수정안 상태에 따라 올바른 필터로 이동"
```
