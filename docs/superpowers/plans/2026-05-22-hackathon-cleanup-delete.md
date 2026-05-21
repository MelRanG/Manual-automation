# 해커톤 시연 데이터 정리 — 삭제 기능 + Q&A 버그 fix 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시연 직전 누적 데이터 정리를 위해 메뉴얼 요청·SR·위젯 대화 3종에 단건 hard delete UI를 추가하고, 동작하지 않는 Q&A 챗봇 세션 삭제를 수정한다.

**Architecture:** 각 도메인 라우터에 `DELETE` 엔드포인트를 추가하고, 자식 FK 행은 cascade 옵션 신설 대신 라우터에서 명시 삭제한다(마이그레이션 회피). 프론트는 행 hover 시 휴지통 버튼 + `window.confirm` 통일 패턴을 사용한다.

**Tech Stack:** FastAPI(async) + SQLAlchemy 2.0(async), React + Vite (TypeScript), pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-05-22-hackathon-cleanup-delete-design.md`

---

## 파일 구조 / 변경 위치

| 파일 | 작업 |
|------|------|
| `backend/app/routers/chat.py` | `delete_session` 보강 (feedback 선삭제) |
| `backend/app/routers/manual.py` | `DELETE /jobs/{job_id}` 추가 |
| `backend/app/routers/sr.py` | `DELETE /drafts/{sr_id}` 추가 |
| `backend/app/routers/widget.py` | `DELETE /admin/sessions/{session_id}` 추가 |
| `backend/tests/test_chat.py` | feedback 달린 세션 삭제 테스트 |
| `backend/tests/test_manual_jobs_embed.py` (또는 새 파일) | 메뉴얼 삭제 테스트 |
| `backend/tests/test_sr.py` | SR 삭제 테스트 |
| `backend/tests/test_widget.py` | 위젯 세션 삭제 테스트 |
| `frontend/src/lib/api.ts` | `deleteSession` ok 체크 + `deleteManualJob`, `deleteSRDraft`, `deleteWidgetSession` 추가 |
| `frontend/src/pages/ManualGenerator.tsx` | 행 hover 휴지통 |
| `frontend/src/pages/ServiceRequests.tsx` | 행 hover 휴지통 |
| `frontend/src/pages/WidgetConversations.tsx` | 행 hover 휴지통 |

---

## Task 1: Q&A 챗봇 삭제 버그 fix

**Files:**
- Modify: `backend/app/routers/chat.py:90-105`
- Modify: `frontend/src/lib/api.ts:102-103`
- Test: `backend/tests/test_chat.py` (append)

- [ ] **Step 1: Write failing test — feedback 달린 세션 삭제**

`backend/tests/test_chat.py` 끝에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_delete_session_with_feedback(client: AsyncClient, test_user: dict):
    # 문서 → 세션 → 질문(메시지 2건) → 피드백 부착 후 삭제
    doc_resp = await client.post("/api/documents", json={
        "title": "Doc for delete",
        "description": "x",
        "owner_id": test_user["id"],
    }, params={"content": "content for delete"})
    assert doc_resp.status_code == 201

    sess_resp = await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
    })
    session_id = sess_resp.json()["id"]

    ask_resp = await client.post(f"/api/chat/sessions/{session_id}/ask", json={
        "question": "anything?",
    })
    assert ask_resp.status_code == 200
    message_id = ask_resp.json()["message_id"]

    fb_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "chat_message_id": message_id,
        "feedback_text": "wrong answer",
    })
    assert fb_resp.status_code in (200, 201)

    del_resp = await client.delete(f"/api/chat/sessions/{session_id}")
    assert del_resp.status_code == 204

    get_resp = await client.get(f"/api/chat/sessions/{session_id}")
    assert get_resp.status_code == 404
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd backend && uv run pytest tests/test_chat.py::test_delete_session_with_feedback -v`
Expected: FAIL (500 IntegrityError or feedback row가 chat_messages FK 위반)

- [ ] **Step 3: Fix backend — feedback rows 선삭제**

`backend/app/routers/chat.py` 9번 줄(import 영역)에 추가:

```python
from app.models.feedback import FeedbackReport
```

`delete_session` 함수의 메시지 삭제 직전에 feedback 정리 추가. 90-105 라인 전체를 다음으로 교체:

```python
@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select as sa_select
    session = await chat_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    msg_ids_result = await db.execute(sa_select(ChatMessage.id).where(ChatMessage.session_id == session_id))
    msg_ids = msg_ids_result.scalars().all()
    if msg_ids:
        await db.execute(delete(AnswerCitation).where(AnswerCitation.chat_message_id.in_(msg_ids)))
        await db.execute(delete(FeedbackReport).where(FeedbackReport.chat_message_id.in_(msg_ids)))
    await db.execute(delete(ChatMessage).where(ChatMessage.session_id == session_id))
    await db.execute(delete(ChatSession).where(ChatSession.id == session_id))
    await db.commit()
```

- [ ] **Step 4: Run test to confirm pass**

Run: `cd backend && uv run pytest tests/test_chat.py -v`
Expected: 모든 chat 테스트 PASS

- [ ] **Step 5: Fix frontend — api.deleteSession 응답 검증**

`frontend/src/lib/api.ts` 102-103 라인을 다음으로 교체:

```ts
  deleteSession: async (sessionId: string) => {
    const res = await fetch(`${BASE}/chat/sessions/${sessionId}`, { method: 'DELETE', headers: getAuthHeaders() })
    if (!res.ok) throw new Error(`Failed to delete session: ${res.status}`)
    return res
  },
```

- [ ] **Step 6: Typecheck/lint**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/chat.py backend/tests/test_chat.py frontend/src/lib/api.ts
git commit -m "fix(chat): clean feedback rows on session delete + verify response in client"
```

---

## Task 2: 메뉴얼 생성 요청 백엔드 삭제 API

**Files:**
- Modify: `backend/app/routers/manual.py`
- Test: `backend/tests/test_manual_delete.py` (신규)

- [ ] **Step 1: Write failing test — 메뉴얼 job 삭제**

`backend/tests/test_manual_delete.py` 신규 작성:

```python
import uuid
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_manual_job(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/manual/jobs", json={
        "user_id": test_user["id"],
        "target_url": "https://example.com",
    })
    assert create_resp.status_code == 201
    job_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/manual/jobs/{job_id}")
    assert del_resp.status_code == 204

    get_resp = await client.get(f"/api/manual/jobs/{job_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_unknown_manual_job(client: AsyncClient):
    fake_id = uuid.uuid4()
    resp = await client.delete(f"/api/manual/jobs/{fake_id}")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd backend && uv run pytest tests/test_manual_delete.py -v`
Expected: FAIL (405 또는 라우트 미존재)

- [ ] **Step 3: Implement DELETE route**

`backend/app/routers/manual.py` 상단 import 영역에 추가 (없으면):

```python
from sqlalchemy import delete as sa_delete, select
from app.models.manual import ManualGenerationJob
from app.models.feedback import ProposedDocumentChange, ApprovalRequest
```

파일 끝(`get_manual_job` 다음)에 추가:

```python
@router.delete("/jobs/{job_id}", status_code=204)
async def delete_manual_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    job = await db.get(ManualGenerationJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Manual job not found")

    # 자식 행 정리: manual_job_id 가 가리키는 proposed_change → 그 자식 approval_request
    pc_ids_result = await db.execute(
        select(ProposedDocumentChange.id).where(
            ProposedDocumentChange.manual_job_id == job_id
        )
    )
    pc_ids = pc_ids_result.scalars().all()
    if pc_ids:
        await db.execute(
            sa_delete(ApprovalRequest).where(
                ApprovalRequest.proposed_change_id.in_(pc_ids)
            )
        )
        await db.execute(
            sa_delete(ProposedDocumentChange).where(
                ProposedDocumentChange.id.in_(pc_ids)
            )
        )

    await db.execute(sa_delete(ManualGenerationJob).where(ManualGenerationJob.id == job_id))
    await db.commit()
```

`HTTPException` import는 이미 존재해야 함. 없으면 `from fastapi import APIRouter, Depends, HTTPException` 로 보강.

- [ ] **Step 4: Run test to confirm pass**

Run: `cd backend && uv run pytest tests/test_manual_delete.py -v`
Expected: 2 PASS

전체 회귀: `cd backend && uv run pytest -q`
Expected: 신규 실패 없음.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/manual.py backend/tests/test_manual_delete.py
git commit -m "feat(manual): add DELETE /jobs/{job_id} endpoint"
```

---

## Task 3: 메뉴얼 생성 요청 프론트엔드 휴지통

**Files:**
- Modify: `frontend/src/lib/api.ts` (250번 줄 근처 manual 영역)
- Modify: `frontend/src/pages/ManualGenerator.tsx:186-211`

- [ ] **Step 1: api에 deleteManualJob 추가**

`frontend/src/lib/api.ts`의 `listManualJobs` 정의 바로 아래에 추가:

```ts
  deleteManualJob: async (jobId: string) => {
    const res = await fetch(`${BASE}/manual/jobs/${jobId}`, { method: 'DELETE', headers: getAuthHeaders() })
    if (!res.ok) throw new Error(`Failed to delete manual job: ${res.status}`)
    return res
  },
```

- [ ] **Step 2: ManualGenerator 행에 hover 휴지통 추가**

`frontend/src/pages/ManualGenerator.tsx` 186-211 라인의 list 렌더 블록을 다음으로 교체:

```tsx
        <div className="flex-1 overflow-y-auto divide-y divide-[#f2f4f6]">
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[#9a9bad]">항목이 없습니다</div>
          ) : (
            filtered.map(job => (
              <div
                key={job.id}
                className={`group relative w-full hover:bg-[#f7f9fb] transition-colors ${selectedId === job.id ? "bg-[#eef2ff]" : ""}`}
              >
                <button
                  onClick={() => setSelectedId(job.id)}
                  className="w-full text-left px-5 py-4 pr-12"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-[#191c1e] truncate flex-1">{job.target_url}</p>
                    {(() => {
                      const b = jobBadgeLabel(job)
                      return (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${b.cls}`}>
                          {b.label}
                        </span>
                      )
                    })()}
                  </div>
                  <p className="text-xs text-[#9a9bad] mt-1">{new Date(job.created_at).toLocaleDateString("ko-KR")}</p>
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!window.confirm("이 메뉴얼 요청을 삭제하시겠습니까?")) return
                    try {
                      await api.deleteManualJob(job.id)
                      if (selectedId === job.id) setSelectedId(null)
                      refetch()
                    } catch (err) {
                      window.alert("삭제에 실패했습니다.")
                      console.error(err)
                    }
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 text-[#757684] hover:text-[#ba1a1a] transition-all rounded"
                  title="삭제"
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            ))
          )}
        </div>
```

- [ ] **Step 3: Typecheck/lint**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 4: 수동 검증**

Run: `cd frontend && pnpm dev` + `cd backend && uv run fastapi dev`
브라우저: 메뉴얼 생성 → 목록 항목 hover → 휴지통 클릭 → confirm 후 사라짐 확인.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/ManualGenerator.tsx
git commit -m "feat(manual-ui): hover delete button on manual job list"
```

---

## Task 4: 지라 SR 백엔드 삭제 API

**Files:**
- Modify: `backend/app/routers/sr.py`
- Test: `backend/tests/test_sr.py` (append)

자식 FK 정리 대상:
1. `WebhookDeliveryLog`(`sr_draft_id`) — hard delete
2. `ApprovalRequest`(`sr_draft_id`) — hard delete (SR 직결 승인)
3. `ManualGenerationJob`(`source_sr_id`) → SET NULL (manual job 자체는 보존)
4. `JiraCallbackLog`(`sr_draft_id`) → SET NULL (로그는 보존, FK만 끊음)
5. `Document.source_sr_draft_id` → SET NULL (이미 등록된 문서 보존)
6. `SRDraft` 본체 hard delete

- [ ] **Step 1: Write failing test — SR 삭제**

`backend/tests/test_sr.py` 끝에 추가:

```python
import uuid
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_sr_draft(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Delete me SR",
        "description": "to be removed",
        "priority": "low",
    })
    assert create_resp.status_code == 201
    sr_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/sr/drafts/{sr_id}")
    assert del_resp.status_code == 204

    list_resp = await client.get("/api/sr/drafts", params={"skip": 0, "limit": 500})
    assert list_resp.status_code == 200
    ids = [it["id"] for it in list_resp.json()["items"]]
    assert sr_id not in ids


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_unknown_sr_draft(client: AsyncClient):
    fake_id = uuid.uuid4()
    resp = await client.delete(f"/api/sr/drafts/{fake_id}")
    assert resp.status_code == 404
```

(파일 상단 import는 이미 있을 수 있으니 중복 시 생략)

- [ ] **Step 2: Run test to confirm failure**

Run: `cd backend && uv run pytest tests/test_sr.py::test_delete_sr_draft -v`
Expected: FAIL (405 또는 라우트 미존재)

- [ ] **Step 3: Implement DELETE route**

`backend/app/routers/sr.py` 상단 import에 추가 (없는 항목만):

```python
from sqlalchemy import delete as sa_delete, update as sa_update
from app.models.sr import SRDraft, WebhookDeliveryLog
from app.models.feedback import ApprovalRequest
from app.models.manual import ManualGenerationJob
from app.models.jira import JiraCallbackLog
from app.models.document import Document
```

파일 끝에 추가:

```python
@router.delete("/drafts/{sr_id}", status_code=204)
async def delete_sr_draft(
    sr_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    sr = await db.get(SRDraft, sr_id)
    if not sr:
        raise HTTPException(status_code=404, detail="SR draft not found")

    # 1) 직결 자식 hard delete
    await db.execute(sa_delete(WebhookDeliveryLog).where(WebhookDeliveryLog.sr_draft_id == sr_id))
    await db.execute(sa_delete(ApprovalRequest).where(ApprovalRequest.sr_draft_id == sr_id))

    # 2) 보존 대상: FK만 끊기
    await db.execute(
        sa_update(ManualGenerationJob)
        .where(ManualGenerationJob.source_sr_id == sr_id)
        .values(source_sr_id=None)
    )
    await db.execute(
        sa_update(JiraCallbackLog)
        .where(JiraCallbackLog.sr_draft_id == sr_id)
        .values(sr_draft_id=None)
    )
    await db.execute(
        sa_update(Document)
        .where(Document.source_sr_draft_id == sr_id)
        .values(source_sr_draft_id=None)
    )

    await db.execute(sa_delete(SRDraft).where(SRDraft.id == sr_id))
    await db.commit()
```

`Document` 모델에 `source_sr_draft_id` 컬럼명이 다르면 (확인: `backend/app/models/document.py`에서 sr_drafts FK를 가진 필드명) 그에 맞게 교체.

- [ ] **Step 4: Run test to confirm pass**

Run: `cd backend && uv run pytest tests/test_sr.py -v`
Expected: 모든 SR 테스트 PASS

전체 회귀: `cd backend && uv run pytest -q`
Expected: 신규 실패 없음

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/sr.py backend/tests/test_sr.py
git commit -m "feat(sr): add DELETE /drafts/{sr_id} with child row cleanup"
```

---

## Task 5: 지라 SR 프론트엔드 휴지통

**Files:**
- Modify: `frontend/src/lib/api.ts` (167번 줄 근처 `listSRDrafts` 영역)
- Modify: `frontend/src/pages/ServiceRequests.tsx`

- [ ] **Step 1: api에 deleteSRDraft 추가**

`frontend/src/lib/api.ts`의 `listSRDrafts` 정의 다음에 추가:

```ts
  deleteSRDraft: async (srId: string) => {
    const res = await fetch(`${BASE}/sr/drafts/${srId}`, { method: 'DELETE', headers: getAuthHeaders() })
    if (!res.ok) throw new Error(`Failed to delete SR: ${res.status}`)
    return res
  },
```

- [ ] **Step 2: ServiceRequests 목록 행에 hover 휴지통 추가**

`frontend/src/pages/ServiceRequests.tsx`에서 SR 목록을 렌더하는 영역을 찾아 (`displayItems.map(...)` 형태) 각 행에 hover 휴지통을 단다. 행이 `button` 단일 요소면 Task 3 패턴과 동일하게 `div.group` + 내부 `button` + 절대 위치 휴지통 `button`으로 감싼다.

휴지통 핸들러 코드:

```tsx
onClick={async (e) => {
  e.stopPropagation()
  if (!window.confirm("이 SR을 삭제하시겠습니까?")) return
  try {
    await api.deleteSRDraft(sr.id)
    if (selectedId === sr.id) {
      setSelectedId(null)
      setSelectedSR(null)
    }
    refetch()
  } catch (err) {
    window.alert("삭제에 실패했습니다.")
    console.error(err)
  }
}}
```

휴지통 버튼 마크업:

```tsx
<button
  onClick={...}
  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 text-[#757684] hover:text-[#ba1a1a] transition-all rounded"
  title="삭제"
>
  <span className="material-symbols-outlined text-base">delete</span>
</button>
```

행 컨테이너에는 `group relative` 클래스, 본문 버튼에는 `pr-12` (휴지통 자리 확보)를 적용한다.

- [ ] **Step 3: Typecheck/lint**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 4: 수동 검증**

브라우저: SR 목록 hover → 휴지통 → confirm → 사라짐 + 선택 해제.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/ServiceRequests.tsx
git commit -m "feat(sr-ui): hover delete button on SR list"
```

---

## Task 6: 위젯 대화 백엔드 삭제 API

**Files:**
- Modify: `backend/app/routers/widget.py`
- Test: `backend/tests/test_widget.py` (append)

위젯은 `ChatSession`/`ChatMessage`를 재사용한다(`title.like("widget:%")`). 자식 정리 항목은 chat 삭제와 동일: `AnswerCitation`, `FeedbackReport`, `ChatMessage`, `ChatSession`.

- [ ] **Step 1: Write failing test — 위젯 세션 삭제**

`backend/tests/test_widget.py` 끝에 추가 (기존 fixture/패턴을 보고 인자 이름은 맞춤):

```python
import uuid
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_admin_delete_widget_session(client: AsyncClient):
    # 위젯 세션 생성 (anonymous)
    create_resp = await client.post("/api/widget/sessions", json={
        "site_id": "demo-site",
        "anonymous_id": f"anon_{uuid.uuid4().hex[:8]}",
    })
    assert create_resp.status_code == 201
    session_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/widget/admin/sessions/{session_id}")
    assert del_resp.status_code == 204

    list_resp = await client.get("/api/widget/admin/sessions")
    assert list_resp.status_code == 200
    ids = [s["id"] for s in list_resp.json()]
    assert session_id not in ids


@pytest.mark.asyncio(loop_scope="session")
async def test_admin_delete_unknown_widget_session(client: AsyncClient):
    fake_id = uuid.uuid4()
    resp = await client.delete(f"/api/widget/admin/sessions/{fake_id}")
    assert resp.status_code == 404
```

(`POST /api/widget/sessions` 의 schema 필드명은 `backend/app/schemas/widget.py` 의 `WidgetSessionCreate`를 확인하여 맞춘다. 위 코드는 통상적 필드명을 가정.)

- [ ] **Step 2: Run test to confirm failure**

Run: `cd backend && uv run pytest tests/test_widget.py::test_admin_delete_widget_session -v`
Expected: FAIL

- [ ] **Step 3: Implement DELETE route**

`backend/app/routers/widget.py` 상단 import에 추가:

```python
from sqlalchemy import delete as sa_delete, select as sa_select
from app.models.chat import AnswerCitation
from app.models.feedback import FeedbackReport
```

(`ChatSession`, `ChatMessage`는 이미 import 됨)

파일 끝에 추가:

```python
@router.delete("/admin/sessions/{session_id}", status_code=204)
async def admin_delete_widget_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    session = await db.get(ChatSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    msg_ids_result = await db.execute(
        sa_select(ChatMessage.id).where(ChatMessage.session_id == session_id)
    )
    msg_ids = msg_ids_result.scalars().all()
    if msg_ids:
        await db.execute(sa_delete(AnswerCitation).where(AnswerCitation.chat_message_id.in_(msg_ids)))
        await db.execute(sa_delete(FeedbackReport).where(FeedbackReport.chat_message_id.in_(msg_ids)))
    await db.execute(sa_delete(ChatMessage).where(ChatMessage.session_id == session_id))
    await db.execute(sa_delete(ChatSession).where(ChatSession.id == session_id))
    await db.commit()
```

`uuid`, `HTTPException` import는 이미 있어야 하며 없으면 보강.

- [ ] **Step 4: Run test to confirm pass**

Run: `cd backend && uv run pytest tests/test_widget.py -v`
Expected: 모든 widget 테스트 PASS

전체 회귀: `cd backend && uv run pytest -q`
Expected: 신규 실패 없음

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/widget.py backend/tests/test_widget.py
git commit -m "feat(widget): add DELETE /admin/sessions/{session_id}"
```

---

## Task 7: 위젯 대화 프론트엔드 휴지통

**Files:**
- Modify: `frontend/src/pages/WidgetConversations.tsx`

(api 헬퍼 없음 — 현재 페이지가 `fetch` 직접 사용. 일관 유지)

- [ ] **Step 1: WidgetConversations에 deleteSession 핸들러 + UI 추가**

`frontend/src/pages/WidgetConversations.tsx`의 세션 목록 렌더 부분(`sessions.map(...)`)을 행마다 `group relative` 컨테이너로 감싸고 우측에 절대 위치 휴지통을 추가한다.

핸들러를 컴포넌트 내부에 추가:

```tsx
const deleteSession = async (id: string, e: React.MouseEvent) => {
  e.stopPropagation()
  if (!window.confirm("이 대화를 삭제하시겠습니까?")) return
  try {
    const res = await fetch(`/api/widget/admin/sessions/${id}`, { method: "DELETE" })
    if (!res.ok) throw new Error(`status ${res.status}`)
    setSessions(prev => prev.filter(s => s.id !== id))
    if (selectedId === id) {
      setSelectedId(null)
      setMessages([])
    }
  } catch (err) {
    window.alert("삭제에 실패했습니다.")
    console.error(err)
  }
}
```

행 렌더에 휴지통 버튼(절대 위치):

```tsx
<button
  onClick={(e) => deleteSession(session.id, e)}
  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 text-muted-foreground hover:text-destructive transition-all rounded"
  title="삭제"
>
  <span className="material-symbols-outlined text-base">delete</span>
</button>
```

행 컨테이너에 `group relative` + 본문 영역에 `pr-12` 패딩을 적용한다.

- [ ] **Step 2: Typecheck/lint**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 3: 수동 검증**

브라우저: 위젯 대화 페이지 → 세션 hover → 휴지통 → confirm → 사라짐.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/WidgetConversations.tsx
git commit -m "feat(widget-ui): hover delete button on admin widget conversations"
```

---

## 최종 검증

- [ ] **Step 1: 전체 백엔드 테스트**

Run: `cd backend && uv run pytest -q`
Expected: 전체 PASS

- [ ] **Step 2: 프론트 typecheck + lint**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 3: 수동 시연 리허설**

- 메뉴얼 요청 행 hover → 삭제 → 목록에서 사라짐
- SR 행 hover → 삭제 → 목록 + 검토 탭에서 사라짐
- 위젯 대화 행 hover → 삭제 → 사라짐
- Q&A 챗봇: 피드백 단 세션도 휴지통 → 새로고침 후에도 사라진 상태 유지

문제 없으면 시연 준비 완료.
