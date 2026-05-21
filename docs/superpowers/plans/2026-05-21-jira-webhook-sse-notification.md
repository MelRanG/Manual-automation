# Jira Webhook SSE 알림 누락 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jira 웹훅으로 이슈가 "완료"로 전환될 때 admin 전원과 SR 작성자에게 SSE 알림을 발송하고, 기존 `process_jira_done`의 admin 알림도 전원 발송으로 일관화한다.

**Architecture:** `backend/app/routers/jira.py:receive_jira_webhook` 끝에 알림 분기를 추가한다. admin 사용자는 `User.role == "admin"`으로 전부 조회, 작성자는 `sr.user_id`로 단일 조회. 알림 송신 블록 전체를 `try/except`로 감싸 실패 시에도 webhook 응답을 200으로 유지한다. `backend/app/services/jira_service.py:process_jira_done`의 admin 단일 알림(`.limit(1)`)을 전원 발송 루프로 교체한다.

**Tech Stack:** Python 3, FastAPI, SQLAlchemy(async), pytest, pytest-asyncio.

---

## 변경 파일

- Modify: `backend/app/routers/jira.py:142-150`
- Modify: `backend/app/services/jira_service.py:363-382`
- Modify: `backend/tests/test_jira.py` (테스트 3건 추가)

---

### Task 1: Webhook 알림 — admin 전원 + 작성자 (TDD)

**Files:**
- Modify: `backend/app/routers/jira.py:142-150`
- Modify: `backend/tests/test_jira.py` (테스트 추가)

목적: webhook 처리 후 admin 전원에게 `jira_sr_doc_review_needed` 알림과 작성자에게 `jira_sr_done_owner` 알림이 DB에 생성되는지 검증하고 구현한다.

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_jira.py` 파일 끝에 다음 테스트 함수를 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_webhook_creates_notifications_for_admins_and_owner(client, db_session):
    """webhook 완료 처리 시 admin 전원 + 작성자에게 알림 생성"""
    import uuid
    from sqlalchemy import select
    from app.models.user import User
    from app.models.sr import SRDraft
    from app.models.jira import JiraConfig
    from app.models.notification import Notification

    # admin 2명 생성
    admin_ids = []
    for i in range(2):
        resp = await client.post("/api/users", json={
            "name": f"Admin {i}",
            "email": f"admin_{i}_{uuid.uuid4().hex[:8]}@example.com",
            "role": "admin",
        })
        assert resp.status_code == 201
        admin_ids.append(uuid.UUID(resp.json()["id"]))

    # 작성자 생성
    resp = await client.post("/api/users", json={
        "name": "Owner",
        "email": f"owner_{uuid.uuid4().hex[:8]}@example.com",
        "role": "editor",
    })
    assert resp.status_code == 201
    owner_id = uuid.UUID(resp.json()["id"])

    # Jira config 활성화
    config = JiraConfig(
        id=uuid.uuid4(),
        base_url="https://test.atlassian.net",
        user_email="t@example.com",
        api_token="token",
        project_key="TEST",
        is_active=True,
        trigger_status_names=None,
    )
    db_session.add(config)

    # 미처리 SR
    unique_key = f"TEST-NOTIF-{uuid.uuid4().hex[:6]}"
    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=owner_id,
        title="알림 테스트 SR",
        description="설명",
        priority="medium",
        status="submitted",
        created_by_ai=False,
        jira_issue_key=unique_key,
    )
    db_session.add(sr)
    await db_session.commit()

    payload = {
        "webhookEvent": "jira:issue_updated",
        "issue": {
            "key": unique_key,
            "fields": {
                "status": {
                    "name": "Done",
                    "statusCategory": {"key": "done"},
                }
            },
        },
    }
    resp = await client.post("/api/jira/webhook", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending_doc_review"

    # admin 알림 조회 — 각 admin 1건씩
    for admin_id in admin_ids:
        admin_notifs = (await db_session.execute(
            select(Notification).where(
                Notification.user_id == admin_id,
                Notification.type == "jira_sr_doc_review_needed",
            )
        )).scalars().all()
        assert len(admin_notifs) == 1
        n = admin_notifs[0]
        assert "알림 테스트 SR" in n.title
        assert n.link_path == "/approvals?tab=jira_sr"

    # 작성자 알림 조회
    owner_notifs = (await db_session.execute(
        select(Notification).where(
            Notification.user_id == owner_id,
            Notification.type == "jira_sr_done_owner",
        )
    )).scalars().all()
    assert len(owner_notifs) == 1
    assert "알림 테스트 SR" in owner_notifs[0].message
    assert owner_notifs[0].link_path == "/approvals?tab=jira_sr"
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd backend && uv run pytest tests/test_jira.py::test_webhook_creates_notifications_for_admins_and_owner -v`
Expected: FAIL — admin/owner 알림 0건 (assertion `len == 1` 실패)

- [ ] **Step 3: webhook 핸들러에 알림 호출 추가**

`backend/app/routers/jira.py`의 `receive_jira_webhook` 함수에서 `return {"status": "pending_doc_review", ...}` 직전(라인 151)에 알림 블록을 삽입한다.

상단 import에 추가 (파일 상단 import 블록 끝):

```python
import logging

from app.models.user import User
from app.routers.notifications import create_notification

logger = logging.getLogger(__name__)
```

(이미 동일 import가 있으면 중복 추가하지 말 것. `grep -n "from app.models.user" backend/app/routers/jira.py`로 확인.)

기존 코드(`jira.py:142-151`):

```python
    log.sr_draft_id = draft.id
    log.status = "processed"
    await db.commit()

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

변경 후:

```python
    log.sr_draft_id = draft.id
    log.status = "processed"
    await db.commit()

    approval = ApprovalRequestModel(
        id=uuid.uuid4(),
        approval_type="doc_review",
        sr_draft_id=draft.id,
        status="pending",
    )
    db.add(approval)
    draft.status = "pending_doc_review"
    await db.commit()

    try:
        admin_result = await db.execute(select(User).where(User.role == "admin"))
        admins = admin_result.scalars().all()
        for admin in admins:
            await create_notification(
                db,
                user_id=admin.id,
                type="jira_sr_doc_review_needed",
                title=f"Jira SR '{draft.title}' 완료",
                message="문서화 검토가 필요합니다",
                document_id=None,
                link_path="/approvals?tab=jira_sr",
            )
        await create_notification(
            db,
            user_id=draft.user_id,
            type="jira_sr_done_owner",
            title="내 SR Jira 완료 처리됨",
            message=f"'{draft.title}' SR이 Jira에서 완료되었습니다",
            document_id=None,
            link_path="/approvals?tab=jira_sr",
        )
    except Exception as e:
        logger.warning(f"Jira webhook 알림 전송 실패 (sr={draft.id}): {e}")

    return {"status": "pending_doc_review", "sr_id": str(draft.id), "approval_id": str(approval.id)}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd backend && uv run pytest tests/test_jira.py::test_webhook_creates_notifications_for_admins_and_owner -v`
Expected: PASS

- [ ] **Step 5: 기존 webhook 테스트 회귀 확인**

Run: `cd backend && uv run pytest tests/test_jira.py -v`
Expected: 모든 기존 테스트도 PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/app/routers/jira.py backend/tests/test_jira.py
git commit -m "feat(jira): send SSE notifications on webhook done transition"
```

---

### Task 2: 알림 실패가 webhook 응답을 깨지 않음 (TDD)

**Files:**
- Modify: `backend/tests/test_jira.py` (테스트 추가)

목적: `create_notification`이 예외를 던져도 webhook 응답은 200이며 `ApprovalRequest`와 SR 상태 전환이 정상적으로 완료되는지 검증한다. (구현은 Task 1에서 `try/except`로 완료되었으므로 본 task는 회귀 방지 테스트만 추가.)

- [ ] **Step 1: 실패 시나리오 테스트 작성**

`backend/tests/test_jira.py` 파일 끝에 다음 테스트를 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_webhook_notification_failure_does_not_break_response(client, db_session):
    """create_notification이 raise해도 webhook 응답 200, SR 상태 전환 정상"""
    import uuid
    from unittest.mock import patch
    from sqlalchemy import select
    from app.models.sr import SRDraft
    from app.models.jira import JiraConfig
    from app.models.feedback import ApprovalRequest

    resp = await client.post("/api/users", json={
        "name": "Owner Fail",
        "email": f"owner_fail_{uuid.uuid4().hex[:8]}@example.com",
        "role": "editor",
    })
    assert resp.status_code == 201
    owner_id = uuid.UUID(resp.json()["id"])

    config = JiraConfig(
        id=uuid.uuid4(),
        base_url="https://test.atlassian.net",
        user_email="t@example.com",
        api_token="token",
        project_key="TEST",
        is_active=True,
        trigger_status_names=None,
    )
    db_session.add(config)

    unique_key = f"TEST-FAIL-{uuid.uuid4().hex[:6]}"
    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=owner_id,
        title="알림 실패 SR",
        description="설명",
        priority="medium",
        status="submitted",
        created_by_ai=False,
        jira_issue_key=unique_key,
    )
    db_session.add(sr)
    await db_session.commit()

    payload = {
        "webhookEvent": "jira:issue_updated",
        "issue": {
            "key": unique_key,
            "fields": {
                "status": {
                    "name": "Done",
                    "statusCategory": {"key": "done"},
                }
            },
        },
    }

    async def boom(*args, **kwargs):
        raise RuntimeError("simulated push failure")

    with patch("app.routers.jira.create_notification", side_effect=boom):
        resp = await client.post("/api/jira/webhook", json=payload)

    assert resp.status_code == 200
    assert resp.json()["status"] == "pending_doc_review"

    # SR 상태가 정상 전환됐는지
    await db_session.refresh(sr)
    assert sr.status == "pending_doc_review"

    # ApprovalRequest가 생성됐는지
    approvals = (await db_session.execute(
        select(ApprovalRequest).where(ApprovalRequest.sr_draft_id == sr.id)
    )).scalars().all()
    assert len(approvals) == 1
```

- [ ] **Step 2: 테스트 실행 — 통과 확인**

Run: `cd backend && uv run pytest tests/test_jira.py::test_webhook_notification_failure_does_not_break_response -v`
Expected: PASS (Task 1에서 `try/except` 이미 추가됨)

- [ ] **Step 3: 커밋**

```bash
git add backend/tests/test_jira.py
git commit -m "test(jira): notification failure must not break webhook response"
```

---

### Task 3: `process_jira_done` admin 전원 알림 일관화 (TDD)

**Files:**
- Modify: `backend/app/services/jira_service.py:363-382`
- Modify: `backend/tests/test_jira.py` (테스트 추가)

목적: 기존 `process_jira_done`이 `.limit(1)`로 admin 1명에게만 알림을 보내던 동작을 admin 전원 발송으로 변경한다.

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_jira.py` 파일 끝에 다음 테스트를 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_process_jira_done_notifies_all_admins(client, db_session):
    """process_jira_done은 admin 전원에게 jira_sr_proposals_ready 알림 발송"""
    import uuid
    import json
    from unittest.mock import patch, MagicMock, AsyncMock
    from sqlalchemy import select
    from app.models.sr import SRDraft
    from app.models.jira import JiraCallbackLog
    from app.models.document import Document, DocumentVersion
    from app.models.notification import Notification
    from app.services import jira_service

    # admin 2명
    admin_ids = []
    for i in range(2):
        resp = await client.post("/api/users", json={
            "name": f"Proc Admin {i}",
            "email": f"proc_admin_{i}_{uuid.uuid4().hex[:8]}@example.com",
            "role": "admin",
        })
        assert resp.status_code == 201
        admin_ids.append(uuid.UUID(resp.json()["id"]))

    # 작성자
    resp = await client.post("/api/users", json={
        "name": "Proc Owner",
        "email": f"proc_owner_{uuid.uuid4().hex[:8]}@example.com",
        "role": "editor",
    })
    assert resp.status_code == 201
    user_id = uuid.UUID(resp.json()["id"])

    doc = Document(
        id=uuid.uuid4(), title="문서A", description="설명",
        owner_id=user_id,
        status="active", priority="medium", trust_score=1.0,
    )
    db_session.add(doc)
    await db_session.flush()
    version = DocumentVersion(
        id=uuid.uuid4(), document_id=doc.id, version_number=1,
        content="내용", created_by=user_id,
        change_summary="초기",
    )
    db_session.add(version)
    await db_session.flush()
    doc.current_version_id = version.id

    sr = SRDraft(
        id=uuid.uuid4(), user_id=user_id,
        title="모든 관리자 알림 SR", description="설명",
        priority="medium", status="submitted",
        created_by_ai=False, target_url=None,
    )
    db_session.add(sr)
    await db_session.flush()
    log = JiraCallbackLog(
        id=uuid.uuid4(), jira_issue_key=f"TEST-ALL-{uuid.uuid4().hex[:6]}",
        event_type="jira:issue_updated", payload={},
        status="pending", sr_draft_id=sr.id,
    )
    db_session.add(log)
    await db_session.commit()

    mock_chunk = {
        "document_id": doc.id, "document_title": doc.title,
        "content": "내용", "distance": 0.1,
    }

    with patch("app.services.jira_service._find_related_documents", return_value=[mock_chunk]), \
         patch("app.services.llm_service.get_llm_provider") as mock_llm_factory:
        mock_llm = MagicMock()
        mock_llm.generate = AsyncMock(return_value="수정 내용")
        mock_llm_factory.return_value = mock_llm
        await jira_service.process_jira_done(sr.id, log.id, db=db_session)

    for admin_id in admin_ids:
        notifs = (await db_session.execute(
            select(Notification).where(
                Notification.user_id == admin_id,
                Notification.type == "jira_sr_proposals_ready",
            )
        )).scalars().all()
        assert len(notifs) == 1, f"admin {admin_id} 알림 누락"
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd backend && uv run pytest tests/test_jira.py::test_process_jira_done_notifies_all_admins -v`
Expected: FAIL — admin 중 1명만 알림 받음 (`.limit(1)` 때문)

- [ ] **Step 3: `process_jira_done`을 admin 전원 발송으로 수정**

`backend/app/services/jira_service.py`의 라인 363-382 블록을 찾는다. 현재 코드:

```python
            if proposals_created > 0:
                try:
                    from app.routers.notifications import create_notification
                    from app.models.user import User
                    admin_result = await session.execute(
                        select(User).where(User.role == "admin").limit(1)
                    )
                    admin = admin_result.scalar_one_or_none()
                    if admin:
                        await create_notification(
                            session,
                            user_id=admin.id,
                            type="jira_sr_proposals_ready",
                            title=f"SR '{sr.title}' 완료 — 문서 수정안 {proposals_created}건 생성",
                            message="SR 페이지에서 검토하세요.",
                            document_id=None,
                            link_path="/sr",
                        )
                except Exception as e:
                    logger.warning(f"알림 전송 실패 (sr={sr_id}): {e}")
```

변경 후:

```python
            if proposals_created > 0:
                try:
                    from app.routers.notifications import create_notification
                    from app.models.user import User
                    admin_result = await session.execute(
                        select(User).where(User.role == "admin")
                    )
                    admins = admin_result.scalars().all()
                    for admin in admins:
                        await create_notification(
                            session,
                            user_id=admin.id,
                            type="jira_sr_proposals_ready",
                            title=f"SR '{sr.title}' 완료 — 문서 수정안 {proposals_created}건 생성",
                            message="SR 페이지에서 검토하세요.",
                            document_id=None,
                            link_path="/sr",
                        )
                except Exception as e:
                    logger.warning(f"알림 전송 실패 (sr={sr_id}): {e}")
```

(차이: `.limit(1)` 제거, `scalar_one_or_none()` → `scalars().all()`, `if admin:` 단일 분기 → `for admin in admins:` 루프.)

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd backend && uv run pytest tests/test_jira.py::test_process_jira_done_notifies_all_admins -v`
Expected: PASS

- [ ] **Step 5: 회귀 확인**

Run: `cd backend && uv run pytest tests/test_jira.py -v`
Expected: 모든 jira 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/jira_service.py backend/tests/test_jira.py
git commit -m "refactor(jira): notify all admins on proposals ready"
```

---

### Task 4: 전체 검증

**Files:** 없음 (검증만 수행)

- [ ] **Step 1: 백엔드 전체 테스트 실행**

Run: `cd backend && uv run pytest -v`
Expected: 모든 테스트 PASS (관련 테스트는 위 task에서 이미 검증, 회귀 없는지 확인)

- [ ] **Step 2: 린트 + 타입체크**

Run: `cd backend && uv run ruff check && uv run mypy .`
Expected: 오류 없음

- [ ] **Step 3 (수동): SSE 동작 확인 (선택)**

브라우저에서 `cd frontend && pnpm dev` 실행 후 admin 사용자로 로그인. 별도 터미널에서 webhook payload를 직접 POST해 알림 벨에 새 알림이 즉시 표시되는지 확인.

```bash
curl -X POST http://localhost:8000/api/jira/webhook \
  -H "Content-Type: application/json" \
  -d '{"webhookEvent":"jira:issue_updated","issue":{"key":"SCRUM-189","fields":{"status":{"name":"완료","statusCategory":{"key":"done"}}}}}'
```

(`SCRUM-189`에 매칭되는 SR이 DB에 미처리 상태로 존재해야 함.)
