import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.services import jira_service
from app.models.jira import JiraConfig


def make_config():
    cfg = JiraConfig()
    cfg.base_url = "https://test.atlassian.net"
    cfg.user_email = "test@example.com"
    cfg.api_token = "token123"
    cfg.project_key = "TEST"
    cfg.is_active = True
    cfg.trigger_status_names = None
    return cfg


def test_is_done_status_category():
    cfg = make_config()
    payload = {
        "issue": {
            "fields": {
                "status": {
                    "name": "완료됨",
                    "statusCategory": {"key": "done"},
                }
            }
        }
    }
    assert jira_service.is_done_transition(cfg, payload) is True


def test_is_done_custom_status_names_match():
    cfg = make_config()
    cfg.trigger_status_names = ["배포됨", "Done"]
    payload = {
        "issue": {
            "fields": {
                "status": {
                    "name": "배포됨",
                    "statusCategory": {"key": "indeterminate"},
                }
            }
        }
    }
    assert jira_service.is_done_transition(cfg, payload) is True


def test_is_done_custom_status_names_no_match():
    cfg = make_config()
    cfg.trigger_status_names = ["Done"]
    payload = {
        "issue": {
            "fields": {
                "status": {
                    "name": "In Progress",
                    "statusCategory": {"key": "indeterminate"},
                }
            }
        }
    }
    assert jira_service.is_done_transition(cfg, payload) is False


def test_mask_token():
    assert jira_service.mask_token("abcdefgh") == "****efgh"
    assert jira_service.mask_token("ab") == "****"


@pytest.mark.asyncio(loop_scope="session")
async def test_webhook_skipped_no_config(client):
    payload = {
        "webhookEvent": "jira:issue_updated",
        "issue": {
            "key": "TEST-999",
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
    assert resp.json()["status"] == "skipped"


@pytest.mark.asyncio(loop_scope="session")
async def test_process_jira_done_no_related_docs(client, db_session):
    """관련 문서가 없으면 log.status == skipped_no_docs"""
    import uuid
    from unittest.mock import patch
    from app.models.sr import SRDraft
    from app.models.jira import JiraCallbackLog
    from app.services import jira_service

    # 테스트 사용자 생성
    resp = await client.post("/api/users", json={
        "name": "Jira Test User",
        "email": f"jira_test_{uuid.uuid4().hex[:8]}@example.com",
        "role": "editor",
    })
    assert resp.status_code == 201
    user_id = uuid.UUID(resp.json()["id"])

    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=user_id,
        title="테스트 SR",
        description="설명",
        priority="medium",
        status="submitted",
        created_by_ai=False,
        target_url=None,
    )
    db_session.add(sr)
    await db_session.commit()

    log = JiraCallbackLog(
        id=uuid.uuid4(),
        jira_issue_key="TEST-100",
        event_type="jira:issue_updated",
        payload={},
        status="pending",
        sr_draft_id=sr.id,
    )
    db_session.add(log)
    await db_session.commit()

    with patch("app.services.jira_service._find_related_documents", return_value=[]):
        await jira_service.process_jira_done(sr.id, log.id, db=db_session)

    await db_session.refresh(log)
    assert log.status == "skipped_no_docs"


@pytest.mark.asyncio(loop_scope="session")
async def test_process_jira_done_creates_proposals(client, db_session):
    """관련 문서가 있으면 ProposedChange + ApprovalRequest 생성"""
    import uuid
    from unittest.mock import patch
    from app.models.sr import SRDraft
    from app.models.jira import JiraCallbackLog
    from app.models.document import Document, DocumentVersion
    from app.models.feedback import ProposedDocumentChange, ApprovalRequest
    from app.services import jira_service
    from sqlalchemy import select

    resp = await client.post("/api/users", json={
        "name": "Proposals Test User",
        "email": f"proposals_test_{uuid.uuid4().hex[:8]}@example.com",
        "role": "editor",
    })
    assert resp.status_code == 201
    user_id = uuid.UUID(resp.json()["id"])

    doc = Document(
        id=uuid.uuid4(), title="테스트 문서", description="설명",
        owner_id=user_id,
        status="active", priority="medium", trust_score=1.0,
    )
    db_session.add(doc)
    await db_session.flush()

    version = DocumentVersion(
        id=uuid.uuid4(), document_id=doc.id, version_number=1,
        content="기존 문서 내용",
        created_by=user_id,
        change_summary="초기",
    )
    db_session.add(version)
    await db_session.flush()
    doc.current_version_id = version.id

    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=user_id,
        title="기능 개선 요청", description="로그인 버튼 위치 변경",
        priority="medium", status="submitted",
        created_by_ai=False, target_url=None,
    )
    db_session.add(sr)
    await db_session.flush()
    log = JiraCallbackLog(
        id=uuid.uuid4(), jira_issue_key="TEST-200",
        event_type="jira:issue_updated", payload={},
        status="pending", sr_draft_id=sr.id,
    )
    db_session.add(log)
    await db_session.commit()

    mock_chunk = {
        "document_id": doc.id, "document_title": doc.title,
        "content": "기존 문서 내용", "distance": 0.2,
    }

    with patch("app.services.jira_service._find_related_documents", return_value=[mock_chunk]), \
         patch("app.services.llm_service.get_llm_provider") as mock_llm_factory:
        from unittest.mock import AsyncMock
        mock_llm = MagicMock()
        mock_llm.generate = AsyncMock(return_value="수정된 문서 내용")
        mock_llm_factory.return_value = mock_llm
        await jira_service.process_jira_done(sr.id, log.id, db=db_session)

    await db_session.refresh(log)
    assert log.status == "processed"

    proposals = (await db_session.execute(
        select(ProposedDocumentChange).where(ProposedDocumentChange.document_id == doc.id)
    )).scalars().all()
    assert len(proposals) == 1
    assert proposals[0].source_type == "jira_sr"

    approvals = (await db_session.execute(
        select(ApprovalRequest).where(ApprovalRequest.proposed_change_id == proposals[0].id)
    )).scalars().all()
    assert len(approvals) == 1


@pytest.mark.asyncio(loop_scope="session")
async def test_process_jira_done_no_playwright_without_target_url(client, db_session):
    """target_url 없으면 capture_screenshots 미호출"""
    import uuid
    from unittest.mock import patch, MagicMock
    from app.models.sr import SRDraft
    from app.models.jira import JiraCallbackLog
    from app.models.document import Document, DocumentVersion
    from app.services import jira_service

    resp = await client.post("/api/users", json={
        "name": "No Playwright Test User",
        "email": f"no_playwright_{uuid.uuid4().hex[:8]}@example.com",
        "role": "editor",
    })
    assert resp.status_code == 201
    user_id = uuid.UUID(resp.json()["id"])

    doc = Document(
        id=uuid.uuid4(), title="문서3", description="설명",
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
        id=uuid.uuid4(),
        user_id=user_id,
        title="SR no url", description="설명",
        priority="medium", status="submitted",
        created_by_ai=False, target_url=None,
    )
    db_session.add(sr)
    await db_session.flush()
    log = JiraCallbackLog(
        id=uuid.uuid4(), jira_issue_key="TEST-300",
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
        from unittest.mock import AsyncMock
        import json
        mock_llm = MagicMock()
        mock_llm.generate = AsyncMock(return_value=json.dumps({
            "needs_update": True,
            "strategy": "update_existing",
            "confidence": 0.9,
            "reasoning": "test",
        }))
        mock_llm_factory.return_value = mock_llm
        await jira_service.process_jira_done(sr.id, log.id, db=db_session)


# === Phase 1: 중복 webhook 방지 테스트 ===


@pytest.mark.asyncio(loop_scope="session")
async def test_webhook_skips_already_done_sr(client, db_session):
    """김운영: 이미 처리된 SR의 중복 webhook은 스킵"""
    import uuid
    from app.models.sr import SRDraft
    from app.models.jira import JiraConfig

    resp = await client.post("/api/users", json={
        "name": "Dup Test User",
        "email": f"dup_test_{uuid.uuid4().hex[:8]}@example.com",
        "role": "editor",
    })
    assert resp.status_code == 201
    user_id = uuid.UUID(resp.json()["id"])

    config = JiraConfig(
        id=uuid.uuid4(),
        base_url="https://test.atlassian.net",
        user_email="test@example.com",
        api_token="token",
        project_key="TEST",
        is_active=True,
        trigger_status_names=None,
    )
    db_session.add(config)

    unique_key = f"TEST-DUP-{uuid.uuid4().hex[:6]}"
    sr = SRDraft(
        id=uuid.uuid4(),
        user_id=user_id,
        title="이미 완료된 SR",
        description="설명",
        priority="medium",
        status="done_synced",
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
    data = resp.json()
    assert data["status"] == "skipped"
    assert data["reason"] == "SR already processed"
