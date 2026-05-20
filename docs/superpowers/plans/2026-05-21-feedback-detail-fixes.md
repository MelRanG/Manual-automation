# 오류 제보 상세 버그 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오류 제보 상세 컴포넌트의 텍스트 오류, 반영 안함 이력 미기록, 반영 후 스테일 경고 오표시 3가지 버그 수정

**Architecture:** 백엔드 `feedback.py` 라우터 2곳 수정(get_proposal is_stale 로직, apply_draft 이력 로깅) + 프론트엔드 `Feedback.tsx` UI 텍스트·상태 표시 수정. 신규 파일 없음.

**Tech Stack:** Python FastAPI, React TypeScript

---

## 변경 파일

- Modify: `backend/app/routers/feedback.py` — `get_proposal`, `apply_draft` 엔드포인트
- Modify: `frontend/src/pages/Feedback.tsx` — 텍스트, draft 탭 상태 표시
- Modify: `backend/tests/test_feedback.py` — 신규 테스트 추가

---

### Task 1: get_proposal — 승인/거절된 proposal의 is_stale 오표시 수정

**Files:**
- Modify: `backend/app/routers/feedback.py:62-80`
- Modify: `backend/tests/test_feedback.py` (테스트 추가)

**배경:** apply 성공 → `create_new_version` → `doc.current_version_id` 변경 → `get_proposal` 재조회 시 `proposal.document_version_id != doc.current_version_id` → `is_stale=True` 잘못 반환. 이미 approved/rejected 상태면 stale 계산 불필요.

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_feedback.py` 하단에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_get_proposal_is_not_stale_after_apply(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Apply No Stale Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Original content to fix."})
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

    # 반영
    apply_resp = await client.post(f"/api/feedback/{feedback_id}/apply-draft", json={
        "action": "apply",
        "reviewer_id": test_user["id"],
    })
    assert apply_resp.status_code == 200

    # 반영 후 get_proposal → is_stale must be False
    proposal_resp = await client.get(f"/api/feedback/{feedback_id}/proposal")
    assert proposal_resp.status_code == 200
    assert proposal_resp.json()["is_stale"] is False
    assert proposal_resp.json()["status"] == "approved"
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py::test_get_proposal_is_not_stale_after_apply -v
```

Expected: FAIL — `assert False is False` (is_stale이 True로 반환됨)

- [ ] **Step 3: get_proposal 수정**

`backend/app/routers/feedback.py` 의 `get_proposal` 엔드포인트(line 62-80)를 아래로 교체:

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
    if proposal.status not in ("approved", "rejected"):
        if proposal.document_version_id and proposal.document_id:
            doc_result = await db.execute(select(Document).where(Document.id == proposal.document_id))
            doc = doc_result.scalar_one_or_none()
            if doc and doc.current_version_id != proposal.document_version_id:
                is_stale = True

    return ProposedChangeResponse.model_validate(proposal, from_attributes=True).model_copy(
        update={"is_stale": is_stale}
    )
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py::test_get_proposal_is_not_stale_after_apply -v
```

Expected: PASS

- [ ] **Step 5: 기존 테스트 회귀 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py -v
```

Expected: 모두 PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/app/routers/feedback.py backend/tests/test_feedback.py
git commit -m "fix: skip is_stale check for approved/rejected proposals"
```

---

### Task 2: apply_draft — 반영/반영 안함 이력 로깅 추가

**Files:**
- Modify: `backend/app/routers/feedback.py:164-230`
- Modify: `backend/tests/test_feedback.py` (테스트 추가)

**배경:** "반영 안함" 클릭 시 변경 이력에 아무것도 안 남음. `history_service.log_event`를 apply/reject 양쪽에서 호출해야 함.

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_feedback.py` 하단에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_apply_draft_reject_logs_history(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Reject History Doc",
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

    await client.post(f"/api/feedback/{feedback_id}/apply-draft", json={
        "action": "reject",
        "reviewer_id": test_user["id"],
    })

    history_resp = await client.get(f"/api/history/feedback/{feedback_id}")
    assert history_resp.status_code == 200
    events = history_resp.json()
    assert any(e["event_type"] == "feedback_rejected" for e in events)


@pytest.mark.asyncio(loop_scope="session")
async def test_apply_draft_apply_logs_history(client: AsyncClient, test_user: dict):
    doc_resp = await client.post("/api/documents", json={
        "title": "Apply History Doc",
        "owner_id": test_user["id"],
    }, params={"content": "Content to be fixed."})
    doc_id = doc_resp.json()["id"]

    feedback_resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "document_id": doc_id,
        "feedback_text": "Fix it",
    })
    feedback_id = feedback_resp.json()["feedback"]["id"]

    await client.post(f"/api/feedback/{feedback_id}/request-draft", json={
        "reviewed_text": "Fix it",
    })

    await client.post(f"/api/feedback/{feedback_id}/apply-draft", json={
        "action": "apply",
        "reviewer_id": test_user["id"],
    })

    history_resp = await client.get(f"/api/history/feedback/{feedback_id}")
    assert history_resp.status_code == 200
    events = history_resp.json()
    assert any(e["event_type"] == "feedback_applied" for e in events)
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py::test_apply_draft_reject_logs_history tests/test_feedback.py::test_apply_draft_apply_logs_history -v
```

Expected: FAIL — 이벤트가 없어서 `any(...)` 가 False

- [ ] **Step 3: apply_draft 엔드포인트에 이력 로깅 추가**

`backend/app/routers/feedback.py` import에 `history_service` 추가:

```python
from app.services import feedback_service, approval_service, history_service
```

`apply_draft` 엔드포인트에서 `try/except` 블록 이후, `await db.refresh(feedback)` 바로 앞에 아래 코드 추가:

```python
    if body.action == "apply":
        await history_service.log_event(
            db, "feedback", feedback_id,
            event_type="feedback_applied",
            actor_id=body.reviewer_id,
            detail="AI 수정 초안이 문서에 반영되었습니다.",
        )
    elif body.action == "reject":
        await history_service.log_event(
            db, "feedback", feedback_id,
            event_type="feedback_rejected",
            actor_id=body.reviewer_id,
            detail="오류 제보를 검토하였으나 문서에 반영하지 않기로 결정했습니다.",
        )
```

정확한 삽입 위치는 `apply_draft` 함수 내 `except ValueError as e:` 블록 종료 직후, `await db.refresh(feedback)` 줄 바로 앞:

```python
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # ← 여기에 삽입
    if body.action == "apply":
        await history_service.log_event(
            db, "feedback", feedback_id,
            event_type="feedback_applied",
            actor_id=body.reviewer_id,
            detail="AI 수정 초안이 문서에 반영되었습니다.",
        )
    elif body.action == "reject":
        await history_service.log_event(
            db, "feedback", feedback_id,
            event_type="feedback_rejected",
            actor_id=body.reviewer_id,
            detail="오류 제보를 검토하였으나 문서에 반영하지 않기로 결정했습니다.",
        )

    await db.refresh(feedback)
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py::test_apply_draft_reject_logs_history tests/test_feedback.py::test_apply_draft_apply_logs_history -v
```

Expected: PASS

- [ ] **Step 5: 기존 테스트 회귀 확인**

```bash
cd backend && uv run pytest tests/test_feedback.py -v
```

Expected: 모두 PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/app/routers/feedback.py backend/tests/test_feedback.py
git commit -m "feat: log feedback_applied/feedback_rejected history events in apply_draft"
```

---

### Task 3: Feedback.tsx — 텍스트 수정 및 draft 탭 성공/거절 상태 표시

**Files:**
- Modify: `frontend/src/pages/Feedback.tsx`

**배경:** "이 피드백 삭제" 텍스트를 메뉴 용어인 "오류제보 삭제"로 통일. apply/reject 완료 후 버튼만 사라지고 상태 메시지가 없어 사용자가 처리 완료 여부를 알 수 없음.

- [ ] **Step 1: 삭제 버튼 텍스트 및 confirm 메시지 수정**

`frontend/src/pages/Feedback.tsx:142-148` 수정:

```tsx
  async function handleDelete() {
    if (!confirm("이 오류 제보를 삭제하시겠습니까?")) return
    const res = await api.deleteFeedback(item.id)
    if (res.ok || res.status === 204) {
      onDelete()
    }
  }
```

`frontend/src/pages/Feedback.tsx:345-352` 수정:

```tsx
          <div className="pt-4 border-t border-[#e0e3e5]">
            <button
              onClick={handleDelete}
              className="text-xs text-[#dc2626] hover:text-[#991b1b] underline"
            >
              오류제보 삭제
            </button>
          </div>
```

- [ ] **Step 2: draft 탭에 approved/rejected 상태 메시지 추가**

`frontend/src/pages/Feedback.tsx` draft 탭 내 버튼 블록(`{!proposal.is_stale && !["approved", "rejected"].includes(proposal.status) && (...)}`  끝나는 닫는 태그 바로 다음에 추가:

```tsx
              {proposal.status === "approved" && (
                <div className="flex items-center gap-2 p-3 bg-[#dcfce7] border border-[#bbf7d0] rounded-lg">
                  <span className="text-sm text-[#15803d] font-medium">✓ 문서에 반영 완료</span>
                </div>
              )}
              {proposal.status === "rejected" && (
                <div className="flex items-center gap-2 p-3 bg-[#f2f4f6] border border-[#e0e3e5] rounded-lg">
                  <span className="text-sm text-[#757684]">반영 안함으로 처리되었습니다.</span>
                </div>
              )}
```

- [ ] **Step 3: 타입체크 통과 확인**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/Feedback.tsx
git commit -m "fix: rename delete button to 오류제보 삭제, show approved/rejected state in draft tab"
```
